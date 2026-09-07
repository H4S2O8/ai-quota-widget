# AI 额度面板（Scripting 小组件）

在 iPhone 桌面上一眼看到各家 AI 服务还剩多少额度。用
[Scripting](https://scripting.fun) 的 TSX + SwiftUI 组件写成。

仓库：<https://github.com/H4S2O8/ai-quota-widget>

一屏回答一个问题：**哪个快用完了。** 排序按紧张程度，不按你添加的顺序——
出错的排最前，快用完的排第二，宽裕的沉底。

## 装

1. 从 [Releases](https://github.com/H4S2O8/ai-quota-widget/releases/latest) 下载，
   在 iPhone 上用 Scripting 打开即可导入。两个附件字节相同，按你的导入方式挑：

   | 导入方式 | 用哪个 |
   | --- | --- |
   | 下载文件后打开 / AirDrop | `AI-Quota.scripting` |
   | Scripting 里「从 URL 导入」 | `AI-Quota.zip` 的下载直链 |

   **别在 GitHub 网页上直接点文件名下载**——那样存下来的是 HTML 页面，
   导入会报「不支持的脚本文件」。要用 Releases 里的链接，或文件页右上角的
   「Download raw file」。

   自己改过代码就跑 `dev/pack.sh` 重新打包。

2. **自动更新**：`remoteResource` 指向 jsDelivr 上的 `AI-Quota.zip`（GitHub 的公共 CDN 镜像）。
   不用 `raw.githubusercontent.com`——国内网络下它时通时不通，表现是「远程 not found」。
   Scripting 按 `script.json` 的 `version` 判断要不要更新，所以版本号加一才会推送。

   **别填 GitHub 的 `tree/...` 网页地址**——那个返回 270KB 的 HTML，不是 zip，
   装上之后会一直停在初始版本**而且不报错**。这是本项目踩过的坑。

   **已经装了旧版本的救不回来**：它存的是旧 URL，拉不到东西也就更新不了自己，
   必须手动重装一次才进入自动更新的轨道。

3. 当前版本号显示在主列表「诊断」那一行，以及诊断页顶部。更新到没到看那里。

## 内置服务商

| 服务商 | 拿什么 | 需要填 |
| --- | --- | --- |
| Claude 订阅 | 5 小时 / 7 天 / Sonnet / Opus 窗口的已用比例 | refresh token |
| OpenRouter | 账户余额，以及这把 key 自己的限额 | API Key |
| DeepSeek | 余额（CNY / USD 分开列） | API Key |
| 硅基流动 | 总余额，赠送与充值分开显示 | API Key |
| Moonshot / Kimi | 开放平台可用余额、现金、代金券 | 开放平台 API Key + 站点 |
| Kimi Code | 订阅的 5 小时 / 7 天额度窗口 | Kimi Code 控制台的 `sk-kimi-` Key |
| Command Code | 订阅的 5 小时 / 7 天窗口 + 额度池 | Command Code 的 API Key |
| Codex / ChatGPT | 订阅的 5 小时 / 7 天用量窗口 | account_id + refresh token |
| OpenAI 兼容中转站 | 剩余额度与已消费 | 站点地址 + 系统访问令牌 |
| 自定义 JSON 接口 | 你指定的任意字段 | URL、请求头、JSON 路径 |

前五个用的是各家公开文档里的接口。**Claude 那个不是公开接口**，返回结构是推断的，
详见 `dev/NOTES.md`。

**Kimi 有三个互不相通的产品**，别拿错 Key：

| 产品 | 计费 | 用哪个账户类型 | Key 格式 |
| --- | --- | --- | --- |
| Kimi API 开放平台 | 按量付费 | 「Moonshot / Kimi」 | `sk-...` |
| Kimi Code | 订阅制 | 「Kimi Code」 | `sk-kimi-...` |
| Kimi 会员（kimi.com） | 订阅制 | **读不了**，见下 | — |

官方问题排查页原话：三者「付费方式、余额/权益和 API Key 均不通用」，填错了会 401 或 404。
开放平台还分中国站 `platform.kimi.com` 和国际站 `platform.kimi.ai`，账户相互隔离。

**Kimi 会员的用量这个面板读不到。** 它没有 API——参考实现 kimi-code-usage 是靠浏览器
扩展抓 `kimi.com/membership/subscription` 这个网页拿到的，那条路在 iPhone 小组件里走不通。

## 增长式与扣除式统一

各家给额度的方向是反的：Claude 和 Command Code 报「已用 42%」，越大越糟；
DeepSeek 和 Kimi Code 报「还剩 ¥12.5」，越大越好。混在一屏里没法扫——你得先想
清楚这一行的大数字是哪种，才知道它大是好事还是坏事。

所以内部统一成同一套坐标（`used` / `total` / `remaining` / `fraction`），
渲染层只认这四个。设置里的「显示口径」决定整屏用哪个方向，默认「还剩多少」：

| provider 报的 | 显示（剩余口径） | 副标题 |
| --- | --- | --- |
| 已用 42% | **剩 58%** | 已用 42% / 100% |
| 余额 ¥12.5，上限 ¥50 | **¥12.50** | 已用 ¥37.50 / ¥50.00 |

大数字一律代表宽裕，进度条一律表示已用比例，配色一律按已用比例判。
切成「用了多少」则整屏一起反过来。

统一是在 `view.ts` 里做的，两个界面都只读算好的文本，所以口径不可能漂移。

## 小组件

| 尺寸 | 显示 |
| --- | --- |
| 小 | 最紧张的那一个：数值、比例条、重置倒计时 |
| 中 | 最多 4 个账户，每个一行加一条比例条，右上角带刷新按钮 |
| 大 | 最多 7 个账户，每个展开到 3 项指标 |
| 锁屏矩形 | 一行：账户名 + 数值 + 倒计时 |
| 锁屏圆形 | 一个环 |

**点小组件 = 立刻刷新额度**。整块小组件就是一个按钮，点哪儿都会重新抓一遍。
代价是点它不再打开脚本，要开 App 从桌面图标进——设置里可以切回去。

小组件被系统唤起重画时，数据过期会**自己联网抓**一遍（设置里可关）。iOS 对小组件
的刷新配额有限且不保证，所以这条是尽力而为；真正可靠的时机是打开 App，
那时数据过期也会自动抓。
不想让它联网就在设置里关掉，那样它只显示 App 抓来的缓存。

iOS 对小组件刷新有自己的配额，设得再短系统也不保证照做。

## 加一个服务商

新建 `app/p_yourservice.ts`：

```ts
import type { Provider } from "./types"
import { describeHttpError, getPath, num, requestJson } from "./util"

export const yourProvider: Provider = {
  id: "yourservice",          // 别改，它写进了用户的配置
  name: "你的服务",
  icon: "bolt.fill",          // SF Symbol
  color: "#FF6B00",
  help: "去哪儿拿 key，一句话说清。",
  fields: [
    { key: "apiKey", label: "API Key", secret: true, required: true },
  ],
  async fetch(config, ctx) {
    const resp = await requestJson(
      "https://api.example.com/balance",
      { headers: { Authorization: `Bearer ${config.apiKey}` } },
      ctx.timeoutSec,
    )
    if (!resp.ok) throw new Error(describeHttpError(resp))
    return {
      metrics: [{
        id: "balance",
        label: "余额",
        kind: "amount",                                  // amount / count / percent / spent
        value: num(getPath(resp.json, "data.balance")) ?? 0,
        unit: "¥",
      }],
    }
  },
}
```

在 `app/providers.ts` 的 `PROVIDERS` 里加一行，`script.json` 的 `version` 加一。
**界面不用改**：设置页按 `fields` 自动长出表单，小组件按 `Metric` 自动排版。

三条约定：

- **`id` 不能改**，它是用户配置里的外键。
- **拿不到数就抛错，不要返回 0。** 一个绿色的「余额 0」比一条红色的错误更贵，
  因为它看起来像正常工作。
- **靠推断解析的接口要调 `ctx.captureRaw(text)`**，字段猜错时才有原文可看。

只是接口形状不同、不值得写代码的服务，直接用内置的「自定义 JSON 接口」配置，
不用改一行代码。

## 凭据存在哪

和配置一起放在 App Group 容器的 `config.json` 里，明文。这个目录在「文件」App 里
看不到，别的 App 也读不到，但它不是 Keychain。

这么选是因为小组件跑在独立进程里，Keychain 在那边读不读得到没有文档用例——
猜错的话症状是「小组件自刷新静默不工作」。项目里埋了探针去验这件事，
结论显示在诊断页的「能读 Keychain」那一行。验实了再搬。

## 开发

```sh
./dev/test.sh              # 静态检查 + 检查器自检 + 打包 + 逻辑测试（不需要手机）
./dev/probe_endpoints.sh   # 各服务商接口还在不在
./dev/pack.sh              # 打包
```

改完记得 `app/script.json` 的 `version` 加一，否则手机不更新。

平台的坑、分层的理由、以及真机上还没验的清单，见 `dev/NOTES.md`。
