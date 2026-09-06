/**
 * one-api / new-api 系的中转站（国内常见的「OpenAI 兼容站」）。
 *
 *   GET {base}/api/user/self
 *   Authorization: Bearer <系统访问令牌>
 *   -> { success, data: { quota, used_quota, username, ... } }
 *
 * 站点很多、版本不一，所以这里对字段名和额度单位都做了兼容：
 *
 * - 额度单位：one-api 内部用「点」计价，惯例是 500000 点 = $1。站点会在设置里
 *   改这个比例，所以做成可填的字段，默认 500000。填 1 就是按原始点数显示。
 * - 有的分支把剩余额度直接给成 `quota`，有的给「总额 + 已用」。两种都认。
 *
 * 这个接口不是统一标准，所以照例记原始响应，取不到值时能直接看到原文。
 */
import type { Metric, Provider, ProviderResult } from "./types"
import { describeHttpError, getPath, num, requestJson } from "./util"

export const oneapiProvider: Provider = {
  id: "oneapi",
  name: "OpenAI 兼容中转站",
  icon: "arrow.left.arrow.right",
  color: "#0EA5E9",
  help:
    "适用于 one-api / new-api 搭的站点。令牌要用「个人设置」里的**系统访问令牌**，" +
    "不是 sk- 开头的 API Key——API Key 查不了账户额度。",
  fields: [
    {
      key: "baseUrl",
      label: "站点地址",
      required: true,
      placeholder: "https://api.example.com",
      help: "只填到域名，后面的 /api/user/self 由这里补。",
    },
    { key: "token", label: "系统访问令牌", secret: true, required: true },
    {
      key: "quotaPerUnit",
      label: "额度换算比例",
      placeholder: "500000",
      help: "多少「点」算 1 美元。one-api 默认 500000；填 1 则直接显示点数。",
    },
    { key: "unit", label: "货币符号", placeholder: "$" },
  ],
  async fetch(config, ctx): Promise<ProviderResult> {
    const base = (config.baseUrl ?? "").trim().replace(/\/+$/, "")
    if (!base) throw new Error("没填站点地址")

    const resp = await requestJson(
      `${base}/api/user/self`,
      {
        headers: {
          Authorization: `Bearer ${config.token?.trim() ?? ""}`,
          // new-api 的部分版本要这个头才认令牌
          "New-Api-User": "1",
        },
      },
      ctx.timeoutSec,
    )
    ctx.captureRaw(resp.text)
    if (!resp.ok) throw new Error(describeHttpError(resp, "读取额度失败"))
    if (getPath(resp.json, "success") === false) {
      const message = getPath(resp.json, "message")
      throw new Error(typeof message === "string" && message ? message : "站点返回失败")
    }

    const data = getPath(resp.json, "data") ?? resp.json
    const perUnit = Math.max(1, num(config.quotaPerUnit) ?? 500000)
    const unit = (config.unit ?? "").trim() || "$"

    const remainRaw = num(getPath(data, "quota")) ?? num(getPath(data, "remain_quota"))
    const usedRaw = num(getPath(data, "used_quota"))
    if (remainRaw === undefined && usedRaw === undefined) {
      throw new Error("返回里没有 quota 字段，请在详情页查看原始响应")
    }

    const metrics: Metric[] = []
    if (remainRaw !== undefined) {
      metrics.push({
        id: "quota",
        label: "剩余额度",
        kind: "amount",
        value: remainRaw / perUnit,
        unit,
        // 剩余 + 已用 = 拿到过的总额，用它算已用比例
        max: usedRaw !== undefined ? (remainRaw + usedRaw) / perUnit : undefined,
      })
    }
    if (usedRaw !== undefined) {
      metrics.push({ id: "used", label: "已消费", kind: "spent", value: usedRaw / perUnit, unit })
    }

    const username = getPath(data, "username")
    return { metrics, plan: typeof username === "string" ? username : undefined }
  },
}
