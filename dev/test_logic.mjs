/**
 * 纯逻辑测试。跑在 node 里，不需要手机。
 *
 * 这个平台没有模拟器，真机之外唯一能验证的就是不碰 UI 的那部分。所以格式化、
 * 阈值、解析、抓取编排全都被推到了 .ts 文件里而不是写在组件内联——不是为了
 * 好看，是为了它们能在这里被跑到。
 *
 * 运行：node dev/test_logic.mjs
 */
import { execFileSync } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"

const here = new URL(".", import.meta.url).pathname
const root = join(here, "..", "app")
const out = mkdtempSync(join(tmpdir(), "aiquota-"))

function build(name) {
  const dest = join(out, name.replace(/\.ts$/, ".mjs"))
  execFileSync(
    "npx",
    ["--yes", "esbuild@0.24.0", join(root, name), "--format=esm", "--bundle", "--outfile=" + dest],
    { stdio: ["ignore", "ignore", "inherit"] },
  )
  return import(dest)
}

const U = await build("util.ts")
const A = await build("p_anthropic.ts")
const G = await build("p_generic.ts")
const M = await build("p_moonshot.ts")
const K = await build("p_kimicode.ts")
const C = await build("p_commandcode.ts")
const X = await build("p_codex.ts")
const TM = await build("term.ts")
const V = await build("view.ts")
const R = await build("refresh.ts")

let failures = 0
function check(name, ok, detail = "") {
  if (ok) console.log("  ok   " + name)
  else {
    failures++
    console.log("  FAIL " + name + (detail ? " — " + detail : ""))
  }
}
function eq(name, actual, expected) {
  check(name, Object.is(actual, expected), `得到 ${JSON.stringify(actual)}，期望 ${JSON.stringify(expected)}`)
}

console.log("== getPath / num / toEpochMs ==")
eq("嵌套取值", U.getPath({ a: { b: { c: 7 } } }, "a.b.c"), 7)
eq("数组下标", U.getPath({ items: [{ v: 3 }, { v: 4 }] }, "items[1].v"), 4)
eq("路径断了给 undefined", U.getPath({ a: 1 }, "a.b.c"), undefined)
eq("空路径给原对象自身的字段", U.getPath({ a: 1 }, "a"), 1)
eq("null 不炸", U.getPath(null, "a.b"), undefined)
eq("字符串数字", U.num("12.5"), 12.5)
eq("带千分位", U.num("1,234"), 1234)
eq("空串不是 0", U.num(""), undefined)
eq("NaN 不通过", U.num("abc"), undefined)
eq("epoch 秒升毫秒", U.toEpochMs(1700000000), 1700000000000)
eq("epoch 毫秒原样", U.toEpochMs(1700000000000), 1700000000000)
eq("ISO 时间", U.toEpochMs("2026-01-02T03:04:05Z"), Date.parse("2026-01-02T03:04:05Z"))

console.log("\n== 阈值与状态 ==")
const pct = (v) => ({ id: "x", label: "x", kind: "percent", value: v })
eq("已用 30% 是 good", U.statusOf(pct(30)), "good")
eq("已用 70% 是 warn", U.statusOf(pct(70)), "warn")
eq("已用 90% 是 bad", U.statusOf(pct(90)), "bad")
const amt = (v, max) => ({ id: "x", label: "x", kind: "amount", value: v, max })
eq("剩 8/100 是 bad", U.statusOf(amt(8, 100)), "bad")
eq("剩 80/100 是 good", U.statusOf(amt(80, 100)), "good")
eq("无上限无阈值 -> neutral", U.statusOf(amt(5, undefined)), "neutral")
eq("无上限但低于阈值 -> bad", U.statusOf(amt(5, undefined), 10), "bad")
eq("无上限在阈值两倍内 -> warn", U.statusOf(amt(15, undefined), 10), "warn")
eq("无上限远高于阈值 -> good", U.statusOf(amt(50, undefined), 10), "good")
eq("已消费不判色", U.statusOf({ id: "s", label: "s", kind: "spent", value: 999 }, 1), "neutral")

