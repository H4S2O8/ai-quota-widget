/**
 * 桌面 / 锁屏小组件。
 *
 * ## 这个文件全程同步，一个 await 都没有
 *
 * 两次真机事故换来的形状：
 *
 * 1. 顶层 `await` -> `ReferenceError: Can't find variable: await`。
 *    小组件脚本按普通脚本求值，不是 ES 模块。
 * 2. 把异步动作包进 `async main()` 之后 -> **小组件一片漆黑**。
 *    异步做完再 `Widget.present`，时机上已经太晚。
 *
 * 所以现在：同步读文件（`FileManager.readAsStringSync`），立刻 present。
 * **不要再往这个文件里加 `await`**，`dev/check.py` 会拦。
 *
 * 代价是小组件不能自己联网抓数据了——网络请求没有同步版本。刷新改由
 * 点击小组件（AppIntent）和主 App 承担，这也是用户要的交互。
 *
 * ## 出错要看得见
 *
 * 整个流程包在 try/catch 里，任何异常都会 present 一个带错误文本的视图。
 * 在一个静默失败的平台上，「一片漆黑」是最贵的症状——它不告诉你任何事。
 * 宁可显示一行难看的报错。
 */
import {
  Button,
  HStack,
  Image,
  Script,
  Spacer,
  Text,
  VStack,
  Widget,
  ZStack,
  Gauge,
  RoundedRectangle,
  AccessoryWidgetBackground,
} from "scripting"
import { RefreshQuotaIntent } from "./app_intents"
import { loadConfigSync, loadSnapshotSync, probeKeychain, writeWidgetDiagSync } from "./store"
import { STATUS_COLOR, TRACK_COLOR } from "./theme"
import type { AccountRow } from "./view"
import { buildRows, enabledRows, sortBySeverity, summarize } from "./view"
import { fmtAgo, fmtReset } from "./util"

const now = Date.now()

// Widget.family 的取值在文档里有两种写法（Quick Start 写 'small'，Widget API 写
// 'systemSmall'）。两种都认，免得在某个版本上整块判空。
const rawFamily = String(Widget.family ?? "")
const family = rawFamily.replace(/^system/, "").toLowerCase()
const isAccessory = family.startsWith("accessory")
const contentWidth = Math.max(80, (Widget.displaySize?.width ?? 160) - 28)

let rows: AccountRow[] = []
let totals = { good: 0, warn: 0, bad: 0, failed: 0 }
let updatedAt = 0
let refreshMinutes = 15

// ---------- 组件 ----------

/** 进度条。宽度由调用方算好传进来——小组件里没有布局回调，靠 displaySize 推。 */
function Bar({
  used,
  color,
  width,
}: {
  used: number
  color: { light: string; dark: string }
  width: number
}) {
  const filled = Math.max(3, Math.min(width, width * used))
  return (
    <ZStack alignment="leading">
      <RoundedRectangle
        cornerRadius={3}
        fill={TRACK_COLOR}
        frame={{ width, height: 6 }}
      />
      <RoundedRectangle
        cornerRadius={3}
        fill={color}
        frame={{ width: filled, height: 6 }}
      />
    </ZStack>
  )
}

function statusColor(row: AccountRow): { light: string; dark: string } {
  if (!row.ok && row.error) return STATUS_COLOR.bad
  return STATUS_COLOR[row.primary?.status ?? "neutral"]
}

/** 一行：图标 + 名字 + 数值，下面一条比例条。给中/大尺寸用。 */
function Row({ row, barWidth, dense }: { row: AccountRow; barWidth: number; dense: boolean }) {
  const color = statusColor(row)
  const metric = row.primary?.metric
  const value = !row.ok && row.error ? "失败" : (row.primary?.primary ?? "—")

  return (
    <VStack spacing={3} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>
      <HStack spacing={5}>
        <Image systemName={row.icon} font={11} foregroundStyle={color} />
        <Text font={12} lineLimit={1} foregroundStyle="label">
          {row.account.label}
        </Text>
        <Spacer />
        <Text font={12} fontWeight="semibold" monospacedDigit foregroundStyle={color}>
          {value}
        </Text>
      </HStack>
      {row.primary?.used !== undefined ? (
        <Bar used={row.primary.used} color={color} width={barWidth} />
      ) : (
        <Text font={9} foregroundStyle="tertiaryLabel" lineLimit={1}>
          {!row.ok && row.error ? row.error : dense ? row.providerName : (metric?.label ?? "")}
        </Text>
      )}
    </VStack>
  )
}

