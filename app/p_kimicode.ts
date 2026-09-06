/**
 * Kimi Code（订阅制编程产品）的额度窗口。
 *
 *   GET https://api.kimi.com/coding/v1/usages
 *   Authorization: Bearer sk-kimi-...
 *
 * ## 和「Moonshot / Kimi」那个 provider 的区别
 *
 * 完全是两个产品，两套 Key，两个域名：
 *
 *   - **Kimi API 开放平台**：按量付费，读余额，`api.moonshot.cn`，Key 是 `sk-...`
 *   - **Kimi Code**：订阅制，读额度窗口，`api.kimi.com/coding/v1`，Key 是 `sk-kimi-...`
 *
 * 官方问题排查页原话：两者「API Key 均不通用」，填错了会 401 或 404。所以这里
 * 单独一个文件，而不是给上面那个加个开关——让用户在「添加账户」列表里就看见
 * 两个不同的东西，比让他在一个页面里选对某个下拉项更不容易错。
 *
 * ## 端点是怎么确认的
 *
 * 官方文档没有这个接口的 API 参考（`/code/docs/` 下只有 CLI 和 IDE 的说明）。
 * 路径来自开源工具 kimi-code-usage 的实现，实测存在：
 *
 *   /coding/v1/usages  -> 401 {"code":"unauthenticated",...}   接口在
 *   /coding/v1/usage   -> 404 resource_not_found                路径不对
 *
 * 注意是复数。单数那个是老路径，那个工具留了回退，这里也留。
 *
 * ## 返回结构有两种，都认
 *
 *   A) { data: [ { model_name, limit, used, resetTime }, ... ] }
 *      model_name === "all" 的那条是周额度汇总，其余是分模型限额
 *   B) { usage: {...}, limits: [ { detail: {...}, window: { duration, timeUnit } } ] }
 *
 * 字段名同样来自那个工具（它对每个字段都写了两三种拼法的兜底，说明实际返回
 * 在不同版本里变过）。所以这里照例 captureRaw，认不出来就报错而不是显示 0。
 */
import type { Metric, Provider, ProviderResult } from "./types"
import { getPath, num, requestJson, toEpochMs } from "./util"

const BASE = "https://api.kimi.com/coding/v1"

export const kimicodeProvider: Provider = {
  id: "kimicode",
  name: "Kimi Code",
  icon: "chevron.left.forwardslash.chevron.right",
  color: "#00A6A6",
  help:
    "Kimi Code 控制台（kimi.com/code/console）创建的 Key，格式 sk-kimi-...。" +
    "开放平台那把 sk-... 在这里用不了，会 401。读的是订阅的 5 小时 / 7 天额度窗口。",
  fields: [
    {
      key: "apiKey",
      label: "Kimi Code API Key",
      secret: true,
      required: true,
      placeholder: "sk-kimi-...",
    },
    {
      key: "baseUrl",
      label: "接口地址",
      placeholder: BASE,
      help: "一般不用改。留空即 " + BASE,
    },
  ],
  async fetch(config, ctx): Promise<ProviderResult> {
    const base = ((config.baseUrl ?? "").trim() || BASE).replace(/\/+$/, "")
    const headers = {
      Authorization: `Bearer ${config.apiKey?.trim() ?? ""}`,
      "User-Agent": "KimiCLI/1.6",
    }

    let resp = await requestJson(`${base}/usages`, { headers }, ctx.timeoutSec)
    // 老版本的单数路径，留个回退
    if (resp.status === 404) {
      resp = await requestJson(`${base}/usage`, { headers }, ctx.timeoutSec)
    }
    ctx.captureRaw(resp.text)

    if (resp.status === 401 || resp.status === 403) {
      throw new Error(
        `凭据被拒 (${resp.status})。这里只认 Kimi Code 控制台的 sk-kimi- 开头的 Key；` +
          `开放平台的 sk- 开头那把请用「Moonshot / Kimi」那个账户类型。`,
      )
    }
    if (resp.status === 404) {
      throw new Error("用量接口 404。确认接口地址是 " + BASE + "（注意不是开放平台的地址）")
    }
    if (!resp.ok) throw new Error(`读取额度失败 (${resp.status})`)

    const metrics = parseUsages(resp.json)
    if (metrics.length === 0) {
      throw new Error("返回里没有可识别的额度字段，请在详情页查看原始响应")
    }
    return { metrics }
  },
}

