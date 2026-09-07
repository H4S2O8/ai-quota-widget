# 开发手记

## ⚠️ 不要对生产鉴权端点做压测

**2026-09-07 的事故：** 为了测出限流阈值，我用一个假 token 连续请求
`api.anthropic.com/api/oauth/usage` 六次，又拿真实的 Claude Code client_id 配假的
refresh token 打了几次 `/v1/oauth/token`——**从用户本机的 IP 发出去的**。

结果：用户本地的 Claude Code CLI 被登出。那些请求在形状上就是凭据爆破，
触发账号侧的保护是完全可预见的。

实测到的事实（这部分是有价值的，但获取方式是错的）：

- `/api/oauth/usage` 连续 **3 次鉴权失败**之后，第 4 次就返回 429
- 429 的 `retry-after` 是 **3573 秒**，将近一小时
- 限流期间，本来能成功的请求也会一起被挡

**规则：**

1. **永远不要用无效凭据反复请求真实的鉴权端点。** 一次就够判断「接口在不在」；
   要测限流行为，只能在自己的测试服务器上模拟。
2. **尤其不要在用户的机器上做。** 那是用户的 IP、用户的账号，
   代价由用户承担而不是你。
3. 探活只做一次，且优先选**不需要鉴权**的路径（比如 `/v1/models`）。

## 

## 这个项目为什么这么分层

```
types.ts     领域类型，只有它定义数据形状
util.ts      纯函数：JSON 路径、数字解析、阈值、格式化。不 import "scripting"
p_*.ts       每个服务商一个文件，纯函数，不碰 UI 不碰存储
providers.ts 注册表，唯一需要改的登记处
refresh.ts   抓取编排：并发、失败保留旧值
view.ts      配置 + 快照 -> 可渲染的行，主 App 和小组件共用
store.ts     持久化（唯一 import "scripting" 的非 UI 文件）
ui.tsx       共用小部件
editor.tsx   账户详情页
index.tsx    主 App
widget.tsx   小组件
app_intents.tsx  小组件上的刷新按钮
```

分成这样不是为了整齐，是为了**能在没有手机的情况下被测到**。这个平台没有模拟器，
真机之外只剩静态检查和 node。所以凡是能判断对错的逻辑都被推出组件之外：
`dev/test_logic.mjs` 里那 60 条断言，一条都不需要 iPhone。

留在 `.tsx` 里的只有布局，而布局的对错只能在真机上看。

## 平台坑与这里的对策

| 坑 | 这里怎么绕 |
| --- | --- |
| `setInterval` 回调里的 `setState` 不触发重渲染 | 全程无定时器；配置落盘的防抖用 `setTimeout` |
| 主界面 present 之后 `Dialog.*` 静默失败 | 没有任何 Dialog，输入全是页面内的 TextField |
| 容器上 `shadow` / 形状上 `padding` 不生效 | 卡片是「带 padding 的 stack + `background` 传形状」，边界靠 `stroke` |
| Hooks 在提前 `return` 之后会卡住渲染 | 所有组件 hooks 都在函数顶部，没有提前 return |
| `overlay={cond ? <X/> : undefined}` 不生效 | 条件内容一律放进 stack 的 children |
| 小组件读不到主脚本的 documents 目录 | 配置和快照都在 `FileManager.appGroupDocumentsDirectory` |
| `Widget.present()` 之后的代码不执行 | 诊断在 present **之前**写；`dev/check.py` 会拦反例 |
| 小组件里 hooks 不生效 | 小组件是一次性渲染，数据在模块顶层 await 备齐 |
| `Widget.family` 文档里有两种拼法 | 两种都认：`String(family).replace(/^system/,"").toLowerCase()` |
| `GeometryReader` 只声明了 children | 高度限制加在外层 `HStack` 上，不加在它自己身上 |
| `toolbar` 里放 `NavigationLink` 无用例 | 工具栏只放 Button，导航入口全做成列表行 |

后三条是这个项目新踩的，已经写进 `dev/check.py` 的黑名单，并且
`dev/test_check.sh` 会验证「黑名单确实拦得住」。

## 凭据存哪，以及为什么不是 Keychain

凭据和配置一起放在 App Group 容器的 `config.json` 里，明文。

