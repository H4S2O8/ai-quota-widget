#!/bin/sh
# 取本机 Codex CLI 的凭据，拼成一行方便往手机上带。
#
# 只在本机跑。access_token 和 refresh_token 不完整打印，只显示首尾几位用于确认。
#
# 用法：./dev/get_codex_token.sh
AUTH="$HOME/.codex/auth.json"

if [ ! -f "$AUTH" ]; then
  echo "没找到 $AUTH"
  echo "先在这台机器上跑一次 codex login。"
  exit 1
fi

python3 - "$AUTH" <<'PY'
import json, subprocess, sys

path = sys.argv[1]
try:
    with open(path) as f:
        auth = json.load(f)
except Exception as exc:
    print(f"读不了 {path}：{exc}")
    raise SystemExit(1)

mode = auth.get("auth_mode")
if mode and mode != "chatgpt":
    print(f"auth_mode 是 {mode!r}，不是 'chatgpt'。")
    print("这个 provider 读的是 ChatGPT 订阅的用量窗口，API Key 模式没有这个东西。")
    raise SystemExit(1)

tokens = auth.get("tokens") or {}
access = tokens.get("access_token")
account = tokens.get("account_id")
refresh = tokens.get("refresh_token")

missing = [n for n, v in (("access_token", access), ("account_id", account)) if not v]
if missing:
    print("auth.json 里缺：" + "、".join(missing))
    print("重新跑一次 codex login。")
    raise SystemExit(1)

def mask(v):
    return f"{v[:8]}…{v[-4:]}（共 {len(v)} 字符）" if v else "（没有）"

print(f"account_id    = {account}")
print(f"access_token  = {mask(access)}")
print(f"refresh_token = {mask(refresh)}")
print()

# account_id 不敏感，直接给出来；两个 token 分别复制
# 主角是 refresh_token：access_token 会被自动换出来。
payload = refresh or access
try:
    subprocess.run(["pbcopy"], input=payload.encode(), check=True)
    print(f"{'refresh_token' if refresh else 'access_token'} 已复制到剪贴板。")
except Exception:
    print("没有 pbcopy，自己从 auth.json 里复制。")

print()
print("手机上：AI 额度 → 添加账户 → Codex / ChatGPT")
print(f"  account_id     直接输入：{account}")
print( "  refresh_token  长按粘贴（已在剪贴板）")
print( "  access_token   留空即可，App 会用 refresh_token 换出来")
if not refresh:
    print()
    print("auth.json 里没有 refresh_token —— 那就只能填 access_token，几小时后要重取。")
    print("在电脑上重新跑一次 codex login 通常会带上它。")
PY

# --refresh：单独把 refresh_token 放进剪贴板
if [ "$1" = "--refresh" ]; then
  python3 - "$AUTH" <<'PY'
import json, subprocess, sys
with open(sys.argv[1]) as f:
    tok = (json.load(f).get("tokens") or {}).get("refresh_token")
if not tok:
    print("auth.json 里没有 refresh_token。")
    raise SystemExit(1)
subprocess.run(["pbcopy"], input=tok.encode(), check=False)
print(f"refresh_token 已复制到剪贴板（{tok[:8]}…{tok[-4:]}，共 {len(tok)} 字符）")
PY
fi
