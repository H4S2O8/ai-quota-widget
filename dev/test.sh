#!/bin/sh
# 没有手机也能做完的全部验证。改完代码先跑这个。
set -e
cd "$(dirname "$0")/.."
echo "== 静态检查 =="
python3 dev/check.py app
echo
echo "== 检查器自己 =="
./dev/test_check.sh
echo
echo "== 打包（语法 / 本地 import） =="
./dev/test_bundle.sh
echo
echo "== 打包自洽（漏打包会让手机上装了起不来）=="
./dev/pack.sh >/dev/null
./dev/test_pack.sh
echo
echo "== 纯逻辑 =="
node dev/test_logic.mjs
echo
echo "全部通过。真机上还要验的东西见 dev/NOTES.md 的「待验证」。"
