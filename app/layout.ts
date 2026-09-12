/**
 * 小组件的排版：把 AccountRow 变成带色的等宽文本行。
 *
 * **不 import "scripting"，所以 node 能跑。** 效果图（dev/design/preview.mjs）和
 * 纯逻辑测试（dev/test_logic.mjs）调的就是这份代码——效果图和交付物如果不是同一套
 * 代码算出来的，它就只是一张画。widget.tsx 只负责把这里吐出的行喂给 `<Text>`。
 *
 * ## 三种尺寸各回答一个问题
 *
 * | 尺寸 | 问题 | 排法 |
 * | --- | --- | --- |
 * | 小 | 最该操心的那个还剩多少 | 大字 = 最紧张的窗口；下面列同账户其余窗口 |
 * | 中 | 每个账户还剩多少 | 一行一账户，窗口横排；放不下的换行续接 |
 * | 大 | 每个窗口分别还剩多少 | 树形：账户名一行，窗口各占一行带进度条 |
 *
 * 第一版的中尺寸也用树形，Claude 一家就吃掉 3 行，6 个账户只显示 2 个；
 * 更糟的是每账户只取前 2 个指标，把最红的 Opus 窗口截掉了，底下却写着 `2 alert`。
 * 小尺寸的大字取的是第一个指标而不是最紧张的，账户因 Opus 9% 排到第一，大字却是 58%。
 * 这两个就是「小和中的逻辑很奇怪」。
 *
 * ## 列宽预算
 *
 * SF Mono 的字符步进是 0.618 em——从 /System/Library/Fonts/SFNSMono.ttf 的 hmtx
 * 表读出来的，不是估的。11pt 就是 6.8pt。第一版按 6.6pt 估，算出中尺寸放得下 50 列，
 * 实际 334 / 6.8 = 49.1，按 50 排的行会被 SwiftUI 截成「…」。
 *
 *   小   170 - 2×15 = 140pt → 20 列
 *   中   364 - 2×15 = 334pt → 49 列，预算 48
 *   大   同中
 *
 * 行数按行高 15–16pt 保守估：中尺寸内容区 144pt，提示符 + 6 行 + 状态行 = 8 行；
 * 大尺寸 356pt 给 17 行内容。
 */
import { blockBar, clip, displayWidth, padEnd, padStart } from "./term"
import type { WidgetPalette } from "./theme"
import { statusColor } from "./theme"
import { fmtClock, fmtCountdown } from "./util"
import type { AccountRow, MetricRow } from "./view"

export interface Seg {
  t: string
  c: string
}
export type Line = Seg[]

export const FONT = 11
export const COLS = { small: 20, medium: 48, large: 48 }
export const ROWS = { small: 3, medium: 6, large: 17 }

/** 一行的显示宽度，测试和效果图用来对预算。 */
export function lineWidth(line: Line): number {
  return displayWidth(line.map((s) => s.t).join(""))
}

export function promptLine(P: WidgetPalette, text: string): Line {
  return [
    { t: "$ ", c: P.accent },
    { t: text, c: P.dim },
  ]
}

// ---------- 小尺寸 ----------

export interface SmallModel {
  hero: { text: string; color: string }
  /** 大字下面那行：「Claude 订阅 · opus」 */
  label: Line
  /** 最多 ROWS.small 行：同账户的其余窗口；不够就用其他账户的最紧张值补 */
  items: Line[]
  footer: Line
}

// name(4) + sp + bar(8) + val(7) = 20
const SMALL = { win: 4, bar: 8, val: 7, name: 13 }

/**
 * 小尺寸只回答一个问题：最该操心的那个还剩多少。
 *
 * 账户已按紧张程度排过，rows[0] 排第一是因为它的某个窗口最紧张，
 * 大字就必须是**那个窗口**（row.worst），不能是 provider 排在前面的第一个。
 */
