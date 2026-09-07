/**
 * Codex / ChatGPT 订阅的额度窗口。
 *
 *   GET https://chatgpt.com/backend-api/wham/usage
 *   Authorization: Bearer <access_token>
 *   ChatGPT-Account-Id: <account_id>
 *
 * ## 为什么是 /wham/usage 而不是别的路径
 *
 * `chatgpt.com/backend-api` 大部分路径挂着 Cloudflare，裸 HTTP 客户端打过去返回
 * 403 的 HTML 质询页——手机上没有浏览器环境，那条路是走不通的。实测对比：
 *
 *   /backend-api/me          -> 403  text/html   （Cloudflare 质询）
 *   /backend-api/wham/usage  -> 401  application/json  （干净的鉴权失败）
 *
 * `wham/usage` 这条没有质询，所以 Scripting 的 fetch 能直接用。这也是参考实现
 * （kimi-code-usage 的 codex.py）选它的原因，它的注释里写着「for cloudscraper bypass」。
 *
 * ## 凭据从哪来
 *
 * Codex CLI 登录后写在 `~/.codex/auth.json`：`tokens.access_token` 和
 * `tokens.account_id`，`auth_mode` 应当是 `"chatgpt"`。用 `dev/get_codex_token.sh`
 * 一次取全。
 *
 * **access_token 会过期。** 所以这里支持填 `refresh_token`：401 时自动去
 * `auth.openai.com/oauth/token` 换一个新的，通过 ctx.updateConfig 存回配置，
 * 再重试一次。ctx.updateConfig 这个口子当初就是为这种情况留的。
 *
 * ## 返回结构
 *
 *   { rate_limit: { primary_window: {...}, secondary_window: {...} }, credits: { balance } }
 *
 * 每个窗口带 `used_percent` 和 `limit_window_seconds`（604800 是 7 天，18000 是 5 小时）。
 * 字段名来自参考实现，重置时间那几个键它没用上，这里做了多种拼法的兜底——
 * 拿不到就只显示百分比，不编一个假的倒计时出来。
 */
import type { Metric, Provider, ProviderResult } from "./types"
import { describeHttpError, getPath, num, requestJson, toEpochMs, windowLabel } from "./util"

const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage"
const TOKEN_URL = "https://auth.openai.com/oauth/token"
/** Codex CLI 自己用的 OAuth 客户端 id，公开值，不是密钥。 */
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"

export const codexProvider: Provider = {
  id: "codex",
  name: "Codex / ChatGPT",
  icon: "chevron.left.slash.chevron.right",
  color: "#10A37F",
  help:
    "读 ChatGPT 订阅的 5 小时 / 7 天用量窗口。凭据在 Codex CLI 登录后写的 " +
    "~/.codex/auth.json 里，跑 dev/get_codex_token.sh 一次取全。" +
    "access_token 会过期，把 refresh_token 也填上就能自动续。",
  fields: [
    {
      key: "accessToken",
      label: "access_token",
      secret: true,
      required: true,
      placeholder: "eyJ...",
      help: "auth.json 里 tokens.access_token。",
    },
    {
      key: "accountId",
      label: "account_id",
      required: true,
      help: "auth.json 里 tokens.account_id，会作为 ChatGPT-Account-Id 头发出去。",
    },
    {
      key: "refreshToken",
      label: "refresh_token",
      secret: true,
      help: "可选但强烈建议填。填了之后 access_token 过期能自动换新的，不用再手动取一次。",
    },
  ],
  async fetch(config, ctx): Promise<ProviderResult> {
    const accountId = (config.accountId ?? "").trim()
    if (!accountId) throw new Error("没填 account_id")

    let token = (config.accessToken ?? "").trim()
    let resp = await getUsage(token, accountId, ctx.timeoutSec)

    // 过期就换一个再来一次。只重试一次——第二次还 401 就是真的要重新登录了。
    if (resp.status === 401) {
      const refreshToken = (config.refreshToken ?? "").trim()
      if (!refreshToken) {
        throw new Error(
          "access_token 无效或已过期 (401)。填上 refresh_token 可以自动续；" +
            "或者重新跑一次 codex login 再取一次凭据。",
        )
      }
      if (!ctx.allowTokenRefresh) {
        throw new Error(
          "access_token 已过期，而上一次换新的也失败了，正在退避中（半小时内不再重试）。" +
            "多半是 refresh_token 也失效了——在电脑上重新跑一次 codex login 再取一次凭据。",
        )
      }
      let refreshed
      try {
        refreshed = await refreshAccessToken(refreshToken, ctx.timeoutSec)
      } catch (error) {
        ctx.onTokenRefreshFailed()
        throw error
      }
      token = refreshed.accessToken
      ctx.updateConfig({
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
      })
      resp = await getUsage(token, accountId, ctx.timeoutSec)
      if (resp.status === 401) {
        throw new Error("换过 token 之后仍然 401，需要重新跑 codex login。")
      }
    }

    ctx.captureRaw(resp.text)

    // Cloudflare 质询会返回 HTML；这条路径实测不该发生，真发生了要说清楚，
    // 否则症状会是「JSON 解析不出来」这种毫无指向的报错。
    if (!resp.ok && resp.json === undefined && resp.text.startsWith("<")) {
      throw new Error(`被 Cloudflare 拦了 (${resp.status})，这条路径在手机上走不通`)
    }
    if (!resp.ok) throw new Error(describeHttpError(resp, "读取用量失败"))

    const metrics = parseUsage(resp.json)
    if (metrics.length === 0) {
      throw new Error("返回里没有可识别的用量窗口，请在详情页查看原始响应")
    }
    return { metrics }
  },
}

