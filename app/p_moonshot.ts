/**
 * Moonshot / Kimi 开放平台 —— 官方文档化接口。
 *
 *   GET {base}/v1/users/me/balance
 *   -> { code, data: { available_balance, voucher_balance, cash_balance } }
 *
 * available_balance 可能大于 cash_balance（代金券先扣），所以主指标用它。
 *
 * ## 为什么要选站点
 *
 * Kimi 有国内站（api.moonshot.cn）和国际站（api.moonshot.ai），**两套账号、两套
 * key，路径完全一样**。拿国内站的 key 去打国际站，返回的是 401 Invalid
 * Authentication —— 和「key 打错了」的报错一模一样，看不出区别。
 *
 * 这是实测：两个域名都用同一个无效 key 探过，401 的报文逐字相同。所以域名写死
 * 在代码里的话，站点选错的人会盯着一个「凭据无效」的提示反复检查 key，
 * 而 key 从头到尾都是对的。
 */
import type { Provider, ProviderResult } from "./types"
import { describeHttpError, getPath, num, requestJson } from "./util"

const CN = "https://api.moonshot.cn"
const GLOBAL = "https://api.moonshot.ai"

export const moonshotProvider: Provider = {
  id: "moonshot",
  name: "Moonshot / Kimi",
  icon: "moon.stars",
  color: "#0F172A",
  help:
    "开放平台的 API Key（sk-...），不是 Kimi 助手的登录账号。" +
    "国内站在 platform.moonshot.cn，国际站在 platform.moonshot.ai —— " +
    "key 是哪个站建的，下面就要选哪个，选错了报的也是 401。",
  fields: [
    { key: "apiKey", label: "API Key", secret: true, required: true, placeholder: "sk-..." },
    {
      key: "site",
      label: "站点",
      placeholder: "cn",
      help: "填 cn 用国内站（默认），填 global 或 ai 用国际站。",
    },
  ],
  async fetch(config, ctx): Promise<ProviderResult> {
    const base = resolveBase(config.site)
    const resp = await requestJson(
      `${base}/v1/users/me/balance`,
      { headers: { Authorization: `Bearer ${config.apiKey?.trim() ?? ""}` } },
      ctx.timeoutSec,
    )
    ctx.captureRaw(resp.text)

    if (resp.status === 401 || resp.status === 403) {
      // 两个站的 401 报文一样，所以这里必须把「可能是站点选错」说出来，
      // 否则用户只会反复去检查那把其实没问题的 key。
      const other = base === CN ? "国际站（site 填 global）" : "国内站（site 填 cn）"
      throw new Error(
        `凭据被拒 (${resp.status})。当前打的是 ${base}；如果这把 key 是在${other}建的，` +
          `换过去再试——两个站的报错一模一样。`,
      )
    }
    if (!resp.ok) throw new Error(describeHttpError(resp, "读取余额失败"))

    const data = getPath(resp.json, "data")
    const available = num(getPath(data, "available_balance"))
    if (available === undefined) {
      throw new Error("返回里没有 available_balance，请在详情页查看原始响应")
    }

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

/** 站点标识 -> 域名。空值、大小写、写全域名都认。 */
export function resolveBase(site: string | undefined): string {
  const value = (site ?? "").trim().toLowerCase()
  if (!value) return CN
  if (value.startsWith("http")) return value.replace(/\/+$/, "")
  if (value === "global" || value === "ai" || value === "intl" || value === "国际" || value === "国际站") {
    return GLOBAL
  }
  return CN
}