按理说应该用 Keychain。没用是因为**小组件跑在独立扩展进程里，Keychain 在那边读不
读得到，文档里没有用例**——而这个平台上没有用例的写法，失败方式是静默的。如果凭据
进了 Keychain 而小组件读不到，症状是「小组件自刷新一直不工作，但不报错」。

所以现在的做法是：先用一定能工作的路径（App Group 文件），同时埋一个探针去攒证据。
主 App 每次启动往 Keychain 写一个固定值，小组件每次渲染尝试读它，把结论写进
`widget-diag.json`，诊断页显示成「能读 Keychain：是 / 否」。

**等它在真机上稳定报「是」，再把凭据搬进 Keychain 才有依据。** 在那之前搬过去
就是在拿静默失败赌运气。

## 内置服务商的接口，哪些是文档化的

| 服务商 | 接口 | 来源 |
| --- | --- | --- |
| OpenRouter | `/api/v1/credits`、`/api/v1/key` | 官方文档 |
| DeepSeek | `/user/balance` | 官方文档 |
| 硅基流动 | `/v1/user/info` | 官方文档 |
| Moonshot | `/v1/users/me/balance` | 官方文档 |
| one-api / new-api | `/api/user/self` | 开源项目惯例，各站点版本不一 |
| Claude 订阅 | `/api/oauth/usage` | **非公开接口，返回结构是推断的** |

六个接口在 2026-09-06 都用无效凭据探过，全部返回 401 而不是 404——**路径和鉴权方式
是对的**。但「接口在」不等于「字段名对」：401 的响应里没有业务数据。

真实凭据下的字段名，只有你自己拿号跑一次才知道。所以每个页面都给了「试抓一次」
按钮，抓完把原始响应原样贴出来。

`dev/probe_endpoints.sh` 可以随时重跑这个探活。某个服务商忽然一直报错时先跑它，
能立刻分清「你的 key 过期了」还是「人家改接口了」。

## Claude 那个 provider 的解析为什么写得这么啰嗦

`p_anthropic.ts` 认三层：已知窗口键（连同驼峰等几种拼法）→ 通用数组形状 → 都不认识
就**抛错**。

最后那一条是重点。取不到字段时最省事的写法是给个 0，那样界面永远不会报错——
然后你会在小组件上看到一个漂亮的绿色「0%」，以为额度充足。**在一个静默失败的平台
上，一个假的正常读数比一条错误信息危险得多。**

`utilization` 是 `0.42` 还是 `42` 也不确定，所以 `<= 1` 一律当小数。代价是真有 1%
的时候会显示成 1%（而不是 100%）——这个方向的错比反过来安全。

## 自动更新的地址换过三次，记录一下都为什么不行

| 地址 | 结果 |
| --- | --- |
| `github.com/<u>/<r>/tree/main/app` | 返回 270KB HTML，不是 zip 也不是 git 仓库。手机一直停在初始版本且不报错 |
| `github.com/<u>/<r>/releases/latest/download/x.zip` | 是 302 跳转；且发布后几分钟内附件 CDN 仍返回上一版 |
| `raw.githubusercontent.com/<u>/<r>/main/x.zip` | **在国内网络下不稳定**：同一分钟内一次 200、一次直接连不上（curl 000）。App 侧表现为「远程 not found」 |
| `cdn.jsdelivr.net/gh/<u>/<r>@main/x.zip` | **在用**。GitHub 的公共 CDN 镜像，同样的字节，可达性好得多 |

jsDelivr 的 `@main` 有缓存（约 12 小时），所以 `dev/release.sh` 每次发布会调一次
`purge.jsdelivr.net` 并验证拿到的是新版本。

## 发布必须走 dev/release.sh

踩过一次：`gh release create ... --notes-file - <<'NOTES'` 这种写法，**heredoc 会把
后面的附件参数吃掉**，连着两个版本的 release 是空的——安装链直接 404，而且
GitHub 不会报错，release 页面看起来一切正常。

`dev/release.sh` 把整条链串起来并逐条验证：tag 与 `script.json` 的 version 必须一致、
测试通过、包自洽、附件确实上传了、三条对外链接都能拿到新版本号。

一般化的教训：**发布是一条有很多步的流水线，任何一步漏掉都不会当场报错。**
凡是「漏了不报错」的动作，就该有脚本替你验一遍。

## 旧记录：remoteResource 不能填 GitHub 的 tree 网页

第一版填的是 `https://github.com/<user>/<repo>/tree/main/app`（skill 模板里的写法）。
**不工作**，手机上一直停在最初装的那个版本，而且不报错。

