#!/bin/sh
# 用 esbuild 把三个入口各打一遍包。
#
# 抓的是静态检查抓不到的另一半：语法错、本地 import 路径写错、导出名拼错。
# "scripting" 标成 external —— 那是 App 提供的运行时，本地没有。
set -e
cd "$(dirname "$0")/.."
OUT=$(mktemp -d)
for entry in index.tsx widget.tsx app_intents.tsx; do
  printf "  %-18s " "$entry"
  npx --yes esbuild@0.24.0 "app/$entry" \
    --bundle --format=esm --jsx=automatic --jsx-import-source=scripting \
    --external:scripting --outfile="$OUT/${entry%.tsx}.mjs" \
    --log-level=warning
  echo "ok"
done
rm -rf "$OUT"
echo "  打包全部通过"
