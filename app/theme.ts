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