原因很直白，curl 一下就看得见：

```
tree/main/app                         -> 200, 270KB, text/html
releases/latest/download/AI-Quota.zip -> 200,  44KB, application/zip
```

文档对这个字段的说明是「a `.zip` or Git repository」，tree 网页两样都不是。

试过两种能用的写法，最后选了后者：

| 写法 | 问题 |
| --- | --- |
| `releases/latest/download/AI-Quota.zip` | 是 302 跳转，而「Scripting 跟不跟随重定向」没有文档也没验证过；实测发布后几分钟内附件 CDN 还会返回上一版 |
| `raw.githubusercontent.com/.../main/AI-Quota.zip` | 不跳转，`cache-control: max-age=300`，永远跟着 main。**用这个** |

所以 `AI-Quota.zip` 是**故意提交进仓库的**，它就是那条更新链的内容。改完代码
跑 `dev/pack.sh` 会同时更新 `.scripting` 和 `.zip`，两个都要提交。

推 main 不会打扰用户：Scripting 是按 `script.json` 的 `version` 判断要不要更新的，
版本号不变就不会有动静。所以「什么时候真正推送给用户」由你改不改版本号决定，
和 push 的频率无关。

**改这个 URL 本身救不了已经装好的旧版本**。旧版本里存的是旧 URL，它拉不到东西
也就更新不了自己。必须手动重装一次，之后才进入自动更新的轨道。

版本号现在显示在主列表的「诊断」那一行和诊断页顶部。装完之后先看一眼那里，
确认拿到的是不是你以为的版本——不然「更新到没到」只能靠猜。

## 事故：连续四个版本发出了起不来的包

`dev/pack.sh` 第一版是**写死的文件列表**。后来加的 `p_kimicode.ts` 和
`p_commandcode.ts` 没被加进那个列表，于是 v0.2.0 到 v0.3.1 发出去的包里，
`providers.ts` 在 import 两个包里根本不存在的文件。

症状是「手机上装了但起不来」，而且**在 Mac 上完全看不见**：

- 静态检查过，因为它扫的是 `app/` 目录，文件是齐的
- esbuild 打包过，同样因为扫的是 `app/`
- 60 条逻辑测试全绿，它们直接从 `app/` 编译

三道防线全部在源目录上做，没有一道看的是**真正要发出去的那个 zip**。

修法有两层。根因是手工维护的列表，改成 `ls script.json *.ts *.tsx` 自动收集；
但光这样只是修了这一次，所以又加了 `dev/test_pack.sh`，验的是一条不变式：

> **包内每一条相对 import，都要能在包里解析到。**

这条成立，「漏打包」就不可能再发生——不管以后用什么方式打包。写这个脚本时先拿
当时那个坏包跑了一遍，确认它确实报错，才接进 `dev/test.sh`。

教训是：**验证要落在交付物上，不是落在源目录上。** 三道检查看起来很厚，
但它们检查的都不是用户实际拿到的东西。

## fetch 的 `timeout` 是私有扩展，测不到

`requestJson` 一开始只传 `timeout: <秒>` —— 那是 Scripting 给 fetch 加的选项，
**node 的 fetch 不认**。后果是 `dev/` 里的测试永远测不到超时路径，
而超时恰恰是最容易写错的一条路。

代价是真的付了：Command Code 的 `whoami` 被写成硬依赖，它一超时整个抓取就死，
报「请求超时」，而真正要的 `credits` 根本没被发出去过。这个 bug 在本地测不出来，
因为本地根本触发不了超时。

现在改成 `AbortController` + `setTimeout` 自己实现（两者在官方 fetch 文档里都有
用例），同时保留 `timeout` 选项。两个都传，平台的先生效也好，没生效也有兜底。
超时行为于是在 node 里也成立，回归测试能真的跑起来。

一般化的教训：**平台私有的扩展参数，等于一条测不到的代码路径。** 能用文档化的
通用原语实现同一件事时，优先用通用的那条——它在测试里也活着。

## 可选的前置步骤不该能否决主流程

`whoami` 只是去省一个查询参数（`orgId`，个人账号本来就可能没有），却被写成了
必须成功。一个只提供优化的步骤，不该有能力让主流程失败。

现在它包在 try/catch 里，超时上限也压到 6 秒——它只是来省个参数的，不值得让人
等满一整个超时。回归测试直接让 whoami 吊死不回应，断言仍然出数。

