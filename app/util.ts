/**
 * 无依赖的小工具：取 JSON 路径、数字解析、HTTP 请求包装、格式化。
 * 这个文件不 import "scripting"，所以 dev/ 里的 node 测试可以直接跑它。
 */
import type { Metric, MetricKind } from "./types"

/** 按 "data.items[0].balance" 这种路径取值；任何一步取不到就返回 undefined */
export function getPath(obj: unknown, path: string): unknown {
  if (!path) return obj
  const parts = path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter((p) => p.length > 0)
  let cur: unknown = obj
  for (const part of parts) {
    if (cur === null || cur === undefined) return undefined
    if (typeof cur !== "object") return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}

/** 服务商经常把数字当字符串返回（"12.34"），统一转成 number；转不了给 undefined */
export function num(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined
  if (typeof value === "string") {
    const trimmed = value.trim().replace(/,/g, "")
    if (!trimmed) return undefined
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

/** ISO 字符串 / epoch 秒 / epoch 毫秒 → epoch 毫秒 */
export function toEpochMs(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 1e11 ? value * 1000 : value
  }
  if (typeof value === "string") {
    const asNumber = num(value)
    if (asNumber !== undefined && /^\d+(\.\d+)?$/.test(value.trim())) return toEpochMs(asNumber)
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

export interface JsonResponse {
  status: number
  ok: boolean
  json: unknown
  text: string
  /** 服务器要求的等待秒数（429 时的 retry-after 头）。没有就是 undefined。 */
  retryAfterSec?: number
}

/**
 * fetch + 解析 JSON，一处统一超时与错误措辞。
 * 非 2xx 不抛错，由调用方决定怎么解释（有的服务商在 4xx 里也带业务信息）。
 */
export async function requestJson(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string },
  timeoutSec: number,
): Promise<JsonResponse> {
  // 超时用 AbortController + setTimeout 自己实现，不只依赖 fetch 的 timeout 选项。
  //
  // 两个理由：
  // 1. `timeout` 是 Scripting 给 fetch 加的私有扩展，node 不认。只写它的话，
  //    dev/ 里的测试永远测不到超时行为——而超时恰恰是最容易出错的一条路径。
  //    Command Code 的 whoami 把整个抓取拖死那个 bug，就是因为没测到。
  // 2. AbortController 那条路在官方 fetch 文档里有完整用例，setTimeout 也是
  //    脚本环境唯一保证可用的定时器。两者都是文档化的写法。
  //
  // 两个都传：平台的原生超时先生效也好，没生效也有这条兜底。
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort("timeout"), Math.max(1, timeoutSec) * 1000)
  try {
    const response = await fetch(url, {
      method: init.method ?? "GET",
      headers: init.headers,
      body: init.body,
      // `timeout` 是 Scripting 给 fetch 加的私有扩展，标准 RequestInit 里没有，
      // 所以这里要断言一下才能过类型检查。真正兜底的是上面的 AbortController。
      timeout: timeoutSec,
      signal: controller.signal,
    } as RequestInit & { timeout: number })
    const text = await response.text()
    let json: unknown = undefined
    try {
      json = text ? JSON.parse(text) : undefined
    } catch {
      json = undefined
    }
    return {
      status: response.status,
      ok: response.ok,
      json,
      text,
      retryAfterSec: parseRetryAfter(response.headers),
    }
  } finally {
    // 成功也要清，否则定时器一直挂到超时才释放
    clearTimeout(timer)
  }
}

/**
 * 读 `retry-after` 头。
 *
 * 429 的时候服务器会明确告诉你等多久（实测 Anthropic 给的是将近一小时）。
 * 不读它就只能瞎猜，而猜短了会把限流窗口顶得更长。
 */
function parseRetryAfter(headers: unknown): number | undefined {
  try {
    const raw = (headers as { get?: (n: string) => string | null } | undefined)?.get?.("retry-after")
    if (!raw) return undefined
    const seconds = Number(raw)
    if (Number.isFinite(seconds) && seconds > 0) return seconds
    // 也可能是 HTTP 日期格式
    const at = Date.parse(raw)
    if (Number.isFinite(at)) return Math.max(0, Math.round((at - Date.now()) / 1000))
    return undefined
  } catch {
    return undefined
  }
}

/**
 * 响应体看起来是不是 HTML。
 *
 * 一个返回 JSON 的接口忽然回 HTML，几乎总是同一件事：中间有东西把请求截胡了——
 * Cloudflare 的验证页、登录跳转、或者网络里的门户。这种情况下报「HTTP 200」
 * 是最误导人的说法，因为状态码确实是 200，问题在内容。
 */
export function looksLikeHtml(text: string): boolean {
  const head = text.slice(0, 400).trim().toLowerCase()
  return head.startsWith("<!doctype html") || head.startsWith("<html") || head.startsWith("<")
}

/**
 * 把「refresh token 被作废」这类回复翻译成能照着做的话。
 *
 * 服务器原话是 "Your refresh token has been invalidated. Please try signing in again."
 * ——它没说**为什么**被作废，而原因几乎总是同一个：这个 refresh token 被两个客户端
 * 共用了。OAuth 的 refresh token 每次使用都会轮换并作废旧的；旧的再被用一次，
 * 会被判定为重放（可能是被盗），于是整个 token 家族一起撤销，两边都登出。
 */
export function explainAuthFailure(json: unknown, text: string): string | undefined {
  const code = getPath(json, "error.code") ?? getPath(json, "error")
  const message = getPath(json, "error.message") ?? getPath(json, "error_description")
  const codeStr = typeof code === "string" ? code : ""
  const msgStr = typeof message === "string" ? message : ""

  if (codeStr === "refresh_token_invalidated" || /invalidated/i.test(msgStr)) {
    return (
      "这台手机上的 refresh token 已经过期了——不是它坏了，是被换掉了。\n\n" +
      "OAuth 的 refresh token 每次使用都会轮换：电脑上的 CLI 每续期一次，" +
      "就会签发一个新的并作废旧的。你粘过来的是当时那一份，CLI 之后又续过，" +
      "手里这份就成了旧的。\n\n" +
      "怎么办：在电脑上跑一次取凭据的脚本，把最新的整段 JSON 复制过来，" +
      "在这一页点「粘贴凭据」一键填入。只要电脑上的 CLI 还在用，这一步就得偶尔重做一次；" +
      "想彻底免掉，就改成只填 access token（不碰轮换，但几小时要重取一次）。"
    )
  }
  if (codeStr === "invalid_grant" || /not found or invalid/i.test(msgStr)) {
    return "refresh token 无效或已过期。在电脑上重新登录一次再取。"
  }
  if (msgStr) return msgStr
  return text.trim() ? undefined : undefined
}

/**
 * 从一段 JSON（CLI 的凭据文件原文）里认出凭据字段。
 *
 * 各家的键名不一样（`access_token` / `accessToken` / `token`），层级也不一样，
 * 所以按「归一化名字」在整棵树里找，而不是写死路径。
 *
 * 存在的理由很实际：带轮换的 refresh token 被电脑上的 CLI 换掉之后，手机这份就废了，
 * 需要重新同步。如果重新同步意味着在手机上手打三个长字符串，那没人会去做——
 * 于是这个功能实际上就是不可用的。一键粘贴才让「偶尔重同步」变成可以接受的方案。
 */
export function extractCredentials(text: string): Record<string, string> {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return {}
  }
  const found: Record<string, string> = {}
  const norm = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, "")

  const walk = (node: unknown) => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item)
      return
    }
    if (!node || typeof node !== "object") return
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (typeof value === "string" && value) {
        const n = norm(key)
        // 先到先得：外层的通常是正主，嵌套深处可能是历史残留
        if (!(n in found)) found[n] = value
      } else {
        walk(value)
      }
    }
  }
  walk(json)
  return found
}

