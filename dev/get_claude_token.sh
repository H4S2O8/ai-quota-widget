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

# 从凭据里同时抠出 access token 和 refresh token。
#
# access token 只有几个小时寿命，refresh token 才是长期的那个——两个都要，
# 填进 App 之后才能自动续，不用每次过期都回来跑一遍这个脚本。
extract_json() {
  python3 -c '
import json, re, sys
raw = sys.stdin.read()
acc = ref = None
try:
    data = json.loads(raw)
    def walk(node):
        global acc, ref
        if isinstance(node, dict):
            for k, v in node.items():
                lk = k.lower()
                if isinstance(v, str):
                    if "refresh" in lk and "token" in lk and not ref:
                        ref = v
                    elif "access" in lk and "token" in lk and not acc:
                        acc = v
                else:
                    walk(v)
        elif isinstance(node, list):
            for item in node:
                walk(item)
    walk(data)
except Exception:
    pass
if not acc:
    m = re.search(r"sk-ant-oat[A-Za-z0-9_-]*", raw)
    acc = m.group(0) if m else None
print(acc or "")
print(ref or "")
'
}

RAW=""
for SERVICE in "Claude Code-credentials" "Claude Code" "claude-code"; do
  [ -n "$RAW" ] && break
  RAW=$(security find-generic-password -s "$SERVICE" -w 2>/dev/null)
  [ -n "$RAW" ] && SOURCE="钥匙串「$SERVICE」"
done
if [ -z "$RAW" ] && [ -f "$HOME/.claude/.credentials.json" ]; then
  RAW=$(cat "$HOME/.claude/.credentials.json")
  SOURCE="$HOME/.claude/.credentials.json"
fi

if [ -z "$RAW" ]; then
  echo "没找到凭据。手动确认一下这两处："
  echo "  1) 钥匙串访问.app 里搜 Claude，看那条目叫什么名字"
  echo "  2) cat ~/.claude/.credentials.json"
  exit 1
fi

PARSED=$(printf %s "$RAW" | extract_json)
TOKEN=$(printf %s "$PARSED" | sed -n '1p')
REFRESH=$(printf %s "$PARSED" | sed -n '2p')

if [ -z "$TOKEN" ]; then
  echo "在 $SOURCE 里没找到 access token。"
  exit 1
fi

printf %s "$RAW" | pbcopy 2>/dev/null && COPIED="整段凭据已复制到剪贴板（手机上点「粘贴凭据」一键填入）" || COPIED="（没有 pbcopy，自己复制）"

mask() {
  printf "%s…%s（共 %s 字符）" "$(printf %s "$1" | cut -c1-12)" "$(printf %s "$1" | rev | cut -c1-4 | rev)" "$(printf %s "$1" | wc -c | tr -d ' ')"
}

echo "来源：$SOURCE"
echo "access  token：$(mask "$TOKEN")"
if [ -n "$REFRESH" ]; then
  echo "refresh token：$(mask "$REFRESH")"
else
  echo "refresh token：没找到（那就只能过期后手动重取）"
fi
echo "$COPIED"
echo
echo "iPhone 上：AI 额度 → 添加账户 → Claude 订阅"
echo "  只填 Refresh Token 就够了，Access Token 那格可以留空 ——"
echo "  它只有几个小时寿命，App 会用 refresh token 自动换出来。"
if [ -n "$REFRESH" ]; then
  echo
  echo "取 refresh token（这才是要填的那个）：./dev/get_claude_token.sh --refresh"
fi

# --refresh：单独把 refresh token 放进剪贴板
if [ "$1" = "--refresh" ]; then
  if [ -z "$REFRESH" ]; then
    echo
    echo "凭据里没有 refresh token。"
    exit 1
  fi
  printf %s "$REFRESH" | pbcopy 2>/dev/null && echo && echo "refresh token 已复制到剪贴板。"
fi
