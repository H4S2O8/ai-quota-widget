/**
 * 服务商的**显示元数据**：名字、图标、颜色。只有这些。
 *
 * 单独一个文件，是为了让小组件不必把十个 provider 的抓取逻辑一起拖进扩展进程。
 * 小组件要画一行「图标 + 名字」，不需要知道怎么发 HTTP 请求。
 *
 * 文档里写着小组件大约有 30MB 内存上限，超了会「渲染失败或显示为空白」——
 * 而空白正是我们在真机上反复遇到的症状。导入图能小就小。
 *
 * `providers.ts` 从这里取元数据挂到 Provider 上，所以名字和图标只有一份定义。
 */
export interface ProviderMeta {
  name: string
  icon: string
  color: string
}

export const PROVIDER_META: Record<string, ProviderMeta> = {
  anthropic: { name: "Claude 订阅", icon: "sparkle", color: "#D97757" },
  openrouter: { name: "OpenRouter", icon: "arrow.triangle.branch", color: "#6467F2" },
  deepseek: { name: "DeepSeek", icon: "brain", color: "#4D6BFE" },
  siliconflow: { name: "硅基流动", icon: "cube.transparent", color: "#7C3AED" },
  moonshot: { name: "Moonshot / Kimi", icon: "moon.stars", color: "#0F172A" },
  kimicode: { name: "Kimi Code", icon: "chevron.left.forwardslash.chevron.right", color: "#00A6A6" },
  commandcode: { name: "Command Code", icon: "terminal", color: "#111827" },
  codex: { name: "Codex / ChatGPT", icon: "chevron.left.slash.chevron.right", color: "#10A37F" },
  oneapi: { name: "OpenAI 兼容中转站", icon: "arrow.left.arrow.right", color: "#0EA5E9" },
  generic: { name: "自定义 JSON 接口", icon: "curlybraces", color: "#64748B" },
}

/** 配置里出现了不认识的 provider id 时用的占位，避免整页崩掉。 */
export const UNKNOWN_META: ProviderMeta = {
  name: "未知服务",
  icon: "questionmark.circle",
  color: "#8E8E93",
}

export function metaOf(id: string): ProviderMeta {
  return PROVIDER_META[id] ?? { ...UNKNOWN_META, name: `未知服务 (${id})` }
}
