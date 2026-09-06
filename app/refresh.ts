/**
 * 抓取编排：并发跑各账户的 provider.fetch，把结果写进快照。
 *
 * 主 App 和小组件共用这一份，所以它不引用任何 UI，也不假设自己跑在哪个进程里。
 *
 * 两条设计取舍：
 *
 * - **一个账户失败不影响别的**，而且失败时保留上一次成功的结果。额度面板的用途
 *   是「扫一眼还剩多少」，某个 token 过期了不该把整块面板清空——旧数据配上
 *   「几小时前」的时间戳，比一片空白有用。
 * - **并发但有上限**。小组件进程的时间和内存都紧，一次开十几个请求容易触到墙。
 */
import { providerOrPlaceholder } from "./providers"
import type { Account, AccountState, AppConfig, Snapshot } from "./types"
import { errorMessage } from "./util"

/** 原始响应留多少字符。够看清结构，又不至于把快照撑大。 */
const RAW_LIMIT = 4000
const MAX_CONCURRENT = 4

export interface RefreshOutcome {
  snapshot: Snapshot
  /** provider 在抓取过程中要求写回的配置补丁，按账户 id 归集 */
  configPatches: Record<string, Record<string, string>>
  okCount: number
  failCount: number
}

export async function refreshAccounts(
  config: AppConfig,
  previous: Snapshot,
  accounts?: Account[],
): Promise<RefreshOutcome> {
  const targets = (accounts ?? config.accounts).filter((a) => a.enabled)
  const states: Record<string, AccountState> = { ...previous.states }
  const configPatches: Record<string, Record<string, string>> = {}
  let okCount = 0
  let failCount = 0

  // 分批而不是 Promise.all 全开：见文件头。
  for (let start = 0; start < targets.length; start += MAX_CONCURRENT) {
    const batch = targets.slice(start, start + MAX_CONCURRENT)
    const results = await Promise.all(
      batch.map((account) => fetchOne(account, config, states[account.id])),
    )
    for (let i = 0; i < batch.length; i++) {
      const { state, patch } = results[i]
      states[batch[i].id] = state
      if (patch) configPatches[batch[i].id] = patch
      if (state.ok) okCount++
      else failCount++
    }
  }

  return {
    snapshot: { updatedAt: Date.now(), states },
    configPatches,
    okCount,
    failCount,
  }
}

async function fetchOne(
  account: Account,
  config: AppConfig,
  previous: AccountState | undefined,
): Promise<{ state: AccountState; patch?: Record<string, string> }> {
  const provider = providerOrPlaceholder(account.providerId)
  let patch: Record<string, string> | undefined
  let raw: string | undefined

  try {
    const result = await provider.fetch(account.config, {
      timeoutSec: config.settings.timeoutSec,
      updateConfig: (next) => {
        patch = { ...(patch ?? {}), ...next }
      },
      captureRaw: (text) => {
        raw = text.length > RAW_LIMIT ? `${text.slice(0, RAW_LIMIT)}\n…（已截断）` : text
      },
    })
    return {
      state: {
        ok: true,
        fetchedAt: Date.now(),
        result,
        raw: raw ?? previous?.raw,
        // 成功后清掉错误，但保留它发生的时间没有意义，一并清掉
        error: undefined,
        errorAt: undefined,
      },
      patch,
    }
  } catch (error) {
    return {
      state: {
        ok: false,
        // 保留上一次成功的时间和结果：面板要能继续显示旧值
        fetchedAt: previous?.fetchedAt ?? 0,
        result: previous?.result,
        raw: raw ?? previous?.raw,
        error: errorMessage(error),
        errorAt: Date.now(),
      },
      patch,
    }
  }
}

/** 快照是不是该刷新了 */
export function isStale(snapshot: Snapshot, refreshMinutes: number, now = Date.now()): boolean {
  if (!snapshot.updatedAt) return true
  return now - snapshot.updatedAt >= refreshMinutes * 60000
}
