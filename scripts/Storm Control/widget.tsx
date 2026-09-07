import { HStack, Spacer, Text, VStack, Widget } from "scripting"
import { api, isConfigured } from "./api"
import type { StatusResp } from "./api"

function Body({ s, err }: { s: StatusResp | null; err: string }) {
  if (err) {
    return (
      <VStack padding={10}>
        <Text font="caption" foregroundStyle="systemRed">住宅代理</Text>
        <Text font="caption2" foregroundStyle="secondaryLabel">{err}</Text>
      </VStack>
    )
  }
  const t = s?.tunnel ?? null
  const running = s?.service === "active"
  const left = t?.hours_left
  return (
    <VStack padding={10} spacing={2}>
      <HStack>
        <Text font="caption" foregroundStyle={running ? "systemGreen" : "secondaryLabel"}>
          {running ? "● 运行中" : "○ 已停止"}
        </Text>
        <Spacer />
      </HStack>
      <Text font="headline">{t?.ip ?? "无隧道"}</Text>
      <Text font="caption2" foregroundStyle="secondaryLabel">
        {t ? [t.country, t.city].filter(Boolean).join(" / ") || "未知地区" : "—"}
      </Text>
      <Spacer />
      <Text font="caption2"
        foregroundStyle={left != null && left <= 2 ? "systemOrange" : "secondaryLabel"}>
        {left == null ? "有效期未知"
          : left <= 0 ? "已过期，需重新提取"
          : "剩 " + left.toFixed(1) + " 小时"}
      </Text>
    </VStack>
  )
}

async function main() {
  if (!isConfigured()) {
    Widget.present(<Body s={null} err="未配置，请先在主程序里设置" />)
    return
  }
  try {
    const s = await api.status()
    Widget.present(<Body s={s} err="" />)
  } catch (e: any) {
    Widget.present(<Body s={null} err={String(e?.message ?? e).slice(0, 60)} />)
  }
}

main()
