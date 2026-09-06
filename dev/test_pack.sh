#!/bin/sh
# 检查打出来的包是不是自洽的。
#
# 存在的理由：有过一次连续四个版本发出坏包的事故。pack.sh 当时是写死的文件列表，
# 新加的两个 provider 没进去，providers.ts 却在 import 它们。Mac 上一切正常
# （app/ 目录是全的），手机上装完直接起不来。
#
# 所以这里验的不是「文件数量对不对」，而是**包内每一条相对 import 都能在包里解析到**。
# 这条不变式一旦成立，「漏打包」就不可能再发生。
set -e
cd "$(dirname "$0")/.."
PKG="AI-Quota.scripting"
[ -f "$PKG" ] || { echo "  没有 $PKG，先跑 dev/pack.sh"; exit 1; }

TMP=$(mktemp -d)
unzip -q "$PKG" -d "$TMP"
fail=0

# 1) script.json 必须在根目录
if [ -f "$TMP/script.json" ]; then
  echo "  ok   script.json 在包的根目录"
else
  echo "  FAIL script.json 不在根目录（Scripting 只认这种结构）"
  fail=1
fi

# 2) app/ 里的每个源文件都要在包里
missing_src=$(cd app && ls -1 *.ts *.tsx 2>/dev/null | while read -r f; do
  [ -f "$TMP/$f" ] || echo "$f"
done)
if [ -z "$missing_src" ]; then
  echo "  ok   app/ 下的源文件一个不落"
else
  echo "  FAIL 这些文件在 app/ 里但没进包：$(echo $missing_src | tr '\n' ' ')"
  fail=1
fi

# 3) 每条相对 import 都要能在包里解析到（这条才是真正的不变式）
unresolved=$(cd "$TMP" && grep -hoE 'from "\./[A-Za-z0-9_.-]+"' ./*.ts ./*.tsx 2>/dev/null \
  | sed 's/.*"\.\///; s/"$//' | sort -u | while read -r m; do
    [ -f "$m" ] || [ -f "$m.ts" ] || [ -f "$m.tsx" ] || echo "$m"
  done)
if [ -z "$unresolved" ]; then
  echo "  ok   包内每条相对 import 都解析得到"
else
  echo "  FAIL 包里 import 了不存在的模块：$(echo $unresolved | tr '\n' ' ')"
  echo "       手机上的症状是「装了但起不来」"
  fail=1
fi

# 4) 入口文件必须齐
for e in index.tsx widget.tsx app_intents.tsx; do
  [ -f "$TMP/$e" ] || { echo "  FAIL 缺入口 $e"; fail=1; }
done
[ "$fail" = 0 ] && echo "  ok   三个入口文件都在"

rm -rf "$TMP"
exit $fail
