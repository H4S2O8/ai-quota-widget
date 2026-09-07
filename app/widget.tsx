/**
 * 桌面 / 锁屏小组件 —— 终端风（设计方案 B-2「树形连线」）。
 *
 * 排版语言来自命令行：一行提示符、等宽对齐的列、`├ └` 画出的从属关系、
 * 方块进度条、底部一行状态。选它是因为 Claude 这类账户有多个额度窗口
 * （5h / 7d / 7d Opus），而终端本来就有表达层级的惯用法。
 *
 * ## 两条硬约束（都是真机换来的）
 *
 * 1. **`Widget.present` 必须是同步执行链上的最后一步。**
 *    顶层 `await` 会抛 ReferenceError；把 present 包进 async 函数里再 present
 *    则一片漆黑。但**异步本身是可以的**——在 async 函数里 await 完再 present
 *    是可行的（有能跑的样本为证），关键是 present 之后不能再有同层代码。
 * 2. **Button 的内容走 children，不是 `label=` 属性。** 用 label 那一版一片漆黑。
 *
 * ## 深浅色
 *
 * 读一次 `Device.colorScheme`，从两套扁平 hex 里选一套（见 theme.ts）。
 * 不用 `{light, dark}` 动态色，也不用语义色——两者在小组件里都没验证过。
 *
 * ## 对齐
 *
 * 等宽排版的命门是列宽。中文账户名是双宽字符，用 `String.length` 补空格会整体
 * 错位，而错位在等宽里特别刺眼。所有补齐都走 `term.ts` 的 `padEnd/padStart`。
 */
import {
  Button,
  HStack,
  Spacer,
  Text,
  VStack,
  Widget,
} from "scripting"
import { RefreshQuotaIntent } from "./app_intents"
import { isStale, refreshAccounts } from "./refresh"
import {
  applyConfigPatches,
  loadConfig,
  loadSnapshot,
  probeKeychain,
  saveSnapshot,
  writeWidgetDiag,
} from "./store"
import { blockBar, padEnd, padStart } from "./term"
import type { WidgetPalette } from "./theme"
import { statusColor, widgetPalette } from "./theme"
import type { AccountRow, MetricRow } from "./view"
import { buildRows, enabledRows, sortBySeverity, summarize } from "./view"
import { fmtClock, fmtReset } from "./util"

const now = Date.now()
const P = widgetPalette()
const family = String(Widget.family ?? "")
const isAccessory = family.startsWith("accessory")
const isSmall = family === "systemSmall" || family === "small"
const isLarge = family === "systemLarge" || family === "large"

/** 每种尺寸的列宽预算。等宽字体下这些数字直接决定了会不会换行。 */
const LAYOUT = isLarge
  ? { font: 11, name: 11, win: 5, bar: 9, val: 7, rows: 13 }
  : { font: 11, name: 10, win: 4, bar: 7, val: 6, rows: 5 }

// ---------- 一行由若干带色片段拼成 ----------

interface Seg {
  t: string
  c: string
}

/**
 * 一行等宽文本。
 *
 * 用 `styledText` 的分段形式，而不是把几个 `<Text>` 塞进 HStack——
 * HStack 会在片段之间加自己的间距，等宽对齐当场就毁了。
 */
function Line({ segs, size }: { segs: Seg[]; size?: number; key?: string }) {
  return (
    <Text
      styledText={{
        fontDesign: "monospaced",
        font: size ?? LAYOUT.font,
        content: segs.map((s) => ({ content: s.t, foregroundColor: s.c })),
      }}
      lineLimit={1}
    />
  )
}

function prompt(text: string): Seg[] {
  return [
    { t: "$ ", c: P.accent },
    { t: text, c: P.dim },
  ]
}

/** 「├ 5h ███░░░░  58%」这样一行。 */
function metricSegs(m: MetricRow, last: boolean, indent: boolean): Seg[] {
  const color = statusColor(P, m.status)
  return [
    { t: indent ? (last ? " └ " : " ├ ") : "", c: P.rule },
    { t: padEnd(m.metric.label, LAYOUT.win), c: P.dim },
    { t: " ", c: P.dim },
    { t: blockBar(m.used ?? 0, LAYOUT.bar), c: color },
    { t: padStart(m.primary, LAYOUT.val + 1), c: P.fg },
  ]
}

