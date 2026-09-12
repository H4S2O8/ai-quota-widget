/**
 * 生成实现版效果图 impl.html / impl.png。
 *
 * **排版直接调用 app/layout.ts**（用 esbuild 打成 mjs 后 import），样例数据走
 * app/view.ts 的 buildRows——效果图和真机对不上是最没意义的事，所以这里不另写
 * 一行排版逻辑，连列宽常量都不抄。
 *
 * 运行：node dev/design/preview.mjs && 用无头 Chrome 截图（见 README）。
 */
import { execFileSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const here = new URL(".", import.meta.url).pathname
const root = join(here, "..", "..", "app")
const out = mkdtempSync(join(tmpdir(), "aiquota-preview-"))

function build(name) {
  const dest = join(out, name.replace(/\.ts$/, ".mjs"))
  execFileSync(
    "npx",
    ["--yes", "esbuild@0.24.0", join(root, name), "--format=esm", "--bundle", "--outfile=" + dest],
    { stdio: ["ignore", "ignore", "inherit"] },
  )
  return import(dest)
}
const L = await build("layout.ts")
const V = await build("view.ts")
const T = await build("theme.ts")

// ---------- 样例数据：走 buildRows，指标标签用 provider 真正会给的中文 ----------

const NOW = Date.UTC(2026, 8, 12, 6, 32) // 14:32 UTC+8
const h = 3600e3
const pct = (id, label, used, resetAt) => ({ id, label, kind: "percent", value: used, resetAt })
const amt = (id, label, value, unit, max) => ({ id, label, kind: "amount", value, unit, max })

const accounts = [
  ["claude", "anthropic", "Claude 订阅"],
  ["codex", "codex", "Codex"],
  ["deepseek", "deepseek", "DeepSeek"],
  ["kimi", "kimicode", "Kimi Code"],
  ["openrouter", "openrouter", "OpenRouter"],
  ["silicon", "siliconflow", "硅基流动"],
].map(([id, providerId, label]) => ({ id, providerId, label, enabled: true, fields: {} }))

const states = {
  claude: {
    ok: true, fetchedAt: NOW,
    result: { metrics: [
      pct("5h", "5 小时", 42, NOW + 2 * h),
      pct("7d", "7 天", 77, NOW + 76 * h),
      pct("opus", "7 天 Opus", 91, NOW + 76 * h),
    ] },
  },
  codex: { ok: true, fetchedAt: NOW, result: { metrics: [
    pct("5h", "5 小时", 29, NOW + h), pct("7d", "7 天", 56, NOW + 50 * h),
  ] } },
  deepseek: { ok: true, fetchedAt: NOW, result: { metrics: [amt("bal", "余额", 12.5, "¥", 50)] } },
  kimi: { ok: true, fetchedAt: NOW, result: { metrics: [
    // count 的 value 是「剩余」，不是已用
    { id: "5h", label: "5 小时", kind: "count", value: 940, max: 1000, resetAt: NOW + 3 * h },
    { id: "7d", label: "7 天", kind: "count", value: 812, max: 1000, resetAt: NOW + 30 * h },
  ] } },
  openrouter: { ok: true, fetchedAt: NOW, result: { metrics: [amt("bal", "余额", 3.1, "$", 35)] } },
  silicon: { ok: true, fetchedAt: NOW, result: { metrics: [amt("bal", "总余额", 88.2, "¥", 100)] } },
}
const config = { version: 1, settings: { refreshMinutes: 15, displayMode: "remaining" }, accounts }
const rows = V.sortBySeverity(V.enabledRows(V.buildRows(config, { updatedAt: NOW, states }, NOW)))
const totals = V.summarize(V.buildRows(config, { updatedAt: NOW, states }, NOW))
const alarming = totals.bad + totals.failed

// ---------- 渲染成 HTML ----------

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/ /g, "&nbsp;")
const seg = (s) => `<span style="color:${s.c}">${esc(s.t)}</span>`
const ln = (line, cls = "ln") => `<div class="${cls}">${line.map(seg).join("")}</div>`

