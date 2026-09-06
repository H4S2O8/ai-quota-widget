/**
 * 桌面 / 锁屏小组件。
 *
 * ## 这个文件的两条硬约束
 *
 * 1. **全程同步。** 顶层 `await` 会抛 `ReferenceError`（脚本按普通脚本求值，
 *    不是 ES 模块）；把 present 包进 async 函数则一片漆黑——`Widget.present`
 *    必须在同步执行过程中被调用。文件读取走 `readAsStringSync`。
 *
 * 2. **导入图要尽量小。** 文档写着小组件约有 30MB 内存上限，超了会
 *    「渲染失败或显示为空白」。所以这里刻意**不 import**：
 *      - `providers.ts` / `p_*.ts`（十个服务商的抓取逻辑，画一行图标用不到）
 *      - `refresh.ts`（网络编排，小组件不联网）
 *      - `app_intents.tsx`（它会连带拖进上面两个）
 *    显示用的名字/图标/颜色单独放在 `meta.ts` 里，就是为了这件事。
 *
 * ## 实测过的失败写法（别再试）
 *
 *   Widget.present(<Button label={<Body/>} .../>)  -> 一片漆黑（Button 当根视图）
 *   顶层 await                                      -> ReferenceError
 *   async main() 里 present                         -> 一片漆黑
 *
 * ## 点击行为
 *
 * 两种，由 `settings.widgetTap` 决定。都不需要 AppIntent：
 *   `open` —— 不包裹，系统默认（打开脚本）
 *   `link` —— `<Link url={run_single?action=refresh}>` 包住内容；`index.tsx` 认这个
 *             参数，抓完直接退出不展示界面。Link 收自定义布局是文档化的。
 *
 * ## 排障
 *
 * 小组件的 Parameter 填 `min`，只渲染一行纯文本。它还黑就说明问题在加载阶段
 * （导入或环境），跟这里的视图树无关；能显示就说明视图树里有东西不被 WidgetKit 支持。
 * 这是这个平台上唯一能二分的办法。
 */
import {
  HStack,
  Image,
  Link,
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
/** 点击行为。 */
let tapMode: "open" | "link" = "open"

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

function Header() {
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

      <Text font={9} foregroundStyle="tertiaryLabel" lineLimit={1}>
        {metric?.resetAt ? fmtReset(metric.resetAt, now) : `${rows.length} 个账户 · ${fmtAgo(updatedAt, now)}`}
      </Text>
    </VStack>
  )
}

function MediumView() {
  if (rows.length === 0) return <Empty compact={false} />
  return (
    <VStack spacing={7} alignment="leading" frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "leading" }}>
      <Header />
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
      <Header />
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
/** 内容 + 背景。open / link 两种模式直接用它。 */
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

// Parameter 填 min 时只渲染一行纯文本。
// 这是这个平台上唯一能二分的办法：还黑 -> 问题在加载阶段（导入/环境）；
// 能显示 -> 问题在视图树里，有组件不被 WidgetKit 支持。
if (String(Widget.parameter ?? "").trim().toLowerCase() === "min") {
  Widget.present(
    <VStack padding={12}>
      <Text font={14}>AI 额度</Text>
      <Text font={10}>最小渲染 OK</Text>
      <Text font={10}>{rawFamily || "family?"}</Text>
    </VStack>,
  )
} else
try {
  const config = loadConfigSync()
  const snapshot = loadSnapshotSync()
  refreshMinutes = config.settings.refreshMinutes
  tapMode = config.settings.widgetTap === "link" ? "link" : "open"

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

  const presented =
    tapMode === "link" ? (
      // Link 收自定义布局是文档化的，小组件里也有明确说明（它会让 widgetURL 失效）。
      // run_single 保证不会开出一堆实例；action=refresh 由 index.tsx 认，抓完就退出。
      <Link url={Script.createRunSingleURLScheme(Script.name, { action: "refresh" })}>
        <Body />
      </Link>
    ) : (
      <Body />
    )

  Widget.present(presented, {
    // 到下一个刷新周期再让系统回来要新时间线。iOS 会自己打折扣，这里只是给个意图。
    policy: "after",
    date: new Date(now + refreshMinutes * 60000),
  })
} catch (error) {
  Widget.present(<Failed message={`小组件出错：${String(error)}`} />)
}
