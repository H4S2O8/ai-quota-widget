/**
 * Provider 注册表 —— 面板的可扩展点。
 *
 * ## 加一个服务商要做什么
 *
 * 1. 新建 `p_<名字>.ts`，导出一个 `Provider`（形状见 types.ts）。整个文件是纯
 *    函数：拿 config 进去，吐 Metric 出来，不碰 UI、不碰存储、不碰全局状态。
 * 2. 在下面的 PROVIDERS 数组里加一行。
 * 3. `script.json` 的 version 加一，推送。
 *
 * 不用改 UI：设置页按 `fields` 自动生成表单，小组件按 `Metric` 自动排版。
 *
 * ## 三条约定（都是被坑出来的）
 *
 * - **id 不能改。** 它写进了用户的配置文件，改了等于让已有账户失联。
 * - **拿不到数就抛错，不要返回 0。** 这个平台的失败是静默的，一个绿色的
 *   「余额 0」比一条红色的错误更贵——它看起来像正常工作。
 * - **靠推断解析的接口要调 ctx.captureRaw(text)。** 字段名猜错的唯一自救办法
 *   是在手机上直接看到原文。
 *
 * 只是接口形状不一样、不值得写代码的服务，用内置的「自定义 JSON 接口」配置即可。
 */
import { anthropicProvider } from "./p_anthropic"
import { deepseekProvider } from "./p_deepseek"
import { genericProvider } from "./p_generic"
import { moonshotProvider } from "./p_moonshot"
import { oneapiProvider } from "./p_oneapi"
import { openrouterProvider } from "./p_openrouter"
import { siliconflowProvider } from "./p_siliconflow"
import type { Provider } from "./types"

/** 顺序就是「添加账户」页面里的顺序。 */
export const PROVIDERS: Provider[] = [
  anthropicProvider,
  openrouterProvider,
  deepseekProvider,
  siliconflowProvider,
  moonshotProvider,
  oneapiProvider,
  genericProvider,
]

export function providerById(id: string): Provider | undefined {
  return PROVIDERS.find((p) => p.id === id)
}

/** 找不到 provider（配置来自更新版本、或 id 被改过）时用的占位，避免整页崩掉。 */
export function providerOrPlaceholder(id: string): Provider {
  return (
    providerById(id) ?? {
      id,
      name: `未知服务 (${id})`,
      icon: "questionmark.circle",
      color: "#8E8E93",
      help: "这个账户所属的服务商在当前版本里不存在。可能是脚本版本回退了。",
      fields: [],
      async fetch() {
        throw new Error(`没有名为 ${id} 的服务商`)
      },
    }
  )
}
