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

现在填的是 `releases/latest/download/AI-Quota.zip`，它 302 到最新 release 的同名
附件，所以**发一个新 release 就等于推一次更新**，不用改 script.json 里的 URL。

两个后果要知道：

- **只有发了 release 才会更新**，push 到 main 不会。这反而是好事——半成品不会
  自动跑到手机上。
- **改这个 URL 本身救不了已经装好的旧版本**。旧版本里存的是旧 URL，它拉不到东西
  也就更新不了自己。必须手动重装一次，之后才进入自动更新的轨道。

版本号现在显示在主列表的「诊断」那一行和诊断页顶部。装完之后先看一眼那里，
确认拿到的是不是你以为的版本——不然「更新到没到」只能靠猜。

## 待验证（只能在真机上做）

按重要性排：

1. **remoteResource 换成 release zip 直链之后到底更不更新。** 它是 302 跳转，
   Scripting 的下载器跟不跟随重定向没有文档说明。不跟随的话就只能手动重装。
2. **小组件能不能读 App Group 目录里的配置。** 整个数据共享都压在这上面。
   看诊断页的「小组件上次渲染 → 读到账户」是不是非 0。
3. **小组件自刷新会不会被 iOS 掐掉。** 扩展进程有时间和内存限制（约 30MB），
   一次抓 4 个账户是否安全没验过。真被掐了就把「小组件自行刷新」关掉，
   靠打开 App 或点小组件上的刷新按钮更新。
4. **AppIntent 刷新按钮是否真的重画。** `Widget.reloadAll()` 之后 WidgetKit 什么时候
   回来是系统说了算。
5. **`widgetBackground` 传 shape 对象在着色模式下的表现。**
6. **小组件里 Keychain 读不读得到**（探针会自己回答，看诊断页）。
7. **`refreshable` 下拉刷新**在 List 上是否生效。

踩到新的坑，往 `dev/check.py` 的 RISKY 里加一条，再往 `dev/test_check.sh` 里加一个
反例。记在文档里的坑会被忘记，写进脚本的不会。

## 改完要跑什么

```sh
./dev/test.sh          # 静态检查 + 检查器自检 + 打包 + 逻辑测试
./dev/pack.sh          # 重新打 AI-Quota.scripting
```

用 `remoteResource` 自动同步时，**`app/script.json` 的 `version` 必须加一**，
不然手机上看到的还是旧代码。这是最常见的「我明明改了」。
