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
import type { Account, ProviderResult } from "./types"
import { ACCENT, STATUS_COLOR } from "./theme"
import { Card, FieldLabel, SectionTitle, Well } from "./ui"
import { errorMessage, fmtMetricDetail, fmtMetricValue, newId, statusOf } from "./util"

export function AccountEditor({
  initial,
  timeoutSec,
  onChange,
}: {
  initial: Account
  timeoutSec: number
  onChange: (account: Account) => void
}) {
  const provider = useMemo(() => providerOrPlaceholder(initial.providerId), [initial.providerId])

  // id 为空表示这是「添加账户」页递过来的草稿：现在挂载了，才给它一个 id。
  // 惰性初始化（传函数）是文档里 ProgressView 示例用过的写法。
  const [account, setAccount] = useState<Account>(() =>
    initial.id ? initial : { ...initial, id: newId() },
  )
  const [warnText, setWarnText] = useState(
    initial.warnBelow === undefined ? "" : String(initial.warnBelow),
  )
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState(provider.help)
  const [preview, setPreview] = useState<ProviderResult | null>(null)
  const [raw, setRaw] = useState("")

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

  async function test() {
    setBusy(true)
    setStatus("正在请求…")
    setPreview(null)
    let captured = ""
    try {
      const result = await provider.fetch(account.config, {
        timeoutSec,
        updateConfig: (next) => patch({ config: { ...account.config, ...next } }),
        captureRaw: (text) => {
          captured = text
        },
      })
      setPreview(result)
      setStatus(`成功，拿到 ${result.metrics.length} 项指标。`)
    } catch (error) {
      setStatus(`失败：${errorMessage(error)}`)
    } finally {
      // 成功也要留原文：字段解析对不对，只有对着原文才看得出来。
      if (captured) {
        setRaw(captured.length > 4000 ? `${captured.slice(0, 4000)}\n…（已截断）` : captured)
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
            <SectionTitle text="凭据与参数" />
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
          <SectionTitle text="试抓一次" />
          <Text font={11} foregroundStyle="secondaryLabel">
            {status}
          </Text>
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
            <SectionTitle text="原始响应" />
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
