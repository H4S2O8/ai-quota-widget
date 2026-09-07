/**
 * 桌面 / 锁屏小组件。
 *
 * ## 这个文件是照着一份「已知能跑」的样本重建的
 *
 * 之前连着三版一片漆黑，我在没有报错的情况下反复猜，每次都猜错。转机是拿到了
 * 另一个能正常渲染的 Scripting 小组件源码，逐条比对出差异。**它推翻了我三个结论：**
 *
 *   - 异步是可以的：它在 `async run()` 里 `await` 完网络请求才 present。
 *     所以小组件能自己联网，「异步导致漆黑」是我的错误归因。
 *   - 整块包 Button 是可以的：`<Button intent={...}>{内容}</Button>`。
 *     注意是 **children**，不是我之前用的 `label={...}` 属性。
 *   - 小组件能做网络请求（它跑的是 SSH 采集）。
 *
 * 剩下的差异就是嫌疑人，这里全部对齐到它那一侧：
 *
 * | 维度 | 样本（能跑） | 我之前（漆黑） |
 * | --- | --- | --- |
 * | Button 子节点 | children | `label={...}` 属性 |
 * | 背景 | `backgroundColor={hex}` | `widgetBackground={{style, shape}}` |
 * | 颜色 | 扁平 hex | `{light, dark}` 动态色 |
 * | 语义色 | 不用 | `"secondaryLabel"` 等 14 处 |
 *
 * 所以这里：扁平 hex、自己画背景、Button 用 children。代价是小组件不跟随系统
 * 深浅色，固定是一张深色卡片——背景由我们自己画，前景对比度就完全可控。
 *
 * 改这个文件之前请先看这段。在一个不给报错的平台上，**照抄一个已知能跑的形状**
 * 比读文档更可靠：文档说得对不对，只有真机知道。
 */
