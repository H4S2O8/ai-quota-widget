/**
 * 自定义 JSON 接口 —— 这个面板「可扩展」的兜底出口。
 *
 * 内置 provider 覆盖不到的服务（或者哪个服务改了接口把内置的打挂了），都可以在
 * 这里用配置顶上：填 URL、请求头、以及几个 JSON 路径，不用改一行代码、不用重新
 * 同步脚本。写代码的那条路见 providers.ts 顶部的说明。
 *
 * 路径语法就是 "data.items[0].balance"。
 */
import type { Metric, Provider, ProviderResult } from "./types"
import { describeHttpError, getPath, num, requestJson, toEpochMs } from "./util"

export const genericProvider: Provider = {
  id: "generic",
  name: "自定义 JSON 接口",
  icon: "curlybraces",
  color: "#64748B",
  help:
    "任何返回 JSON 的额度接口都能接进来。先填 URL 抓一次，在详情页看原始响应，" +
    "再照着里面的层级填路径。路径写法：data.balance 或 data.items[0].amount。",
  fields: [
    { key: "url", label: "请求地址", required: true, placeholder: "https://..." },
    { key: "method", label: "方法", placeholder: "GET" },
    {
      key: "headers",
      label: "请求头",
      multiline: true,
      placeholder: "Authorization: Bearer xxx",
      secret: false,
      help: "一行一个，写成「名字: 值」。凭据也写在这里。",
    },
    { key: "body", label: "请求体", multiline: true, help: "POST 才需要，留空即不发。" },
    {
      key: "valuePath",
      label: "数值路径",
      required: true,
      placeholder: "data.balance",
    },
    { key: "maxPath", label: "上限路径", placeholder: "data.total", help: "留空则不显示比例条。" },
    { key: "resetPath", label: "重置时间路径", placeholder: "data.reset_at" },
    { key: "metricLabel", label: "指标名称", placeholder: "余额" },
    {
      key: "metricKind",
      label: "指标类型",
      placeholder: "amount",
      help: "amount 金额 / count 次数 / percent 已用百分比 / spent 已消费。",
    },
    { key: "unit", label: "单位", placeholder: "¥" },
  ],
  async fetch(config, ctx): Promise<ProviderResult> {
    const url = (config.url ?? "").trim()
    if (!url) throw new Error("没填请求地址")

    const method = ((config.method ?? "").trim() || "GET").toUpperCase()
    const body = (config.body ?? "").trim()

    const resp = await requestJson(
      url,
      {
        method,
        headers: parseHeaders(config.headers ?? ""),
        body: method === "GET" || method === "HEAD" || !body ? undefined : body,
      },
      ctx.timeoutSec,
    )
    ctx.captureRaw(resp.text)
    if (!resp.ok) throw new Error(describeHttpError(resp, "请求失败"))

    const valuePath = (config.valuePath ?? "").trim()
    const value = num(getPath(resp.json, valuePath))
    if (value === undefined) {
      throw new Error(`路径「${valuePath || "(空)"}」上没有数字，请在详情页对照原始响应`)
    }

    const kind = normalizeKind(config.metricKind)
    const metric: Metric = {
      id: "value",
      label: (config.metricLabel ?? "").trim() || "额度",
      kind,
      value,
      unit: (config.unit ?? "").trim() || undefined,
      max: kind === "percent" ? undefined : num(getPath(resp.json, (config.maxPath ?? "").trim())),
      resetAt: toEpochMs(getPath(resp.json, (config.resetPath ?? "").trim())),
    }
    return { metrics: [metric] }
  },
}

/** "名字: 值" 一行一个。冒号后的空格吃掉，值里面的冒号保留（Bearer token 里有）。 */
export function parseHeaders(text: string): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const at = trimmed.indexOf(":")
    if (at <= 0) continue
    const name = trimmed.slice(0, at).trim()
    const value = trimmed.slice(at + 1).trim()
    if (name) headers[name] = value
  }
  return headers
}

function normalizeKind(raw: string | undefined): Metric["kind"] {
  switch ((raw ?? "").trim().toLowerCase()) {
    case "percent":
      return "percent"
    case "count":
      return "count"
    case "spent":
      return "spent"
    default:
      return "amount"
  }
}