function accountLines(row: AccountRow, budget: number): Seg[][] {
  const out: Seg[][] = []
  if (!row.ok && row.error) {
    out.push([
      { t: padEnd(row.account.label, LAYOUT.name + 2), c: P.fg },
      { t: "failed", c: P.bad },
    ])
    return out
  }
  const metrics = row.metrics.slice(0, budget)
  if (metrics.length === 0) {
    out.push([
      { t: padEnd(row.account.label, LAYOUT.name + 2), c: P.fg },
      { t: "no data", c: P.faint },
    ])
    return out
  }
  // 只有一个指标时不画树线，省一行；多个时账户名单独成行
  if (metrics.length === 1) {
    out.push([
      { t: padEnd(row.account.label, LAYOUT.name), c: P.fg },
      { t: " ", c: P.fg },
      ...metricSegs(metrics[0], true, false),
    ])
    return out
  }
  out.push([
    { t: padEnd(row.account.label, LAYOUT.name), c: P.fg },
    { t: `  ${metrics.length} windows`, c: P.faint },
  ])
  for (let i = 0; i < metrics.length; i++) {
    out.push(metricSegs(metrics[i], i === metrics.length - 1, true))
  }
  return out
}

// ---------- 各尺寸 ----------

interface ViewProps {
  rows: AccountRow[]
  totals: { good: number; warn: number; bad: number; failed: number }
  updatedAt: number
}

function Empty() {
  return (
    <VStack spacing={4} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
      <Line segs={prompt("ai-quota")} />
      <Line segs={[{ t: "no accounts configured", c: P.faint }]} />
      <Line segs={[{ t: "open app to add one", c: P.faint }]} />
    </VStack>
  )
}

/** 小尺寸：只回答「最该操心的那个还剩多少」。 */
function SmallView({ rows }: ViewProps) {
  const row = rows[0]
  if (!row) return <Empty />
  const m = row.primary
  const color = m ? statusColor(P, m.status) : P.neutral
  const failed = !row.ok && !!row.error
  return (
    <VStack
      spacing={3}
      alignment="leading"
      frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" }}
    >
      <Line segs={prompt("quota")} />
      <Spacer />
      <Text
        styledText={{
          fontDesign: "monospaced",
          font: 30,
          fontWeight: "semibold",
          content: [{ content: failed ? "fail" : (m?.primary ?? "—"), foregroundColor: color }],
        }}
        lineLimit={1}
      />
      <Line
        segs={[{ t: `${row.account.label}${m ? " " + m.metric.label : ""}`, c: P.dim }]}
        size={10}
      />
      {m?.used !== undefined ? (
        <Line segs={[{ t: blockBar(m.used, 10), c: color }]} />
      ) : null}
      <Spacer />
      <Line
        segs={[
          {
            t: m?.metric.resetAt ? fmtReset(m.metric.resetAt, now) : `updated ${fmtClock(now)}`,
            c: P.faint,
          },
        ]}
        size={10}
      />
    </VStack>
  )
}

/** 中 / 大尺寸：树形清单。 */
function ListView({ rows, totals, updatedAt }: ViewProps) {
  if (rows.length === 0) return <Empty />

  // 按行预算铺，铺不下就停——不做省略号，终端输出本来就是截断的
  const lines: Seg[][] = []
  let shown = 0
  for (const row of rows) {
    const budget = Math.max(0, LAYOUT.rows - lines.length - 1)
    if (budget <= 0) break
    const block = accountLines(row, isLarge ? 4 : 2)
    if (lines.length + block.length > LAYOUT.rows) break
    lines.push(...block)
    shown++
  }

  const alarming = totals.bad + totals.failed
  return (
    <VStack
      spacing={1}
      alignment="leading"
      frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" }}
    >
      <Line segs={prompt(isLarge ? "ai-quota --tree" : "ai-quota")} />
      {lines.map((segs, i) => (
        <Line key={String(i)} segs={segs} />
      ))}
      <Spacer />
      <HStack spacing={0}>
        <Line
          segs={[
            { t: `${shown}/${rows.length} accounts`, c: P.faint },
            { t: "  ", c: P.faint },
            ...(alarming > 0
              ? ([
                  { t: String(alarming), c: P.bad },
                  { t: " alert  ", c: P.faint },
                ] as Seg[])
              : []),
            { t: fmtClock(updatedAt || now), c: P.faint },
          ]}
          size={10}
        />
        <Spacer />
      </HStack>
    </VStack>
  )
}

