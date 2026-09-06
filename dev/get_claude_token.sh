#!/bin/sh
# 取本机 Claude Code 的 OAuth access token，直接复制到剪贴板。
#
# 只在本机跑，token 不打印到屏幕上（只显示前后各 8 个字符用于确认）。
# Mac 和 iPhone 登同一个 Apple ID 时有「通用剪贴板」，复制完直接在手机上长按粘贴即可。
#
# 用法：./dev/get_claude_token.sh

extract() {
  # 不管 JSON 怎么嵌套，token 的形状是固定的，直接按形状抠
  grep -o 'sk-ant-oat[A-Za-z0-9_-]*' | head -1
}

TOKEN=""

# 1) 钥匙串（Claude Code 在 macOS 上的默认存法）
for SERVICE in "Claude Code-credentials" "Claude Code" "claude-code"; do
  [ -n "$TOKEN" ] && break
  TOKEN=$(security find-generic-password -s "$SERVICE" -w 2>/dev/null | extract)
  [ -n "$TOKEN" ] && SOURCE="钥匙串「$SERVICE」"
done

# 2) 凭据文件（Linux / 某些版本的 macOS）
if [ -z "$TOKEN" ] && [ -f "$HOME/.claude/.credentials.json" ]; then
  TOKEN=$(extract < "$HOME/.claude/.credentials.json")
  [ -n "$TOKEN" ] && SOURCE="$HOME/.claude/.credentials.json"
fi

if [ -z "$TOKEN" ]; then
  echo "没找到 token。手动确认一下这两处："
  echo "  1) 钥匙串访问.app 里搜 Claude，看那条目叫什么名字"
  echo "  2) cat ~/.claude/.credentials.json"
  echo "找到之后要的是 sk-ant-oat 开头那一串（不是 sk-ant-api 开头的 API Key）。"
  exit 1
fi

printf %s "$TOKEN" | pbcopy 2>/dev/null && COPIED="已复制到剪贴板" || COPIED="（没有 pbcopy，自己复制）"

HEAD=$(printf %s "$TOKEN" | cut -c1-14)
TAIL=$(printf %s "$TOKEN" | rev | cut -c1-6 | rev)
LEN=$(printf %s "$TOKEN" | wc -c | tr -d ' ')

echo "来源：$SOURCE"
echo "token：$HEAD…$TAIL（共 $LEN 字符）"
echo "$COPIED"
echo
echo "接下来：iPhone 上打开「AI 额度」→ 添加账户 → Claude 订阅 → 长按粘贴到"
echo "「OAuth Access Token」→ 点「现在抓取」。"
echo
echo "注意：这个 token 有有效期，过期后小组件会显示「凭据无效或已过期 (401)」，"
echo "那时重跑一次这个脚本、重新粘一次即可。"
