/**
 * DeepSeek —— 官方文档化接口。
 *
 *   GET https://api.deepseek.com/user/balance
 *   -> { is_available, balance_infos: [{ currency, total_balance, granted_balance, topped_up_balance }] }
 *
 * 可能同时有 CNY 和 USD 两组，每组各出一个指标。
 */
import type { Metric, Provider, ProviderResult } from "./types"
import { currencySymbol, describeHttpError, getPath, num, requestJson } from "./util"

export const deepseekProvider: Provider = {
  id: "deepseek",
  name: "DeepSeek",
  icon: "brain",
  color: "#4D6BFE",
  help: "platform.deepseek.com 的 API Key（sk-...）。查余额不计费。",
  fields: [
    { key: "apiKey", label: "API Key", secret: true, required: true, placeholder: "sk-..." },
  ],
  async fetch(config, ctx): Promise<ProviderResult> {
    const resp = await requestJson(
      "https://api.deepseek.com/user/balance",
      { headers: { Authorization: `Bearer ${config.apiKey?.trim() ?? ""}` } },
      ctx.timeoutSec,
    )
    if (!resp.ok) throw new Error(describeHttpError(resp, "读取余额失败"))

    const infos = getPath(resp.json, "balance_infos")
    const list = Array.isArray(infos) ? infos : []
    const metrics: Metric[] = list.map((info: unknown, index: number) => {
      const currency = (getPath(info, "currency") as string | undefined) ?? ""
      const granted = num(getPath(info, "granted_balance"))
      const toppedUp = num(getPath(info, "topped_up_balance"))
      const hints: string[] = []
      if (granted !== undefined && granted > 0) hints.push(`赠送 ${granted}`)
      if (toppedUp !== undefined && toppedUp > 0) hints.push(`充值 ${toppedUp}`)
      return {
        id: currency || `balance${index}`,
        label: currency ? `余额 ${currency}` : "余额",
        kind: "amount",
        value: num(getPath(info, "total_balance")) ?? 0,
        unit: currencySymbol(currency),
        hint: hints.length > 0 ? hints.join(" · ") : undefined,
      }
    })

    if (metrics.length === 0) {
      metrics.push({ id: "balance", label: "余额", kind: "amount", value: 0, unit: "¥" })
    }

    return {
      metrics,
      note: getPath(resp.json, "is_available") === false ? "账户余额不足，接口已停用" : undefined,
    }
  },
}