import {
  Button,
  HStack,
  Image,
  RoundedRectangle,
  Spacer,
  Text,
  VStack,
  Widget,
  ZStack,
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
import { W, W_STATUS } from "./theme"
import type { AccountRow } from "./view"
import { buildRows, enabledRows, sortBySeverity, summarize } from "./view"
import { fmtAgo, fmtReset } from "./util"

const now = Date.now()
const family = String(Widget.family ?? "")
const isAccessory = family.startsWith("accessory")
const isSmall = family === "systemSmall" || family === "small"
const isLarge = family === "systemLarge" || family === "large"
const contentWidth = Math.max(80, (Widget.displaySize?.width ?? 160) - 28)

// ---------- 组件 ----------

/** 进度条。宽度由调用方算好传进来——小组件里没有布局回调，靠 displaySize 推。 */
function Bar({ used, color, width }: { used: number; color: string; width: number }) {
  const filled = Math.max(3, Math.min(width, width * used))
  return (
    <ZStack alignment="leading">
      <RoundedRectangle cornerRadius={3} fill={W.track} frame={{ width, height: 6 }} />
      <RoundedRectangle cornerRadius={3} fill={color} frame={{ width: filled, height: 6 }} />
    </ZStack>
  )
}

function colorOf(row: AccountRow): string {
  if (!row.ok && row.error) return W.bad
  return W_STATUS[row.primary?.status ?? "neutral"]
}

function primaryText(row: AccountRow): string {
  if (!row.ok && row.error) return "失败"
  return row.primary?.primary ?? "—"
}

function Row({ row, barWidth }: { row: AccountRow; barWidth: number; key?: string }) {
  const color = colorOf(row)
  return (
    <VStack spacing={3} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>
      <HStack spacing={5}>
        <Image systemName={row.icon} font={11} foregroundStyle={color} />
        <Text font={12} lineLimit={1} foregroundStyle={W.fg}>
          {row.account.label}
        </Text>
        <Spacer />
        <Text font={12} fontWeight="semibold" foregroundStyle={color}>
          {primaryText(row)}
        </Text>
      </HStack>
      {row.primary?.used !== undefined ? (
        <Bar used={row.primary.used} color={color} width={barWidth} />
      ) : (
        <Text font={9} foregroundStyle={W.faint} lineLimit={1}>
          {!row.ok && row.error ? row.error : (row.primary?.detail || row.providerName)}
        </Text>
      )}
    </VStack>
  )
}

function Header({ totals, updatedAt }: { totals: Totals; updatedAt: number }) {
  const alarming = totals.bad + totals.failed
  return (
    <HStack spacing={4}>
      <Image systemName="gauge.with.dots.needle.33percent" font={10} foregroundStyle={W.dim} />
      <Text font={10} foregroundStyle={W.dim}>
        AI 额度
      </Text>
      <Spacer />
      <Text font={10} foregroundStyle={alarming > 0 ? W.bad : W.faint}>
        {alarming > 0 ? `${alarming} 项告警` : fmtAgo(updatedAt, now)}
      </Text>
    </HStack>
  )
}

function Empty() {
  return (
    <VStack spacing={4} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
      <Image systemName="plus.circle" font={20} foregroundStyle={W.dim} />
      <Text font={11} foregroundStyle={W.dim} multilineTextAlignment="center">
        打开 App 添加账户
      </Text>
    </VStack>
  )
}

interface Totals {
  good: number
  warn: number
  bad: number
  failed: number
}

function SmallView({ rows, totals, updatedAt }: ViewProps) {
  const row = rows[0]
  if (!row) return <Empty />
  const color = colorOf(row)
  const metric = row.primary?.metric
  return (
    <VStack
      spacing={5}
      alignment="leading"
      frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" }}
    >
      <HStack spacing={4}>
        <Image systemName={row.icon} font={11} foregroundStyle={color} />
        <Text font={11} foregroundStyle={W.dim} lineLimit={1}>
          {row.account.label}
        </Text>
        <Spacer />
      </HStack>
      <Spacer />
      <Text font={28} fontWeight="bold" lineLimit={1} foregroundStyle={color}>
        {primaryText(row)}
      </Text>
      <Text font={10} foregroundStyle={W.dim} lineLimit={1}>
        {!row.ok && row.error ? row.error : (metric?.label ?? row.providerName)}
      </Text>
      {row.primary?.used !== undefined ? (
        <Bar used={row.primary.used} color={color} width={contentWidth} />
      ) : null}
      <Spacer />
      <Text font={9} foregroundStyle={W.faint} lineLimit={1}>
        {metric?.resetAt
          ? fmtReset(metric.resetAt, now)
          : `${rows.length} 个账户 · ${fmtAgo(updatedAt, now)}`}
      </Text>
    </VStack>
  )
}

function MediumView({ rows, totals, updatedAt }: ViewProps) {
  if (rows.length === 0) return <Empty />
  return (
    <VStack
      spacing={7}
      alignment="leading"
      frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" }}
    >
      <Header totals={totals} updatedAt={updatedAt} />
      {rows.slice(0, 4).map((row) => (
        <Row key={row.account.id} row={row} barWidth={contentWidth} />
      ))}
      <Spacer />
    </VStack>
  )
}

function LargeView({ rows, totals, updatedAt }: ViewProps) {
  if (rows.length === 0) return <Empty />
  return (
    <VStack
      spacing={9}
      alignment="leading"
      frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" }}
    >
      <Header totals={totals} updatedAt={updatedAt} />
      {rows.slice(0, 7).map((row) => (
        <VStack
          key={row.account.id}
          spacing={3}
          alignment="leading"
          frame={{ maxWidth: "infinity", alignment: "leading" }}
        >
          <Row row={row} barWidth={contentWidth} />
          {row.metrics.slice(1, 3).map((sub) => (
            <HStack key={sub.metric.id} spacing={5}>
              <Text font={10} foregroundStyle={W.faint} lineLimit={1}>
                {sub.metric.label}
              </Text>
              <Spacer />
              <Text font={10} foregroundStyle={W_STATUS[sub.status]}>
                {sub.primary}
              </Text>
            </HStack>
          ))}
        </VStack>
      ))}
      <Spacer />
    </VStack>
  )
}

/** 锁屏。这里不能自己画背景，交给系统。 */
function AccessoryView({ rows }: ViewProps) {
  const row = rows[0]
  if (!row) {
    return (
      <VStack alignment="leading">
        <Text font="caption">AI 额度</Text>
        <Text font="caption2">未配置账户</Text>
      </VStack>
    )
  }
  const metric = row.primary?.metric
  return (
    <VStack spacing={1} alignment="leading">
      <Text font="caption2" widgetAccentable lineLimit={1}>
        {row.account.label}
      </Text>
      <Text font="headline" lineLimit={1}>
        {primaryText(row)}
      </Text>
      <Text font="caption2" lineLimit={1}>
        {metric?.resetAt ? fmtReset(metric.resetAt, now) : row.providerName}
      </Text>
    </VStack>
  )
}

interface ViewProps {
  rows: AccountRow[]
  totals: Totals
  updatedAt: number
}

function Content(props: ViewProps) {
  if (isAccessory) return <AccessoryView {...props} />
  if (isSmall) return <SmallView {...props} />
  if (isLarge) return <LargeView {...props} />
  return <MediumView {...props} />
}

/** 桌面尺寸自己画底；锁屏交给系统。背景用扁平色 + backgroundColor，见文件顶部。 */
function Body(props: ViewProps) {
  if (isAccessory) return <Content {...props} />
  return (
    <VStack
      padding={14}
      frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" }}
      backgroundColor={W.bg}
    >
      <Content {...props} />
    </VStack>
  )
}

/** 出了任何岔子都要显示点什么，不能留一块黑的。 */
function Failed({ message }: { message: string }) {
  return (
    <VStack
      spacing={4}
      padding={12}
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      backgroundColor={W.bg}
    >
      <Image systemName="exclamationmark.triangle.fill" font={16} foregroundStyle={W.bad} />
      <Text font={10} foregroundStyle={W.dim} multilineTextAlignment="center" lineLimit={4}>
        {message}
      </Text>
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

    // 小组件能联网（样本证明了这一点），所以自刷新回来了。
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
        // **换到的新凭据一定要存。** 以前这里只存快照，于是 OAuth 的 access token
        // 每次渲染都重换一遍、换完就丢，很快把 token 端点打成 429。
        // applyConfigPatches 是读盘改字段再写回，不会覆盖主 App 那边的改动。
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

    // 诊断必须写在 present 之前 —— present 之后当前执行上下文立刻销毁。
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

  // present 之后当前上下文立刻销毁，所以整个函数只在末尾调一次，
  // 所有分支在它之前收敛完 —— 不写成「present 完再 return」，那个 return 是死代码。
  //
  // 整块小组件就是刷新按钮。**Button 的内容走 children，不是 label 属性**：
  // 用 label 那一版实测一片漆黑，这里是照着能跑的样本改的。
  const presented =
    failure !== null ? (
      <Failed message={`小组件出错：${failure}`} />
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
