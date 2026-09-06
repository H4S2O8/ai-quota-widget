/**
 * 持久化：配置 + 快照。
 *
 * ## 为什么全部走 App Group 目录，而不是 Storage / Keychain
 *
 * 小组件跑在独立的扩展进程里。文档里明确说「Widget 里的脚本能访问
 * appGroupDocumentsDirectory」，而 Storage 的私有域和 Keychain 在扩展进程里能不能
 * 读到，文档没有用例——按这个项目的纪律，没有用例的写法先当它不支持。
 *
 * 所以凭据也在这个文件里（明文 JSON）。这不是无所谓的选择，写清楚代价：
 * App Group 容器在 App 沙箱内，「文件」App 里看不到，其他 App 也读不到，但它
 * 确实不如 Keychain。换回 Keychain 的前提是先证明小组件读得到——`probeKeychain()`
 * 就是干这个的，它把结论写进快照，主 App 的「诊断」页会显示。等它在真机上稳定
 * 报「是」，再把凭据搬进 Keychain 才有依据。
 */
import { Path } from "scripting"
import type { AppConfig, Settings, Snapshot } from "./types"
import { DEFAULT_SETTINGS, EMPTY_SNAPSHOT } from "./types"

const DIR_NAME = "AIQuota"
const CONFIG_FILE = "config.json"
const SNAPSHOT_FILE = "snapshot.json"

/** 小组件能不能读 Keychain 的探针键。见文件头。 */
const KEYCHAIN_PROBE_KEY = "aiquota.keychain.probe"
const KEYCHAIN_PROBE_VALUE = "ok"

function rootDir(): string {
  // 类型声明里这个属性可能为 null（没配 App Group 时）。真为 null 就退回私有
  // documents——主 App 还能用，只是小组件读不到数据，诊断页会说明。
  const group = FileManager.appGroupDocumentsDirectory as string | null
  return group ?? FileManager.documentsDirectory
}

export function usingAppGroup(): boolean {
  return (FileManager.appGroupDocumentsDirectory as string | null) != null
}

function dataDir(): string {
  return Path.join(rootDir(), DIR_NAME)
}

export function configPath(): string {
  return Path.join(dataDir(), CONFIG_FILE)
}

export function snapshotPath(): string {
  return Path.join(dataDir(), SNAPSHOT_FILE)
}

async function ensureDir(): Promise<void> {
  const dir = dataDir()
  if (!FileManager.existsSync(dir)) {
    await FileManager.createDirectory(dir, true)
  }
}

/**
 * 同步读。小组件专用。
 *
 * 小组件里顶层 await 不可用，而把 present 放进 async 函数之后又出现了
 * 「一片漆黑」——异步做完再 present，时机上就已经太晚了。所以小组件那条路
 * 全程不碰 Promise：同步读文件，立刻 present。
 */
function readJsonSync<T>(path: string, fallback: T): T {
  try {
    if (!FileManager.existsSync(path)) return fallback
    const text = FileManager.readAsStringSync(path)
    if (!text) return fallback
    return JSON.parse(text) as T
  } catch {
    return fallback
  }
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    if (!FileManager.existsSync(path)) return fallback
    const text = await FileManager.readAsString(path)
    if (!text) return fallback
    return JSON.parse(text) as T
  } catch {
    // 文件损坏时宁可回到默认值，也不要让主 App 打不开。
    return fallback
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await ensureDir()
  await FileManager.writeAsString(path, JSON.stringify(value))
}

// ---------- 配置 ----------

export const EMPTY_CONFIG: AppConfig = {
  version: 1,
  accounts: [],
  settings: DEFAULT_SETTINGS,
}

/** 读配置并顺手修一遍：旧版本存下来的结构不完整时不能让 UI 崩。 */
export async function loadConfig(): Promise<AppConfig> {
  const raw = await readJson<Partial<AppConfig>>(configPath(), EMPTY_CONFIG)
  return normalizeConfig(raw)
}

/** 同步版，给小组件用。 */
export function loadConfigSync(): AppConfig {
  return normalizeConfig(readJsonSync<Partial<AppConfig>>(configPath(), EMPTY_CONFIG))
}

export async function saveConfig(config: AppConfig): Promise<void> {
  await writeJson(configPath(), config)
}

