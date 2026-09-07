#!/usr/bin/env python3
"""Scripting 项目静态检查。

esbuild / tsc 只查语法，抓不到这个平台最常见的四类错误 —— 它们全都在运行时
才暴露，而且症状极不直观（白屏、界面卡住、什么都没发生）：

  1. JSX 引用了不存在的组件           -> 运行到该处白屏
  2. 用了 Navigation./Dialog./Widget. 却忘了从 "scripting" 导入
                                      -> ReferenceError；若在 present 之前，前台一片空白
  3. Hooks 出现在提前 return 之后      -> 界面卡在上一次成功渲染的状态
  4. 已知会静默失效的写法（黑名单）    -> 不报错，就是不生效

用法：
    python3 check_scripting.py [项目目录]      # 默认当前目录

黑名单是项目资产：踩到新坑就往 RISKY 里加一条，让它以后自动拦。
若某条在新版文档里已经有了用例，删掉它并在 commit message 里说明。
"""
import re
import sys
import pathlib

# Scripting 提供的全局对象（不需要 import）。缺了会误报，按需补。
GLOBALS = {
    "SQLite", "FileManager", "DateComponents", "CalendarNotificationTrigger",
    "TimeIntervalNotificationTrigger", "LocationNotificationTrigger", "Animation",
    "Data", "console", "JSON", "Math", "Date", "Number", "String", "Object", "Array",
    "Promise", "Set", "Map", "setTimeout", "clearTimeout", "setInterval", "clearInterval",
    "LanguageModelSession", "Crypto", "UUID", "fetch", "Response", "Headers",
    "AbortController", "AbortSignal", "TextDecoder", "TextEncoder", "URL", "Symbol",
    "AVPlayer", "SharedAudioSession", "MediaPlayer", "UIImage", "Device", "Keychain",
    "Storage", "Clipboard", "Location", "Calendar", "Reminder", "Contact", "Photos",
    "QuickLook", "ShareSheet", "SafariView", "WebView", "HttpServer", "Bluetooth",
}

# 必须从 "scripting" 显式导入的模块对象。漏掉不是语法错，只在运行到那一行才炸。
MUST_IMPORT = ["Path", "Script", "Navigation", "Notification", "Widget", "Dialog",
               "Intent", "AppIntent", "CustomKeyboard", "LiveActivity", "Assistant"]

# 文档零用例 / 实测静默失效的写法。见 references/pitfalls.md §2。
RISKY = [
    (r'<RoundedRectangle[^>]*padding=',
     "RoundedRectangle 直接带 padding（实测不生效，套一层 HStack）"),
    (r'<ProgressView[^>]*padding=',
     "ProgressView 直接带 padding（实测不生效，套一层 HStack）"),
    (r'<(VStack|HStack|ZStack)[^>]*shadow=',
     "容器上用 shadow（文档唯一用例在 Text 上）"),
    (r'overlay=\{[^}]*undefined',
     "overlay 传 undefined（实测不生效，请常驻渲染 + opacity 控制）"),
    (r'DragGesture\s*\(',
     "DragGesture() 链式构造（实测完全不动，请用 onDragGesture 属性形式）"),
    (r'(simultaneous|highPriority)Gesture=',
     "simultaneous/highPriorityGesture 配 DragGesture（实测失效）"),
    (r'setInterval\s*\(',
     "setInterval 回调里的 setState 不触发重渲染（脚本环境只保证 setTimeout，请自递归）"),
    # —— 以下是本项目自己踩/绕过的，见 dev/NOTES.md ——
    (r'<GeometryReader[^>]+\w+=',
     "GeometryReader 带 props（它只声明了 children，尺寸限制请加在外层容器上）"),
    (r'toolbar=\{[^}]*<NavigationLink',
     "toolbar 里放 NavigationLink（文档只有 Button 用例，导航入口请做成列表行）"),
    (r'\bDialog\.(prompt|alert|confirm)',
     "主界面 present 之后 Dialog.* 会静默失败（改用页面内的 TextField / alert 修饰符）"),
]