## 小组件必须全程同步（两次事故）

真机上连着栽了两次：

| 写法 | 症状 |
| --- | --- |
| 顶层 `await` | `ReferenceError: Can't find variable: await`（脚本按普通脚本求值，不是 ES 模块） |
| 包进 `async main()` 再 present | **一片漆黑，什么都没有** |

第二条是关键：`Widget.present` 必须在脚本同步执行的过程中被调用。异步做完再
present，时机上已经太晚，小组件拿不到内容。

所以 `widget.tsx` 现在一个 `await` 都没有，文件读取走 `FileManager.readAsStringSync`。
`dev/check.py` 加了一条只针对 `widget.tsx` 的规则：出现 `await` 或 `async` 直接报错。

**代价**：小组件不能自己联网抓数据了——网络请求没有同步版本。刷新时机改成两个：
打开 App（`autoRefreshOnOpen`，数据过期才抓）和点小组件上的刷新按钮（AppIntent）。

**「一片漆黑」这个症状本身就是要消灭的东西。** 现在整个流程包在 try/catch 里，
出任何异常都会 present 一个带错误文本的视图。在一个静默失败的平台上，
一块黑方块不告诉你任何事；一行难看的报错至少能定位。

## 旧记录：小组件里没有顶层 await

真机报错：`ReferenceError: Can't find variable: await`。

小组件脚本是**当作普通脚本求值的，不是 ES 模块**，所以顶层 `await` 直接不存在。
所有异步动作必须收进一个 async 函数，在那个函数内部调 `Widget.present`，
最后在顶层调一次那个函数。

这条是照抄别人代码栽的跟头：另一个项目的 `widget.tsx` 顶层写着 `await openDB()`，
我当成可用写法直接搬了。**「别人那样写过」不等于「能用」**——在这个平台上，
唯一算数的是文档里的用例和真机跑通。官方的小组件示例全是同步的，这本身就是信号。

连带改了 `dev/check.py` 里那条「present 之后不该有代码」的规则：它原来按文件末尾
判，会把正确的 `main()` 收尾判成错误。现在按花括号深度判「同一层级」，
`dev/test_check.sh` 里正反例都有。

## 加了类型检查，因为 esbuild 看不出「漏传必填字段」

真实事故：给 `FetchContext` 加了三个必填字段，只改了 `refresh.ts`，**漏了
`editor.tsx`**。于是详情页的「现在抓取」拿到的 `ctx.allowTokenRefresh` 是
`undefined`，当假值处理，**每一次手动抓取都报「正在退避中」**——填了新凭据也没用。

esbuild 打包照过（它只看语法和 import 路径），60 多条逻辑测试也照过（它们不走
editor.tsx）。这类错误在这个平台上是运行时才炸的，而运行时又几乎不给报错。

`dev/test_types.sh` 用 `tsc --noEmit` 补上这一层。平台没发布类型定义，所以
`dev/typecheck/scripting.d.ts` 把 `"scripting"` 声明成简写环境模块（导入的一切都是
any）——目标不是校验 UI 组件的 props，是校验**我们自己那几个接口**。

一个坑：`useMemo` 也来自 any 模块，所以

```ts
const provider = useMemo(() => providerOrPlaceholder(id), [id])   // provider: any
const provider: Provider = useMemo(...)                            // 这样才受检查
```

不显式标注的话 `provider.fetch(...)` 的参数完全不受检查——上面那个 bug 正是这么
溜过去的。**从 any 模块拿到的值，凡是后面要靠类型检查兜底的，都要显式标注。**

## 退避不该拦住人手动点的那一次

同一批改动里还有个判断失误：我让「限流期间连手动抓取也拒绝」。那是矫枉过正——
退避的意义是拦住**自动重试**（小组件每次渲染都来一遍才危险），不是把人锁在自己
的工具外面。人点一次按钮是有限的、明确的动作，而且他多半刚换过凭据，正是最该
放行的时候。

现在：手动抓取永远放行，只在限流期给一句提示；改凭据会把两种退避都清掉。

## 429 必须整账户停手，而不只是「换 token 退避」

之前只做了「换 token 失败就退避」，不够。真正的机制是：

1. access token 过期 → 401
2. 换 token、重试 → 又一次请求
3. 几次失败之后 → **429，锁将近一小时**
4. 429 不是 401，**换 token 的逻辑压根不会触发**，账户就卡在 429 上

