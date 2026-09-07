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
import {
  describeHttpError,
  getPath,
  explainAuthFailure,
  looksLikeHtml,
  num,
  requestJson,
  toEpochMs,
  windowLabel,
} from "./util"

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
    "读 ChatGPT 订阅的 5 小时 / 7 天用量窗口。凭据来自 codex login 写的 ~/.codex/auth.json。" +
    "⚠️ refresh_token 和电脑上的 CLI 共用同一个 token 家族，两边都续期会互相作废——" +
    "如果你经常用 Codex CLI，建议只填 access_token（几小时重取一次），别填 refresh_token。",
  fields: [
    {
      key: "accountId",
      label: "account_id",
      required: true,
      help:
        "auth.json 里 tokens.account_id，作为 ChatGPT-Account-Id 请求头发出去。" +
        "它不在 token 里，换不出来，所以必须填。",
    },
    {
      key: "accessToken",
      label: "access_token",
      secret: true,
      placeholder: "eyJ...",
      help:
        "auth.json 里 tokens.access_token。只填这个最安全——不碰 token 家族，" +
        "不会影响电脑上的 CLI。代价是几小时后要回电脑重取一次。",
    },
    {
      key: "refreshToken",
      label: "refresh_token（可选，有代价）",
      secret: true,
      help:
        "填了能自动续期，但**和电脑上的 CLI 共用同一个 token 家族**。" +
        "OAuth 的 refresh token 每次使用都会轮换并作废旧的，两边各续各的就会互相踢掉，" +
        "严重时整个家族被撤销、两边一起登出。经常用 CLI 的话别填。",
    },
  ],
  async fetch(config, ctx): Promise<ProviderResult> {
    const accountId = (config.accountId ?? "").trim()
    if (!accountId) throw new Error("没填 account_id")

    let token = (config.accessToken ?? "").trim()
    const refreshToken = (config.refreshToken ?? "").trim()

    if (!token && !refreshToken) {
      throw new Error("至少要填 access_token（或 refresh_token）。")
    }

    // 没有 access_token 就直接去换，不发那个注定 401 的请求。
    if (!token) {
      if (!ctx.allowTokenRefresh) {
        throw new Error("上一次换 token 失败，正在退避中（半小时内不再重试）。")
      }
      try {
        const first = await refreshAccessToken(refreshToken, ctx.timeoutSec, ctx.captureRaw)
        token = first.accessToken
        ctx.updateConfig({ accessToken: first.accessToken, refreshToken: first.refreshToken })
      } catch (error) {
        ctx.onTokenRefreshFailed()
        throw error
      }
    }

    let resp = await getUsage(token, accountId, ctx.timeoutSec)

    // 过期就换一个再来一次。只重试一次——第二次还 401 就是真的要重新登录了。
    if (resp.status === 401) {
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
        refreshed = await refreshAccessToken(refreshToken, ctx.timeoutSec, ctx.captureRaw)
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
    if (resp.status === 429) {
      // 服务器明确要求停下来。上报之后，调用方会在这段时间内完全不碰这个账户。
      ctx.onRateLimited(resp.retryAfterSec)
      const mins = resp.retryAfterSec ? Math.ceil(resp.retryAfterSec / 60) : undefined
      throw new Error(
        `被限流 (429)${mins ? `，服务器要求等 ${mins} 分钟` : ""}。` +
          "这个端点对鉴权失败的容忍度很低——连续几次失败就会锁一段时间，" +
          "期间本来能成功的请求也会一起挡掉。已经暂停对这个账户的请求。",
      )
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
  captureRaw?: (text: string) => void,
): Promise<{ accessToken: string; refreshToken: string }> {
  const body =
    `grant_type=refresh_token` +
    `&refresh_token=${encodeURIComponent(refreshToken)}` +
    `&client_id=${encodeURIComponent(CLIENT_ID)}`

  const resp = await requestJson(
    TOKEN_URL,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        // 参考实现（kimi-code-usage 的 codex.py）打这个端点用的是 cloudscraper，
        // 说明它挂着 Cloudflare。带上浏览器味道的头是我们能做的最低成本尝试；
        // 挡不住的话下面会明确报出来，而不是含糊地说「HTTP 200」。
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 " +
          "(KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
        "Accept-Language": "en-US,en;q=0.9",
      },
      body,
    },
    timeoutSec,
  )
  // 换 token 的响应也留给诊断页 —— 这一步失败时，原文是唯一能定位的东西
  captureRaw?.(resp.text)

  if (looksLikeHtml(resp.text)) {
    throw new Error(
      `换 token 时收到的是网页而不是 JSON（HTTP ${resp.status}）。` +
        "这几乎肯定是 Cloudflare 的验证页——它需要浏览器环境，手机上的 fetch 过不去。" +
        "解决办法：在电脑上重新取一次 access_token 填进来（那个能直接用），" +
        "或者等一段时间换个网络再试。完整响应见下面的「原始响应」，可以复制。",
    )
  }
  const next = getPath(resp.json, "access_token")
  if (!resp.ok || typeof next !== "string" || !next) {
    // 这里之前只说「刷新被拒 (200)」——状态码 200 配「被拒」，而且没说服务器
    // 到底返回了什么。只能靠错误文字排查的界面上，那种消息等于没有。
    const explained = explainAuthFailure(resp.json, resp.text)
    if (explained) throw new Error(explained)
    throw new Error(
      `换 token 失败：HTTP ${resp.status}，服务器返回：${resp.text.trim().slice(0, 500) || "（空）"}`,
    )
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