function small(P) {
  const m = L.smallModel(rows, P, NOW, NOW)
  return `<div class="pad" style="background:${P.bg}">
    ${ln(L.promptLine(P, "quota"))}
    <div class="hero" style="color:${m.hero.color}">${esc(m.hero.text)}</div>
    ${ln(m.label, "ln sm")}
    ${m.items.map((l) => ln(l)).join("")}
    <div style="flex:1"></div>
    ${ln(m.footer, "ln sm")}
  </div>`
}
function list(P, size) {
  const large = size === "l"
  const { lines, shown } = large
    ? L.treeLines(rows, P, L.ROWS.large)
    : L.tableLines(rows, P, L.ROWS.medium)
  return `<div class="pad" style="background:${P.bg}">
    ${ln(L.promptLine(P, large ? "ai-quota --tree" : "ai-quota"))}
    ${lines.map((l) => ln(l)).join("")}
    <div style="flex:1"></div>
    ${ln(L.footerLine(P, shown, rows.length, alarming, NOW), "ln sm")}
  </div>`
}

// 顺手对一遍列宽预算：超了就是真机上会被截成「…」的行
let over = 0
for (const [P, name] of [[T.W_LIGHT, "light"], [T.W_DARK, "dark"]]) {
  const m = L.smallModel(rows, P, NOW, NOW)
  for (const l of [m.label, ...m.items, m.footer])
    if (L.lineWidth(l) > L.COLS.small) { over++; console.error(`小尺寸超宽(${name}):`, l.map((s) => s.t).join("")) }
  for (const l of L.tableLines(rows, P, L.ROWS.medium).lines)
    if (L.lineWidth(l) > L.COLS.medium) { over++; console.error(`中尺寸超宽(${name}):`, l.map((s) => s.t).join("")) }
  for (const l of L.treeLines(rows, P, L.ROWS.large).lines)
    if (L.lineWidth(l) > L.COLS.large) { over++; console.error(`大尺寸超宽(${name}):`, l.map((s) => s.t).join("")) }
}

let body = ""
for (const [P, label] of [[T.W_LIGHT, "日间"], [T.W_DARK, "夜间"]]) {
  body += `<div class="grp"><div class="lbl">${label}</div><div class="pair">
    <div class="w s">${small(P)}</div>
    <div class="w m">${list(P, "m")}</div>
    <div class="w l">${list(P, "l")}</div></div></div>`
}
// 字号和行高都按 SF Mono 的真实度量：步进 0.618em，行高 ≈ 1.18em + VStack 间距
writeFileSync(join(here, "impl.html"), `<!doctype html><html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#6b6b76;padding:26px;font-family:-apple-system,sans-serif}
h1{color:#fff;font:600 16px/1;margin-bottom:4px}
.note{color:#fff;opacity:.6;font-size:12.5px;margin-bottom:18px}
.grp{margin-bottom:18px}
.lbl{color:#fff;opacity:.55;font:500 11px/1;margin:0 0 7px 2px}
.pair{display:flex;gap:16px;align-items:flex-start}
.w{border-radius:22px;overflow:hidden}
.s{width:170px;height:170px}.m{width:364px;height:170px}.l{width:364px;height:382px}
.pad{padding:13px 15px;height:100%;display:flex;flex-direction:column;gap:1px;
     font-family:"SF Mono",Menlo,monospace;font-variant-numeric:tabular-nums}
.ln{font-size:${L.FONT}px;line-height:1.35;white-space:pre}
.sm{font-size:10px}
.hero{font-size:28px;line-height:1.1;font-weight:600;font-family:"SF Mono",Menlo,monospace;margin:2px 0}
</style></head><body>
<h1>AI 额度小组件 · 终端风</h1>
<div class="note">排版由 app/layout.ts 生成（样例数据走 view.ts 的 buildRows），与 widget.tsx 用的是同一份代码</div>
${body}</body></html>`)
console.log(over ? `已生成 impl.html，但有 ${over} 行超出列宽预算` : "已生成 impl.html，所有行都在列宽预算内")
process.exit(over ? 1 : 0)
