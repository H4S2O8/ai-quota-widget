/**
 * Command Code（commandcode.ai）的订阅额度窗口。
 *
 * GOAT 套餐是三个滚动窗口：5 小时 $14、7 天 $35、每月 $70。前两个是限流窗口，
 * 第三个是月度额度池。
 *
 * ## 接口是怎么找到的
 *
 * 官方文档只写了 Provider API 那三个推理端点（chat/completions、messages、models），
 * **没有任何用量接口的文档**，只说 CLI 里敲 `/usage` 能看。所以路径是从 npm 包
 * `command-code` 的 bundle 里挖出来的，四个都实测存在（无效凭据返回 401 而非 404）：
 *
 *   GET /alpha/billing/credits?orgId=       额度池 + 窗口限额  <- 主要就靠它
 *   GET /alpha/whoami                       拿 org.id
 *   GET /alpha/billing/subscriptions?orgId= 套餐名与账期
 *   GET /alpha/usage/summary?orgId=&since=  本账期已花多少
 *
 * 路径带 `alpha` 前缀，字面意思就是随时会变。变了的症状是 404，届时重新打开
 * npm 包搜一遍 `/alpha/` 就能找到新的。
 *
 * ## 鉴权的不确定之处
 *
 * CLI 走的是浏览器登录后落盘的 token；官方文档说 Provider API 用
 * `Authorization: Bearer <CMD_API_KEY>`。**这两者是不是同一种凭据，没有文档说明**，
 * 而且无效凭据在两条路上返回的 401 一模一样，从外面分辨不出来。所以这里就用
 * Bearer 发，401 的提示会把这件事讲清楚，让人知道该去换哪种 Key 而不是怀疑自己抄错了。
 *
 * ## 返回结构（来自 bundle 里的 projectUsageView / WindowLimitMeter）
 *
 *   credits: {
 *     credits: { monthlyCredits, purchasedCredits, freeCredits, planId },
 *     windowLimits: {
 *       limited: bool,
 *       fiveHour: { used, cap, resetAt },   // resetAt 是毫秒时间戳
 *       weekly:   { used, cap, resetAt },
 *     }
 *   }
 *
 * 窗口用 used/cap 报，是「增长式」；额度池用剩余量报，是「扣除式」。两种在这里
 * 都照原样交给上层，由 normalizeMetric 统一（见 util.ts）。
 */
import type { Metric, Provider, ProviderResult } from "./types"
import { errorMessage, getPath, num, requestJson, toEpochMs } from "./util"

const BASE = "https://api.commandcode.ai"

/** 套餐 id -> 显示名。来自 bundle 里的常量表。 */
const PLAN_NAMES: Record<string, string> = {
  "individual-go": "Go",
  "individual-goat": "GOAT",
  "individual-pro": "Pro",
  "individual-pro-v1": "Pro",
  "individual-provider": "Provider",
  "individual-max": "Max",
  "individual-ultra": "Ultra",
  "teams-pro": "Teams Pro",
}

