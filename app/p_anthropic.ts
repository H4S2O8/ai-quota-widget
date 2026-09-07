/**
 * Claude 订阅用量（Pro / Max 的 5 小时与 7 天窗口）。
 *
 * 用的是 Claude Code 自己在用的那个 OAuth 端点：
 *   GET https://api.anthropic.com/api/oauth/usage
 *   Authorization: Bearer <sk-ant-oat...>
 *   anthropic-beta: oauth-2025-04-20
 *
 * 端点确实存在（拿无效 token 打过去会返回 401 authentication_error，不是 404），
 * 但 **它不是公开文档化的接口，返回结构是推断出来的**：这里按
 * five_hour / seven_day / seven_day_opus 三个窗口去认，每个窗口取 utilization
 * 和 resets_at。为了不在字段名变了的时候静默显示 0，解析分三层：
 *
 *   1. 认已知窗口键（连同几种可能的写法）
 *   2. 认「一个数组，每项带 utilization / resets_at」的通用形状
 *   3. 都不认识 -> 抛错，并把原始 JSON 留给诊断页
 *
 * 第 3 条是关键：宁可红着报错，也不要绿着显示一个假的 0%。
 */
import type { Metric, Provider, ProviderResult } from "./types"
import { describeHttpError, getPath, num, requestJson, toEpochMs, windowLabel } from "./util"

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage"
const TOKEN_URL = "https://api.anthropic.com/v1/oauth/token"
/**
 * Claude Code 自己的 OAuth 客户端 id。公开值，不是密钥。
 *
 * 验证方式：拿它配一个伪造的 refresh_token 打 TOKEN_URL，返回的是
 * `invalid_grant`（refresh token 无效）而不是 `invalid_client`——
 * 说明 client_id 这一半是被接受的。
 */
const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"

/** 已知窗口键 -> 显示名。左边写了几种可能的拼法，命中一个就够。 */
const WINDOWS: { keys: string[]; label: string }[] = [
  { keys: ["five_hour", "fiveHour", "5h", "session"], label: "5 小时" },
  { keys: ["seven_day", "sevenDay", "7d", "week", "weekly"], label: "7 天" },
  { keys: ["seven_day_sonnet", "sevenDaySonnet", "7d_sonnet"], label: "7 天 Sonnet" },
  { keys: ["seven_day_opus", "sevenDayOpus", "7d_opus", "weekly_opus"], label: "7 天 Opus" },
  { keys: ["seven_day_oauth_apps", "sevenDayOauthApps"], label: "7 天 · 第三方应用" },
]

/** 从一个窗口对象里抠出「已用百分比」。接受 0–1 的小数和 0–100 的整数两种。 */
function utilizationOf(node: unknown): number | undefined {
  const raw =
    num(getPath(node, "utilization")) ??
    num(getPath(node, "used_percent")) ??
    num(getPath(node, "usedPercent")) ??
    num(getPath(node, "percent")) ??
    num(getPath(node, "usage"))
  if (raw === undefined) return undefined
  // 0.42 和 42 都可能是「42%」。<= 1 一律当小数——真有 1% 的时候少显示 1%，
  // 比把 0.42 显示成 0% 强。
  return raw <= 1 ? raw * 100 : raw
}

function resetOf(node: unknown): number | undefined {
  return (
    toEpochMs(getPath(node, "resets_at")) ??
    toEpochMs(getPath(node, "resetsAt")) ??
    toEpochMs(getPath(node, "reset_at")) ??
    toEpochMs(getPath(node, "resets"))
  )
}

export const anthropicProvider: Provider = {
  id: "anthropic",
  name: "Claude 订阅",
  icon: "sparkle",
  color: "#D97757",
  help:
    "需要 Claude Code 的 OAuth token（sk-ant-oat...），不是 API Key。" +
    "跑 dev/get_claude_token.sh 一次取全。**access token 只有几个小时的寿命**，" +
    "所以 refresh token 也要填——填了就能自动续，不用每次过期都重取一遍。",
  fields: [
    {
      key: "token",
      label: "Access Token",
      secret: true,
      required: true,
      placeholder: "sk-ant-oat01-...",
      help: "凭据文件里的 accessToken。它是短命的，见下。",
    },
    {
      key: "refreshToken",
      label: "Refresh Token",
      secret: true,
      help:
        "凭据文件里的 refreshToken。填了之后 access token 过期会自动换新的。" +
        "不填的话每隔几小时就要手动重取一次——这不是这里做得不好，" +
        "OAuth 的 access token 本来就是设计成短命的。",
    },
  ],
  async fetch(config, ctx): Promise<ProviderResult> {
    let token = config.token?.trim() ?? ""
    let resp = await getUsage(token, ctx.timeoutSec)

    // access token 是短命的（几小时），过期就换一个再来一次。
    // 只重试一次：第二次还 401 就是 refresh token 也失效了，得重新登录。
    if (resp.status === 401) {
      const refreshToken = config.refreshToken?.trim() ?? ""
      if (!refreshToken) {
        throw new Error(
          "access token 已过期 (401)。它本来就只有几个小时的寿命——" +
            "把 refresh token 也填上就能自动续，不用每次手动重取。",
        )
      }
      if (!ctx.allowTokenRefresh) {
        throw new Error(
          "access token 已过期，而上一次换新的也失败了，正在退避中（半小时内不再重试）。" +
            "多半是 refresh token 也过期或被轮换掉了——回电脑上重新取一次凭据。",
        )
      }
      let refreshed
      try {
        refreshed = await refreshTokens(refreshToken, ctx.timeoutSec)
      } catch (error) {
        // 告诉调用方去退避。不退避的话，每次渲染都来换一遍，
        // 很快会把 token 端点打成 429，那时连错误信息都会变得看不懂。
        ctx.onTokenRefreshFailed()
        throw error
      }
      token = refreshed.accessToken
      ctx.updateConfig({ token: refreshed.accessToken, refreshToken: refreshed.refreshToken })
      resp = await getUsage(token, ctx.timeoutSec)
      if (resp.status === 401) {
        throw new Error("换过 token 之后仍然 401，refresh token 也失效了，需要在电脑上重新登录 Claude Code。")
      }
    }

    ctx.captureRaw(resp.text)
    if (!resp.ok) throw new Error(describeHttpError(resp, "读取用量失败"))

    const metrics = parseUsage(resp.json)
    if (metrics.length === 0) {
      throw new Error("接口返回了无法识别的结构，请在详情页查看原始响应")
    }
    return { metrics, plan: readPlan(resp.json) }
  },
}

