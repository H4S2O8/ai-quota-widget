/**
 * 桌面 / 锁屏小组件。
 *
 * 小组件跑在独立扩展进程里，只渲染一次，hooks 不生效。所以这里的顺序是：
 * 先把数据全部准备好（可能包括一次网络抓取），最后一次性 present。
 * `Widget.present` 之后的代码不会执行——诊断要在它之前写。
 *
 * 尺寸策略：小尺寸只回答「最该操心的那个还剩多少」，中尺寸给一屏清单，
 * 大尺寸展开每个账户的全部指标，锁屏两种给一行/一环。
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
import { isStale, refreshAccounts } from "./refresh"
import { loadConfig, loadSnapshot, probeKeychain, saveSnapshot, writeWidgetDiag } from "./store"
import { STATUS_COLOR, TRACK_COLOR } from "./theme"
import type { AccountRow } from "./view"
import { buildRows, enabledRows, sortBySeverity, summarize } from "./view"
import { fmtAgo, fmtMetricValue, fmtReset } from "./util"

// ---------- 准备数据 ----------

const now = Date.now()
const config = await loadConfig()
let snapshot = await loadSnapshot()
let selfRefreshed = false
let note: string | undefined

if (
  config.settings.widgetSelfRefresh &&
  config.accounts.some((a) => a.enabled) &&
  isStale(snapshot, config.settings.refreshMinutes, now)
) {
  try {
    // 小组件里不写配置，只写快照：config 的写入权归主 App，避免两个进程互相覆盖。
    const outcome = await refreshAccounts(config, snapshot)
    snapshot = outcome.snapshot
    await saveSnapshot(snapshot)
    selfRefreshed = true
  } catch (error) {
    note = `自刷新失败：${String(error)}`
  }
}

const rows = sortBySeverity(enabledRows(buildRows(config, snapshot)))
const totals = summarize(buildRows(config, snapshot))

// Widget.family 的取值在文档里有两种写法（Quick Start 写 'small'，Widget API 写
// 'systemSmall'）。两种都认，免得在某个版本上整块判空。
const rawFamily = String(Widget.family ?? "")
const family = rawFamily.replace(/^system/, "").toLowerCase()
const isAccessory = family.startsWith("accessory")

await writeWidgetDiag({
  renderedAt: now,
  family: rawFamily,
  accountsSeen: rows.length,
  selfRefreshed,
  keychainReadable: probeKeychain(),
  note,
})

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
  const value = !row.ok && row.error ? "失败" : metric ? fmtMetricValue(metric) : "—"

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
          {fmtAgo(snapshot.updatedAt, now)}
        </Text>
      )}
      {trailing ? (
        <Button
          intent={RefreshQuotaIntent(undefined)}
          label={<Image systemName="arrow.clockwise" font={10} foregroundStyle="secondaryLabel" />}
          buttonStyle="plain"
        />
      ) : null}
    </HStack>
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

const contentWidth = Math.max(80, (Widget.displaySize?.width ?? 160) - 28)

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
        {!row.ok && row.error ? "失败" : metric ? fmtMetricValue(metric) : "—"}
      </Text>
      <Text font={10} foregroundStyle="secondaryLabel" lineLimit={1}>
        {!row.ok && row.error ? row.error : (metric?.label ?? row.providerName)}
      </Text>

      {row.primary?.used !== undefined ? (
        <Bar used={row.primary.used} color={color} width={contentWidth} />
      ) : null}

      <Spacer />

      <Text font={9} foregroundStyle="tertiaryLabel" lineLimit={1}>
        {metric?.resetAt ? fmtReset(metric.resetAt, now) : `${rows.length} 个账户 · ${fmtAgo(snapshot.updatedAt, now)}`}
      </Text>
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
                {fmtMetricValue(sub.metric)}
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
        {!row.ok && row.error ? "失败" : metric ? fmtMetricValue(metric) : "—"}
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
            {row?.primary ? fmtMetricValue(row.primary.metric) : "—"}
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
const body = isAccessory ? (
  <WidgetView />
) : (
  <VStack
    padding={14}
    frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
    widgetBackground={{ style: "systemBackground", shape: { type: "rect", cornerRadius: 20 } }}
  >
    <WidgetView />
  </VStack>
)

Widget.present(body, {
  // 到下一个刷新周期再让系统回来要新时间线。iOS 会自己打折扣，这里只是给个意图。
  policy: "after",
  date: new Date(now + config.settings.refreshMinutes * 60000),
})