/** 锁屏：一行文字，背景交给系统。 */
function AccessoryView({ rows }: ViewProps) {
  const row = rows[0]
  if (!row) {
    return (
      <VStack alignment="leading">
        <Text font="caption2">ai-quota</Text>
        <Text font="caption">no accounts</Text>
      </VStack>
    )
  }
  const m = row.primary
  return (
    <VStack spacing={1} alignment="leading">
      <Text font="caption2" widgetAccentable lineLimit={1}>
        {row.account.label}
        {m ? ` ${m.metric.label}` : ""}
      </Text>
      <Text font="headline" lineLimit={1}>
        {!row.ok && row.error ? "fail" : (m?.primary ?? "—")}
      </Text>
      <Text font="caption2" lineLimit={1}>
        {m?.metric.resetAt ? fmtReset(m.metric.resetAt, now) : row.providerName}
      </Text>
    </VStack>
  )
}

function Body(props: ViewProps) {
  if (isAccessory) return <AccessoryView {...props} />
  return (
    <VStack
      padding={{ leading: 15, trailing: 15, top: 13, bottom: 13 }}
      frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" }}
      backgroundColor={P.bg}
    >
      {isSmall ? <SmallView {...props} /> : <ListView {...props} />}
    </VStack>
  )
}

/** 出了任何岔子都要显示点什么，不能留一块黑的。 */
function Failed({ message }: { message: string }) {
  return (
    <VStack
      spacing={3}
      padding={13}
      alignment="leading"
      frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" }}
      backgroundColor={P.bg}
    >
      <Line segs={prompt("ai-quota")} />
      <Text
        styledText={{
          fontDesign: "monospaced",
          font: 10,
          content: [{ content: message, foregroundColor: P.bad }],
        }}
        lineLimit={6}
      />
    </VStack>
  )
}

async function run() {
  let props: ViewProps = { rows: [], totals: { good: 0, warn: 0, bad: 0, failed: 0 }, updatedAt: 0 }
  let refreshMinutes = 15
  let tapToRefresh = true
  let failure: string | null = null

  try {
    const config = await loadConfig()
    let snapshot = await loadSnapshot()
    refreshMinutes = config.settings.refreshMinutes
    tapToRefresh = config.settings.widgetTap !== "open"

    let selfRefreshed = false
    if (
      config.settings.widgetSelfRefresh &&
      config.accounts.some((a) => a.enabled) &&
      isStale(snapshot, refreshMinutes, now)
    ) {
      try {
        const outcome = await refreshAccounts(config, snapshot)
        snapshot = outcome.snapshot
        await saveSnapshot(snapshot)
        // 换到的新凭据一定要存，否则下次渲染会重放旧的 refresh token
        await applyConfigPatches(outcome.configPatches)
        selfRefreshed = true
      } catch {
        // 抓不到就显示旧数据，比空着强
      }
    }

    const all = buildRows(config, snapshot, now)
    props = {
      rows: sortBySeverity(enabledRows(all)),
      totals: summarize(all),
      updatedAt: snapshot.updatedAt,
    }

    // 诊断必须写在 present 之前 —— present 之后当前执行上下文立刻销毁
    await writeWidgetDiag({
      renderedAt: now,
      family,
      accountsSeen: props.rows.length,
      selfRefreshed,
      keychainReadable: probeKeychain(),
    })
  } catch (error) {
    failure = String(error)
  }

  // present 只在末尾调一次，所有分支在它之前收敛完。
  // Button 的内容走 children，不是 label 属性 —— 后者实测一片漆黑。
  const presented =
    failure !== null ? (
      <Failed message={failure} />
    ) : tapToRefresh ? (
      <Button intent={RefreshQuotaIntent(undefined)} buttonStyle="plain">
        <Body {...props} />
      </Button>
    ) : (
      <Body {...props} />
    )

  Widget.present(presented, {
    policy: "after",
    date: new Date(now + refreshMinutes * 60000),
  })
}

run()
