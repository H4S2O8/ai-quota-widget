// 枚举探针：把设备上「实际存在什么」列出来，而不是继续猜。
// 只用已证实可用的组件：Navigation / NavigationStack / List / Section / Text。
import * as S from "scripting"
import { List, Navigation, NavigationStack, Script, Section, Text } from "scripting"

function typeOf(v: any): string {
  if (v === undefined) return "undefined"
  if (v === null) return "null"
  return typeof v
}

function g(name: string): any {
  try { return (globalThis as any)[name] } catch { return undefined }
}

// 关心的候选名：模块导出 vs 全局
const CANDIDATES = [
  "Storage", "FileManager", "Dialog", "Navigation", "Widget", "Script",
  "Device", "Keychain", "Path", "Data", "fetch", "Notification",
  "AppIntentManager", "ProgressView", "TextField",
]

const modKeys: string[] = (() => {
  try { return Object.keys(S as any).sort() } catch { return ["<Object.keys 失败>"] }
})()

const rows = CANDIDATES.map(n => {
  const inMod = typeOf((S as any)[n])
  const inGlobal = typeOf(g(n))
  return { n, s: "模块:" + inMod + "  全局:" + inGlobal }
})

function ProbeView() {
  return (
    <NavigationStack>
      <List navigationTitle="API 枚举">
        <Section header={<Text>版本</Text>}>
          <Text font="footnote">{"script v" + Script.metadata.version}</Text>
          <Text font="footnote">{"模块导出数量: " + modKeys.length}</Text>
        </Section>

        <Section header={<Text>关键 API 是否存在</Text>}>
          {rows.map(r => (
            <Text key={r.n} font="footnote">{r.n + " → " + r.s}</Text>
          ))}
        </Section>

        <Section header={<Text>模块全部导出（按字母序）</Text>} footer={
          <Text font="footnote">
            把这两段截图发回来即可。持久化用哪个 API，看完这个列表就能定死。
          </Text>
        }>
          {modKeys.map(k => (
            <Text key={k} font="caption2">{k}</Text>
          ))}
        </Section>
      </List>
    </NavigationStack>
  )
}

async function run() {
  await Navigation.present({ element: <ProbeView /> })
  Script.exit()
}

run()
