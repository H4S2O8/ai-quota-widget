/**
 * Moonshot / Kimi 开放平台 —— 官方文档化接口。
 *
 *   GET {base}/v1/users/me/balance
 *   -> { code, data: { available_balance, voucher_balance, cash_balance } }
 *
 * available_balance 可能大于 cash_balance（代金券先扣），所以主指标用它。
 *
 * ## 这个接口读的是「开放平台余额」，只有它
 *
 * Kimi 有三个互不相通的产品，官方问题排查页写得很直白：
 *
 *   - **Kimi API 开放平台**（platform.kimi.com）：按量付费，有余额，就是这里读的
 *   - **Kimi Code**：独立编程产品，自己的 Key，和开放平台不通用
 *   - **Kimi 会员**（kimi.com 的订阅）：权益不折算成开放平台余额
 *
 * 「把其他产品的 Key 填到开放平台端点，会出现 401 或 404」——原话。所以拿
 * kimi.com 的会员身份或 Kimi Code 的 Key 来填，必然 401，而且和「Key 写错了」
 * 的报错一模一样。**会员和 Kimi Code 的订阅用量没有公开接口，这个 provider
 * 读不了，任何 provider 都读不了。**
 *
 * ## 区域也隔离
 *
 * 中国站 platform.kimi.com（端点 api.moonshot.cn）和国际站 platform.kimi.ai
 * （端点 api.moonshot.ai）账户、余额、Key 相互隔离。两个端点对同一个无效 Key
 * 返回的 401 报文逐字相同，所以域名不能写死——站点选错的人会盯着一把没问题的
 * Key 反复检查。
 *
 * 以上两条都不是推测：`docs/guide/faq` 和 `docs/api/balance` 里写着，
 * 端点也逐个探过。
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
    "只认 Kimi API 开放平台的 Key，在 platform.kimi.com（国际站 platform.kimi.ai）" +
    "的用户中心创建。kimi.com 的会员订阅和 Kimi Code 是另外两个产品，Key 不通用、" +
    "余额也不互通，拿它们来填会报 401，而且那份订阅用量没有公开接口，读不出来。",
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
      // 官方 FAQ 把 401 的成因按可能性排过序，这里照抄那个顺序。笼统一句
      // 「凭据无效」会让人去反复检查一把其实正确的 Key。
      const other = base === CN ? "国际站（站点填 global）" : "国内站（站点填 cn）"
      throw new Error(
        `凭据被拒 (${resp.status})，当前打的是 ${base}。按这个顺序查：` +
          `① Key 是不是「Kimi API 开放平台」建的——kimi.com 的会员订阅和 Kimi Code ` +
          `各是独立产品，Key 不通用，填过来就是这个报错；` +
          `② 是不是${other}的 Key，两个区域相互隔离且报错一模一样；` +
          `③ 账户有没有可用余额。`,
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