/** 把认出来的凭据映射到某个字段上。`token` 也认 access token。 */
export function credentialFor(fieldKey: string, found: Record<string, string>): string | undefined {
  const n = fieldKey.toLowerCase().replace(/[^a-z0-9]/g, "")
  const candidates =
    n === "token" ? ["token", "accesstoken"] : n === "accesstoken" ? ["accesstoken", "token"] : [n]
  for (const c of candidates) {
    if (found[c]) return found[c]
  }
  return undefined
}

/** 读剪贴板。Pasteboard 是现行 API，Clipboard 是废弃的旧名。 */
export function readClipboard(): string {
  try {
    const pb = (globalThis as any).Pasteboard
    if (pb?.getString) return String(pb.getString() ?? "")
    const cb = (globalThis as any).Clipboard
    if (cb?.getText) return String(cb.getText() ?? "")
  } catch {
    // 落到返回空串
  }
  return ""
}

/** 复制到剪贴板。Pasteboard 是现行 API，Clipboard 是废弃的旧名，都试一下。 */
export function copyToClipboard(text: string): boolean {
  try {
    const pb = (globalThis as any).Pasteboard
    if (pb?.setString) {
      pb.setString(text)
      return true
    }
    const cb = (globalThis as any).Clipboard
    if (cb?.copyText) {
      cb.copyText(text)
      return true
    }
  } catch {
    // 落到下面返回 false
  }
  return false
}