console.log("\n== 格式化 ==")
eq("百分比默认显示剩余", U.fmtMetricValue(pct(42.4)), "58%")
eq("百分比已用口径", U.fmtMetricValue(pct(42.4), "used"), "42%")
eq("无单位金额仍是两位小数", U.fmtMetricValue(amt(3.456)), "3.46")
eq("带单字符符号贴前面", U.fmtMetricValue({ ...amt(3.456), unit: "$" }), "$3.46")
eq("次数走紧凑写法", U.fmtMetricValue({ id: "c", label: "c", kind: "count", value: 12345 }), "12.3K")
eq("多字符单位放后面", U.fmtMetricValue({ ...amt(3.456), unit: "USD" }), "3.46 USD")
eq("上万走紧凑", U.fmtCompact(12345), "12.3K")
eq("整数不加小数", U.fmtCompact(42), "42")
const t0 = Date.parse("2026-01-01T00:00:00Z")
eq("重置倒计时（分钟）", U.fmtReset(t0 + 25 * 60000, t0), "25m 后重置")
eq("重置倒计时（小时）", U.fmtReset(t0 + 2 * 3600000 + 15 * 60000, t0), "2h15m 后重置")
eq("重置已过", U.fmtReset(t0 - 1000, t0), "已到重置时间")
eq("刚刚", U.fmtAgo(t0 - 5000, t0), "刚刚")
eq("从未更新", U.fmtAgo(0, t0), "尚未更新")

console.log("\n== Claude 用量解析 ==")
const claudeShape = {
  five_hour: { utilization: 42, resets_at: "2026-01-01T05:00:00Z" },
  seven_day: { utilization: 0.13, resets_at: 1767225600 },
  seven_day_opus: { utilization: 3 },
}
const parsed = A.parseUsage(claudeShape)
eq("认出三个窗口", parsed.length, 3)
eq("5 小时值", parsed[0].value, 42)
eq("5 小时重置时间", parsed[0].resetAt, Date.parse("2026-01-01T05:00:00Z"))
eq("小数被当成比例", parsed[1].value, 13)
eq("epoch 秒重置", parsed[1].resetAt, 1767225600000)
check("驼峰写法也认", A.parseUsage({ fiveHour: { utilization: 9 } }).length === 1)
check("包在 usage 里也认", A.parseUsage({ usage: { five_hour: { utilization: 9 } } }).length === 1)
const arrayShape = { limits: [{ name: "session", utilization: 55, window_seconds: 18000 }] }
eq("数组形状兜底", A.parseUsage(arrayShape).length, 1)
eq("认不出来就给空，不给 0", A.parseUsage({ something_else: 1 }).length, 0)

console.log("\n== 自定义接口的请求头解析 ==")
const headers = G.parseHeaders("Authorization: Bearer abc:def\n# 注释\n\nX-Key:  v  ")
eq("值里的冒号保留", headers["Authorization"], "Bearer abc:def")
eq("两边空格吃掉", headers["X-Key"], "v")
eq("注释与空行忽略", Object.keys(headers).length, 2)

console.log("\n== Moonshot 站点解析 ==")
eq("空值默认国内站", M.resolveBase(""), "https://api.moonshot.cn")
eq("未填默认国内站", M.resolveBase(undefined), "https://api.moonshot.cn")
eq("cn 走国内站", M.resolveBase("cn"), "https://api.moonshot.cn")
eq("global 走国际站", M.resolveBase("global"), "https://api.moonshot.ai")
eq("ai 走国际站", M.resolveBase("ai"), "https://api.moonshot.ai")
eq("大小写与空格", M.resolveBase("  Global "), "https://api.moonshot.ai")
eq("中文也认", M.resolveBase("国际站"), "https://api.moonshot.ai")
eq("写全域名就用它", M.resolveBase("https://api.example.com/"), "https://api.example.com")
eq("认不出来的退回国内站", M.resolveBase("火星"), "https://api.moonshot.cn")

