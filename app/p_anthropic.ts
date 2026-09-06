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
import { describeHttpError, getPath, num, toEpochMs, windowLabel } from "./util"

/** 已知窗口键 -> 显示名。左边写了几种可能的拼法，命中一个就够。 */
const WINDOWS: { keys: string[]; label: string }[] = [
  { keys: ["five_hour", "fiveHour", "5h", "session"], label: "5 小时" },
  { keys: ["seven_day", "sevenDay", "7d", "week", "weekly"], label: "7 天" },
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
    "需要 Claude Code 的 OAuth access token（sk-ant-oat...），不是 API Key。" +
    "Mac 上在钥匙串里找 Claude Code 那一条，或读 ~/.claude/.credentials.json 的 accessToken。" +
    "这是非公开接口，Anthropic 改了返回结构这里就会报「无法识别的结构」——那时到详情页看原始响应，改用「自定义 JSON 接口」顶上。",
  fields: [
    {
      key: "token",
      label: "OAuth Access Token",
      secret: true,
      required: true,
      placeholder: "sk-ant-oat01-...",
      help: "token 有有效期，过期后要重新取一次。",
    },
  ],
  async fetch(config, ctx): Promise<ProviderResult> {
    const token = config.token?.trim() ?? ""
    const response = await fetch("https://api.anthropic.com/api/oauth/usage", {
      headers: {
        Authorization: `Bearer ${token}`,
        "anthropic-beta": "oauth-2025-04-20",
        "Content-Type": "application/json",
      },
      timeout: ctx.timeoutSec,
    })
    const text = await response.text()
    ctx.captureRaw(text)

    let json: unknown = undefined
    try {
      json = text ? JSON.parse(text) : undefined
    } catch {
      json = undefined
    }

    if (!response.ok) {
      throw new Error(
        describeHttpError({ status: response.status, ok: false, json, text }, "读取用量失败"),
      )
    }

    const metrics = parseUsage(json)
    if (metrics.length === 0) {
      throw new Error("接口返回了无法识别的结构，请在详情页查看原始响应")
    }
    return { metrics, plan: readPlan(json) }
  },
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