/** 把 HTTP 失败翻译成一句能看懂的话 */
export function describeHttpError(resp: JsonResponse, fallback = "请求失败"): string {
  const msg =
    (getPath(resp.json, "error.message") as string | undefined) ??
    (getPath(resp.json, "error") as string | undefined) ??
    (getPath(resp.json, "message") as string | undefined) ??
    (getPath(resp.json, "msg") as string | undefined)
  const detail = typeof msg === "string" && msg.trim() ? `：${msg.trim().slice(0, 120)}` : ""
  if (resp.status === 401 || resp.status === 403) return `凭据无效或已过期 (${resp.status})${detail}`
  if (resp.status === 429) return `被限流 (429)${detail}`
  if (resp.status >= 500) return `服务端错误 (${resp.status})${detail}`
  return `${fallback} (${resp.status})${detail}`
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "AbortError") return "请求超时"
    return error.message || String(error)
  }
  return String(error)
}

// ---------- 指标语义：把两种额度归一 ----------

/**
 * 服务商给的额度是两种相反的形态：
 *
 *   **增长式**（consumed）——Claude 的「已用 42%」、Command Code 的「这 5 小时花了 $8」。
 *                            数字往上涨，涨到头就没了。
 *   **扣除式**（remaining）——DeepSeek 的「余额 ¥12.5」、Kimi Code 的「还剩 600 次」。
 *                            数字往下掉，掉到零就没了。
 *
 * 一个面板里混着两种方向，是没法一眼扫的：你得先想清楚这一行的大数字是「用掉的」
 * 还是「剩下的」，才知道它大是好事还是坏事。所以这里统一成同一套坐标：
 *
 *   used / total / remaining / fraction
 *
 * 四个量算得出多少算多少，渲染层只认这四个，不再关心 provider 原本给的是哪种。
 * 方向信息保留在 direction 里，只在「没有上限、四个量算不全」时才用得上。
 */
export interface NormalizedMetric {
  /** 已用量，与 total 同单位 */
  used?: number
  /** 上限 / 总量 */
  total?: number
  /** 剩余量 */
  remaining?: number
  /** 已用比例 0–1；没有上限时算不出来 */
  fraction?: number
  unit: string
  /** provider 原本是按哪个方向报的 */
  direction: "consumed" | "remaining"
}

