/**
 * 主 App：账户列表 / 添加 / 设置 / 诊断。
 *
 * 页面之间一律用 NavigationLink 推——不用 sheet、不用嵌套 present，因为那两条
 * 在这个平台上要么没用例，要么在已经全屏 present 的页面里会静默失败。
 */
import {
  Button,
  Group,
  HStack,
  Image,
  List,
  Navigation,
  NavigationLink,
  NavigationStack,
  Picker,
  Script,
  ScrollView,
  Section,
  Spacer,
  Stepper,
  Text,
  Toggle,
  VStack,
  Widget,
  useEffect,
  useMemo,
  useState,
} from "scripting"
import { AccountEditor } from "./editor"
import { PROVIDERS } from "./providers"
import { isStale, refreshAccounts } from "./refresh"
import {
  EMPTY_CONFIG,
  loadConfig,
  loadSnapshot,
  readWidgetDiag,
  saveConfig,
  saveSnapshot,
  seedKeychainProbe,
  snapshotPath,
  usingAppGroup,
} from "./store"
import { ACCENT, STATUS_COLOR } from "./theme"
import type { WidgetDiag } from "./store"
import type { Account, AppConfig, Snapshot } from "./types"
import { EMPTY_SNAPSHOT } from "./types"
import { Card, ProgressBar, SectionTitle, StatusPill } from "./ui"
import { fmtAgo, fmtClock } from "./util"
import { buildRows, summarize } from "./view"
import type { AccountRow, MetricRow } from "./view"

// ---------- 账户行 ----------

function MetricLine({ item }: { item: MetricRow }) {
  return (
    <VStack spacing={4} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>
      <HStack spacing={8}>
        <Text font={12} foregroundStyle="secondaryLabel">
          {item.metric.label}
        </Text>
        <Spacer />
        <Text
          font={15}
          fontWeight="semibold"
          monospacedDigit
          foregroundStyle={STATUS_COLOR[item.status]}
        >
          {item.primary}
        </Text>
        <Text font={11} foregroundStyle="tertiaryLabel">
          {item.detail}
        </Text>
      </HStack>
      {item.used !== undefined ? <ProgressBar used={item.used} status={item.status} /> : null}
      {item.metric.hint ? (
        <Text font={10} foregroundStyle="tertiaryLabel">
          {item.metric.hint}
        </Text>
      ) : null}
    </VStack>
  )
}

function AccountCard({
  row,
  timeoutSec,
  onChange,
  onDelete,
  onRefreshOne,
}: {
  row: AccountRow
  timeoutSec: number
  onChange: (account: Account) => void
  onDelete: () => void
  onRefreshOne: () => void
}) {
  const disabled = !row.account.enabled
  return (
    <VStack
      spacing={10}
      alignment="leading"
      frame={{ maxWidth: "infinity", alignment: "leading" }}
      opacity={disabled ? 0.45 : 1}
      trailingSwipeActions={{
        allowsFullSwipe: false,
        actions: [
          <Button title="删除" role="destructive" action={onDelete} />,
          <Button title="刷新" tint={ACCENT} action={onRefreshOne} />,
        ],
      }}
    >
      <NavigationLink
        destination={
          <AccountEditor initial={row.account} timeoutSec={timeoutSec} onChange={onChange} />
        }
      >
        <HStack spacing={8}>
          <Image systemName={row.icon} font={14} foregroundStyle={row.color} />
          <Text font={14} fontWeight="semibold" lineLimit={1}>
            {row.account.label}
          </Text>
          {row.plan ? (
            <Text font={10} foregroundStyle="tertiaryLabel">
              {row.plan}
            </Text>
          ) : null}
          <Spacer />
          {disabled ? (
            <Text font={11} foregroundStyle="tertiaryLabel">
              已停用
            </Text>
          ) : row.error ? (
            <StatusPill status="bad" text="抓取失败" />
          ) : (
            <Text font={11} foregroundStyle="tertiaryLabel">
              {fmtAgo(row.fetchedAt, Date.now())}
            </Text>
          )}
        </HStack>
      </NavigationLink>

      {row.metrics.map((item) => (
        <MetricLine key={item.metric.id} item={item} />
      ))}

      {row.error ? (
        <Text font={11} foregroundStyle={STATUS_COLOR.bad}>
          {row.error}
        </Text>
      ) : null}
      {row.note ? (
        <Text font={11} foregroundStyle="secondaryLabel">
          {row.note}
        </Text>
      ) : null}
      {row.metrics.length === 0 && !row.error ? (
        <Text font={11} foregroundStyle="tertiaryLabel">
          还没有数据，下拉刷新或进详情页试抓一次。
        </Text>
      ) : null}
    </VStack>
  )
}