/** 导出给测试：解析必须能脱离网络单独验。 */
export function parseUsages(json: unknown): Metric[] {
  const metrics: Metric[] = []
  const data = getPath(json, "data")

  if (Array.isArray(data)) {
    // 形状 A：汇总那条排最前，它才是「这周还剩多少」
    const rows = data.filter((item) => item && typeof item === "object")
    const summary = rows.filter((item) => getPath(item, "model_name") === "all")
    const rest = rows.filter((item) => getPath(item, "model_name") !== "all")
    for (const [index, item] of [...summary, ...rest].entries()) {
      const metric = toMetric(item, item, index, getPath(item, "model_name") === "all" ? "周额度" : undefined)
      if (metric) metrics.push(metric)
    }
    return metrics
  }

  // 形状 B
  const usage = getPath(json, "usage")
  if (usage && typeof usage === "object") {
    const metric = toMetric(usage, usage, 0, "周额度")
    if (metric) metrics.push(metric)
  }
  const limits = getPath(json, "limits")
  if (Array.isArray(limits)) {
    for (const [index, item] of limits.entries()) {
      if (!item || typeof item !== "object") continue
      const detail = getPath(item, "detail")
      const source = detail && typeof detail === "object" ? detail : item
      const window = getPath(item, "window")
      const metric = toMetric(source, item, index + 1, windowName(window, index))
      if (metric) metrics.push(metric)
    }
  }
  return metrics
}

/** source 出数值，labelSource 出名字，两者在形状 B 里不是同一个对象。 */
function toMetric(
  source: unknown,
  labelSource: unknown,
  index: number,
  fallbackLabel?: string,
): Metric | null {
  const limit = num(getPath(source, "limit")) ?? num(getPath(source, "limit_amount"))
  let used = num(getPath(source, "used")) ?? num(getPath(source, "used_amount"))
  const remaining = num(getPath(source, "remaining"))
  if (used === undefined && remaining !== undefined && limit !== undefined) {
    used = limit - remaining
  }
  if (used === undefined && limit === undefined) return null

  const name =
    str(getPath(labelSource, "name")) ??
    str(getPath(labelSource, "title")) ??
    str(getPath(labelSource, "model_name")) ??
    fallbackLabel ??
    `额度 ${index + 1}`

  return {
    id: `usage${index}`,
    label: name === "all" ? "周额度" : name,
    kind: "count",
    // 面板一律显示「还剩多少」，所以这里统一转成剩余量
    value: remaining ?? Math.max(0, (limit ?? 0) - (used ?? 0)),
    max: limit !== undefined && limit > 0 ? limit : undefined,
    resetAt: resetOf(source),
  }
}

/** { duration: 5, timeUnit: "HOUR" } -> "5 小时额度" */
export function windowName(window: unknown, index: number): string {
  const duration = num(getPath(window, "duration"))
  const unit = (str(getPath(window, "timeUnit")) ?? str(getPath(window, "time_unit")) ?? "").toUpperCase()
  if (duration === undefined) return `额度 ${index + 1}`
  if (unit.includes("MINUTE")) {
    return duration >= 60 && duration % 60 === 0 ? `${duration / 60} 小时额度` : `${duration} 分钟额度`
  }
  if (unit.includes("HOUR")) return `${duration} 小时额度`
  if (unit.includes("DAY")) return `${duration} 天额度`
  if (unit.includes("MONTH")) return `${duration} 个月额度`
  return `额度 ${index + 1}`
}

function resetOf(node: unknown): number | undefined {
  const direct =
    toEpochMs(getPath(node, "resetTime")) ??
    toEpochMs(getPath(node, "reset_at")) ??
    toEpochMs(getPath(node, "reset_time"))
  if (direct !== undefined) return direct
  // reset_in 是「还有多少秒」，不是时间点
  const seconds = num(getPath(node, "reset_in"))
  return seconds !== undefined ? Date.now() + seconds * 1000 : undefined
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}
