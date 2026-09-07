#!/bin/sh
# 验证静态检查器自己。
#
# 这条纪律来自这个平台最贵的一次误判：诊断代码本身没被验证过，于是一个假读数
# 支撑了六个版本的错误结论。检查器如果沉默地不工作，比没有检查器更糟——它会
# 让人以为已经查过了。
set -e
cd "$(dirname "$0")/.."
TMP=$(mktemp -d)
fail=0

expect_fail() {
  name="$1"; file="$2"
  if python3 dev/check.py "$TMP" >/dev/null 2>&1; then
    echo "  FAIL $name（检查器没拦住）"
    fail=1
  else
    echo "  ok   $name"
  fi
  rm -f "$TMP/$file"
}

echo "== 检查器应当拦下这些 =="

cat > "$TMP/widget.tsx" <<'X'
import { Text, Widget } from "scripting"
Widget.present(<Text>hi</Text>)
console.log("这行永远不会跑")
X
expect_fail "Widget.present 之后还有代码" widget.tsx

cat > "$TMP/widget.tsx" <<'X'
import { Text, Widget } from "scripting"
function main() {
  Widget.present(<Text>hi</Text>)
  console.log("同一层，这行不会跑")
}
main()
X
expect_fail "present 之后同层还有代码（在函数里）" widget.tsx

cat > "$TMP/widget.tsx" <<'X'
import { Button, Text, Widget } from "scripting"
function main() {
  Widget.present(<Button label={<Text>hi</Text>} />)
}
main()
X
expect_fail "widget.tsx 里 Button 用 label= 属性" widget.tsx

cat > "$TMP/widget.tsx" <<'X'
import { Text, VStack, Widget } from "scripting"
function main() {
  Widget.present(<VStack widgetBackground={{ style: "systemBackground" }}><Text>hi</Text></VStack>)
}
main()
X
expect_fail "widget.tsx 里用 widgetBackground" widget.tsx

cat > "$TMP/a.tsx" <<'X'
import { GeometryReader, Text } from "scripting"
export function V() {
  return <GeometryReader frame={{ height: 6 }}>{(p) => <Text>{p.size.width}</Text>}</GeometryReader>
}
X
expect_fail "GeometryReader 带 props" a.tsx

cat > "$TMP/b.tsx" <<'X'
import { List, NavigationLink, Text } from "scripting"
export function V() {
  return <List toolbar={{ topBarTrailing: <NavigationLink destination={<Text>x</Text>} /> }} />
}
X
expect_fail "toolbar 里放 NavigationLink" b.tsx

cat > "$TMP/c.tsx" <<'X'
import { Text, useState } from "scripting"
export function V({ items }) {
  if (items.length === 0) return <Text>空</Text>
  const [n, setN] = useState(0)
  return <Text>{n}</Text>
}
X
expect_fail "Hooks 在提前 return 之后" c.tsx

cat > "$TMP/d.tsx" <<'X'
import { Text } from "scripting"
export function V() {
  return <MissingComponent><Text>x</Text></MissingComponent>
}
X
expect_fail "JSX 引用了不存在的组件" d.tsx

cat > "$TMP/e.tsx" <<'X'
import { Text } from "scripting"
export function V() {
  Navigation.present({ element: <Text>x</Text> })
  return <Text>x</Text>
}
X
expect_fail "用了 Navigation 却没导入" e.tsx

echo
echo "== 不该误报的写法 =="
cat > "$TMP/widget.tsx" <<'X'
import { Text, Widget } from "scripting"
function main() {
  Widget.present(<Text>hi</Text>)
}
main()
X
if python3 dev/check.py "$TMP" >/dev/null 2>&1; then
  echo "  ok   present 在函数里、末尾 main() 不误报"
fi
rm -f "$TMP/widget.tsx"

cat > "$TMP/widget.tsx" <<'X'
import { Text, Widget } from "scripting"
async function main() {
  const x = await Promise.resolve(1)
  Widget.present(<Text>{x}</Text>)
}
main()
X
if python3 dev/check.py "$TMP" >/dev/null 2>&1; then
  echo "  ok   小组件里的 async/await 不再误报（样本证明它可用）"
else
  echo "  FAIL 正确的 main() 收尾写法被误报"
  python3 dev/check.py "$TMP" || true
  fail=1
fi
rm -f "$TMP/widget.tsx"

cat > "$TMP/widget.tsx" <<'X'
/**
 * 注释里举反例写了 Widget.present(<Button label={<Body/>} />) 也不该被当成真调用。
 */
import { Text, Widget } from "scripting"
function main() {
  Widget.present(<Text>hi</Text>)
}
main()
X
if python3 dev/check.py "$TMP" >/dev/null 2>&1; then
  echo "  ok   注释里的 Widget.present 例子不误报"
else
  echo "  FAIL 注释里的 Widget.present 例子被当成真调用"
  python3 dev/check.py "$TMP" || true
  fail=1
fi
rm -f "$TMP/widget.tsx"

cat > "$TMP/widget.tsx" <<'X'
/**
 * 文档注释里的占位符不是 JSX：
 *   Authorization: Bearer <CMD_API_KEY>
 *   泛型写法 Array<Foo> 同理
 */
import { Text, Widget } from "scripting"
Widget.present(<Text>hi</Text>)
X
if python3 dev/check.py "$TMP" >/dev/null 2>&1; then
  echo "  ok   注释里的 <PLACEHOLDER> 不误报"
else
  echo "  FAIL 注释里的 <PLACEHOLDER> 被误报成组件"
  fail=1
fi
rm -f "$TMP/widget.tsx"

echo
echo "== 干净的文件应当通过 =="
cat > "$TMP/widget.tsx" <<'X'
import { Text, Widget } from "scripting"
Widget.present(<Text>hi</Text>)
X
if python3 dev/check.py "$TMP" >/dev/null 2>&1; then
  echo "  ok   干净文件不误报"
else
  echo "  FAIL 干净文件被误报"
  python3 dev/check.py "$TMP" || true
  fail=1
fi

rm -rf "$TMP"
[ "$fail" = 0 ] && echo "\n检查器自检通过" || echo "\n检查器自检失败"
exit $fail