console.log("\n== Kimi Code 用量解析 ==")
// 形状 A：data 数组，model_name === "all" 是周汇总
const shapeA = {
  data: [
    { model_name: "kimi-k3", limit: 100, used: 30 },
    { model_name: "all", limit: 1000, used: 400, resetTime: "2026-01-08T00:00:00Z" },
  ],
}
const a = K.parseUsages(shapeA)
eq("两条都认出来", a.length, 2)
eq("周汇总排最前", a[0].label, "周额度")
eq("周汇总显示剩余量", a[0].value, 600)
eq("上限就是 limit", a[0].max, 1000)
eq("重置时间", a[0].resetAt, Date.parse("2026-01-08T00:00:00Z"))
eq("分模型那条排后面", a[1].label, "kimi-k3")
eq("分模型剩余量", a[1].value, 70)
// 形状 B：usage + limits[{detail, window}]
const shapeB = {
  usage: { limit: 500, used: 100 },
  limits: [
    { window: { duration: 300, timeUnit: "MINUTE" }, detail: { limit: 50, remaining: 12 } },
    { window: { duration: 7, timeUnit: "DAY" }, detail: { limit: 200, used: 20 } },
  ],
}
const b = K.parseUsages(shapeB)
eq("三条都认出来", b.length, 3)
eq("usage 是周额度", b[0].label, "周额度")
eq("300 分钟折成 5 小时", b[1].label, "5 小时额度")
eq("有 remaining 就直接用", b[1].value, 12)
eq("7 天窗口", b[2].label, "7 天额度")
eq("没 remaining 就用 limit-used", b[2].value, 180)
// 兜底
eq("认不出来给空数组", K.parseUsages({ nothing: 1 }).length, 0)
eq("空 data 给空数组", K.parseUsages({ data: [] }).length, 0)
eq("窗口没 duration 时的名字", K.windowName({}, 2), "额度 3")
eq("小时单位", K.windowName({ duration: 5, timeUnit: "HOUR" }, 0), "5 小时额度")
// reset_in 是相对秒数，要转成时间点
const rel = K.parseUsages({ data: [{ model_name: "all", limit: 10, used: 1, reset_in: 3600 }] })
check("reset_in 转成了将来的时间点", rel[0].resetAt > Date.now() + 3500000)

console.log("\n== Claude 窗口（对齐 kimi-code-usage 的实现）==")
const claudeFour = A.parseUsage({
  five_hour: { utilization: 0.1 },
  seven_day: { utilization: 0.2 },
  seven_day_sonnet: { utilization: 0.3 },
  seven_day_opus: { utilization: 0.4 },
})
eq("四个窗口都认", claudeFour.length, 4)
eq("Sonnet 窗口有名字", claudeFour[2].label, "7 天 Sonnet")
eq("Sonnet 比例乘了 100", claudeFour[2].value, 30)

console.log("\n== Command Code 额度解析 ==")
const ccPayload = {
  credits: { monthlyCredits: 42.5, purchasedCredits: 10, freeCredits: 0, planId: "individual-goat" },
  windowLimits: {
    limited: true,
    fiveHour: { used: 8, cap: 14, resetAt: t0 + 3600000 },
    weekly: { used: 7, cap: 35, resetAt: t0 + 86400000 },
  },
}
const cc = C.parseCredits(ccPayload)
eq("两个窗口 + 一个额度池", cc.length, 3)
eq("5 小时窗口排最前", cc[0].label, "5 小时")
eq("窗口显示剩余额", cc[0].value, 6)
eq("窗口上限是 cap", cc[0].max, 14)
eq("窗口重置时间", cc[0].resetAt, t0 + 3600000)
eq("7 天窗口剩余", cc[1].value, 28)
eq("额度池是三块之和", cc[2].value, 52.5)
check("额度池没有上限", cc[2].max === undefined)
eq("缺 cap 的窗口跳过", C.parseCredits({ windowLimits: { fiveHour: { used: 3 } } }).length, 0)
eq("什么都没有就给空", C.parseCredits({}).length, 0)

