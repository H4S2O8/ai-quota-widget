/**
 * OpenRouter —— 官方文档化接口。
 *
 *   GET /api/v1/credits  -> { data: { total_credits, total_usage } }
 *   GET /api/v1/key      -> { data: { label, usage, limit, is_free_tier, rate_limit } }
 *
 * 两个都打：credits 给「充值总额 - 已用」的余额，key 给这把 key 自己的限额
 * （很多人给 key 单独设了上限，那才是真正会先撞到的墙）。
 */
import type { Metric, Provider, ProviderResult } from "./types"
import { describeHttpError, getPath, num, requestJson } from "./util"

export const openrouterProvider: Provider = {
  id: "openrouter",
  name: "OpenRouter",
  icon: "arrow.triangle.branch",
  color: "#6467F2",
  help: "在 openrouter.ai/settings/keys 建一把 key（sk-or-v1-...）。读余额不消耗额度。",
  fields: [
    {
      key: "apiKey",
      label: "API Key",
      secret: true,
      required: true,
      placeholder: "sk-or-v1-...",
    },
  ],
  async fetch(config, ctx): Promise<ProviderResult> {
    const headers = { Authorization: `Bearer ${config.apiKey?.trim() ?? ""}` }
    const credits = await requestJson(
      "https://openrouter.ai/api/v1/credits",
      { headers },
      ctx.timeoutSec,
    )
    if (!credits.ok) throw new Error(describeHttpError(credits, "读取额度失败"))

    const total = num(getPath(credits.json, "data.total_credits")) ?? 0
    const used = num(getPath(credits.json, "data.total_usage")) ?? 0
    const metrics: Metric[] = [
      {
        id: "balance",
        label: "账户余额",
        kind: "amount",
        value: Math.max(0, total - used),
        unit: "$",
        // 充过多少就是上限，用它算已用比例；从没充过（total=0）就不给上限，
        // 交给 warnBelow 判色。
        max: total > 0 ? total : undefined,
      },
    ]

    // key 自己的限额是可选的，拿不到不算失败。
    let note: string | undefined
    try {
      const key = await requestJson("https://openrouter.ai/api/v1/key", { headers }, ctx.timeoutSec)
      if (key.ok) {
        const limit = num(getPath(key.json, "data.limit"))
        const keyUsage = num(getPath(key.json, "data.usage")) ?? 0
        if (limit !== undefined && limit > 0) {
          metrics.push({
            id: "keyLimit",
            label: "本 Key 限额",
            kind: "amount",
            value: Math.max(0, limit - keyUsage),
            unit: "$",
            max: limit,
          })
        }
        if (getPath(key.json, "data.is_free_tier") === true) note = "免费档"
      }
    } catch {
      // 忽略：主指标已经拿到了
    }

    return { metrics, note }
  },
}