export function normalizeConfig(raw: Partial<AppConfig> | null | undefined): AppConfig {
  const source = raw ?? {}
  const accounts = Array.isArray(source.accounts) ? source.accounts : []
  return {
    version: 1,
    accounts: accounts
      .filter((a) => a && typeof a === "object" && typeof a.id === "string")
      .map((a) => ({
        id: a.id,
        providerId: typeof a.providerId === "string" ? a.providerId : "generic",
        label: typeof a.label === "string" ? a.label : "未命名",
        enabled: a.enabled !== false,
        config:
          a.config && typeof a.config === "object" ? (a.config as Record<string, string>) : {},
        warnBelow: typeof a.warnBelow === "number" && Number.isFinite(a.warnBelow)
          ? a.warnBelow
          : undefined,
      })),
    settings: normalizeSettings(source.settings),
  }
}

function normalizeSettings(raw: Partial<Settings> | undefined): Settings {
  const value = raw ?? {}
  const minutes = Number(value.refreshMinutes)
  const timeout = Number(value.timeoutSec)
  return {
    refreshMinutes: Number.isFinite(minutes) ? Math.min(720, Math.max(5, minutes)) : DEFAULT_SETTINGS.refreshMinutes,
    autoRefreshOnOpen: value.autoRefreshOnOpen !== false,
    widgetTap:
      value.widgetTap === "button" || value.widgetTap === "link"
        ? value.widgetTap
        : DEFAULT_SETTINGS.widgetTap,
    timeoutSec: Number.isFinite(timeout) ? Math.min(60, Math.max(5, timeout)) : DEFAULT_SETTINGS.timeoutSec,
    displayMode: value.displayMode === "used" ? "used" : DEFAULT_SETTINGS.displayMode,
  }
}

// ---------- 快照 ----------

export async function loadSnapshot(): Promise<Snapshot> {
  const raw = await readJson<Partial<Snapshot>>(snapshotPath(), EMPTY_SNAPSHOT)
  return {
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : 0,
    states: raw.states && typeof raw.states === "object" ? raw.states : {},
  }
}

/** 同步版，给小组件用。 */
export function loadSnapshotSync(): Snapshot {
  const raw = readJsonSync<Partial<Snapshot>>(snapshotPath(), EMPTY_SNAPSHOT)
  return {
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : 0,
    states: raw.states && typeof raw.states === "object" ? raw.states : {},
  }
}

export async function saveSnapshot(snapshot: Snapshot): Promise<void> {
  await writeJson(snapshotPath(), snapshot)
}

// ---------- Keychain 探针 ----------

/** 主 App 调用：埋一个值进 Keychain。 */
export function seedKeychainProbe(): void {
  try {
    Keychain.set(KEYCHAIN_PROBE_KEY, KEYCHAIN_PROBE_VALUE)
  } catch {
    // 忽略：探针失败本身就是一种结论，由 probeKeychain 报告
  }
}

/** 小组件调用：报告自己读不读得到。 */
export function probeKeychain(): boolean {
  try {
    return Keychain.get(KEYCHAIN_PROBE_KEY) === KEYCHAIN_PROBE_VALUE
  } catch {
    return false
  }
}

// ---------- 小组件诊断 ----------

/**
 * 小组件每次渲染写一行，主 App 的诊断页读它。
 *
 * 小组件进程里 console.log 看不到，出了问题只能靠这个文件反推：它到底跑没跑、
 * 跑的时候读到了几个账户、自刷新有没有真的发生。没有这个文件，「小组件不更新」
 * 只能靠猜。
 */
export interface WidgetDiag {
  renderedAt: number
  family: string
  accountsSeen: number
  selfRefreshed: boolean
  keychainReadable: boolean
  note?: string
}

const DIAG_FILE = "widget-diag.json"

function diagPath(): string {
  return Path.join(dataDir(), DIAG_FILE)
}

/** 同步版，给小组件用。写失败绝不能影响出图，所以整段吞掉。 */
export function writeWidgetDiagSync(diag: WidgetDiag): void {
  try {
    const dir = dataDir()
    if (!FileManager.existsSync(dir)) FileManager.createDirectorySync(dir, true)
    FileManager.writeAsStringSync(diagPath(), JSON.stringify(diag))
  } catch {
    // 诊断写失败不能影响小组件出图
  }
}

export async function readWidgetDiag(): Promise<WidgetDiag | null> {
  return await readJson<WidgetDiag | null>(diagPath(), null)
}
