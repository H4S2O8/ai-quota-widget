#!/bin/sh
# 打成可导入 Scripting 的包。
#
# Scripting 只认「根目录里就是 script.json」的 zip —— GitHub 的 Source code (zip)
# 会多套一层仓库名目录，导进去是失败的。
set -e
cd "$(dirname "$0")/../app"
OUT="../AI-Quota.scripting"
rm -f "$OUT"
zip -q -X "$OUT" script.json index.tsx widget.tsx app_intents.tsx editor.tsx ui.tsx \
  theme.ts types.ts util.ts view.ts store.ts refresh.ts providers.ts \
  p_anthropic.ts p_openrouter.ts p_deepseek.ts p_siliconflow.ts p_moonshot.ts \
  p_oneapi.ts p_generic.ts
unzip -l "$OUT"
