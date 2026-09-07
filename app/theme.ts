/**
 * 配色。中性色全部走 iOS 语义色，跟随系统深浅色；只有状态色是写死的。
 *
 * 状态色是**保留色**：good / warn / bad 只表示额度水位，不拿去当「第 4 个系列色」。
 * 每处用到状态色的地方都同时有数字和文字，颜色只是加速识别，不是唯一信息——
 * 色觉障碍和小组件的着色模式下都还读得出来。
 */
import type { Color } from "scripting"
import type { Status } from "./util"

export const ACCENT = "#5E5CE6" as Color

/** 深色底上要更亮一点才够对比，所以状态色成对给。 */
export const STATUS_COLOR: Record<Status, { light: Color; dark: Color }> = {
  good: { light: "#1B873F" as Color, dark: "#4ADE80" as Color },
  warn: { light: "#B45309" as Color, dark: "#FBBF24" as Color },
  bad: { light: "#C0392B" as Color, dark: "#FF6B6B" as Color },
  neutral: { light: "#4B5563" as Color, dark: "#9CA3AF" as Color },
}

/** 进度条的槽。比状态色淡，不抢主体。 */
export const TRACK_COLOR = { light: "rgba(60,60,67,0.14)", dark: "rgba(235,235,245,0.18)" }

export const CARD_BG = { light: "#FFFFFF" as Color, dark: "#1C1C1E" as Color }
export const CARD_STROKE = {
  light: "rgba(17,17,34,0.08)" as Color,
  dark: "rgba(255,255,255,0.10)" as Color,
}
export const WELL_BG = { light: "#F2F2F7" as Color, dark: "#131316" as Color }

export const RADIUS_CARD = 14

/** 状态 -> SF Symbol。颜色之外的第二重编码。 */
export const STATUS_ICON: Record<Status, string> = {
  good: "checkmark.circle.fill",
  warn: "exclamationmark.triangle.fill",
  bad: "exclamationmark.octagon.fill",
  neutral: "circle.dashed",
}

// ---------- 小组件专用调色板（全部扁平 hex） ----------
//
// 小组件里**不用** `{light, dark}` 动态色，也不用 "secondaryLabel" 这类语义色，
// 更不用 `widgetBackground` 的 shape 对象形式。
//
// 理由是一份实测样本：另一个能正常渲染的 Scripting 小组件，通篇用的是扁平 hex
// 加 `backgroundColor`，没有任何动态色和语义色。我这边用满了动态色和
// widgetBackground，结果一片漆黑。在拿不到报错的情况下，照抄一个已知能跑的形状
// 比继续猜有价值得多。
//
// 代价是小组件不跟随系统深浅色——它固定是一张深色卡片。这是刻意的：
// 背景由我们自己画，前景色就能确定对比度，不依赖任何环境推断。
export const W = {
  bg: "#14141A",
  fg: "#F2F2F7",
  dim: "#8E8E93",
  faint: "#5A5A63",
  track: "#2C2C34",
  good: "#4ADE80",
  warn: "#FBBF24",
  bad: "#FF6B6B",
  neutral: "#9CA3AF",
} as const

/** 状态 -> 扁平色。和 STATUS_COLOR 一一对应，只是没有动态色。 */
export const W_STATUS: Record<Status, string> = {
  good: W.good,
  warn: W.warn,
  bad: W.bad,
  neutral: W.neutral,
}