# widget.tsx 专属。
#
# 这里曾经有一条「禁止 async/await」的规则，是**错的**：它建立在「异步导致小组件
# 漆黑」这个错误归因上。后来拿到一份能正常工作的小组件样本，它在 async 里
# await 完网络请求才 present，跑得好好的。规则已撤。
#
# 真正踩过的是这两条：
WIDGET_RISKY = [
    (r'<Button[^>]*\blabel=',
     "widget.tsx 里 Button 用 label= 属性（实测一片漆黑，内容要走 children）"),
    (r'\bwidgetBackground=',
     "widget.tsx 里用 widgetBackground（能跑的样本用的是 backgroundColor + 扁平 hex）"),
]


def _blank_comments(src: str) -> str:
    """把注释替换成等长空格。偏移量不变，后续的深度计算才不会错位。"""
    def repl(m):
        return re.sub(r'[^\n]', " ", m.group(0))
    src = re.sub(r'/\*.*?\*/', repl, src, flags=re.S)
    src = re.sub(r'//[^\n]*', repl, src)
    return src


def check_widget_present(path: pathlib.Path, src: str) -> int:
    """Widget.present() 之后、同一层级里不该再有代码。

    文档写得很清楚：present 之后当前执行上下文立刻销毁。但写惯 React 的人会把
    「收尾」放在最后一行——诊断写入、日志、清理，全都不会跑，且没有任何报错。

    判据必须是「同一层级」，不能是「文件末尾」。小组件里顶层 await 不可用
    （会抛 ReferenceError: Can't find variable: await），所以正确的写法是把异步
    动作收进 async main()、在里面调 present、最后在顶层调一次 main()——那个
    main() 在 present 之后，但它在更外一层，是必需的。第一版规则按文件末尾判，
    把这个正确写法判成了错误。

    所以这里数花括号深度：只看和 present 调用同深度的后续语句。
    """
    if path.name != "widget.tsx":
        return 0

    # 注释里写 Widget.present(...) 当例子是很常见的（这个项目的 widget.tsx 顶部
    # 就有一张「实测过的失败写法」表）。定位前要把注释挖掉，否则规则会去分析一段
    # 文档文字。用等长空格替换而不是删除，这样后面按偏移量算花括号深度仍然准确。
    blanked = _blank_comments(src)
    at = blanked.find("Widget.present(")
    if at < 0:
        return 0
    src = blanked

    # present 调用所在的花括号深度
    depth_at_call = src.count("{", 0, at) - src.count("}", 0, at)

    # 跳过 present 自己那个调用（配平圆括号）
    tail = src[at:]
    depth = 0
    end = None
    for i, c in enumerate(tail):
        if c == "(":
            depth += 1
        elif c == ")":
            depth -= 1
            if depth == 0:
                end = i + 1
                break
    if end is None:
        return 0

    rest = tail[end:]
    # 在同深度内扫描；深度掉到 depth_at_call 以下就说明离开了这个块
    d = depth_at_call
    buf = []
    for c in rest:
        if c == "{":
            d += 1
        elif c == "}":
            d -= 1
            if d < depth_at_call:
                break
        if d == depth_at_call:
            buf.append(c)
    same_level = "".join(buf)
    same_level = re.sub(r'//[^\n]*', '', same_level)
    same_level = re.sub(r'/\*.*?\*/', '', same_level, flags=re.S)
    same_level = same_level.strip().strip(";").strip()
    if same_level:
        print(f"✗ {path.name}: Widget.present() 之后的同层代码永远不会执行 -> {same_level[:60]!r}")
        return 1
    return 0