function getUsage(token: string, timeoutSec: number) {
  return requestJson(
    USAGE_URL,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "anthropic-beta": "oauth-2025-04-20",
        "Content-Type": "application/json",
      },
    },
    timeoutSec,
  )
}

/**
 * 用 refresh token 换一对新的。
 *
 * 端点和 client_id 都探过：伪造的 refresh_token 打过去返回 `invalid_grant`
 * 而不是 `invalid_client`，说明这两样是对的。
 */
async function refreshTokens(
  refreshToken: string,
  timeoutSec: number,
): Promise<{ accessToken: string; refreshToken: string }> {
  const resp = await requestJson(
    TOKEN_URL,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: CLIENT_ID,
      }),
    },
    timeoutSec,
  )
  const next = getPath(resp.json, "access_token")
  if (!resp.ok || typeof next !== "string" || !next) {
    throw new Error(`换 token 失败：${refreshFailureDetail(resp)}`)
  }
  const rotated = getPath(resp.json, "refresh_token")
  return {
    accessToken: next,
    // refresh token 通常会轮换，返回了就换掉，没返回就沿用旧的
    refreshToken: typeof rotated === "string" && rotated ? rotated : refreshToken,
  }
}

/**
 * 换 token 失败时给一句能定位的话。
 *
 * 之前这里只输出「刷新被拒 (200)」——状态码是 200，措辞却是「被拒」，
 * 而且一个字都没说服务器实际返回了什么。**在一个只能靠错误文字排查的界面上，
 * 这种消息等于没有。** 现在把响应体也带出来。
 */
function refreshFailureDetail(resp: { status: number; json: unknown; text: string }): string {
  const known =
    getPath(resp.json, "error_description") ??
    getPath(resp.json, "error.message") ??
    getPath(resp.json, "error") ??
    getPath(resp.json, "message")
  if (typeof known === "string" && known.trim()) return `${known.trim()} (HTTP ${resp.status})`
  const body = resp.text.trim()
  if (!body) return `HTTP ${resp.status}，响应体是空的`
  return `HTTP ${resp.status}，服务器返回：${body.slice(0, 300)}`
}

/** 导出给 dev/ 的测试用：解析逻辑要能在没有网络的情况下单独验。 */
export function parseUsage(json: unknown): Metric[] {
  const root = (getPath(json, "usage") as unknown) ?? json
  const metrics: Metric[] = []

  // 第 1 层：已知窗口键
  for (const window of WINDOWS) {
    for (const key of window.keys) {
      const node = getPath(root, key)
      if (node === undefined || node === null) continue
      const value = utilizationOf(node)
      if (value === undefined) continue
      metrics.push({
        id: key,
        label: window.label,
        kind: "percent",
        value,
        resetAt: resetOf(node),
      })
      break
    }
  }
  if (metrics.length > 0) return metrics

  // 第 2 层：数组形状
  const list = Array.isArray(root)
    ? root
    : Array.isArray(getPath(root, "limits"))
      ? (getPath(root, "limits") as unknown[])
      : Array.isArray(getPath(root, "windows"))
        ? (getPath(root, "windows") as unknown[])
        : []
  for (let i = 0; i < list.length; i++) {
    const value = utilizationOf(list[i])
    if (value === undefined) continue
    const seconds = num(getPath(list[i], "window_seconds")) ?? num(getPath(list[i], "windowSeconds"))
    const name = getPath(list[i], "name") ?? getPath(list[i], "type")
    metrics.push({
      id: typeof name === "string" ? name : `window${i}`,
      label: typeof name === "string" ? name : windowLabel(seconds, `窗口 ${i + 1}`),
      kind: "percent",
      value,
      resetAt: resetOf(list[i]),
    })
  }
  return metrics
}

function readPlan(json: unknown): string | undefined {
  const candidates = ["plan", "subscription_type", "subscriptionType", "account.plan", "tier"]
  for (const path of candidates) {
    const value = getPath(json, path)
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return undefined
}