// ---------- 添加账户 ----------

function AddAccountPage({
  timeoutSec,
  onCreate,
}: {
  timeoutSec: number
  onCreate: (account: Account) => void
}) {
  // 每个 provider 预先造好一个空账户：「选服务商」和「填凭据」是同一次导航里的
  // 两步，中间不需要任何弹窗。
  //
  // 草稿的 id 故意留空，由编辑页在挂载时现取一个。若在这里 newId()，同一次
  // 会话里连着加两个 OpenRouter 账户就会撞成同一个 id，第二个顶掉第一个。
  // 而想在这里换 id 就得让本页重渲染——那会连带重建 NavigationLink 的目标页，
  // 有把用户正在填的表单打回原形的风险。让编辑页自己取，两个问题一起没了。
  const drafts = useMemo(
    () =>
      PROVIDERS.map((provider) => ({
        provider,
        account: {
          id: "",
          providerId: provider.id,
          label: provider.name,
          enabled: true,
          config: {},
        } as Account,
      })),
    [],
  )

  return (
    <List navigationTitle="添加账户" navigationBarTitleDisplayMode="inline">
      <Section
        footer={
          <Text font={11}>
            找不到你用的服务？用「自定义 JSON 接口」填 URL 和字段路径就能接进来，不用改代码。
          </Text>
        }
      >
        {drafts.map(({ provider, account }) => (
          <NavigationLink
            key={provider.id}
            destination={
              <AccountEditor initial={account} timeoutSec={timeoutSec} onChange={onCreate} />
            }
          >
            <HStack spacing={10}>
              <Image systemName={provider.icon} font={15} foregroundStyle={provider.color} />
              <VStack spacing={2} alignment="leading">
                <Text font={14}>{provider.name}</Text>
                <Text font={11} foregroundStyle="tertiaryLabel" lineLimit={2}>
                  {provider.help}
                </Text>
              </VStack>
              <Spacer />
            </HStack>
          </NavigationLink>
        ))}
      </Section>
    </List>
  )
}

// ---------- 设置 ----------