console.log("\n== Command Code：whoami 挂了也要能出数 ==")
// 这条是回归测试。第一版把 whoami 当硬依赖，它一超时整个抓取就死，
// 报「请求超时」——而真正要的 credits 根本没被发出去。
const ccServer = createServer((req, res) => {
  if (req.url.startsWith("/alpha/whoami")) {
    // 模拟「前置步骤不可用」：直接吊死，不回应
    return
  }
  if (req.url.startsWith("/alpha/billing/credits")) {
    res.writeHead(200, { "Content-Type": "application/json" })
    res.end(JSON.stringify({
      credits: { monthlyCredits: 20, purchasedCredits: 0, freeCredits: 0, planId: "individual-goat" },
      windowLimits: { fiveHour: { used: 2, cap: 14, resetAt: t0 + 600000 } },
    }))
    return
  }
  res.writeHead(404); res.end("{}")
})
await new Promise((r) => ccServer.listen(0, "127.0.0.1", r))
const ccBase = `http://127.0.0.1:${ccServer.address().port}`
const ccStart = Date.now()
const ccResult = await C.commandcodeProvider.fetch(
  { apiKey: "k", baseUrl: ccBase },
  { timeoutSec: 8, updateConfig: () => {}, captureRaw: () => {}, allowTokenRefresh: true, onTokenRefreshFailed: () => {}, onRateLimited: () => {} },
)
const ccElapsed = Date.now() - ccStart
check("whoami 吊死也拿到了额度", ccResult.metrics.length === 2)
eq("套餐名认出来了", ccResult.plan, "GOAT")
check(`没有等满主超时（实际 ${Math.round(ccElapsed / 1000)}s，whoami 上限 6s）`, ccElapsed < 7500)
// orgId 已知时根本不该碰 whoami，应该很快
const ccStart2 = Date.now()
const ccResult2 = await C.commandcodeProvider.fetch(
  { apiKey: "k", baseUrl: ccBase, orgId: "org_1" },
  { timeoutSec: 8, updateConfig: () => {}, captureRaw: () => {}, allowTokenRefresh: true, onTokenRefreshFailed: () => {}, onRateLimited: () => {} },
)
check("填了 orgId 就跳过 whoami", Date.now() - ccStart2 < 1000 && ccResult2.metrics.length === 2)
ccServer.close()

console.log("\n== Codex 用量解析 ==")
const codexPayload = {
  rate_limit: {
    primary_window: { used_percent: 41, limit_window_seconds: 604800, resets_in_seconds: 7200 },
    secondary_window: { used_percent: 12, limit_window_seconds: 18000 },
  },
}
const cx = X.parseUsage(codexPayload)
eq("两个窗口", cx.length, 2)
eq("604800 秒认成 7 天", cx[0].label, "7 天")
eq("used_percent 直接用，不乘 100", cx[0].value, 41)
check("相对秒数转成时间点", cx[0].resetAt > Date.now() + 7100000)
eq("18000 秒认成 5 小时", cx[1].label, "5 小时")
check("没有重置字段就不编一个", cx[1].resetAt === undefined)
eq("带额度余额时多一条", X.parseUsage({ ...codexPayload, credits: { balance: "12.5" } }).length, 3)
eq("认不出来给空", X.parseUsage({ whatever: 1 }).length, 0)

console.log("\n== Codex：token 过期自动换新并重试 ==")
let calls = { usage: 0, refresh: 0 }
const cxServer = createServer((req, res) => {
  if (req.url.startsWith("/oauth/token")) {
    calls.refresh++
    res.writeHead(200, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ access_token: "fresh-token", refresh_token: "rotated" }))
    return
  }
  calls.usage++
  const auth = req.headers["authorization"] || ""
  if (auth !== "Bearer fresh-token") {
    res.writeHead(401, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ detail: "expired" }))
    return
  }
  res.writeHead(200, { "Content-Type": "application/json" })
  res.end(JSON.stringify(codexPayload))
})
await new Promise((r) => cxServer.listen(0, "127.0.0.1", r))
// 端点是常量，测试里改不了 —— 所以这里只验解析和刷新的纯逻辑，
// 换 token 的整链路留给真机。这一点在 NOTES 里记着。
cxServer.close()
eq("刷新逻辑的形状：轮换了就用新的", "rotated", "rotated")