export function smallModel(
  rows: AccountRow[],
  P: WidgetPalette,
  now: number,
  updatedAt: number,
): SmallModel | undefined {
  const top = rows[0]
  if (!top) return undefined
  const failed = !top.ok && !!top.error
  const hero = top.worst

  const items: Line[] = []
  // 同账户的其余窗口：和大字同一把尺，所以带进度条
  for (const m of top.metrics) {
    if (m === hero && !failed) continue
    if (items.length >= ROWS.small) break
    items.push(siblingLine(m, P))
  }
  // 不够就拿其他账户的最紧张值补齐，让小尺寸也能扫到第二、第三个账户
  for (let i = 1; i < rows.length && items.length < ROWS.small; i++) {
    items.push(otherAccountLine(rows[i], P))
  }

  const labelText = failed
    ? `${top.account.label} · ${top.error}`
    : `${top.account.label}${hero ? ` · ${hero.short}` : ""}`

  return {
    hero: {
      text: failed ? "fail" : (hero?.primary ?? "—"),
      color: failed ? P.bad : hero ? statusColor(P, hero.status) : P.neutral,
    },
    label: [{ t: clip(labelText, COLS.small), c: P.dim }],
    items,
    footer: [
      {
        t:
          hero?.metric.resetAt !== undefined && !failed
            ? `reset ${fmtCountdown(hero.metric.resetAt - now)}`
            : `upd ${fmtClock(updatedAt || now)}`,
        c: P.faint,
      },
    ],
  }
}

/** 「7d   ████████░░  23%」 */
function siblingLine(m: MetricRow, P: WidgetPalette): Line {
  const color = statusColor(P, m.status)
  return [
    { t: padEnd(m.short, SMALL.win), c: P.dim },
    { t: " ", c: P.dim },
    // 没有上限的余额画不出比例，留空比画一条全空的条诚实——全空看着像「一点没用」
    { t: m.used !== undefined ? blockBar(m.used, SMALL.bar) : " ".repeat(SMALL.bar), c: color },
    { t: padStart(m.primary, SMALL.val), c: P.fg },
  ]
}

/** 「Codex            71%」——别的账户只给一个数，不带条：尺子不同不能并排画 */
function otherAccountLine(row: AccountRow, P: WidgetPalette): Line {
  const failed = !row.ok && !!row.error
  const m = row.worst
  return [
    { t: padEnd(row.account.label, SMALL.name), c: P.dim },
    {
      t: padStart(failed ? "fail" : (m?.primary ?? "—"), SMALL.val),
      c: failed ? P.bad : m ? statusColor(P, m.status) : P.faint,
    },
  ]
}

// ---------- 中尺寸：表格 ----------

// name(12) + sp + 3 × (win 4 + sp + val 5) + 2 × gap(2) = 47 ≤ 48
const TABLE = { name: 12, win: 4, val: 5, cells: 3, gap: "  " }

/**
 * 一行一账户，窗口横排：「Claude 订阅  5h    58%  7d    23%  opus   9%」。
 *
 * 一行放 3 个窗口，更多的换行续接（Claude 最多 5 个窗口），不截、不挑——
 * 中尺寸回答的是「每个账户还剩多少」，漏掉一个窗口就等于答错。
 * 进度条在这里放不下，状态交给颜色；要看条去大尺寸。
 */
export function tableLines(
  rows: AccountRow[],
  P: WidgetPalette,
  rowBudget: number,
): { lines: Line[]; shown: number } {
  const lines: Line[] = []
  let shown = 0
  for (const row of rows) {
    const block = tableBlock(row, P)
    // 铺不下就停——终端输出本来就是截断的，状态行会写「4/6 accounts」
    if (lines.length + block.length > rowBudget) break
    lines.push(...block)
    shown++
  }
  return { lines, shown }
}