function SettingsPage({
  config,
  onChange,
}: {
  config: AppConfig
  onChange: (config: AppConfig) => void
}) {
  const settings = config.settings
  function patch(next: Partial<typeof settings>) {
    onChange({ ...config, settings: { ...settings, ...next } })
  }

  return (
    <ScrollView navigationTitle="设置" navigationBarTitleDisplayMode="inline">
      <VStack spacing={14} padding={16}>
        <Card>
          <SectionTitle text="刷新" />
          <Stepper
            title={`刷新间隔：${settings.refreshMinutes} 分钟`}
            onIncrement={() => patch({ refreshMinutes: Math.min(720, settings.refreshMinutes + 5) })}
            onDecrement={() => patch({ refreshMinutes: Math.max(5, settings.refreshMinutes - 5) })}
          />
          <Text font={11} foregroundStyle="tertiaryLabel">
            这也是「数据算过期」的阈值。iOS 对小组件刷新有自己的配额，设得再短系统也不保证照做。
          </Text>

          <Picker
            title="点小组件时"
            value={settings.widgetTap}
            onChanged={(value: string) => patch({ widgetTap: value === "open" ? "open" : "refresh" })}
            pickerStyle="segmented"
          >
            <Text tag="open">打开脚本</Text>
            <Text tag="refresh">刷新额度</Text>
          </Picker>
          <Text font={11} foregroundStyle="tertiaryLabel">
            {settings.widgetTap === "open"
              ? "点小组件打开这个脚本（系统默认行为）。"
              : "整块小组件都是刷新按钮，点哪儿都会在后台重新抓一遍，不切 App。"}
          </Text>

          <Toggle
            title="小组件自行刷新"
            value={settings.widgetSelfRefresh}
            onChanged={(value) => patch({ widgetSelfRefresh: value })}
            tint={ACCENT}
          />
          <Text font={11} foregroundStyle="tertiaryLabel">
            小组件被系统唤起重画时，数据过期就自己联网抓一遍。iOS 对小组件的刷新
            配额有限且不保证，所以这条只是尽力而为，真正可靠的还是打开 App。
          </Text>

          <Toggle
            title="打开 App 时自动刷新"
            value={settings.autoRefreshOnOpen}
            onChanged={(value) => patch({ autoRefreshOnOpen: value })}
            tint={ACCENT}
          />
          <Text font={11} foregroundStyle="tertiaryLabel">
            数据超过上面那个间隔就在开 App 时抓一遍。小组件本身不联网（它必须同步渲染），
            所以刷新时机就两个：打开 App，或者点小组件上的刷新按钮。
          </Text>

          <Stepper
            title={`请求超时：${settings.timeoutSec} 秒`}
            onIncrement={() => patch({ timeoutSec: Math.min(60, settings.timeoutSec + 5) })}
            onDecrement={() => patch({ timeoutSec: Math.max(5, settings.timeoutSec - 5) })}
          />
        </Card>

        <Card>
          <SectionTitle text="显示口径" />
          <Text font={11} foregroundStyle="secondaryLabel">
            服务商给的额度一半是增长式（Claude 的「已用 42%」），一半是扣除式
            （DeepSeek 的「余额 ¥12.5」）。混在一屏里没法扫，所以这里统一成同一个口径。
          </Text>
          <Picker
            title="主数值显示"
            value={settings.displayMode}
            onChanged={(value: string) => patch({ displayMode: value === "used" ? "used" : "remaining" })}
            pickerStyle="segmented"
          >
            <Text tag="remaining">还剩多少</Text>
            <Text tag="used">用了多少</Text>
          </Picker>
          <Text font={11} foregroundStyle="tertiaryLabel">
            {settings.displayMode === "used"
              ? "大数字代表已经花掉的量，越大越紧张。"
              : "大数字一律代表宽裕：已用 42% 会显示成剩 58%，和余额并排读方向一致。"}
          </Text>
        </Card>

        <Card>
          <SectionTitle text="凭据存在哪" />
          <Text font={11} foregroundStyle="secondaryLabel">
            凭据和配置一起存在 App Group 容器里的 config.json。这个目录在「文件」App 里看不到，
            别的 App 也读不到，但它不是 Keychain。这么选是因为小组件跑在独立进程里，
            Keychain 在那边读不读得到没有文档用例——诊断页的探针就是去验这件事的。
          </Text>
        </Card>
      </VStack>
    </ScrollView>
  )
}

// ---------- 诊断 ----------