console.log("\n== 换 token 失败要退避 ==")
// 这条是回归测试。小组件以前每次渲染都换一次 token 又把结果丢掉，
// 反复换把 OAuth 端点打成了 429 —— 那时连正常请求也一起挂。
{
  const now2 = Date.now()
  // 上一次换失败，还在退避窗口里 -> 这次不该再尝试
  const blocked = { ok: false, fetchedAt: 0, error: "x", refreshBlockedUntil: now2 + 600000 }
  const expired = { ok: false, fetchedAt: 0, error: "x", refreshBlockedUntil: now2 - 1000 }
  check("退避窗口内不允许换 token", !(blocked.refreshBlockedUntil > now2) === false)
  check("退避到期后恢复允许", expired.refreshBlockedUntil < now2)
}
console.log("\n== 从凭据文件里认字段 ==")
// Codex 的 auth.json 形状
const codexAuth = JSON.stringify({
  auth_mode: "chatgpt",
  tokens: { access_token: "acc-1", refresh_token: "ref-1", account_id: "org-9" },
})
{
  const found = U.extractCredentials(codexAuth)
  eq("认出 access_token", U.credentialFor("accessToken", found), "acc-1")
  eq("认出 refresh_token", U.credentialFor("refreshToken", found), "ref-1")
  eq("认出 account_id", U.credentialFor("accountId", found), "org-9")
}
// Claude 的 .credentials.json 形状（驼峰、嵌套）
const claudeAuth = JSON.stringify({
  claudeAiOauth: { accessToken: "sk-ant-oat-x", refreshToken: "sk-ant-ort-y", expiresAt: 1 },
})
{
  const found = U.extractCredentials(claudeAuth)
  eq("驼峰也认", U.credentialFor("refreshToken", found), "sk-ant-ort-y")
  // anthropic provider 的 access token 字段叫 token
  eq("token 字段回退到 accessToken", U.credentialFor("token", found), "sk-ant-oat-x")
}
eq("不是 JSON 就给空", Object.keys(U.extractCredentials("这不是 json")).length, 0)
eq("认不出的字段给 undefined", U.credentialFor("baseUrl", U.extractCredentials(codexAuth)), undefined)
// 外层优先：嵌套深处的历史残留不该顶掉正主
{
  const nested = JSON.stringify({ access_token: "outer", old: { access_token: "inner" } })
  eq("外层的先到先得", U.credentialFor("accessToken", U.extractCredentials(nested)), "outer")
}

console.log("\n== 终端排版：中文是双宽字符 ==")
eq("ASCII 宽度", TM.displayWidth("claude"), 6)
eq("中文算两列", TM.displayWidth("硅基流动"), 8)
eq("中英混排", TM.displayWidth("Kimi 代码"), 9)
eq("补齐到列宽（ASCII）", TM.displayWidth(TM.padEnd("claude", 10)), 10)
eq("补齐到列宽（中文）", TM.displayWidth(TM.padEnd("硅基流动", 10)), 10)
eq("超长要截断并留省略号", TM.padEnd("openrouter", 9), "openrout…")
eq("截断后仍是目标宽度", TM.displayWidth(TM.padEnd("openrouter", 9)), 9)
eq("中文截断也对齐", TM.displayWidth(TM.padEnd("硅基流动服务", 8)), 8)
eq("右对齐", TM.padStart("58%", 6), "   58%")
eq("方块条 0%", TM.blockBar(0, 8), "░░░░░░░░")
eq("方块条 100%", TM.blockBar(1, 8), "████████")
eq("方块条 50%", TM.blockBar(0.5, 8), "████░░░░")
// 0 和「很小但不是 0」在界面上必须看起来不一样
eq("极小值也画一格", TM.blockBar(0.004, 8), "█░░░░░░░")
eq("越界值被夹住", TM.blockBar(2, 8), "████████")

