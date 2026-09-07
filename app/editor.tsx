/**
 * 账户详情页：改凭据、单账户试抓、看原始响应。
 *
 * 「试抓」是这个页面存在的主要理由。这个平台的失败是静默的，服务商的接口又
 * 随时可能改字段；不给一个「现在就抓一次，把结果和原文摆出来」的按钮，用户
 * 只能盯着小组件上一个不动的数字猜。
 *
 * 页面是**随改随存**的：没有保存按钮，改动立刻回调给上层。这样就不需要在
 * NavigationLink 推出来的页面里做「保存并返回」——那要用 Navigation.useDismiss，
 * 而它在 push 出来的页面上是什么行为，文档里没有用例。删除放在主列表的左滑里，
 * 同样是为了不在这一页做「删完再退回去」。
 */
import {
  Button,
  Group,
  HStack,
  Image,
  ScrollView,
  SecureField,
  Spacer,
  Text,
  TextField,
  Toggle,
  VStack,
  useMemo,
  useState,
} from "scripting"
import { providerOrPlaceholder } from "./providers"
import type { Account, Provider, ProviderResult } from "./types"
import { ACCENT, STATUS_COLOR } from "./theme"
import { Card, FieldLabel, SectionTitle, Well } from "./ui"
import {
  copyToClipboard,
  credentialFor,
  errorMessage,
  extractCredentials,
  readClipboard,
  fmtMetricDetail,
  fmtMetricValue,
  newId,
  statusOf,
} from "./util"
// 试抓预览用默认口径（剩余）——这一页是验接口通不通，不跟随面板设置

/** 原始响应保留多少字符。够看完一个 Cloudflare 验证页的头部。 */
const RAW_KEEP = 20000

