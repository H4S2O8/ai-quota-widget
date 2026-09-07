#!/bin/sh
# 发一个版本。把「打包 → 测试 → 推送 → 建 release → 传附件 → 刷 CDN → 验证」
# 串成一条，因为其中任何一步漏掉都很难当场发现。
#
# 已经踩过的两次：
#   1. gh release create 用 heredoc 写发布说明时，附件参数被 heredoc 吃掉了，
#      连着两个版本的 release 是空的 —— 安装链直接 404。
#   2. 自动更新指向 raw.githubusercontent.com，在国内网络下时好时坏。
#
# 用法：./dev/release.sh v0.5.1 "标题" 发布说明文件
set -e
cd "$(dirname "$0")/.."
TAG="$1"; TITLE="$2"; NOTES="$3"
REPO="H4S2O8/ai-quota-widget"
[ -n "$TAG" ] && [ -n "$TITLE" ] && [ -n "$NOTES" ] || {
  echo "用法：./dev/release.sh <tag> <标题> <发布说明文件>"; exit 1; }
[ -f "$NOTES" ] || { echo "发布说明文件不存在：$NOTES"; exit 1; }

VERSION=$(python3 -c "import json;print(json.load(open('app/script.json'))['version'])")
echo "script.json 里的版本：$VERSION    tag：$TAG"
case "$TAG" in
  "v$VERSION") ;;
  *) echo "!! tag 和 script.json 的 version 对不上。改完代码要把 version 加一，"
     echo "   否则手机上拉到新包也不会更新。"; exit 1 ;;
esac

echo "== 测试 =="
./dev/test.sh >/dev/null && echo "  通过"

echo "== 打包 =="
./dev/pack.sh >/dev/null
./dev/test_pack.sh

echo "== 推送 =="
git add -A
git diff --cached --quiet || git commit -q -F - <<COMMIT
$TITLE

$(cat "$NOTES")
COMMIT
git push -q origin main

echo "== 建 release（附件写在最后，且不与 heredoc 混用）=="
gh release create "$TAG" --repo "$REPO" --title "$TITLE" --notes-file "$NOTES" \
  AI-Quota.scripting AI-Quota.zip >/dev/null
ASSETS=$(gh release view "$TAG" --repo "$REPO" --json assets --jq '[.assets[].name] | join(",")')
[ -n "$ASSETS" ] || { echo "!! release 没有附件"; exit 1; }
echo "  附件：$ASSETS"

echo "== 刷 jsDelivr 缓存 =="
curl -s -o /dev/null "https://purge.jsdelivr.net/gh/$REPO@main/AI-Quota.zip" || true
sleep 3

echo "== 验证三条对外链接都拿到 $VERSION =="
fail=0
check_url() {
  printf "  %-28s " "$1"
  tmp=$(mktemp)
  code=$(curl -sL -o "$tmp" -w "%{http_code}" -m 40 "$2")
  got=$(unzip -p "$tmp" script.json 2>/dev/null | python3 -c "import json,sys;print(json.load(sys.stdin)['version'])" 2>/dev/null)
  if [ "$got" = "$VERSION" ]; then echo "ok  HTTP $code  v$got"; else echo "!! HTTP $code  拿到的是 '${got:-非 zip}'"; fail=1; fi
  rm -f "$tmp"
}
check_url "安装 .scripting" "https://github.com/$REPO/releases/latest/download/AI-Quota.scripting"
check_url "安装 .zip"       "https://github.com/$REPO/releases/latest/download/AI-Quota.zip"
check_url "自动更新 jsDelivr" "https://cdn.jsdelivr.net/gh/$REPO@main/AI-Quota.zip"
[ "$fail" = 0 ] || { echo; echo "有链接没拿到新版本，CDN 可能还没同步，过一会儿再验一次。"; exit 1; }
echo
echo "发布完成：https://github.com/$REPO/releases/tag/$TAG"
