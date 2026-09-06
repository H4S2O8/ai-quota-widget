/**
 * 领域类型。整个项目只在这里定义数据形状，其他文件只消费。
 *
 * 三层：
 *   Provider   —— 「怎么向某个服务商拿额度」，纯函数，不碰 UI、不碰存储
 *   Account    —— 用户配置的一个凭据实例（同一 Provider 可以有多个账户）
 *   Snapshot   —— 最近一次抓取结果的缓存，主 App 和小组件通过它共享数据
 */

/**
 * 指标类型决定 value 的含义与配色：
 *   percent —— value 是「已用百分比」0–100（Claude 5 小时窗口这种）
 *   amount  —— value 是「剩余金额」，unit 是货币符号；可选 max 表示总额
 *   count   —— value 是「剩余次数/积分」，可选 max
 *   spent   —— value 是「已消费金额」，没有上限，只做展示不判色
 */
export type MetricKind = "percent" | "amount" | "count" | "spent"

export interface Metric {
  /** 账户内唯一，如 "5h" / "7d" / "balance" */
  id: string
  /** 给人看的短标签，如 "5 小时" / "余额" */
  label: string
  kind: MetricKind
  value: number
  max?: number
  unit?: string
  /** 重置时间，epoch 毫秒 */
  resetAt?: number
  /** 一行补充说明，大尺寸小组件和主 App 会显示 */
  hint?: string
}

export interface ProviderResult {
  /** 第一项是「主指标」：小尺寸小组件只显示它 */
  metrics: Metric[]
  /** 套餐名，如 "Max" / "plus" */
  plan?: string
  /** 服务商返回的备注（如「账户不可用」） */
  note?: string
}

export interface FieldSpec {
  key: string
  label: string
  /** 密码框 */
  secret?: boolean
  placeholder?: string
  required?: boolean
  /** 显示在输入框下面的一句话说明 */
  help?: string
  /** 多行文本 */
  multiline?: boolean
}

export interface FetchContext {
  /** 单次请求超时（秒） */
  timeoutSec: number
  /**
   * Provider 需要持久化新凭据时调用（例如 OAuth 刷新后拿到了新 token）。
   * 调用方负责把补丁合并进账户配置并保存。
   */
  updateConfig: (patch: Record<string, string>) => void
  /**
   * 记下一段原始响应，供主 App 的「原始响应」诊断页显示。
   *
   * 存在的理由：有几个服务商的接口没有公开文档，字段名是推断出来的。推断错了
   * 的症状是「取不到值」，而不是报错——在这个平台上，看不见的错误最贵。所以
   * 凡是靠推断解析的 provider 都要把原文留下来，让人能直接看到它到底返回了什么。
   */
  captureRaw: (text: string) => void
}

export interface Provider {
  /** 稳定 id，写进配置文件；改了会让已有账户失联 */
  id: string
  name: string
  /** SF Symbol */
  icon: string
  /** 品牌色，#RRGGBB */
  color: string
  /** 怎么拿到凭据、接口是否官方，写在这里，添加页会显示 */
  help: string
  fields: FieldSpec[]
  fetch(config: Record<string, string>, ctx: FetchContext): Promise<ProviderResult>
}

export interface Account {
  id: string
  providerId: string
  label: string
  enabled: boolean
  config: Record<string, string>
  /**
   * amount/count 类指标低于这个值就标红。没有上限的余额只能靠它判色；
   * 不填就永远绿色。
   */
  warnBelow?: number
}

export interface Settings {
  /** 小组件多久自行刷新一次；也是「数据算过期」的阈值 */
  refreshMinutes: number
  /**
   * 打开 App 时，数据过期就自动抓一遍。
   *
   * 这条是补小组件那边丢掉的自动性：小组件现在全程同步（顶层 await 不可用，
   * 异步再 present 会一片漆黑），而网络请求没有同步版本，所以它不能自己联网了。
   * 数据的新鲜度改由「打开 App」和「点小组件上的刷新」两条路保证。
   */
  autoRefreshOnOpen: boolean
  /**
   * 点小组件干什么。
   *
   * `refresh`（默认）—— 整块小组件是一个按钮，点哪儿都是刷新。
   * `open`     —— 不包按钮，点击走系统默认（打开脚本），右上角另给一个刷新按钮。
   *
   * 做成开关不是为了花哨：整块包 Button 用到的是 `label` + `buttonStyle="plain"`，
   * 每一件都是文档化的，但这个组合没有用例。万一它在某个版本上渲染不出来，
   * 用户能自己在 App 里切回去，不用等我发新版。
   */
  widgetTap: "refresh" | "open"
  /** 单个账户的请求超时（秒） */
  timeoutSec: number
  /**
   * 面板显示「还剩多少」还是「用了多少」。
   *
   * 存在的理由：服务商给的额度一半是增长式（已用 42%）一半是扣除式（余额 ¥12.5），
   * 混在一屏里没法扫。这个开关把两种统一成同一个口径，默认「剩余」——
   * 大数字一律代表宽裕。
   */
  displayMode: "remaining" | "used"
}

export interface AppConfig {
  version: 1
  accounts: Account[]
  settings: Settings
}

export interface AccountState {
  ok: boolean
  /** 最近一次成功抓取的时间 */
  fetchedAt: number
  /** 最近一次成功的结果；失败时保留上一次的，让小组件继续有数可显 */
  result?: ProviderResult
  error?: string
  errorAt?: number
  /** 最近一次抓取的原始响应（截断），只有部分 provider 会记 */
  raw?: string
}

export interface Snapshot {
  updatedAt: number
  states: Record<string, AccountState>
}

export const DEFAULT_SETTINGS: Settings = {
  refreshMinutes: 15,
  autoRefreshOnOpen: true,
  widgetTap: "refresh",
  timeoutSec: 15,
  displayMode: "remaining",
}

export const EMPTY_SNAPSHOT: Snapshot = { updatedAt: 0, states: {} }
