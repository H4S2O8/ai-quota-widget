/**
 * 无依赖的小工具：取 JSON 路径、数字解析、HTTP 请求包装、格式化。
 * 这个文件不 import "scripting"，所以 dev/ 里的 node 测试可以直接跑它。
 */
import type { Metric } from "./types"

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
  const response = await fetch(url, {
    method: init.method ?? "GET",
    headers: init.headers,
    body: init.body,
    timeout: timeoutSec,
  })
  const text = await response.text()
  let json: unknown = undefined
  try {
    json = text ? JSON.parse(text) : undefined
  } catch {
    json = undefined
  }
  return { status: response.status, ok: response.ok, json, text }
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

// ---------- 指标语义 ----------

/** 已用比例 0–1；算不出来（没有上限的余额）返回 undefined */
export function usedFraction(metric: Metric): number | undefined {
  if (metric.kind === "percent") return clamp01(metric.value / 100)
  if (metric.kind === "spent") return undefined
  if (metric.max !== undefined && metric.max > 0) {
    return clamp01(1 - metric.value / metric.max)
  }
  return undefined
}

export type Status = "good" | "warn" | "bad" | "neutral"

/**
 * 配色只由这里决定，小组件和主 App 共用同一套阈值。
 * 已用 < 60% 绿，< 85% 橙，其余红；没有上限的余额只看 warnBelow。
 */
export function statusOf(metric: Metric, warnBelow?: number): Status {
  const used = usedFraction(metric)
  if (used !== undefined) {
    if (used < 0.6) return "good"
    if (used < 0.85) return "warn"
    return "bad"
  }
  if (metric.kind === "spent") return "neutral"
  if (warnBelow !== undefined && Number.isFinite(warnBelow)) {
    if (metric.value <= warnBelow) return "bad"
    if (metric.value <= warnBelow * 2) return "warn"
    return "good"
  }
  return "neutral"
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0
  return Math.min(1, Math.max(0, x))
}

// ---------- 格式化 ----------

export function fmtMetricValue(metric: Metric): string {
  switch (metric.kind) {
    case "percent":
      return `${Math.round(metric.value)}%`
    case "amount":
    case "spent":
      return fmtMoney(metric.value, metric.unit ?? "")
    case "count":
      return `${fmtCompact(metric.value)}${metric.unit ? " " + metric.unit : ""}`
  }
}

/** 副标题：amount 有上限就写 "/ ¥100"，percent 有重置时间就写倒计时 */
export function fmtMetricDetail(metric: Metric, now: number): string {
  const parts: string[] = []
  if ((metric.kind === "amount" || metric.kind === "count") && metric.max !== undefined) {
    parts.push(`/ ${metric.kind === "amount" ? fmtMoney(metric.max, metric.unit ?? "") : fmtCompact(metric.max)}`)
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
