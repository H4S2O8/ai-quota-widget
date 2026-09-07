/**
 * 主 App 里复用的小部件。
 *
 * 两条来自这个平台的约束决定了写法：
 * - 形状（RoundedRectangle）上直接挂 padding 不生效，所以卡片一律是
 *   「带 padding 的 stack + background 传形状」。
 * - 容器上的 shadow 不生效，卡片边界靠描边。
 */
/** 平台没发布类型定义。VirtualNode 是不透明的视图节点，不需要知道它的结构。 */
type VirtualNode = unknown
import { GeometryReader, HStack, Image, RoundedRectangle, Spacer, Text, VStack, ZStack } from "scripting"
import { CARD_BG, CARD_STROKE, RADIUS_CARD, STATUS_COLOR, STATUS_ICON, TRACK_COLOR, WELL_BG } from "./theme"
import type { Status } from "./util"

export function Card({
  children,
  spacing = 10,
}: {
  children: (VirtualNode | null | undefined)[] | VirtualNode
  spacing?: number
  /** JSX 的 key 由框架消费，声明一下才能在 map 里用 */
  key?: string
}) {
  return (
    <VStack
      spacing={spacing}
      padding={14}
      alignment="leading"
      frame={{ maxWidth: "infinity", alignment: "leading" }}
      background={
        <RoundedRectangle
          cornerRadius={RADIUS_CARD}
          fill={CARD_BG}
          stroke={{ shapeStyle: CARD_STROKE, strokeStyle: { lineWidth: 1 } }}
        />
      }
    >
      {children}
    </VStack>
  )
}

/** 输入框外面那层浅色底。 */
export function Well({
  children,
  padding = 10,
}: {
  children: (VirtualNode | null | undefined)[] | VirtualNode
  padding?: number
}) {
  return (
    <VStack
      padding={padding}
      alignment="leading"
      frame={{ maxWidth: "infinity", alignment: "leading" }}
      background={<RoundedRectangle cornerRadius={10} fill={WELL_BG} />}
    >
      {children}
    </VStack>
  )
}

export function FieldLabel({ text, hint }: { text: string; hint?: string }) {
  return (
    <HStack spacing={6} frame={{ maxWidth: "infinity", alignment: "leading" }}>
      <Text font={12} fontWeight="medium" foregroundStyle="secondaryLabel">
        {text}
      </Text>
      <Spacer />
      {hint ? (
        <Text font={11} foregroundStyle="tertiaryLabel">
          {hint}
        </Text>
      ) : null}
    </HStack>
  )
}

/**
 * 比例条。宽度靠 GeometryReader 拿——列表行的可用宽度只有布局时才知道。
 * 外面必须固定高度，否则 GeometryReader 会把行撑到满屏。
 */
export function ProgressBar({ used, status }: { used: number; status: Status }) {
  const ratio = Math.max(0, Math.min(1, used))
  // GeometryReader 的 props 里只声明了 children，没有 frame 的用例，所以高度
  // 限制加在外面这层 HStack 上，而不是它自己身上。
  return (
    <HStack frame={{ maxWidth: "infinity", height: 6 }}>
      <GeometryReader>
        {(proxy) => (
          <ZStack alignment="leading">
            <RoundedRectangle
              cornerRadius={3}
              fill={TRACK_COLOR}
              frame={{ width: proxy.size.width, height: 6 }}
            />
            <RoundedRectangle
              cornerRadius={3}
              fill={STATUS_COLOR[status]}
              frame={{ width: Math.max(3, proxy.size.width * ratio), height: 6 }}
            />
          </ZStack>
        )}
      </GeometryReader>
    </HStack>
  )
}

/**
 * 状态标。颜色之外一定带图标和文字——色觉障碍、着色模式和黑白截图下都要读得出。
 */
export function StatusPill({ status, text }: { status: Status; text: string }) {
  return (
    <HStack spacing={4}>
      <Image systemName={STATUS_ICON[status]} font={10} foregroundStyle={STATUS_COLOR[status]} />
      <Text font={11} foregroundStyle={STATUS_COLOR[status]}>
        {text}
      </Text>
    </HStack>
  )
}

export function SectionTitle({ text, trailing }: { text: string; trailing?: VirtualNode }) {
  return (
    <HStack frame={{ maxWidth: "infinity", alignment: "leading" }}>
      <Text font={13} fontWeight="semibold" foregroundStyle="secondaryLabel">
        {text}
      </Text>
      <Spacer />
      {trailing ?? null}
    </HStack>
  )
}