export function AccountEditor({
  initial,
  timeoutSec,
  retryAfter,
  onChange,
}: {
  initial: Account
  timeoutSec: number
  /** 被服务器限流到什么时候。在此之前「现在抓取」也不该发请求。 */
  retryAfter?: number
  onChange: (account: Account) => void
}) {
  // 显式标注类型不是多余的：`useMemo` 来自 "scripting"，在类型检查里是 any，
  // 不标注的话 provider 也变成 any，`provider.fetch(...)` 的参数就完全不受检查。
  // 「给 FetchContext 加了必填字段却漏改这里」正是这么溜过去的。
  const provider: Provider = useMemo(
    () => providerOrPlaceholder(initial.providerId),
    [initial.providerId],
  )

  // id 为空表示这是「添加账户」页递过来的草稿：现在挂载了，才给它一个 id。
  // 惰性初始化（传函数）是文档里 ProgressView 示例用过的写法。
  const [account, setAccount]: [Account, (v: Account) => void] = useState(() =>
    initial.id ? initial : { ...initial, id: newId() },
  )
  const [warnText, setWarnText] = useState(
    initial.warnBelow === undefined ? "" : String(initial.warnBelow),
  )
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState(provider.help)
  const [preview, setPreview]: [ProviderResult | null, (v: ProviderResult | null) => void] =
    useState(null as ProviderResult | null)
  const [raw, setRaw] = useState("")
  const [copied, setCopied] = useState("")

  /** 一处改，一处存。所有输入都经过它。 */
  function patch(next: Partial<Account>) {
    const merged = { ...account, ...next }
    setAccount(merged)
    onChange(merged)
  }

  function setField(key: string, value: string) {
    patch({ config: { ...account.config, [key]: value } })
  }

  function warnValue(): number | undefined {
    const parsed = Number(warnText.trim())
    return warnText.trim() && Number.isFinite(parsed) ? parsed : undefined
  }

  /**
   * 从剪贴板里的一段 JSON 认出凭据并填进对应的格子。
   *
   * 这是为「refresh token 被电脑上的 CLI 轮换掉之后要重新同步」准备的。
   * 如果重同步意味着在手机上手打三个长字符串，那这条路实际上就是不可用的。
   */
  function pasteCredentials() {
    const text = readClipboard().trim()
    if (!text) {
      setStatus("剪贴板是空的。先在电脑上运行取凭据的脚本。")
      return
    }
    const found = extractCredentials(text)
    if (Object.keys(found).length === 0) {
      setStatus("剪贴板里不是能识别的 JSON。请复制凭据文件的**整段内容**。")
      return
    }
    const next = { ...account.config }
    const filled: string[] = []
    for (const field of provider.fields) {
      const value = credentialFor(field.key, found)
      if (value && value !== next[field.key]) {
        next[field.key] = value
        filled.push(field.label)
      }
    }
    if (filled.length === 0) {
      setStatus(`认出了 ${Object.keys(found).length} 个字段，但没有一个对得上这个服务商需要的。`)
      return
    }
    patch({ config: next })
    setStatus(`已填入：${filled.join("、")}。可以点「现在抓取」验证了。`)
  }

  async function test() {
    // 之前这里在限流期间**直接拒绝**手动抓取。那是矫枉过正：退避的意义是拦住
    // 自动重试，不是把人锁在自己的工具外面。改成提示，让人自己决定要不要试。
    if (retryAfter !== undefined && retryAfter > Date.now()) {
      const mins = Math.max(1, Math.ceil((retryAfter - Date.now()) / 60000))
      setStatus(
        `注意：服务器上一次要求等约 ${mins} 分钟。现在试大概率还是 429，` +
          `而且可能把窗口顶得更长。仍然为你发出这一次请求。`,
      )
    }
    setBusy(true)
    setStatus("正在请求…")
    setPreview(null)
    let captured = ""
    let rateLimitedFor: number | undefined
    try {
      const result = await provider.fetch(account.config, {
        timeoutSec,
        updateConfig: (next) => patch({ config: { ...account.config, ...next } }),
        captureRaw: (text) => {
          captured = text
        },
        // 手动点的这一次**永远允许换 token**。
        //
        // 退避是用来拦住「自动重试」的：小组件每次渲染都来一遍才危险。人点一下
        // 按钮是一次有限的、明确的动作，而且他多半刚换过凭据——正是最该放行的时候。
        // 之前这里漏传，取到 undefined 当假值，于是每一次手动抓取都报「退避中」，
        // 填了新 token 也没用。
        allowTokenRefresh: true,
        onTokenRefreshFailed: () => {},
        onRateLimited: (seconds) => {
          rateLimitedFor = seconds
        },
      })
      setPreview(result)
      setStatus(`成功，拿到 ${result.metrics.length} 项指标。`)
    } catch (error) {
      setStatus(`失败：${errorMessage(error)}`)
    } finally {
      // 成功也要留原文：字段解析对不对，只有对着原文才看得出来。
      if (captured) {
        // 留得比之前宽得多：截断过的原始响应经常正好把关键那段切掉，
        // 而这一页存在的全部意义就是让人看到接口到底返回了什么。
        setRaw(captured.length > RAW_KEEP ? `${captured.slice(0, RAW_KEEP)}\n…（已截断）` : captured)
      }
      if (rateLimitedFor !== undefined) {
        // 直接拼字符串，不用 setState 的函数式更新 —— 那个写法在这个平台上
        // 没有用例，而这里完全不需要它。
        setStatus(`被限流，服务器要求等约 ${Math.ceil(rateLimitedFor / 60)} 分钟再试。`)
      }
      setBusy(false)
    }
  }

  return (
    <ScrollView
      navigationTitle={account.label || provider.name}
      navigationBarTitleDisplayMode="inline"
    >
      <VStack spacing={14} padding={16}>
        <Card>
          <HStack spacing={8}>
            <Image systemName={provider.icon} font={16} foregroundStyle={provider.color} />
            <Text font={15} fontWeight="semibold">
              {provider.name}
            </Text>
            <Spacer />
            <Toggle
              title="启用"
              value={account.enabled}
              onChanged={(value) => patch({ enabled: value })}
              tint={ACCENT}
              labelsHidden
            />
          </HStack>
          <Text font={11} foregroundStyle="secondaryLabel">
            {provider.help}
          </Text>

          <FieldLabel text="显示名称" hint="小组件上显示的就是它" />
          <Well>
            <TextField
              title="显示名称"
              value={account.label}
              onChanged={(value) => patch({ label: value })}
              prompt={provider.name}
              labelsHidden
            />
          </Well>
        </Card>

        {provider.fields.length > 0 ? (
          <Card>
            <SectionTitle
              text="凭据与参数"
              trailing={
                <Button
                  title="粘贴凭据"
                  systemImage="doc.on.clipboard"
                  controlSize="small"
                  action={pasteCredentials}
                />
              }
            />
            <Text font={11} foregroundStyle="tertiaryLabel">
              在电脑上把凭据文件整段复制过来，点「粘贴凭据」自动填进下面的格子——
              不用手打。带轮换的 token 被电脑那边换掉之后，重来一次即可。
            </Text>
            {provider.fields.map((field) => (
              <Group key={field.key}>
                <FieldLabel
                  text={field.label}
                  hint={field.required ? (account.config[field.key] ? "已填" : "必填") : "可选"}
                />
                <Well>
                  {field.secret ? (
                    <SecureField
                      title={field.label}
                      value={account.config[field.key] ?? ""}
                      onChanged={(value) => setField(field.key, value)}
                      prompt={field.placeholder}
                      labelsHidden
                    />
                  ) : (
                    <TextField
                      title={field.label}
                      value={account.config[field.key] ?? ""}
                      onChanged={(value) => setField(field.key, value)}
                      prompt={field.placeholder}
                      axis={field.multiline ? "vertical" : "horizontal"}
                      lineLimit={field.multiline ? 5 : 1}
                      autocorrectionDisabled
                      labelsHidden
                    />
                  )}
                </Well>
                {field.help ? (
                  <Text font={11} foregroundStyle="tertiaryLabel">
                    {field.help}
                  </Text>
                ) : null}
              </Group>
            ))}
          </Card>
        ) : null}

        <Card>
          <SectionTitle text="告警阈值" />
          <Text font={11} foregroundStyle="secondaryLabel">
            余额低于这个数标红，两倍以内标黄。接口给了总额的服务商会自己算比例，不用填。
          </Text>
          <Well>
            <TextField
              title="告警阈值"
              value={warnText}
              onChanged={(value) => {
                setWarnText(value)
                const parsed = Number(value.trim())
                patch({
                  warnBelow: value.trim() && Number.isFinite(parsed) ? parsed : undefined,
                })
              }}
              prompt="例如 10"
              keyboardType="decimalPad"
              labelsHidden
            />
          </Well>
        </Card>

        <Card>
          <SectionTitle
            text="试抓一次"
            trailing={
              <Button
                title="复制"
                systemImage="doc.on.doc"
                controlSize="small"
                action={() => {
                  const ok = copyToClipboard(
                    [`账户：${account.label}（${provider.name}）`, "", status, "", raw].join("\n"),
                  )
                  setCopied(ok ? "已复制状态与原始响应" : "复制失败")
                }}
              />
            }
          />
          <Text font={11} foregroundStyle="secondaryLabel">
            {status}
          </Text>
          {copied ? (
            <Text font={10} foregroundStyle="tertiaryLabel">
              {copied}
            </Text>
          ) : null}
          <HStack spacing={10}>
            <Button
              title={busy ? "请求中…" : "现在抓取"}
              systemImage="arrow.down.circle"
              action={() => {
                if (!busy) void test()
              }}
              buttonStyle="borderedProminent"
              controlSize="small"
              tint={ACCENT}
              disabled={busy}
            />
            <Spacer />
          </HStack>

          {preview
            ? preview.metrics.map((metric) => (
                <HStack key={metric.id} spacing={8}>
                  <Text font={12} foregroundStyle="secondaryLabel">
                    {metric.label}
                  </Text>
                  <Spacer />
                  <Text
                    font={13}
                    fontWeight="semibold"
                    monospacedDigit
                    foregroundStyle={STATUS_COLOR[statusOf(metric, warnValue())]}
                  >
                    {fmtMetricValue(metric)}
                  </Text>
                  <Text font={11} foregroundStyle="tertiaryLabel">
                    {fmtMetricDetail(metric, Date.now())}
                  </Text>
                </HStack>
              ))
            : null}
        </Card>

        {raw ? (
          <Card>
            <SectionTitle
              text="原始响应"
              trailing={
                <Button
                  title="复制"
                  systemImage="doc.on.doc"
                  controlSize="small"
                  action={() => setCopied(copyToClipboard(raw) ? "已复制原始响应" : "复制失败")}
                />
              }
            />
            <Text font={10} foregroundStyle="tertiaryLabel">
              {raw.length} 字符{raw.length >= RAW_KEEP ? "（已截断）" : ""}
            </Text>
            <Text font={10} fontDesign="monospaced" foregroundStyle="secondaryLabel">
              {raw}
            </Text>
          </Card>
        ) : null}

        <Text font={11} foregroundStyle="tertiaryLabel">
          改动已自动保存。删除账户请回到列表，在那一行上左滑。
        </Text>
      </VStack>
    </ScrollView>
  )
}