export function normalizeMetric(metric: Metric): NormalizedMetric {
  const unit = metric.unit ?? ""
  switch (metric.kind) {
    case "percent": {
      // 百分比天然有上限，单位就是 %
      const used = clamp(metric.value, 0, 100)
      return {
        used,
        total: 100,
        remaining: 100 - used,
        fraction: used / 100,
        unit: "%",
        direction: "consumed",
      }
    }
    case "spent": {
      // 已消费，没有上限。给不出剩余，也给不出比例。
      return { used: metric.value, unit, direction: "consumed" }
    }
    case "amount":
    case "count": {
      const remaining = metric.value
      const total = metric.max !== undefined && metric.max > 0 ? metric.max : undefined
      if (total === undefined) {
        // 没有上限的余额：只知道剩多少，判色交给 warnBelow
        return { remaining, unit, direction: "remaining" }
      }
      const used = Math.max(0, total - remaining)
      return { used, total, remaining, fraction: clamp(used / total, 0, 1), unit, direction: "remaining" }
    }
  }
}

export type Status = "good" | "warn" | "bad" | "neutral"

/**
 * 配色只由这里决定，小组件和主 App 共用同一套阈值。
 * 已用 < 60% 绿，< 85% 橙，其余红；没有上限的余额只看 warnBelow。
 */
export function statusOf(metric: Metric, warnBelow?: number): Status {
  const norm = normalizeMetric(metric)
  if (norm.fraction !== undefined) {
    if (norm.fraction < 0.6) return "good"
    if (norm.fraction < 0.85) return "warn"
    return "bad"
  }
  if (metric.kind === "spent") return "neutral"
  if (warnBelow !== undefined && Number.isFinite(warnBelow) && norm.remaining !== undefined) {
    if (norm.remaining <= warnBelow) return "bad"
    if (norm.remaining <= warnBelow * 2) return "warn"
    return "good"
  }
  return "neutral"
}

function clamp(x: number, lo: number, hi: number): number {
  if (!Number.isFinite(x)) return lo
  return Math.min(hi, Math.max(lo, x))
}

// ---------- 格式化 ----------

/** 面板显示的是「还剩多少」还是「用了多少」。两种额度都按同一个口径显示。 */
export type DisplayMode = "remaining" | "used"

/**
 * 一个数值 + 它的单位。百分比、金额、次数走同一个入口，
 * 保证同一屏里的数字排版一致。
 */
export function fmtQuantity(value: number, unit: string, kind: MetricKind): string {
  if (kind === "percent" || unit === "%") return `${Math.round(value)}%`
  // 次数按紧凑写法（1.2K），金额按两位小数——不能只看有没有单位符号：
  // 不带货币符号的金额如果走了紧凑写法，$3.46 会被显示成 3.5，凭空少掉几分钱。
  if (kind === "count") return unit ? `${fmtCompact(value)} ${unit}` : fmtCompact(value)
  return fmtMoney(value, unit)
}

/**
 * 主数值。这是「统一」真正落地的地方：
 *
 * 无论 provider 报的是已用百分比还是剩余余额，这里都按用户选的同一个口径输出。
 * 选「剩余」时，Claude 的「已用 42%」显示成「剩 58%」，和「余额 ¥12.5」并排读起来
 * 方向一致——大数字都代表宽裕。
 *
 * 算不出所选口径时（已消费没有上限，就没有「剩余」可言）退回另一个口径，
 * 并由 fmtMetricDetail 补一句说明，而不是显示一个空格或者 0。
 */
export function fmtMetricValue(metric: Metric, mode: DisplayMode = "remaining"): string {
  const norm = normalizeMetric(metric)
  const wanted = mode === "remaining" ? norm.remaining : norm.used
  const fallback = mode === "remaining" ? norm.used : norm.remaining
  const value = wanted ?? fallback ?? metric.value
  return fmtQuantity(value, norm.unit, metric.kind)
}

