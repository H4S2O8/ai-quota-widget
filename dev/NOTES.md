# 开发手记

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

## remoteResource 不能填 GitHub 的 tree 网页

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

## 「整块小组件可点」没有确定可用的写法

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