所以现在有两级退避：

| 字段 | 挡什么 | 触发条件 |
| --- | --- | --- |
| `refreshBlockedUntil` | 只挡「换 token」 | 换 token 失败，退避 30 分钟 |
| `retryAfter` | **挡整个账户的抓取** | 收到 429，按 `retry-after` 头，没有就 15 分钟 |

限流期间连一个请求都不发（有回归测试数着 HTTP 请求次数），界面显示「还要等 N 分钟」，
并且**继续显示上一次的数值**——被限流不代表数据没了。

## 「小组件不写配置」把 OAuth 端点打成了 429

小组件当初刻意只写快照、不写配置，理由是「两个进程都写会互相覆盖」。听起来稳妥，
实际是个 bug：**provider 换到的新 access token 也在配置里**，于是每次渲染换一次、
换完就丢，下次再换。反复换很快把 OAuth 的 token 端点打成 429——那时连本来能成功
的请求也一起挂，症状变成完全看不懂的「429」。

正确做法不是「不写」，是**读盘 → 只改点名的字段 → 写回**（`applyConfigPatches`）。
只动 patch 里出现的那几个 key，其余原样保留，两个进程就不会互相抹掉。

一般化的教训：**「为了安全干脆不写」经常只是把问题换了个地方。** 真正的问题是
写入粒度太粗——整份覆盖才危险，改几个字段不危险。

另外加了一道退避：换 token 失败后半小时内不再尝试（`AccountState.refreshBlockedUntil`），
provider 通过 `ctx.allowTokenRefresh` 读、通过 `ctx.onTokenRefreshFailed()` 报告。
一个坏掉的 refresh token 配上每次渲染都重试，同样能把端点打成 429。

## 错误信息里必须带上服务器实际说了什么

Codex 那边报的是「刷新被拒 (200)」——状态码 200 配「被拒」，而且一个字都没说
服务器返回了什么。**在一个只能靠错误文字排查的界面上，这种消息等于没有。**

现在换 token 失败会把响应体（截断 300 字）带出来。写错误信息时的判据很简单：
**拿着这句话，能不能决定下一步做什么？** 不能就是没写完。

## 只该问用户要长期凭据

Claude 和 Codex 一开始都把 **access token 设成必填**，refresh token 设成可选。
方向正好反了：access token 是几小时就死的那个，refresh token 才是长期有效的，
而且**有了 refresh token 就能换出 access token，反过来不行**。

现在两个 provider 都是「refresh token 必填、access token 可留空」，留空时直接去换，
不再先发一个注定 401 的请求。Codex 还需要 `account_id`，因为它是请求头、
不在 token 里、换不出来。

一般化的判据：**问用户要凭据时，先问「这个能不能从别的推出来」和「它多久失效」。**
能推出来的不要问，短命的不要当主凭据。

## OAuth access token 都是短命的，必须做刷新

Claude 和 Codex 两个 provider 用的都是 OAuth **access token**，寿命只有几个小时。
这是 OAuth 的设计，不是哪里做得不好：CLI 在电脑上是靠 refresh token 悄悄续的，
所以你几乎察觉不到。**把 access token 复制到手机上，得到的是一个几小时后就死掉的快照。**

参考实现（kimi-code-usage）没有这个问题，因为它每次都重读本机凭据文件——
那台机器上的 CLI 一直在帮它续。手机上没有这个前提，只能自己续。

两个 provider 现在都实现了「401 → 用 refresh token 换一对新的 → `ctx.updateConfig`
存回配置 → 重试一次」。`ctx.updateConfig` 这个口子当初就是为这件事留的。

端点与 client_id（都探过，伪造 refresh_token 返回 `invalid_grant` 而不是
`invalid_client`，说明 client_id 这一半被接受）：

| | 端点 | client_id |
| --- | --- | --- |
| Claude | `POST api.anthropic.com/v1/oauth/token`（JSON body） | `9d1c250a-e61b-44d9-88ed-5944d1962f5e` |
| Codex | `POST auth.openai.com/oauth/token`（form body） | `app_EMoamEEZ73f0CkXaXp7hrann` |

一般化的教训：**凡是从 CLI 里抠出来的凭据，先问它的寿命。** 短命的就必须
把续期一起搬过来，否则用户会以为「这个功能坏了」，其实只是过期了。