function Header({ trailing }: { trailing?: boolean }) {
  return (
    <HStack spacing={4}>
      <Image systemName="gauge.with.dots.needle.33percent" font={10} foregroundStyle="secondaryLabel" />
      <Text font={10} foregroundStyle="secondaryLabel">
        AI 额度
      </Text>
      <Spacer />
      {totals.bad + totals.failed > 0 ? (
        <Text font={10} foregroundStyle={STATUS_COLOR.bad}>
          {totals.bad + totals.failed} 项告警
        </Text>
      ) : (
        <Text font={10} foregroundStyle="tertiaryLabel">
          {fmtAgo(updatedAt, now)}
        </Text>
      )}
      {trailing ? <RefreshButton /> : null}
    </HStack>
  )
}

/**
 * 刷新按钮。用的是文档里小组件 Button 的原样写法（title + systemImage + intent），
 * 没有自创组合。
 *
 * 之前试过把整块小组件包进 `<Button label={...}>` 让哪儿都能点——那一版真机上
 * 一片漆黑。原因是异步还是 Button 分不清，所以这一版先回到确定能渲染的形状：
 * 一个看得见的按钮。等这版确认能显示，再考虑要不要整块可点。
 */
function RefreshButton() {
  return (
    <Button
      title=""
      systemImage="arrow.clockwise"
      intent={RefreshQuotaIntent(undefined)}
      buttonStyle="plain"
      tint="secondaryLabel"
    />
  )
}

function Empty({ compact }: { compact: boolean }) {
  return (
    <VStack spacing={4} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
      <Image systemName="plus.circle" font={compact ? 18 : 22} foregroundStyle="secondaryLabel" />
      <Text font={compact ? 10 : 12} foregroundStyle="secondaryLabel" multilineTextAlignment="center">
        打开 App 添加账户
      </Text>
    </VStack>
  )
}

// ---------- 各尺寸 ----------

function SmallView() {
  const row = rows[0]
  if (!row) return <Empty compact />
  const color = statusColor(row)
  const metric = row.primary?.metric

  return (
    <VStack spacing={5} alignment="leading" frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "leading" }}>
      <HStack spacing={4}>
        <Image systemName={row.icon} font={11} foregroundStyle={color} />
        <Text font={11} foregroundStyle="secondaryLabel" lineLimit={1}>
          {row.account.label}
        </Text>
        <Spacer />
      </HStack>

      <Spacer />

      <Text font={28} fontWeight="bold" monospacedDigit lineLimit={1} foregroundStyle={color}>
        {!row.ok && row.error ? "失败" : (row.primary?.primary ?? "—")}
      </Text>
      <Text font={10} foregroundStyle="secondaryLabel" lineLimit={1}>
        {!row.ok && row.error ? row.error : (metric?.label ?? row.providerName)}
      </Text>

      {row.primary?.used !== undefined ? (
        <Bar used={row.primary.used} color={color} width={contentWidth} />
      ) : null}

      <Spacer />

      <HStack spacing={4}>
        <Text font={9} foregroundStyle="tertiaryLabel" lineLimit={1}>
          {metric?.resetAt ? fmtReset(metric.resetAt, now) : `${rows.length} 个账户 · ${fmtAgo(updatedAt, now)}`}
        </Text>
        <Spacer />
        <RefreshButton />
      </HStack>
    </VStack>
  )
}