function DiagnosticsPage({ snapshot, rows }: { snapshot: Snapshot; rows: AccountRow[] }) {
  const [diag, setDiag] = useState<WidgetDiag | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    void readWidgetDiag().then((value) => {
      setDiag(value)
      setLoaded(true)
    })
  }, [])

  return (
    <ScrollView navigationTitle="诊断" navigationBarTitleDisplayMode="inline">
      <VStack spacing={14} padding={16}>
        <Card>
          <SectionTitle text="版本" />
          <KeyValue label="当前版本" value={Script.metadata?.version ?? "未知"} />
          <KeyValue label="脚本名" value={Script.name} />
          <Text font={11} foregroundStyle="tertiaryLabel">
            自动更新到没到，看这里。远程更新是按 script.json 的 version 生效的，
            版本号没变就说明还是旧代码。
          </Text>
        </Card>

        <Card>
          <SectionTitle text="存储" />
          <KeyValue label="App Group 目录" value={usingAppGroup() ? "可用" : "不可用（小组件读不到数据）"} />
          <KeyValue label="快照路径" value={snapshotPath()} mono />
          <KeyValue label="快照更新于" value={snapshot.updatedAt ? fmtClock(snapshot.updatedAt) : "从未"} />
        </Card>

        <Card>
          <SectionTitle text="小组件上次渲染" />
          {!loaded ? (
            <Text font={12} foregroundStyle="secondaryLabel">
              读取中…
            </Text>
          ) : diag ? (
            <Group>
              <KeyValue label="时间" value={fmtClock(diag.renderedAt)} />
              <KeyValue label="尺寸" value={diag.family} />
              <KeyValue label="读到账户" value={`${diag.accountsSeen} 个`} />
              <KeyValue label="自行刷新" value={diag.selfRefreshed ? "是" : "否（数据未过期或已关闭）"} />
              <KeyValue label="能读 Keychain" value={diag.keychainReadable ? "是" : "否"} />
              {diag.note ? <KeyValue label="备注" value={diag.note} /> : null}
            </Group>
          ) : (
            <Text font={12} foregroundStyle="secondaryLabel">
              还没有记录。把小组件加到桌面并等它渲染一次，这里就会有数据。
            </Text>
          )}
          <Text font={11} foregroundStyle="tertiaryLabel">
            小组件一片漆黑时：长按小组件 → 编辑小组件 → Parameter 填 min。
            那会只渲染一行纯文本——还黑说明问题在加载阶段（导入或环境），
            能显示说明视图树里有 WidgetKit 不支持的东西。这是唯一能二分的办法。
          </Text>
          <Text font={11} foregroundStyle="tertiaryLabel">
            小组件进程里的 console.log 看不到，「它到底跑没跑」只能靠这条记录反推。
            「能读 Keychain」那一行是为了将来把凭据搬进 Keychain 攒证据用的。
          </Text>
        </Card>

        {rows
          .filter((row) => row.raw)
          .map((row) => (
            <Card key={row.account.id}>
              <SectionTitle text={`原始响应 · ${row.account.label}`} />
              <Text font={10} fontDesign="monospaced" foregroundStyle="secondaryLabel">
                {row.raw ?? ""}
              </Text>
            </Card>
          ))}
      </VStack>
    </ScrollView>
  )
}

function KeyValue({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <HStack spacing={8} frame={{ maxWidth: "infinity", alignment: "leading" }}>
      <Text font={12} foregroundStyle="secondaryLabel">
        {label}
      </Text>
      <Spacer />
      <Text
        font={mono ? 10 : 12}
        fontDesign={mono ? "monospaced" : "default"}
        lineLimit={3}
        multilineTextAlignment="trailing"
      >
        {value}
      </Text>
    </HStack>
  )
}

// ---------- 主页面 ----------