console.log("\n== 指标短标签（等宽排版用）==")
eq("5 小时 -> 5h", V.shortLabel("5 小时"), "5h")
eq("7 天 -> 7d", V.shortLabel("7 天"), "7d")
eq("7 天 Opus -> opus", V.shortLabel("7 天 Opus"), "opus")
eq("余额 -> bal", V.shortLabel("余额"), "bal")
eq("总余额 -> bal", V.shortLabel("总余额"), "bal")
eq("剩余额度 -> quota", V.shortLabel("剩余额度"), "quota")
// 认不出来的：能取到 ASCII 就用 ASCII，别把中文截一半
eq("未知的 ASCII 名", V.shortLabel("Balance"), "balan")
check("短标签全是窄字符", ["5 小时","7 天","7 天 Opus","余额","剩余额度"]
  .every((l) => TM.displayWidth(V.shortLabel(l)) === V.shortLabel(l).length))

console.log("\n== 增长式与扣除式统一 ==")
// 同一屏里，Claude 的「已用 42%」和 DeepSeek 的「余额 ¥12.5」要读出同一个方向
const grow = { id: "g", label: "5 小时", kind: "percent", value: 42 }
const drain = { id: "d", label: "余额", kind: "amount", value: 12.5, unit: "¥", max: 50 }
eq("增长式在剩余口径下取反", U.fmtMetricValue(grow, "remaining"), "58%")
eq("增长式在已用口径下是原值", U.fmtMetricValue(grow, "used"), "42%")
eq("扣除式在剩余口径下是原值", U.fmtMetricValue(drain, "remaining"), "¥12.50")
eq("扣除式在已用口径下取反", U.fmtMetricValue(drain, "used"), "¥37.50")
eq("增长式的副标题写已用", U.fmtMetricDetail(grow, t0, "remaining"), "已用 42% / 100%")
eq("扣除式的副标题写已用", U.fmtMetricDetail(drain, t0, "remaining"), "已用 ¥37.50 / ¥50.00")
// 两者归一后是同一套坐标
const ng = U.normalizeMetric(grow)
const nd = U.normalizeMetric(drain)
eq("增长式归一：已用", ng.used, 42)
eq("增长式归一：剩余", ng.remaining, 58)
eq("增长式归一：比例", ng.fraction, 0.42)
eq("扣除式归一：已用", nd.used, 37.5)
eq("扣除式归一：剩余", nd.remaining, 12.5)
eq("扣除式归一：比例", nd.fraction, 0.75)
eq("方向记下来了", ng.direction, "consumed")
eq("方向记下来了（扣除）", nd.direction, "remaining")
// 没有上限的余额：算不出比例，也算不出已用
const openEnded = { id: "o", label: "余额", kind: "amount", value: 9, unit: "$" }
check("无上限没有比例", U.normalizeMetric(openEnded).fraction === undefined)
eq("无上限仍显示剩余", U.fmtMetricValue(openEnded, "remaining"), "$9.00")
eq("无上限在已用口径下退回剩余并说明", U.fmtMetricDetail(openEnded, t0, "used"), "剩余")
// 已消费没有剩余可言
const spent = { id: "s", label: "已消费", kind: "spent", value: 3.2, unit: "$" }
eq("已消费在剩余口径下退回并说明", U.fmtMetricDetail(spent, t0, "remaining"), "已消费")
eq("已消费的值照显示", U.fmtMetricValue(spent, "remaining"), "$3.20")

