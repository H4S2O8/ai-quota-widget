/**
 * 视图模型：把「配置 + 快照」拍平成一串可直接渲染的行。
 *
 * 主 App 和小组件共用它，好处是两边永远显示同一套判断——排序、状态色、
 * 「几分钟前」的措辞只有一份实现。小组件里发现的显示问题，在主 App 里改一次
 * 两边都好。
 *
 * **只依赖 meta.ts，不碰 providers.ts。** 小组件通过这个文件间接引入的东西，
 * 全都会被加载进那个只有约 30MB 内存的扩展进程；十个 provider 的抓取逻辑
 * 它一行都用不到。
 */
import { metaOf } from "./meta"
import type { Account, AppConfig, Metric, Snapshot } from "./types"
import type { DisplayMode, NormalizedMetric, Status } from "./util"
import { fmtMetricDetail, fmtMetricValue, normalizeMetric, statusOf } from "./util"

export interface MetricRow {
  metric: Metric
  status: Status
  /** 已用比例 0–1，没有上限时为 undefined */
  used?: number
  norm: NormalizedMetric
  /**
   * 给等宽排版用的短标签。
   *
   * 主 App 里「5 小时」「7 天 Opus」是对的，但小组件是等宽终端排版，
   * 中文标签占双宽、长度又不齐，会把整列撞散。效果图里 `5 …` `7 天…` `总余…`
   * 就是这么来的——而那是用真实代码生成的图，手写样张用短标签反而掩盖了问题。
   */
  short: string
  /**
   * 渲染用的成品文本，在这里算一次。
   *
   * 主 App 和小组件都只读这两个字段，不各自调格式化函数——两边的口径就不可能
   * 漂移。「增长式和扣除式统一显示」这件事只在这一层实现一次。
   */
  primary: string
  detail: string
}

export interface AccountRow {
  account: Account
  providerName: string
  icon: string
  color: string
  ok: boolean
  error?: string
  fetchedAt: number
  /** 第一个指标：provider 自己排的头一项。没有数据时为 undefined */
  primary?: MetricRow
  /**
   * 最紧张的那个指标。
   *
   * 小组件的小尺寸和锁屏只放得下一个数，放的必须是这个——账户按紧张程度排到
   * 第一位，是因为它的某个窗口快用完了，结果大字却显示另一个窗口的 58%，
   * 这就是第一版小尺寸「逻辑奇怪」的根源。并列时取靠前的。
   */
  worst?: MetricRow
  metrics: MetricRow[]
  plan?: string
  note?: string
  raw?: string
  /** 被服务器限流到什么时候（epoch 毫秒）。在此之前不该发任何请求。 */
  retryAfter?: number
  /** 排序权重：越紧张越靠前 */
  severity: number
}

/**
 * 中文指标名 -> 等宽排版用的短标签。
 *
 * 认不出来的按「取前几个 ASCII 字符或首字」处理，不硬截中文——
 * 截一半的中文比缩写更难认。
 */
export function shortLabel(label: string): string {
  const table: Record<string, string> = {
    "5 小时": "5h",
    "7 天": "7d",
    "7 天 Opus": "opus",
    "7 天 Sonnet": "sonn",
    "7 天 · 第三方应用": "apps",
    "每月": "1mo",
    "余额": "bal",
    "总余额": "bal",
    "可用余额": "bal",
    "账户余额": "bal",
    "剩余额度": "quota",
    "已消费": "spent",
    "本 Key 限额": "key",
    "周额度": "7d",
    "额度": "quota",
  }
  const hit = table[label.trim()]
  if (hit) return hit
  // 纯 ASCII 的（比如 provider 自己给的 "5 小时" 之外的名字）直接用，最多 5 列
  const ascii = label.replace(/[^\x20-\x7E]/g, "").trim()
  if (ascii.length >= 2) return ascii.slice(0, 5).toLowerCase()
  return label.slice(0, 2)
}

export function buildRows(
  config: AppConfig,
  snapshot: Snapshot,
  now = Date.now(),
): AccountRow[] {
  const mode: DisplayMode = config.settings.displayMode === "used" ? "used" : "remaining"
  return config.accounts.map((account) => {
    const meta = metaOf(account.providerId)
    const state = snapshot.states[account.id]
    const metrics: MetricRow[] = (state?.result?.metrics ?? []).map((metric) => {
      const norm = normalizeMetric(metric)
      return {
        metric,
        status: statusOf(metric, account.warnBelow),
        used: norm.fraction,
        norm,
        primary: fmtMetricValue(metric, mode),
        detail: fmtMetricDetail(metric, now, mode),
        short: shortLabel(metric.label),
      }
    })

    return {
      account,
      providerName: meta.name,
      icon: meta.icon,
      color: meta.color,
      ok: state?.ok ?? false,
      error: state?.error,
      fetchedAt: state?.fetchedAt ?? 0,
      primary: metrics[0],
      worst: worstOf(metrics),
      metrics,
      plan: state?.result?.plan,
      note: state?.result?.note,
      raw: state?.raw,
      retryAfter: state?.retryAfter,
      severity: severityOf(metrics, state?.error != null, account.enabled),
    }
  })
}

/** 单个指标的紧张分：出错 > 快用完 > 用了一多半 > 其余。 */
export function metricScore(row: MetricRow): number {
  const score =
    row.status === "bad" ? 80 : row.status === "warn" ? 50 : row.status === "good" ? 10 : 5
  // 同档时，已用更多的更紧张
  return score + (row.used !== undefined ? row.used : 0)
}

/** 一串指标里最紧张的那个；并列取靠前的。 */
export function worstOf(metrics: MetricRow[]): MetricRow | undefined {
  let best: MetricRow | undefined
  let bestScore = -1
  for (const row of metrics) {
    const score = metricScore(row)
    if (score > bestScore) {
      best = row
      bestScore = score
    }
  }
  return best
}

/**
 * 排序权重。小组件放不下所有账户，得先显示「最该看的」：
 * 出错 > 快用完 > 用了一多半 > 其余。停用的沉底。
 */
function severityOf(metrics: MetricRow[], failed: boolean, enabled: boolean): number {
  if (!enabled) return -1
  if (failed) return 100
  const top = worstOf(metrics)
  return top ? metricScore(top) : 0
}

/** 小组件按紧张程度排；主 App 保持用户自己的顺序，所以只在小组件里用。 */
export function sortBySeverity(rows: AccountRow[]): AccountRow[] {
  return [...rows].sort((a, b) => b.severity - a.severity)
}

export function enabledRows(rows: AccountRow[]): AccountRow[] {
  return rows.filter((row) => row.account.enabled)
}

/**
 * 面板顶部那一行汇总：几个正常、几个告警、几个失败。
 *
 * 按每个账户**最紧张**的指标计，和排序用的是同一个判据。曾经按第一个指标计，
 * 结果 Claude 的 Opus 窗口红了，汇总还说它 good。
 */
export function summarize(rows: AccountRow[]): { good: number; warn: number; bad: number; failed: number } {
  let good = 0
  let warn = 0
  let bad = 0
  let failed = 0
  for (const row of enabledRows(rows)) {
    if (!row.ok && row.error) {
      failed++
      continue
    }
    const status = row.worst?.status ?? "neutral"
    if (status === "bad") bad++
    else if (status === "warn") warn++
    else good++
  }
  return { good, warn, bad, failed }
}