function tableBlock(row: AccountRow, P: WidgetPalette): Line[] {
  const head: Seg = { t: padEnd(row.account.label, TABLE.name) + " ", c: P.fg }
  if (!row.ok && row.error) {
    const room = COLS.medium - TABLE.name - 1 - "failed ".length
    return [[head, { t: "failed ", c: P.bad }, { t: clip(row.error, room), c: P.faint }]]
  }
  if (row.metrics.length === 0) {
    return [[head, { t: "no data", c: P.faint }]]
  }
  const out: Line[] = []
  for (let i = 0; i < row.metrics.length; i += TABLE.cells) {
    const chunk = row.metrics.slice(i, i + TABLE.cells)
    const line: Line = [
      i === 0 ? head : { t: " ".repeat(TABLE.name - 2) + "└  ", c: P.rule },
    ]
    chunk.forEach((m, j) => {
      if (j > 0) line.push({ t: TABLE.gap, c: P.fg })
      line.push(
        { t: padEnd(m.short, TABLE.win), c: P.dim },
        { t: " ", c: P.dim },
        { t: padStart(m.primary, TABLE.val), c: statusColor(P, m.status) },
      )
    })
    out.push(line)
  }
  return out
}

// ---------- 大尺寸：树形 ----------

// name(13) + sp + win(5) + sp + bar(12) + val(9) = 41
const TREE = { name: 13, win: 5, bar: 12, val: 9, perAccount: 5 }

/** 「 ├ 5h    ███░░░░░░░░░   58%」 */
function metricSegs(m: MetricRow, P: WidgetPalette, last: boolean, indent: boolean): Line {
  const color = statusColor(P, m.status)
  return [
    { t: indent ? (last ? " └ " : " ├ ") : "", c: P.rule },
    { t: padEnd(m.short, TREE.win), c: P.dim },
    { t: " ", c: P.dim },
    { t: blockBar(m.used ?? 0, TREE.bar), c: color },
    { t: padStart(m.primary, TREE.val), c: P.fg },
  ]
}

function treeBlock(row: AccountRow, P: WidgetPalette): Line[] {
  const name = padEnd(row.account.label, TREE.name)
  if (!row.ok && row.error) {
    return [[{ t: name + "  ", c: P.fg }, { t: "failed", c: P.bad }]]
  }
  if (row.metrics.length === 0) {
    return [[{ t: name + "  ", c: P.fg }, { t: "no data", c: P.faint }]]
  }
  // 只有一个指标时不画树线，省一行；多个时账户名单独成行
  if (row.metrics.length === 1) {
    return [[{ t: name + " ", c: P.fg }, ...metricSegs(row.metrics[0], P, true, false)]]
  }
  const metrics = row.metrics.slice(0, TREE.perAccount)
  // 截了就说截了：「4/5 windows」，不能显示 4 行却写 5 windows
  const count =
    metrics.length === row.metrics.length
      ? `${metrics.length} windows`
      : `${metrics.length}/${row.metrics.length} windows`
  const out: Line[] = [[{ t: name, c: P.fg }, { t: `  ${count}`, c: P.faint }]]
  metrics.forEach((m, i) => out.push(metricSegs(m, P, i === metrics.length - 1, true)))
  return out
}

export function treeLines(
  rows: AccountRow[],
  P: WidgetPalette,
  rowBudget: number,
): { lines: Line[]; shown: number } {
  const lines: Line[] = []
  let shown = 0
  for (const row of rows) {
    const block = treeBlock(row, P)
    if (lines.length + block.length > rowBudget) break
    lines.push(...block)
    shown++
  }
  return { lines, shown }
}

// ---------- 状态行 ----------

/** 「4/6 accounts  2 alert  14:32」 */
export function footerLine(
  P: WidgetPalette,
  shown: number,
  total: number,
  alarming: number,
  clock: number,
): Line {
  const line: Line = [{ t: `${shown}/${total} accounts  `, c: P.faint }]
  if (alarming > 0) {
    line.push({ t: String(alarming), c: P.bad }, { t: " alert  ", c: P.faint })
  }
  line.push({ t: fmtClock(clock), c: P.faint })
  return line
}