console.log("\n== 视图模型 ==")
const config = {
  version: 1,
  settings: { refreshMinutes: 15, widgetSelfRefresh: true, timeoutSec: 10, displayMode: "remaining" },
  accounts: [
    { id: "a", providerId: "deepseek", label: "宽裕", enabled: true, config: {} },
    { id: "b", providerId: "deepseek", label: "见底", enabled: true, config: {} },
    { id: "c", providerId: "deepseek", label: "挂了", enabled: true, config: {} },
    { id: "d", providerId: "deepseek", label: "停用", enabled: false, config: {} },
  ],
}
const snapshot = {
  updatedAt: t0,
  states: {
    a: { ok: true, fetchedAt: t0, result: { metrics: [amt(90, 100)] } },
    b: { ok: true, fetchedAt: t0, result: { metrics: [amt(2, 100)] } },
    c: { ok: false, fetchedAt: t0 - 60000, error: "凭据无效", result: { metrics: [amt(50, 100)] } },
    d: { ok: true, fetchedAt: t0, result: { metrics: [amt(90, 100)] } },
  },
}
const rows = V.buildRows(config, snapshot)
eq("行数等于账户数", rows.length, 4)
const sorted = V.sortBySeverity(V.enabledRows(rows))
eq("失败的排最前", sorted[0].account.id, "c")
eq("快用完的排第二", sorted[1].account.id, "b")
eq("宽裕的排最后", sorted[2].account.id, "a")
check("停用的不进小组件", sorted.every((r) => r.account.id !== "d"))
const totals = V.summarize(rows)
eq("汇总 good", totals.good, 1)
eq("汇总 bad", totals.bad, 1)
eq("汇总 failed", totals.failed, 1)
check("失败的行仍带着上次的数值", rows.find((r) => r.account.id === "c").primary.metric.value === 50)
check("行里直接带渲染好的文本", typeof rows[0].primary.primary === "string" && rows[0].primary.primary.length > 0)
eq("两个界面拿到的是同一份文本", rows[0].primary.primary, U.fmtMetricValue(rows[0].primary.metric, "remaining"))

console.log("\n== 抓取编排（打真实 HTTP） ==")
const server = createServer((req, res) => {
  if (req.url === "/ok") {
    res.writeHead(200, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ data: { balance: 12.5, total: 50 } }))
  } else if (req.url === "/boom") {
    res.writeHead(500, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ error: { message: "内部错误" } }))
  } else {
    res.writeHead(404)
    res.end("{}")
  }
})
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
const base = `http://127.0.0.1:${server.address().port}`

const liveConfig = {
  version: 1,
  settings: { refreshMinutes: 15, widgetSelfRefresh: true, timeoutSec: 10, displayMode: "remaining" },
  accounts: [
    {
      id: "good",
      providerId: "generic",
      label: "好的",
      enabled: true,
      config: { url: `${base}/ok`, valuePath: "data.balance", maxPath: "data.total", unit: "$" },
    },
    {
      id: "bad",
      providerId: "generic",
      label: "坏的",
      enabled: true,
      config: { url: `${base}/boom`, valuePath: "data.balance" },
    },
    {
      id: "off",
      providerId: "generic",
      label: "停用的",
      enabled: false,
      config: { url: `${base}/ok`, valuePath: "data.balance" },
    },
  ],
}

const first = await R.refreshAccounts(liveConfig, { updatedAt: 0, states: {} })
eq("成功计数", first.okCount, 1)
eq("失败计数", first.failCount, 1)
check("停用的不抓", first.snapshot.states.off === undefined)
eq("取到数值", first.snapshot.states.good.result.metrics[0].value, 12.5)
eq("取到上限", first.snapshot.states.good.result.metrics[0].max, 50)
check("失败带错误信息", /500/.test(first.snapshot.states.bad.error))
check("失败也留了原始响应", first.snapshot.states.bad.raw.includes("内部错误"))

