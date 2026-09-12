/**
 * 桌面 / 锁屏小组件 —— 终端风。
 *
 * 排版语言来自命令行：一行提示符、等宽对齐的列、`├ └` 画出的从属关系、
 * 方块进度条、底部一行状态。三种尺寸各回答一个问题（见 layout.ts 顶部的表）。
 *
 * **这个文件只管把行喂给 `<Text>`。** 哪一行写什么、列宽多少、放几行，全在
 * layout.ts——它不 import "scripting"，效果图和测试跑的是同一份代码。
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
 * ## 为什么用 styledText 而不是几个 Text 拼
 *
 * 一行里要给「窗口名 / 进度条 / 数值」分别上色。用 HStack 拼多个 `<Text>` 的话，
 * HStack 会在片段之间加自己的间距，等宽对齐当场就毁了。`styledText` 的分段形式
 * 把整行当作**一个** Text 渲染，间距完全由字符本身决定。
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
import type { Line as Segs } from "./layout"
import {
  FONT,
  ROWS,
  footerLine,
  promptLine,
  smallModel,
  tableLines,
  treeLines,
} from "./layout"
import { isStale, refreshAccounts } from "./refresh"
import {
  applyConfigPatches,
  loadConfig,
  loadSnapshot,
  probeKeychain,
  saveSnapshot,
  writeWidgetDiag,
} from "./store"
import { widgetPalette } from "./theme"
import type { AccountRow } from "./view"
import { buildRows, enabledRows, sortBySeverity, summarize } from "./view"
import { fmtReset } from "./util"

const now = Date.now()
const P = widgetPalette()
const family = String(Widget.family ?? "")
const isAccessory = family.startsWith("accessory")
const isSmall = family === "systemSmall" || family === "small"
const isLarge = family === "systemLarge" || family === "large"

/** 一行等宽文本，由若干带色片段拼成。 */
function Line({ segs, size }: { segs: Segs; size?: number; key?: string }) {
  return (
    <Text
      styledText={{
        fontDesign: "monospaced",
        font: size ?? FONT,
        content: segs.map((s) => ({ content: s.t, foregroundColor: s.c })),
      }}
      lineLimit={1}
    />
  )
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
      <Line segs={promptLine(P, "ai-quota")} />
      <Line segs={[{ t: "no accounts configured", c: P.faint }]} />
      <Line segs={[{ t: "open app to add one", c: P.faint }]} />
    </VStack>
  )
}

/** 小尺寸：大字是最紧张的窗口，下面列同账户其余窗口。 */
function SmallView({ rows, updatedAt }: ViewProps) {
  const model = smallModel(rows, P, now, updatedAt)
  if (!model) return <Empty />
  return (
    <VStack
      spacing={2}
      alignment="leading"
      frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" }}
    >
      <Line segs={promptLine(P, "quota")} />
      <Text
        styledText={{
          fontDesign: "monospaced",
          font: 28,
          fontWeight: "semibold",
          content: [{ content: model.hero.text, foregroundColor: model.hero.color }],
        }}
        lineLimit={1}
      />
      <Line segs={model.label} size={10} />
      {model.items.map((segs, i) => (
        <Line key={String(i)} segs={segs} />
      ))}
      <Spacer />
      <Line segs={model.footer} size={10} />
    </VStack>
  )
}

/** 中尺寸是表格（一行一账户），大尺寸是树（一行一窗口）。 */
function ListView({ rows, totals, updatedAt }: ViewProps) {
  if (rows.length === 0) return <Empty />
  const { lines, shown } = isLarge
    ? treeLines(rows, P, ROWS.large)
    : tableLines(rows, P, ROWS.medium)
  return (
    <VStack
      spacing={1}
      alignment="leading"
      frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" }}
    >
      <Line segs={promptLine(P, isLarge ? "ai-quota --tree" : "ai-quota")} />
      {lines.map((segs, i) => (
        <Line key={String(i)} segs={segs} />
      ))}
      <Spacer />
      <HStack spacing={0}>
        <Line
          segs={footerLine(P, shown, rows.length, totals.bad + totals.failed, updatedAt || now)}
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
  const m = row.worst
  return (
    <VStack spacing={1} alignment="leading">
      <Text font="caption2" widgetAccentable lineLimit={1}>
        {row.account.label}
        {m ? ` ${m.short}` : ""}
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
      <Line segs={promptLine(P, "ai-quota")} />
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
