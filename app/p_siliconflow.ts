/**
 * 硅基流动 SiliconFlow —— 官方文档化接口。
 *
 *   GET https://api.siliconflow.cn/v1/user/info
 *   -> { code, status, data: { name, balance, chargeBalance, totalBalance } }
 *
 * totalBalance = 赠送余额 + 充值余额，是真正能花的数。
 */
import type { Metric, Provider, ProviderResult } from "./types"
import { describeHttpError, getPath, num, requestJson } from "./util"

export const siliconflowProvider: Provider = {
  id: "siliconflow",
  name: "硅基流动",
  icon: "cube.transparent",
  color: "#7C3AED",
  help: "cloud.siliconflow.cn 的 API 密钥（sk-...）。",
  fields: [
    { key: "apiKey", label: "API Key", secret: true, required: true, placeholder: "sk-..." },
  ],
  async fetch(config, ctx): Promise<ProviderResult> {
    const resp = await requestJson(
      "https://api.siliconflow.cn/v1/user/info",
      { headers: { Authorization: `Bearer ${config.apiKey?.trim() ?? ""}` } },
      ctx.timeoutSec,
    )
    if (!resp.ok) throw new Error(describeHttpError(resp, "读取余额失败"))

    const data = getPath(resp.json, "data")
    const total = num(getPath(data, "totalBalance"))
    const gift = num(getPath(data, "balance"))
    const charged = num(getPath(data, "chargeBalance"))

    const hints: string[] = []
    if (gift !== undefined) hints.push(`赠送 ¥${gift}`)
    if (charged !== undefined) hints.push(`充值 ¥${charged}`)

    return {
      metrics: [
        {
          id: "balance",
          label: "总余额",
          kind: "amount",
          value: total ?? (gift ?? 0) + (charged ?? 0),
          unit: "¥",
          hint: hints.length > 0 ? hints.join(" · ") : undefined,
        },
      ],
      plan: getPath(data, "name") as string | undefined,
    }
  },
}