/** 主数值到底是哪个口径。口径和所选不一致时要在界面上说出来。 */
export function metricValueIsWanted(metric: Metric, mode: DisplayMode = "remaining"): boolean {
  const norm = normalizeMetric(metric)
  return (mode === "remaining" ? norm.remaining : norm.used) !== undefined
}

/**
 * 副标题：把另一半信息补齐。
 * 有上限就写「已用 42 / 100」，有重置时间就接倒计时。
 */
export function fmtMetricDetail(metric: Metric, now: number, mode: DisplayMode = "remaining"): string {
  const norm = normalizeMetric(metric)
  const parts: string[] = []

  if (norm.total !== undefined && norm.used !== undefined) {
    const shown = mode === "remaining" ? norm.used : norm.remaining ?? norm.used
    const word = mode === "remaining" ? "已用" : "剩"
    parts.push(
      `${word} ${fmtQuantity(shown, norm.unit, metric.kind)} / ${fmtQuantity(norm.total, norm.unit, metric.kind)}`,
    )
  } else if (!metricValueIsWanted(metric, mode)) {
    // 显示的不是所选口径，说明白它是什么，免得被当成剩余额度读
    parts.push(norm.direction === "consumed" ? "已消费" : "剩余")
  }

  if (metric.resetAt !== undefined) parts.push(fmtReset(metric.resetAt, now))
  return parts.join(" · ")
}

export function fmtMoney(value: number, unit: string): string {
  const abs = Math.abs(value)
  let digits = 2
  if (abs >= 1000) digits = 0
  else if (abs >= 100) digits = 1
  const body = abs >= 10000 ? fmtCompact(value) : value.toFixed(digits)
  // 单字符符号贴前面（$12.3），多字符单位放后面（12.3 USD）
  if (!unit) return body
  return unit.length <= 1 ? `${unit}${body}` : `${body} ${unit}`
}

export function fmtCompact(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1e9) return `${(value / 1e9).toFixed(1)}B`
  if (abs >= 1e6) return `${(value / 1e6).toFixed(1)}M`
  if (abs >= 1e4) return `${(value / 1e3).toFixed(1)}K`
  if (Number.isInteger(value)) return String(value)
  return value.toFixed(1)
}

/** "2h15m 后重置" / "3d 后重置" / "已到重置时间" */
export function fmtReset(resetAt: number, now: number): string {
  const diff = resetAt - now
  if (diff <= 0) return "已到重置时间"
  const minutes = Math.round(diff / 60000)
  if (minutes < 60) return `${minutes}m 后重置`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h${pad2(minutes % 60)}m 后重置`
  const days = Math.floor(hours / 24)
  return `${days}d${hours % 24}h 后重置`
}

/** "14:32" */
export function fmtClock(ms: number): string {
  if (!ms) return "--:--"
  const d = new Date(ms)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/** "刚刚" / "5 分钟前" / "2 小时前" / "14:32" */
export function fmtAgo(ms: number, now: number): string {
  if (!ms) return "尚未更新"
  const diff = now - ms
  if (diff < 60000) return "刚刚"
  const minutes = Math.floor(diff / 60000)
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  return fmtClock(ms)
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** 窗口秒数 → 人话标签。Codex / Claude 的窗口都是 5 小时和 7 天 */
export function windowLabel(seconds: number | undefined, fallback: string): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return fallback
  if (seconds < 3600) return `${Math.round(seconds / 60)} 分钟`
  if (seconds < 86400) return `${Math.round(seconds / 3600)} 小时`
  const days = Math.round(seconds / 86400)
  return days === 7 ? "7 天" : `${days} 天`
}

export function currencySymbol(code: string | undefined): string {
  switch ((code ?? "").toUpperCase()) {
    case "CNY":
    case "RMB":
      return "¥"
    case "USD":
      return "$"
    case "EUR":
      return "€"
    case "JPY":
      return "JP¥"
    case "":
      return ""
    default:
      return code as string
  }
}

export function newId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}