function MainView() {
  const [config, setConfig] = useState<AppConfig>(EMPTY_CONFIG)
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY_SNAPSHOT)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")

  useEffect(() => {
    void (async () => {
      const [loadedConfig, loadedSnapshot] = await Promise.all([loadConfig(), loadSnapshot()])
      setConfig(loadedConfig)
      setSnapshot(loadedSnapshot)
      setReady(true)
      // 主 App 每次启动埋一次 Keychain 探针，供小组件下次渲染时回答。
      seedKeychainProbe()

      // 小组件不能自己联网了（见 widget.tsx 顶部），所以打开 App 就是最主要的
      // 刷新时机。数据还新鲜就不打扰服务商。
      if (
        loadedConfig.settings.autoRefreshOnOpen &&
        loadedConfig.accounts.some((a) => a.enabled) &&
        isStale(loadedSnapshot, loadedConfig.settings.refreshMinutes)
      ) {
        void refreshWith(loadedConfig, loadedSnapshot)
      }
    })()
  }, [])

  /**
   * 配置落盘。输入框每敲一个字都会调它，所以用 setTimeout 合并——
   * 注意是 setTimeout 不是 setInterval：这个平台只保证前者。
   */
  const saveTimer = useMemo(() => ({ id: undefined as number | undefined }), [])
  function commitConfig(next: AppConfig) {
    setConfig(next)
    if (saveTimer.id !== undefined) clearTimeout(saveTimer.id)
    saveTimer.id = setTimeout(() => {
      void saveConfig(next).then(() => Widget.reloadAll())
    }, 400) as unknown as number
  }

  function upsertAccount(account: Account) {
    const accounts = config.accounts.some((a) => a.id === account.id)
      ? config.accounts.map((a) => (a.id === account.id ? account : a))
      : [...config.accounts, account]
    commitConfig({ ...config, accounts })
  }

  function deleteAccount(id: string) {
    const states = { ...snapshot.states }
    delete states[id]
    const nextSnapshot = { ...snapshot, states }
    setSnapshot(nextSnapshot)
    void saveSnapshot(nextSnapshot)
    commitConfig({ ...config, accounts: config.accounts.filter((a) => a.id !== id) })
  }

  /**
   * 显式传 config / snapshot 的版本。
   *
   * 启动时的自动刷新必须用它：那时组件里的 config 还是空的（useEffect 刚把
   * 读到的值 setState 进去，这一轮渲染的闭包里拿不到），用 refresh() 会拿空配置
   * 去抓，什么都抓不到。
   */
  async function refreshWith(cfg: AppConfig, snap: Snapshot, accounts?: Account[]) {
    setBusy(true)
    setMessage("正在刷新…")
    try {
      const outcome = await refreshAccounts(cfg, snap, accounts)
      setSnapshot(outcome.snapshot)
      await saveSnapshot(outcome.snapshot)

      // provider 在抓取过程中要求写回的凭据（例如刷新过的 token）
      const patches = Object.keys(outcome.configPatches)
      if (patches.length > 0) {
        commitConfig({
          ...cfg,
          accounts: cfg.accounts.map((a) =>
            outcome.configPatches[a.id]
              ? { ...a, config: { ...a.config, ...outcome.configPatches[a.id] } }
              : a,
          ),
        })
      }

      Widget.reloadAll()
      setMessage(
        outcome.failCount > 0
          ? `${outcome.okCount} 个成功，${outcome.failCount} 个失败`
          : `全部成功 · ${fmtClock(Date.now())}`,
      )
    } catch (error) {
      setMessage(`刷新出错：${String(error)}`)
    } finally {
      setBusy(false)
    }
  }

  function refresh(accounts?: Account[]) {
    if (busy) return
    void refreshWith(config, snapshot, accounts)
  }

  const rows = buildRows(config, snapshot)
  const totals = summarize(rows)

  return (
    <NavigationStack>
      <List
        navigationTitle="AI 额度"
        refreshable={async () => {
          refresh()
        }}
        toolbar={{
          // 工具栏里只放 Button —— NavigationLink 放进 toolbar 文档里没有用例，
          // 而这个平台不支持的写法是静默失效的。导航入口都做成列表行。
          topBarTrailing: (
            <Button
              title="刷新"
              systemImage="arrow.clockwise"
              action={() => refresh()}
              disabled={busy || config.accounts.length === 0}
            />
          ),
        }}
      >
        <Section>
          <HStack spacing={12}>
            <StatusPill status="good" text={`${totals.good} 正常`} />
            <StatusPill status="warn" text={`${totals.warn} 偏紧`} />
            <StatusPill status="bad" text={`${totals.bad + totals.failed} 告警`} />
            <Spacer />
          </HStack>
          <HStack spacing={10}>
            <Button
              title={busy ? "刷新中…" : "全部刷新"}
              systemImage="arrow.clockwise"
              action={() => refresh()}
              buttonStyle="borderedProminent"
              controlSize="small"
              tint={ACCENT}
              disabled={busy || config.accounts.length === 0}
            />
            <Text font={11} foregroundStyle="tertiaryLabel" lineLimit={1}>
              {message || (snapshot.updatedAt ? `更新于 ${fmtAgo(snapshot.updatedAt, Date.now())}` : "尚未抓取")}
            </Text>
            <Spacer />
          </HStack>
        </Section>

        {rows.length === 0 ? (
          <Section>
            <VStack spacing={8} padding={20} frame={{ maxWidth: "infinity" }}>
              <Image systemName="tray" font={26} foregroundStyle="secondaryLabel" />
              <Text font={14} foregroundStyle="secondaryLabel">
                {ready ? "还没有账户" : "读取配置中…"}
              </Text>
              <Text font={11} foregroundStyle="tertiaryLabel" multilineTextAlignment="center">
                往下滑，点「添加账户」。加完之后把「AI 额度」小组件放到桌面。
              </Text>
            </VStack>
          </Section>
        ) : (
          <Section header={<Text>账户</Text>}>
            {rows.map((row) => (
              <AccountCard
                key={row.account.id}
                row={row}
                timeoutSec={config.settings.timeoutSec}
                onChange={upsertAccount}
                onDelete={() => deleteAccount(row.account.id)}
                onRefreshOne={() => refresh([row.account])}
              />
            ))}
          </Section>
        )}

        <Section
          footer={
            <Text font={11}>
              加服务商：新建 p_xxx.ts 导出一个 Provider，在 providers.ts 里登记一行。
              界面会按它的 fields 自动长出表单，小组件不用改。
            </Text>
          }
        >
          <NavigationLink
            destination={
              <AddAccountPage timeoutSec={config.settings.timeoutSec} onCreate={upsertAccount} />
            }
          >
            <HStack spacing={10}>
              <Image systemName="plus.circle.fill" font={14} foregroundStyle={ACCENT} />
              <Text font={14}>添加账户</Text>
              <Spacer />
              <Text font={11} foregroundStyle="tertiaryLabel">
                {PROVIDERS.length} 个内置服务商
              </Text>
            </HStack>
          </NavigationLink>

          <NavigationLink destination={<SettingsPage config={config} onChange={commitConfig} />}>
            <HStack spacing={10}>
              <Image systemName="gearshape" font={14} foregroundStyle="secondaryLabel" />
              <Text font={14}>设置</Text>
              <Spacer />
              <Text font={11} foregroundStyle="tertiaryLabel">
                每 {config.settings.refreshMinutes} 分钟
              </Text>
            </HStack>
          </NavigationLink>

          <NavigationLink destination={<DiagnosticsPage snapshot={snapshot} rows={rows} />}>
            <HStack spacing={10}>
              <Image systemName="stethoscope" font={14} foregroundStyle="secondaryLabel" />
              <Text font={14}>诊断</Text>
              <Spacer />
              <Text font={11} foregroundStyle="tertiaryLabel">
                v{Script.metadata?.version ?? "?"} · 原始响应
              </Text>
            </HStack>
          </NavigationLink>
        </Section>
      </List>
    </NavigationStack>
  )
}

/**
 * 被小组件的 link 模式拉起来时，只刷新，不开界面。
 *
 * 小组件的「点击=刷新」有三种实现，link 那种是打开
 * `scripting://run_single/<脚本名>?action=refresh`。走到这里说明用户点的是小组件，
 * 他要的是新数字，不是这个 App 的界面——抓完、让小组件重画、立刻退出。
 */
async function runRefreshOnly() {
  try {
    const config = await loadConfig()
    const snapshot = await loadSnapshot()
    const outcome = await refreshAccounts(config, snapshot)
    await saveSnapshot(outcome.snapshot)
  } catch {
    // 静默失败也比把用户丢进一个他没想打开的界面强；下次点还会再试
  }
  Widget.reloadAll()
  Script.exit()
}

async function run() {
  if (Script.queryParameters?.action === "refresh") {
    await runRefreshOnly()
    return
  }
  Script.enableMinimize()
  await Navigation.present({ element: <MainView /> })
  Script.exit()
}

run()
