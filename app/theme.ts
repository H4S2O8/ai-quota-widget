/**
 * 配色。中性色全部走 iOS 语义色，跟随系统深浅色；只有状态色是写死的。
 *
 * 状态色是**保留色**：good / warn / bad 只表示额度水位，不拿去当「第 4 个系列色」。
 * 每处用到状态色的地方都同时有数字和文字，颜色只是加速识别，不是唯一信息——
 * 色觉障碍和小组件的着色模式下都还读得出来。
 */
/** 平台没发布类型定义，颜色在运行时就是字符串。 */
type Color = string
import type { Status } from "./util"

export const ACCENT = "#5E5CE6"

/** 深色底上要更亮一点才够对比，所以状态色成对给。 */
export const STATUS_COLOR: Record<Status, { light: Color; dark: Color }> = {
  good: { light: "#1B873F", dark: "#4ADE80" },
  warn: { light: "#B45309", dark: "#FBBF24" },
  bad: { light: "#C0392B", dark: "#FF6B6B" },
  neutral: { light: "#4B5563", dark: "#9CA3AF" },
}

/** 进度条的槽。比状态色淡，不抢主体。 */
export const TRACK_COLOR = { light: "rgba(60,60,67,0.14)", dark: "rgba(235,235,245,0.18)" }

export const CARD_BG = { light: "#FFFFFF", dark: "#1C1C1E" }
export const CARD_STROKE = {
  light: "rgba(17,17,34,0.08)",
  dark: "rgba(255,255,255,0.10)",
}
export const WELL_BG = { light: "#F2F2F7", dark: "#131316" }

export const RADIUS_CARD = 14

/** 状态 -> SF Symbol。颜色之外的第二重编码。 */
export const STATUS_ICON: Record<Status, string> = {
  good: "checkmark.circle.fill",
  warn: "exclamationmark.triangle.fill",
  bad: "exclamationmark.octagon.fill",
  neutral: "circle.dashed",
}

// ---------- 小组件调色板：终端风，日夜两套扁平色 ----------
//
// **不用 `{light, dark}` 动态色，也不用 "secondaryLabel" 这类语义色。**
// 两者在小组件里都没验证过，而且曾经和「一片漆黑」搅在一起分不清是谁的锅。
// 改成渲染时读一次 `Device.colorScheme`，从下面两套里选一套——背景自己画，
// 前景对比度就完全可控，不依赖任何环境推断。
//
// 配色是查过 WCAG 文字对比度的：三个状态色在各自表面上都 ≥ 4.5:1，
// 三级文字（时间戳那种）≥ 3.3:1。
//
// 一开始用 dataviz 的分类调色板校验器跑，它报 FAIL（警告色和危险色在色觉障碍下
// ΔE 只有 2.8）。但那个校验器自己写着「仅限分类调色板；单独的状态/文字色应当查
// WCAG 文字对比度」——状态色不是分类色，它另有二重编码（数字本身、条的长度）。
// 硬凑一组能过分类校验的颜色，反而会牺牲「红=危险、黄=警告」这个更重要的约定。
export interface WidgetPalette {
  bg: string
  fg: string
  dim: string
  faint: string
  rule: string
  accent: string
  good: string
  warn: string
  bad: string
  neutral: string
}

/** 日间：米白纸感，不用纯白——纯白在阳光下反而更晃。 */
export const W_LIGHT: WidgetPalette = {
  bg: "#F6F4EE",
  fg: "#23211C",
  dim: "#6B675C",
  faint: "#847E6E",
  rule: "#D5D0C2",
  accent: "#15803D",
  good: "#15803D",
  warn: "#9C5F06",
  bad: "#BE123C",
  neutral: "#6B675C",
}

/** 夜间：近黑带一点冷调，像终端。 */
export const W_DARK: WidgetPalette = {
  bg: "#0D0F12",
  fg: "#C8D3D5",
  dim: "#6F8286",
  faint: "#5E6E73",
  rule: "#232A30",
  accent: "#4ADE80",
  good: "#4ADE80",
  warn: "#F5C451",
  bad: "#FF8080",
  neutral: "#6F8286",
}

/**
 * 按系统外观取一套。
 *
 * `Device.colorScheme` 在 TS 版 Device API 里是文档化的，返回 "light" / "dark"。
 * 取不到就走夜间——小组件多数时间在深色底上，猜错的代价更小。
 */
export function widgetPalette(): WidgetPalette {
  try {
    if (typeof Device !== "undefined" && Device?.colorScheme === "light") return W_LIGHT
  } catch {
    // 落到夜间
  }
  return W_DARK
}

/** 状态 -> 颜色。 */
export function statusColor(p: WidgetPalette, s: Status): string {
  return s === "good" ? p.good : s === "warn" ? p.warn : s === "bad" ? p.bad : p.neutral
}
