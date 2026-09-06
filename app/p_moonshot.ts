/**
 * Moonshot / Kimi 开放平台 —— 官方文档化接口。
 *
 *   GET https://api.moonshot.cn/v1/users/me/balance
 *   -> { code, data: { available_balance, voucher_balance, cash_balance } }
 *
 * available_balance 可能大于 cash_balance（代金券先扣），所以主指标用它。
 */
import type { Provider, ProviderResult } from "./types"
import { describeHttpError, getPath, num, requestJson } from "./util"

export const moonshotProvider: Provider = {
  id: "moonshot",
  name: "Moonshot / Kimi",
  icon: "moon.stars",
  color: "#0F172A",
  help: "platform.moonshot.cn 的 API Key（sk-...）。国际站请改用「自定义 JSON 接口」。",
  fields: [
    { key: "apiKey", label: "API Key", secret: true, required: true, placeholder: "sk-..." },
  ],
  async fetch(config, ctx): Promise<ProviderResult> {
    const resp = await requestJson(
      "https://api.moonshot.cn/v1/users/me/balance",
      { headers: { Authorization: `Bearer ${config.apiKey?.trim() ?? ""}` } },
      ctx.timeoutSec,
    )
    if (!resp.ok) throw new Error(describeHttpError(resp, "读取余额失败"))

    const data = getPath(resp.json, "data")
    const available = num(getPath(data, "available_balance")) ?? 0
    const voucher = num(getPath(data, "voucher_balance"))
    const cash = num(getPath(data, "cash_balance"))

    const hints: string[] = []
    if (cash !== undefined) hints.push(`现金 ¥${cash}`)
    if (voucher !== undefined && voucher > 0) hints.push(`代金券 ¥${voucher}`)

    return {
      metrics: [
        {
          id: "available",
          label: "可用余额",
          kind: "amount",
          value: available,
          unit: "¥",
          hint: hints.length > 0 ? hints.join(" · ") : undefined,
        },
      ],
    }
  },
}