export const commandcodeProvider: Provider = {
  id: "commandcode",
  name: "Command Code",
  icon: "terminal",
  color: "#111827",
  help:
    "commandcode.ai 的订阅额度（GOAT 是 5 小时 $14 / 7 天 $35 / 每月 $70）。" +
    "先试 Studio 里的 API Key；用量接口是 CLI 在用的非公开接口，如果 401，" +
    "多半是它只认 CLI 登录后的 token，那就把 ~/.commandcode 里的那个填进来。",
  fields: [
    { key: "apiKey", label: "API Key", secret: true, required: true, placeholder: "cmd-..." },
    {
      key: "orgId",
      label: "组织 ID",
      help: "留空则自动通过 /alpha/whoami 取。个人账号一般不用填。",
    },
    { key: "baseUrl", label: "接口地址", placeholder: BASE, help: "一般不用改。" },
  ],
  async fetch(config, ctx): Promise<ProviderResult> {
    const base = ((config.baseUrl ?? "").trim() || BASE).replace(/\/+$/, "")
    const headers = { Authorization: `Bearer ${config.apiKey?.trim() ?? ""}` }

    // orgId 只是个查询参数，个人账号本来就可能没有。
    //
    // 所以 whoami 是**尽力而为**：超时、报错、返回结构不对，全部忽略，直接去打
    // credits。第一版把它当成硬依赖，结果它一超时整个抓取就死了，报「请求超时」——
    // 而真正要的那个请求根本没被发出去过。一个可选的前置步骤不该有能力否决主流程。
    //
    // 超时也给得比主请求短：它只是来省一个查询参数的，不值得让人等满一整个超时。
    let orgId = (config.orgId ?? "").trim()
    if (!orgId) {
      try {
        const who = await requestJson(
          `${base}/alpha/whoami`,
          { headers },
          Math.min(6, ctx.timeoutSec),
        )
        const found = getPath(who.json, "org.id")
        if (typeof found === "string" && found) {
          orgId = found
          // 下次直接用，省这一次请求
          ctx.updateConfig({ orgId: found })
        }
      } catch {
        // 拿不到就不带 orgId，让 credits 自己去判断凭据对不对
      }
    }

    const query = orgId ? `?orgId=${encodeURIComponent(orgId)}` : ""
    const credits = await requestJson(
      `${base}/alpha/billing/credits${query}`,
      { headers },
      ctx.timeoutSec,
    ).catch((error: unknown) => {
      // 超时的措辞要点名是哪一步。「请求超时」四个字帮不了任何人。
      throw new Error(
        `读取额度失败：${errorMessage(error)}（请求的是 ${base}/alpha/billing/credits）`,
      )
    })
    ctx.captureRaw(credits.text)
    if (credits.status === 401 || credits.status === 403) throw authError(credits.status)
    if (credits.status === 404) {
      throw new Error("用量接口 404。alpha 路径可能已经变了，见 p_commandcode.ts 顶部的说明")
    }
    if (!credits.ok) throw new Error(`读取额度失败 (${credits.status})`)

    const metrics = parseCredits(credits.json)
    if (metrics.length === 0) {
      throw new Error("返回里没有可识别的额度字段，请在详情页查看原始响应")
    }

    // 套餐名是锦上添花，拿不到不算失败
    let plan: string | undefined
    const planId = getPath(credits.json, "credits.planId")
    if (typeof planId === "string" && planId) plan = PLAN_NAMES[planId] ?? planId

    return { metrics, plan }
  },
}

function authError(status: number): Error {
  return new Error(
    `凭据被拒 (${status})。用量走的是 CLI 在用的非公开接口 /alpha/*，` +
      `它认不认 Studio 里签发的 API Key 没有文档说明——如果这把 Key 能正常跑推理` +
      `却在这里 401，就换成 CLI 浏览器登录后存在本地的那个 token 试试。`,
  )
}

/** 导出给测试。 */
export function parseCredits(json: unknown): Metric[] {
  const metrics: Metric[] = []

  // 1) 限流窗口。这是「这会儿还能不能用」的答案，排最前。
  const windows = getPath(json, "windowLimits")
  for (const [key, label] of [
    ["fiveHour", "5 小时"],
    ["weekly", "7 天"],
    ["monthly", "每月"],
  ] as const) {
    const node = getPath(windows, key)
    const cap = num(getPath(node, "cap"))
    const used = num(getPath(node, "used"))
    if (cap === undefined || used === undefined || cap <= 0) continue
    metrics.push({
      id: key,
      label,
      // 窗口是按美元花费算的，用 amount 而不是 percent：
      // 这样「还剩 $6」和「已用 $8 / $14」都能显示出来，比一个光秃秃的百分比有用。
      kind: "amount",
      value: Math.max(0, cap - used),
      max: cap,
      unit: "$",
      resetAt: toEpochMs(getPath(node, "resetAt")),
    })
  }

  // 2) 额度池。窗口之外还有个月度总量，充值的部分会滚存。
  const credits = getPath(json, "credits")
  const monthly = num(getPath(credits, "monthlyCredits"))
  const purchased = num(getPath(credits, "purchasedCredits"))
  const free = num(getPath(credits, "freeCredits"))
  if (monthly !== undefined || purchased !== undefined || free !== undefined) {
    const total = (monthly ?? 0) + (purchased ?? 0) + (free ?? 0)
    const hints: string[] = []
    if (purchased !== undefined && purchased > 0) hints.push(`充值 $${purchased.toFixed(2)}`)
    if (free !== undefined && free > 0) hints.push(`赠送 $${free.toFixed(2)}`)
    metrics.push({
      id: "credits",
      label: "剩余额度",
      kind: "amount",
      value: total,
      unit: "$",
      hint: hints.length > 0 ? hints.join(" · ") : undefined,
    })
  }

  return metrics
}
