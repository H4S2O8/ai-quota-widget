/**
 * 生成实现版（方案 B-2 终端风）的效果图。
 *
 * **排版直接调用 app/term.ts**，列宽和 widget.tsx 里的 LAYOUT 保持一致——
 * 效果图和真机对不上是最没意义的事，所以不另写一套排版逻辑。
 */
import { writeFileSync } from "node:fs"
const T = await import("/tmp/term.mjs")

const P = {
  light: { bg:"#F6F4EE", fg:"#23211C", dim:"#6B675C", faint:"#847E6E", rule:"#D5D0C2",
           accent:"#15803D", good:"#15803D", warn:"#9C5F06", bad:"#BE123C" },
  dark:  { bg:"#0D0F12", fg:"#C8D3D5", dim:"#6F8286", faint:"#5E6E73", rule:"#232A30",
           accent:"#4ADE80", good:"#4ADE80", warn:"#F5C451", bad:"#FF8080" },
}
// widget.tsx 里的 LAYOUT，逐字抄过来
const L = {
  m: { font:11, name:13, win:5, bar:10, val:8, rows:6 },
  l: { font:11, name:13, win:5, bar:12, val:8, rows:17 },
}
const ACC = [
  { n:"Claude 订阅", ms:[{w:"5h",v:"58%",u:.42,s:"good"},{w:"7d",v:"23%",u:.77,s:"warn"},{w:"opus",v:"9%",u:.91,s:"bad"}] },
  { n:"Codex",      ms:[{w:"5h",v:"71%",u:.29,s:"good"},{w:"7d",v:"44%",u:.56,s:"good"}] },
  { n:"DeepSeek",   ms:[{w:"bal",v:"¥12.50",u:.75,s:"warn"}] },
  { n:"Kimi Code",  ms:[{w:"5h",v:"940",u:.06,s:"good"},{w:"7d",v:"812",u:.19,s:"good"}] },
  { n:"OpenRouter", ms:[{w:"bal",v:"$3.10",u:.91,s:"bad"}] },
  { n:"硅基流动",    ms:[{w:"bal",v:"¥88.20",u:.12,s:"good"}] },
]
const ord = { bad:3, warn:2, good:1 }
const worst = a => a.ms.reduce((x,m)=>ord[m.s]>ord[x.s]?m:x, a.ms[0])

function metricSegs(p, lay, m, last, indent) {
  return [
    { t: indent ? (last ? " └ " : " ├ ") : "", c: p.rule },
    { t: T.padEnd(m.w, lay.win), c: p.dim },
    { t: " ", c: p.dim },
    { t: T.blockBar(m.u, lay.bar), c: p[m.s] },
    { t: T.padStart(m.v, lay.val + 1), c: p.fg },
  ]
}
function accountLines(p, lay, a, budget) {
  const ms = a.ms.slice(0, budget)
  if (ms.length === 1) {
    return [[{ t: T.padEnd(a.n, lay.name), c: p.fg }, { t: " ", c: p.fg },
             ...metricSegs(p, lay, ms[0], true, false)]]
  }
  const out = [[{ t: T.padEnd(a.n, lay.name), c: p.fg },
                { t: `  ${ms.length} windows`, c: p.faint }]]
  ms.forEach((m,i)=>out.push(metricSegs(p, lay, m, i===ms.length-1, true)))
  return out
}
const esc = s => s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/ /g,"&nbsp;")
const render = segs => segs.map(s=>`<span style="color:${s.c}">${esc(s.t)}</span>`).join("")

function listView(mode, size) {
  const p = P[mode], lay = L[size]
  const lines = []
  let shown = 0
  for (const a of ACC) {
    const block = accountLines(p, lay, a, size === "l" ? 4 : 2)
    if (lines.length + block.length > lay.rows) break
    lines.push(...block); shown++
  }
  return `<div class="pad" style="background:${p.bg}">
    <div class="ln"><span style="color:${p.accent}">$&nbsp;</span><span style="color:${p.dim}">${size==="l"?"ai-quota&nbsp;--tree":"ai-quota"}</span></div>
    ${lines.map(l=>`<div class="ln">${render(l)}</div>`).join("")}
    <div style="flex:1"></div>
    <div class="ln sm"><span style="color:${p.faint}">${shown}/${ACC.length}&nbsp;accounts&nbsp;&nbsp;</span><span style="color:${p.bad}">2</span><span style="color:${p.faint}">&nbsp;alert&nbsp;&nbsp;14:32</span></div>
  </div>`
}
function smallView(mode) {
  const p = P[mode], a = ACC[0], m = worst(a)
  return `<div class="pad" style="background:${p.bg}">
    <div class="ln"><span style="color:${p.accent}">$&nbsp;</span><span style="color:${p.dim}">quota</span></div>
    <div style="flex:1"></div>
    <div class="hero" style="color:${p[m.s]}">${m.v}</div>
    <div class="ln sm" style="color:${p.dim}">${esc(a.n + " " + m.w)}</div>
    <div class="ln"><span style="color:${p[m.s]}">${T.blockBar(m.u,10)}</span></div>
    <div style="flex:1"></div>
    <div class="ln sm" style="color:${p.faint}">3d4h&nbsp;后重置</div>
  </div>`
}
let body = ""
for (const mode of ["light","dark"]) {
  body += `<div class="grp"><div class="lbl">${mode==="light"?"日间":"夜间"}</div><div class="pair">
    <div class="w s">${smallView(mode)}</div>
    <div class="w m">${listView(mode,"m")}</div>
    <div class="w l">${listView(mode,"l")}</div></div></div>`
}
writeFileSync("dev/design/impl.html", `<!doctype html><html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#6b6b76;padding:26px;font-family:-apple-system,sans-serif}
h1{color:#fff;font:600 16px/1;margin-bottom:4px}
.note{color:#fff;opacity:.6;font-size:12.5px;margin-bottom:18px}
.grp{margin-bottom:18px}
.lbl{color:#fff;opacity:.55;font:500 11px/1;margin:0 0 7px 2px}
.pair{display:flex;gap:16px;align-items:flex-start}
.w{border-radius:22px;overflow:hidden}
.s{width:170px;height:170px}.m{width:364px;height:170px}.l{width:364px;height:382px}
.pad{padding:13px 15px;height:100%;display:flex;flex-direction:column;
     font-family:"SF Mono",Menlo,monospace;font-variant-numeric:tabular-nums}
.ln{font-size:11px;line-height:1.64;white-space:pre}
.sm{font-size:10px}
.hero{font-size:30px;line-height:1.05;font-weight:600;font-family:"SF Mono",Menlo,monospace}
</style></head><body>
<h1>AI 额度小组件 v0.7.0 · 终端风（方案 B-2）</h1>
<div class="note">排版由 app/term.ts 生成，列宽与 widget.tsx 的 LAYOUT 一致</div>
${body}</body></html>`)
console.log("已生成 dev/design/impl.html")