function getUsage(token: string, accountId: string, timeoutSec: number) {
  return requestJson(
    USAGE_URL,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "ChatGPT-Account-Id": accountId,
      },
    },
    timeoutSec,
  )
}

async function refreshAccessToken(
  refreshToken: string,
  timeoutSec: number,
): Promise<{ accessToken: string; refreshToken: string }> {
  const body =
    `grant_type=refresh_token` +
    `&refresh_token=${encodeURIComponent(refreshToken)}` +
    `&client_id=${encodeURIComponent(CLIENT_ID)}`

  const resp = await requestJson(
    TOKEN_URL,
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body },
    timeoutSec,
  )
  const next = getPath(resp.json, "access_token")
  if (!resp.ok || typeof next !== "string" || !next) {
    // 这里之前只说「刷新被拒 (200)」——状态码 200 配「被拒」，而且没说服务器
    // 到底返回了什么。只能靠错误文字排查的界面上，那种消息等于没有。
    const known =
      getPath(resp.json, "error_description") ?? getPath(resp.json, "error") ?? getPath(resp.json, "message")
    const detail =
      typeof known === "string" && known.trim()
        ? `${known.trim()} (HTTP ${resp.status})`
        : `HTTP ${resp.status}，服务器返回：${resp.text.trim().slice(0, 300) || "（空）"}`
    throw new Error(`换 token 失败：${detail}`)
  }
  const rotated = getPath(resp.json, "refresh_token")
  return {
    accessToken: next,
    // 有的实现会轮换 refresh_token，返回了就换掉，没返回就沿用旧的
    refreshToken: typeof rotated === "string" && rotated ? rotated : refreshToken,
  }
}

/** 导出给测试。 */
export function parseUsage(json: unknown): Metric[] {
  const metrics: Metric[] = []
  const rateLimit = getPath(json, "rate_limit")

  for (const key of ["primary_window", "secondary_window"] as const) {
    const node = getPath(rateLimit, key)
    const percent = num(getPath(node, "used_percent"))
    if (percent === undefined) continue
    const seconds = num(getPath(node, "limit_window_seconds"))
    metrics.push({
      id: key,
      label: windowLabel(seconds, key === "primary_window" ? "主窗口" : "次窗口"),
      kind: "percent",
      // used_percent 就是 0–100，不像 Anthropic 那边是 0–1
      value: percent,
      resetAt: resetOf(node),
    })
  }

  // 有些账户还带一个额度余额
  const balance = getPath(json, "credits.balance")
  const parsed = num(balance)
  if (parsed !== undefined) {
    metrics.push({ id: "credits", label: "额度余额", kind: "amount", value: parsed, unit: "$" })
  }

  return metrics
}

/**
 * 重置时间。参考实现没有取这个字段，所以键名是猜的，多试几种拼法；
 * 都拿不到就返回 undefined —— 宁可不显示倒计时，也不编一个假的出来。
 */
function resetOf(node: unknown): number | undefined {
  const direct =
    toEpochMs(getPath(node, "resets_at")) ??
    toEpochMs(getPath(node, "reset_at")) ??
    toEpochMs(getPath(node, "resets_at_seconds"))
  if (direct !== undefined) return direct
  const seconds =
    num(getPath(node, "resets_in_seconds")) ??
    num(getPath(node, "reset_after_seconds")) ??
    num(getPath(node, "resets_in"))
  return seconds !== undefined ? Date.now() + seconds * 1000 : undefined
}
