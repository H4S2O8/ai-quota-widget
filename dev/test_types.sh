#!/bin/sh
# 类型检查。
#
# esbuild 只看语法和 import 路径，看不出「给接口加了必填字段但某个调用点没传」。
# 那类错误在这个平台上是运行时才炸的，而运行时又几乎不给报错。
#
# 平台没有官方类型定义，所以 dev/typecheck/scripting.d.ts 把 "scripting" 声明成
# any —— 目的不是校验 UI 组件的 props，是校验我们自己那几个接口。
set -e
cd "$(dirname "$0")/typecheck"
npx --yes -p typescript@5.6.3 tsc -p tsconfig.json
echo "  类型检查通过"