def check_file(path: pathlib.Path) -> int:
    src = path.read_text(encoding="utf-8")
    fail = check_widget_present(path, src)

    imported = set()
    for m in re.finditer(r'import\s*\{([^}]*)\}\s*from', src):
        for part in m.group(1).split(","):
            name = part.strip().replace("type ", "").split(" as ")[-1].strip()
            if name:
                imported.add(name)

    defined = set(re.findall(r'^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_]\w*)', src, re.M))
    defined |= set(re.findall(r'^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_]\w*)', src, re.M))
    defined |= set(re.findall(r'^\s*(?:export\s+)?type\s+([A-Za-z_]\w*)', src, re.M))
    known = imported | defined | GLOBALS

    # 1) JSX 用到的大写开头组件。要求 < 前是空白/括号/逗号，
    #    这样 useState<Card[]> 之类的泛型不会被误判成标签。
    #
    #    扫描前先去掉块注释：文档里写 `Authorization: Bearer <CMD_API_KEY>` 这种
    #    占位符会被当成 JSX 标签，报一个根本不存在的「组件未定义」。
    #    误报比漏报更糟——它会让人开始不信任这个检查器。
    #    行注释不能一起去，`https://` 里的两个斜杠会被误伤。
    jsx_src = re.sub(r'/\*.*?\*/', ' ', src, flags=re.S)
    used = set(re.findall(r'(?<=[\s(){}>,])<([A-Z]\w*)[\s/>]', jsx_src))
    missing = sorted(used - known)
    if missing:
        fail += 1
        print(f"✗ {path.name}: JSX 引用了未定义的组件 -> {', '.join(missing)}")
    else:
        print(f"✓ {path.name}: {len(used)} 个组件全部有来源")

    # 扫描前剥掉注释，避免注释里提到某 API 被误报
    code = re.sub(r'/\*.*?\*/', '', src, flags=re.S)
    code = re.sub(r'//[^\n]*', '', code)

    # 2) 漏导入
    for name in MUST_IMPORT:
        if re.search(r'\b' + name + r'\.', code) and name not in imported:
            fail += 1
            print(f'✗ {path.name}: 用了 {name}.* 但没有从 "scripting" 导入 {name}')

    # 3) 高危写法
    checks = list(RISKY)
    if path.name == "widget.tsx":
        checks += WIDGET_RISKY
    for pat, why in checks:
        if re.search(pat, code, re.S):
            fail += 1
            print(f"✗ {path.name}: {why}")

    # 4) Hooks 在提前 return 之后
    #
    # 判据是「函数体顶层的 return」，靠花括号深度算，不靠缩进：useEffect 的
    # cleanup return、回调里的守卫 return 都在更深的层级，按缩进认会全部误报。
    # 扫描时要跳过字符串——UC 预设里就有 "{bad}" 这种带花括号的文本。
    for fn in re.split(r'\n(?=(?:export\s+)?function\s)', code):
        m = re.match(r'(?:export\s+)?function\s+(\w+)', fn)
        if not m:
            continue
        first_return, hooks = _top_level_return_and_hooks(fn)
        if first_return is None:
            continue
        late = sorted({name for pos, name in hooks if pos > first_return})
        if late:
            fail += 1
            print(f"✗ {path.name}: {m.group(1)}() 在提前 return 之后调用了 "
                  f"{', '.join(late)} —— 违反 Hooks 规则")
    return fail



def _body_start(fn: str) -> int:
    """函数体左花括号的位置。

    不能直接取第一个 "{"：`function View({ items }: Props)` 的解构参数里就有一个，
    从那里开始数深度会在参数列表结束时就判定函数结束，整条规则静默失效。
    先跳过参数列表的括号，再找花括号。
    """
    open_paren = fn.find("(")
    if open_paren < 0:
        return fn.find("{")
    depth = 0
    i = open_paren
    while i < len(fn):
        if fn[i] == "(":
            depth += 1
        elif fn[i] == ")":
            depth -= 1
            if depth == 0:
                return fn.find("{", i)
        i += 1
    return -1