## 小组件漆黑事件的最终结论（照抄样本才解决的）

连着三版一片漆黑，我在没有报错的情况下反复猜、每次都猜错，还基于错误归因往
`check.py` 里加了一条**错的**规则（禁止小组件里用 async）。转机是拿到了另一个
能正常渲染的 Scripting 小组件源码。逐条比对之后，**我的三个结论全是错的**：

| 我以为 | 实际 |
| --- | --- |
| 顶层 await 不可用 → 所以异步不行 | 顶层 await 确实不可用，但 `async run()` 里 await 完再 present **完全可以** |
| 小组件不能联网 | 能。样本在小组件里跑 SSH 采集 |
| 整块包 Button 会漆黑 | 不会。**但内容必须走 children，不能用 `label=` 属性** |

剩下的差异就是真嫌疑人，现在全部对齐到样本那一侧：

- **Button 用 children**：`<Button intent={...}>{内容}</Button>`，不是 `label={...}`
- **背景用 `backgroundColor={扁平hex}`**，不是 `widgetBackground={{style, shape}}`
- **颜色全用扁平 hex**，不用 `{light, dark}` 动态色，也不用 `"secondaryLabel"` 这类语义色

代价：小组件不跟随系统深浅色，固定一张深色卡片。背景自己画，前景对比度就完全
可控，不依赖任何环境推断。这是样本的做法，也是能确定跑通的做法。

### 方法论

**在一个不给报错的平台上，一份「已知能跑」的样本胜过任何文档和推理。**

我那三轮猜测的共同错误是：症状（漆黑）只有一个，可疑变量却有五六个，我每次只
换一个变量就下结论。而真机上根本没有隔离条件——你甚至不知道上一版到底是"好了"
还是"换了个理由继续黑"。正确的做法是先拿到一个确定能跑的形状，再从那里往外加。

顺带：那条错误的 check.py 规则提醒了一件事——**检查器里的每条规则都是一个断言，
断言可能是错的。** 加规则时要问「我凭什么确信」，删规则时要在注释里留下它为什么
错，否则下一个人会把它加回来。

## 小组件一片漆黑：排查手册

真机上反复出现，每次原因都不同。已确认的：

| 写法 | 结果 |
| --- | --- |
| 顶层 `await` | `ReferenceError: Can't find variable: await` |
| `async main()` 里 present | 一片漆黑（present 必须在同步执行中调用） |
| `Widget.present(<Button label={<Body/>} .../>)` | 一片漆黑（Button 当根视图） |

文档里还有一条**没被重视够**的：小组件约有 30MB 内存上限，
「超了会渲染失败或显示为空白」。而 `widget.tsx` 曾经通过 `view.ts` 和
`app_intents.tsx` 把十个 provider 的抓取逻辑、整套 refresh 编排全部拖进了那个进程——
它一行都用不到。现在拆出 `meta.ts` 只放显示元数据，小组件的传递依赖从
89KB 降到 48KB，且不含任何 `p_*.ts` / `providers.ts` / `refresh.ts` / `app_intents.tsx`。

**验证依赖图有没有回潮**（加新 import 之后跑一下）：

```sh
cd app && python3 - <<'EOF'
import pathlib, re
seen, stack = set(), ["widget.tsx"]
while stack:
    f = stack.pop()
    if f in seen: continue
    seen.add(f)
    src = re.sub(r'/\*.*?\*/', '', pathlib.Path(f).read_text(), flags=re.S)
    for m in re.findall(r'from "\./([A-Za-z0-9_.-]+)"', src):
        for c in (m, m+".ts", m+".tsx"):
            if pathlib.Path(c).exists(): stack.append(c); break
print(sorted(seen))
EOF
```

### 二分的办法

小组件的 **Parameter 填 `min`** —— 只渲染一行纯文本。

- 还黑 -> 问题在**加载阶段**（导入失败、内存、或者小组件根本没跑）。
  这种情况 `widget-diag.json` 也不会有记录，诊断页会显示「还没有记录」。
- 能显示 -> 问题在**视图树**里，有组件不被 WidgetKit 支持，逐块删了试。

在一个不给报错的平台上，这是唯一可靠的二分手段。

## 旧记录：「整块小组件可点」没有确定可用的写法

实测记录，别删，省得以后再试一遍：

