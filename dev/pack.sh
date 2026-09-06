#!/bin/sh
# 打成可导入 Scripting 的包。
#
# 文件列表**不能写死**。第一版写死了，后来加的两个 provider 文件没被加进列表，
# 于是连续四个版本发出去的包里 providers.ts 在 import 两个不存在的文件——
# 手机上的症状是「装了但起不来」，而且这个错在 Mac 上完全看不见，
# 因为 app/ 目录里文件是齐的。
#
# 现在改成收集 app/ 下的全部文件。要排除什么，写进下面的 EXCLUDE。
set -e
cd "$(dirname "$0")/.."
OUT_NAME="AI-Quota.scripting"

# 不进包的东西（手机上用不到的）。目前没有，留着占位。
EXCLUDE=""

cd app
rm -f "../$OUT_NAME"
FILES=$(ls -1 script.json *.ts *.tsx 2>/dev/null | sort)
if [ -n "$EXCLUDE" ]; then
  FILES=$(echo "$FILES" | grep -vE "$EXCLUDE")
fi

# script.json 必须在包里，且必须在根目录（Scripting 只认这种）
echo "$FILES" | grep -qx "script.json" || { echo "script.json 不在打包列表里"; exit 1; }

# shellcheck disable=SC2086
zip -q -X "../$OUT_NAME" $FILES
cd ..
cp "$OUT_NAME" AI-Quota.zip
unzip -l "$OUT_NAME"