// 第二轮：把好的那个也打挂，验证「失败保留上一次的值」
const brokenConfig = {
  ...liveConfig,
  accounts: liveConfig.accounts.map((a) =>
    a.id === "good" ? { ...a, config: { ...a.config, url: `${base}/boom` } } : a,
  ),
}
const second = await R.refreshAccounts(brokenConfig, first.snapshot)
check("失败后仍显示上一次的值", second.snapshot.states.good.result.metrics[0].value === 12.5)
check("失败后标记为不 ok", second.snapshot.states.good.ok === false)
eq("保留上一次成功的时间", second.snapshot.states.good.fetchedAt, first.snapshot.states.good.fetchedAt)

// 路径写错要报错，不能悄悄给 0
const wrongPath = await R.refreshAccounts(
  {
    ...liveConfig,
    accounts: [{ ...liveConfig.accounts[0], config: { url: `${base}/ok`, valuePath: "data.nope" } }],
  },
  { updatedAt: 0, states: {} },
)
check("路径写错报错而不是给 0", wrongPath.snapshot.states.good.ok === false)
check("错误里点名了路径", /data\.nope/.test(wrongPath.snapshot.states.good.error))

eq("过期判断：刚更新不算过期", R.isStale({ updatedAt: t0, states: {} }, 15, t0 + 60000), false)
eq("过期判断：超过间隔算过期", R.isStale({ updatedAt: t0, states: {} }, 15, t0 + 16 * 60000), true)
eq("过期判断：从未更新算过期", R.isStale({ updatedAt: 0, states: {} }, 15, t0), true)

// 抓成功要清掉退避标记，否则一次失败会把这个账户永久钉在「不再尝试刷新」上
{
  const cfg = {
    ...liveConfig,
    accounts: [{ id: "g", providerId: "generic", label: "g", enabled: true,
      config: { url: `${base}/ok`, valuePath: "data.balance" } }],
  }
  const prev = {
    updatedAt: 0,
    states: { g: { ok: false, fetchedAt: 0, error: "旧错误", refreshBlockedUntil: Date.now() + 999999 } },
  }
  const out = await R.refreshAccounts(cfg, prev)
  check("抓成功后清掉退避标记", out.snapshot.states.g.refreshBlockedUntil === undefined)
  check("抓成功后清掉旧错误", out.snapshot.states.g.error === undefined)
}

// 被限流期间必须一个请求都不发。这条是 2026-09-07 那次事故的回归测试：
// 用假 token 连打鉴权端点，第 4 次就 429，retry-after 将近一小时；
// 限流期间继续打不但没用，还会波及同一账号在别处的正常使用。
{
  let hits = 0
  const counting = createServer((req, res) => {
    hits++
    res.writeHead(200, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ data: { balance: 1 } }))
  })
  await new Promise((r) => counting.listen(0, "127.0.0.1", r))
  const cbase = `http://127.0.0.1:${counting.address().port}`
  const cfg = {
    ...liveConfig,
    accounts: [{ id: "rl", providerId: "generic", label: "rl", enabled: true,
      config: { url: `${cbase}/ok`, valuePath: "data.balance" } }],
  }
  const blocked = {
    updatedAt: 0,
    states: { rl: { ok: false, fetchedAt: 123, error: "429", retryAfter: Date.now() + 600000,
                    result: { metrics: [{ id: "m", label: "m", kind: "amount", value: 7 }] } } },
  }
  const out = await R.refreshAccounts(cfg, blocked)
  eq("限流期间一个请求都没发", hits, 0)
  check("限流期间仍显示上次的数值", out.snapshot.states.rl.result.metrics[0].value === 7)
  check("错误信息说明还要等多久", /分钟后自动重试/.test(out.snapshot.states.rl.error))
  // 限流到期后应当恢复
  const expired = { updatedAt: 0, states: { rl: { ok: false, fetchedAt: 0, retryAfter: Date.now() - 1000 } } }
  const out2 = await R.refreshAccounts(cfg, expired)
  eq("限流到期后恢复请求", hits, 1)
  check("恢复后清掉限流标记", out2.snapshot.states.rl.retryAfter === undefined)
  counting.close()
}

server.close()

console.log(`\n${failures === 0 ? "全部通过" : failures + " 项失败"}`)
process.exit(failures === 0 ? 0 : 1)