| 写法 | 结果 |
| --- | --- |
| `Widget.present(<Button label={<Body/>} buttonStyle="plain" intent={...} />)` | **一片漆黑** |
| `Widget.present(<Body/>)`，容器里放一个 title+systemImage 的 Button | 正常显示 |

第一种失败时 `widget.tsx` 已经全程同步了，所以能确定不是异步的问题——
**Button 作为 present 的根视图渲染不出来**。文档的交互式小组件示例里，Button
永远是放在 `VStack` 里面的，从来不是根视图；那个细节当时被我忽略了。

现在 `settings.widgetTap` 是三选一：

- `open`（默认）—— 不包裹，系统默认行为，角落一个刷新按钮。**唯一确认能显示的**
- `button` —— 根容器里套一个撑满的 Button（比「Button 当根视图」更接近文档形状）
- `link` —— `<Link url={run_single?action=refresh}>` 包住内容，`index.tsx` 认这个参数，
  抓完直接 `Script.exit()` 不展示界面。Link 收自定义布局是文档化的，代价是会切一下 App

默认必须是 `open`：整块可点已经让这个小组件黑过一次，默认不能是没把握的那个。

## 旧记录：小组件点击 = 刷新（整块可点）

`Widget.present` 传的是 `<Button intent={RefreshQuotaIntent(...)} buttonStyle="plain"
label={<Body/>} />`，整块都是按钮。

`label` / `plain` / `intent` 每一件都是文档化的，但**这个组合没有用例**。所以
`settings.widgetTap` 留了个开关（`refresh` / `open`）：万一它在某个版本上渲染不
出来，用户能自己在 App 里切回「打开脚本」模式恢复显示，不用等发新版。

按这个平台的纪律，没有用例的组合本该先当它不支持。这里是用户明确要的交互，
所以照做，但把「猜错了怎么办」的出口一起给了。切到 `open` 模式时，角落会出现
一个文档原样写法的刷新按钮——按钮套按钮在 WidgetKit 上行为未定义，两者不同时出现。

## 旧记录：小组件点击 = 刷新

整块小组件包在一个 `Button` 里，`intent` 是 `RefreshQuotaIntent`，
`buttonStyle="plain"` 免得长出按钮边框。头部原来那个小刷新按钮删了——
按钮套按钮在 WidgetKit 上行为未定义，现在那里只留一个 `hand.tap` 图标作提示。

代价是点小组件不再打开 App。这是用户明确要的取舍。

## 待验证（只能在真机上做）

按重要性排：

1. **remoteResource 换成 raw zip 直链之后到底更不更新。** 这是目前最大的未知数：
   之前那版（GitHub tree 网页）是确定不工作的，新的这版没有重定向、返回真 zip、
   根目录第一项就是 script.json，形状上都对，但只有真机能证明。
   装上之后看诊断页的版本号。
2. **点击小组件是否真的触发刷新并重画。** AppIntent + reloadAll 之后 WidgetKit
   什么时候回来是系统说了算。
3. **小组件能不能读 App Group 目录里的配置。** 整个数据共享都压在这上面。
   看诊断页的「小组件上次渲染 → 读到账户」是不是非 0。
4. **小组件自刷新会不会被 iOS 掐掉。** 扩展进程有时间和内存限制（约 30MB），
   一次抓 4 个账户是否安全没验过。真被掐了就把「小组件自行刷新」关掉，
   靠打开 App 或点小组件上的刷新按钮更新。
5. **AppIntent 刷新按钮是否真的重画。** `Widget.reloadAll()` 之后 WidgetKit 什么时候
   回来是系统说了算。
6. **`widgetBackground` 传 shape 对象在着色模式下的表现。**
7. **小组件里 Keychain 读不读得到**（探针会自己回答，看诊断页）。
8. **`refreshable` 下拉刷新**在 List 上是否生效。

踩到新的坑，往 `dev/check.py` 的 RISKY 里加一条，再往 `dev/test_check.sh` 里加一个
反例。记在文档里的坑会被忘记，写进脚本的不会。

## 改完要跑什么

```sh
./dev/test.sh          # 静态检查 + 检查器自检 + 打包 + 逻辑测试
./dev/pack.sh          # 重新打 AI-Quota.scripting
```

用 `remoteResource` 自动同步时，**`app/script.json` 的 `version` 必须加一**，
不然手机上看到的还是旧代码。这是最常见的「我明明改了」。