def _top_level_return_and_hooks(fn: str):
    """函数体顶层（深度 1）的第一个 return 位置，以及所有顶层 hook 调用。

    返回 (return 的偏移量 or None, [(偏移量, hook 名), ...])。
    深度按花括号算，字符串与模板字面量内的花括号不计。
    """
    body = _body_start(fn)
    if body < 0:
        return None, []

    depth = 0
    i = body
    n = len(fn)
    quote = None          # 当前所在字符串的引号字符
    tmpl = []             # 模板字面量里 ${} 的嵌套深度栈
    first_return = None
    hooks = []

    while i < n:
        c = fn[i]
        if quote:
            if c == "\\":
                i += 2
                continue
            if c == quote:
                quote = None
            elif quote == "`" and c == "$" and i + 1 < n and fn[i + 1] == "{":
                tmpl.append(depth)
                quote = None
                depth += 1
                i += 2
                continue
            i += 1
            continue

        if c in "'\"`":
            quote = c
        elif c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if tmpl and depth == tmpl[-1]:
                tmpl.pop()
                quote = "`"
            if depth == 0:
                break
        elif depth == 1 and (c == "r" or c == "u"):
            word = re.match(r'\breturn\b', fn[i:])
            if word and (i == 0 or not (fn[i - 1].isalnum() or fn[i - 1] in "_.$")):
                if first_return is None:
                    first_return = i
            else:
                hook = re.match(r'\b(use[A-Z]\w*)\s*\(', fn[i:])
                if hook and (i == 0 or not (fn[i - 1].isalnum() or fn[i - 1] in "_.$")):
                    hooks.append((i, hook.group(1)))
        i += 1

    return first_return, hooks


def check_dead_exports(target: pathlib.Path) -> int:
    """导出了但全项目没人用的符号。

    这条是拿回归换来的：v3.0.0 重构标签页时把「存相册 / 分享」的按钮弄丢了，
    `saveToPhotos` 还好端端导出着，于是既不报错也没有入口——症状是「功能没了」，
    而不是「代码坏了」。

    判定标准是「除了定义那一处，全项目（含 dev 里的测试）再没出现过」。第一版写成
    「在定义它的文件之外出现过」，结果把 isV5、loadKeystore 这些在自己文件里被调用的
    导出全误报了——放松过头的检查会淹没真信号，收紧过头的会制造噪音，两边都得试。
    """
    sources = sorted(target.glob("*.ts")) + sorted(target.glob("*.tsx"))
    if not sources:
        return 0

    bodies = {path.name: path.read_text(encoding="utf-8") for path in sources}
    for extra in sorted((target / "dev").glob("*.mjs")):
        bodies["dev/" + extra.name] = extra.read_text(encoding="utf-8")

    dead = []
    for path in sources:
        src = bodies[path.name]
        for name in re.findall(r'^export\s+(?:async\s+)?function\s+(\w+)', src, re.M):
            occurrences = sum(
                len(re.findall(r'\b' + name + r'\b', body)) for body in bodies.values()
            )
            # One occurrence is the definition itself.
            if occurrences <= 1:
                dead.append(f"{path.name}: {name}")

    if dead:
        print("✗ 导出了但没人用（要么接上入口，要么删掉）：")
        for item in dead:
            print(f"    {item}")
    return len(dead)


def main() -> int:
    target = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".")
    if not target.is_dir():
        print(f"不是目录：{target}")
        return 2
    files = sorted(target.glob("*.tsx")) + sorted(target.glob("*.ts"))
    if not files:
        print(f"{target} 下没有 .ts / .tsx —— 是不是该指向同步目录（放 script.json 的那个）？")
        return 2
    fail = sum(check_file(f) for f in files)
    fail += check_dead_exports(target)
    print(f"\n{'✗ 有 %d 处问题' % fail if fail else '✓ 全部通过'}")
    return 1 if fail else 0


if __name__ == "__main__":
    sys.exit(main())
