/**
 * 终端风排版的工具：显示宽度、补齐、方块进度条。
 *
 * 等宽字体的对齐全靠「每个字符占几列」。**中日韩字符占两列**，
 * 所以不能用 `String.length` 补空格——账户名叫「硅基流动」的那一行会整体错位，
 * 而错位在等宽排版里特别刺眼，一眼就毁掉整块的观感。
 *
 * 这个文件不 import "scripting"，所以能在 node 里直接跑测试。
 */

/**
 * 一个字符占几列。
 *
 * 判据是 Unicode 的 East Asian Width：Wide 和 Fullwidth 算两列，其余算一列。
 * 这里只列了实际会遇到的区段（中日韩、全角标点、假名、谚文），不做完整实现——
 * 完整表很大，而小组件里出现的字符是可枚举的。
 */
export function charWidth(code: number): number {
  if (
    (code >= 0x1100 && code <= 0x115f) || // 谚文字母
    (code >= 0x2e80 && code <= 0x303e) || // 中日韩部首、标点
    (code >= 0x3041 && code <= 0x33ff) || // 假名、注音、兼容字符
    (code >= 0x3400 && code <= 0x4dbf) || // 中日韩扩展 A
    (code >= 0x4e00 && code <= 0x9fff) || // 中日韩统一表意
    (code >= 0xa000 && code <= 0xa4cf) || // 彝文
    (code >= 0xac00 && code <= 0xd7a3) || // 谚文音节
    (code >= 0xf900 && code <= 0xfaff) || // 兼容表意
    (code >= 0xfe30 && code <= 0xfe6f) || // 竖排、小写变体
    (code >= 0xff00 && code <= 0xff60) || // 全角
    (code >= 0xffe0 && code <= 0xffe6)
  ) {
    return 2
  }
  return 1
}

/** 字符串占几列。 */
export function displayWidth(text: string): number {
  let width = 0
  for (const ch of text) width += charWidth(ch.codePointAt(0) ?? 0)
  return width
}

/**
 * 截到指定列宽。
 *
 * 放不下时最后一列换成 `…`——直接砍掉会让人以为名字就那么长，
 * 而省略号是「还有内容」的通用信号。
 */
export function clip(text: string, columns: number): string {
  if (displayWidth(text) <= columns) return text
  let out = ""
  let width = 0
  for (const ch of text) {
    const w = charWidth(ch.codePointAt(0) ?? 0)
    if (width + w > columns - 1) break
    out += ch
    width += w
  }
  return out + "…"
}

/** 左对齐补到指定列宽（会先截断）。 */
export function padEnd(text: string, columns: number): string {
  const clipped = clip(text, columns)
  return clipped + " ".repeat(Math.max(0, columns - displayWidth(clipped)))
}

/** 右对齐补到指定列宽（数值列用这个）。 */
export function padStart(text: string, columns: number): string {
  const clipped = clip(text, columns)
  return " ".repeat(Math.max(0, columns - displayWidth(clipped))) + clipped
}

/**
 * 方块进度条。
 *
 * 用 █ 和 ░ 而不是画矩形：等宽字体里它们和文字天然对齐，
 * 而且不需要知道容器宽度——小组件里拿不到布局回调。
 *
 * 已用大于 0 时至少画一格：0.4% 和 0% 在界面上应当看起来不一样。
 */
export function blockBar(usedFraction: number, columns: number): string {
  const clamped = Math.max(0, Math.min(1, usedFraction))
  const filled = clamped > 0 ? Math.max(1, Math.round(clamped * columns)) : 0
  return "█".repeat(filled) + "░".repeat(Math.max(0, columns - filled))
}
