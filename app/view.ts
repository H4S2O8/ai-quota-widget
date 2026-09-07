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
  /** 主指标：小尺寸小组件只显示它。没有数据时为 undefined */
  primary?: MetricRow
  metrics: MetricRow[]
  plan?: string
  note?: string
  raw?: string
  /** 被服务器限流到什么时候（epoch 毫秒）。在此之前不该发任何请求。 */
  retryAfter?: number
  /** 排序权重：越紧张越靠前 */
  severity: number
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
      metrics,
      plan: state?.result?.plan,
      note: state?.result?.note,
      raw: state?.raw,
      retryAfter: state?.retryAfter,
      severity: severityOf(metrics, state?.error != null, account.enabled),
    }
  })
}

/**
 * 排序权重。小组件放不下所有账户，得先显示「最该看的」：
 * 出错 > 快用完 > 用了一多半 > 其余。停用的沉底。
 */
function severityOf(metrics: MetricRow[], failed: boolean, enabled: boolean): number {
  if (!enabled) return -1
  if (failed) return 100
  let worst = 0
  for (const row of metrics) {
    const score =
      row.status === "bad" ? 80 : row.status === "warn" ? 50 : row.status === "good" ? 10 : 5
    // 同为 bad 时，已用更多的排前面
    const tie = row.used !== undefined ? row.used : 0
    worst = Math.max(worst, score + tie)
  }
  return worst
}

/** 小组件按紧张程度排；主 App 保持用户自己的顺序，所以只在小组件里用。 */
export function sortBySeverity(rows: AccountRow[]): AccountRow[] {
  return [...rows].sort((a, b) => b.severity - a.severity)
}

export function enabledRows(rows: AccountRow[]): AccountRow[] {
  return rows.filter((row) => row.account.enabled)
}

/** 面板顶部那一行汇总：几个正常、几个告警、几个失败。 */
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
    const status = row.primary?.status ?? "neutral"
    if (status === "bad") bad++
    else if (status === "warn") warn++
    else good++
  }
  return { good, warn, bad, failed }
}