function MediumView() {
  if (rows.length === 0) return <Empty compact={false} />
  return (
    <VStack spacing={7} alignment="leading" frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "leading" }}>
      <Header trailing />
      {rows.slice(0, 4).map((row) => (
        <Row key={row.account.id} row={row} barWidth={contentWidth} dense />
      ))}
      <Spacer />
    </VStack>
  )
}

function LargeView() {
  if (rows.length === 0) return <Empty compact={false} />
  return (
    <VStack spacing={9} alignment="leading" frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "leading" }}>
      <Header trailing />
      {rows.slice(0, 7).map((row) => (
        <VStack key={row.account.id} spacing={3} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>
          <Row row={row} barWidth={contentWidth} dense={false} />
          {row.metrics.slice(1, 3).map((sub) => (
            <HStack key={sub.metric.id} spacing={5}>
              <Text font={10} foregroundStyle="tertiaryLabel" lineLimit={1}>
                {sub.metric.label}
              </Text>
              <Spacer />
              <Text font={10} monospacedDigit foregroundStyle={STATUS_COLOR[sub.status]}>
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

function AccessoryRectangularView() {
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
      <Text font="headline" monospacedDigit lineLimit={1}>
        {!row.ok && row.error ? "失败" : (row.primary?.primary ?? "—")}
      </Text>
      <Text font="caption2" lineLimit={1}>
        {metric?.resetAt ? fmtReset(metric.resetAt, now) : `${totals.bad + totals.failed} 项告警`}
      </Text>
    </VStack>
  )
}

function AccessoryCircularView() {
  const row = rows[0]
  const used = row?.primary?.used
  return (
    <ZStack>
      <AccessoryWidgetBackground />
      {used !== undefined ? (
        <Gauge
          value={used}
          label={<Text>额度</Text>}
          currentValueLabel={<Text>{Math.round(used * 100)}</Text>}
          gaugeStyle="accessoryCircularCapacity"
        />
      ) : (
        <VStack spacing={0}>
          <Image systemName="gauge.with.dots.needle.33percent" font="caption" />
          <Text font="caption2" lineLimit={1}>
            {row?.primary?.primary ?? "—"}
          </Text>
        </VStack>
      )}
    </ZStack>
  )
}

function WidgetView() {
  if (family === "accessorycircular") return <AccessoryCircularView />
  if (family === "accessoryrectangular" || family === "accessoryinline") return <AccessoryRectangularView />
  if (family === "large") return <LargeView />
  if (family === "medium") return <MediumView />
  return <SmallView />
}

// 桌面小组件才画自己的底；锁屏的底交给系统。
function Body() {
  if (isAccessory) return <WidgetView />
  return (
    <VStack
      padding={14}
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      widgetBackground={{ style: "systemBackground", shape: { type: "rect", cornerRadius: 20 } }}
    >
      <WidgetView />
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
      widgetBackground={{ style: "systemBackground", shape: { type: "rect", cornerRadius: 20 } }}
    >
      <Image systemName="exclamationmark.triangle.fill" font={16} foregroundStyle={STATUS_COLOR.bad} />
      <Text font={10} foregroundStyle="secondaryLabel" multilineTextAlignment="center" lineLimit={4}>
        {message}
      </Text>
    </VStack>
  )
}

try {
  const config = loadConfigSync()
  const snapshot = loadSnapshotSync()
  refreshMinutes = config.settings.refreshMinutes

  const all = buildRows(config, snapshot, now)
  rows = sortBySeverity(enabledRows(all))
  totals = summarize(all)
  updatedAt = snapshot.updatedAt

  // 诊断必须写在 present 之前 —— present 之后当前执行上下文立刻销毁。
  writeWidgetDiagSync({
    renderedAt: now,
    family: rawFamily,
    accountsSeen: rows.length,
    selfRefreshed: false,
    keychainReadable: probeKeychain(),
  })

  Widget.present(<Body />, {
    // 到下一个刷新周期再让系统回来要新时间线。iOS 会自己打折扣，这里只是给个意图。
    policy: "after",
    date: new Date(now + refreshMinutes * 60000),
  })
} catch (error) {
  Widget.present(<Failed message={`小组件出错：${String(error)}`} />)
}
