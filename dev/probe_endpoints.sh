#!/bin/sh
# 用一个**无效**凭据打一遍各服务商的额度接口，只看它还在不在。
#
# 401 = 路径和鉴权方式都对，只是 key 是假的 —— 这正是我们想要的。
# 404 = 接口挪了或删了，对应的 p_*.ts 要改。
# 其他 = 自己看。
#
# 这是这个项目在没有真实凭据的情况下，能对「内置服务商还能不能用」做的最强验证。
# 觉得某个服务商忽然一直报错时，先跑这个，能立刻分清是「你的 key 过期了」还是
# 「人家把接口改了」。
KEY="probe-invalid-key"
probe() {
  printf "%-52s " "$1"
  code=$(curl -s -o /tmp/aiquota-probe.txt -w "%{http_code}" -m 15 \
    -H "Authorization: Bearer $KEY" ${2:+-H "$2"} "$1" 2>/dev/null)
  case "$code" in
    401|403) verdict="接口在（凭据被拒，符合预期）" ;;
    404)     verdict="!! 404，接口可能已经变了" ;;
    000)     verdict="!! 连不上（网络或代理问题）" ;;
    *)       verdict="?? HTTP $code，自己看下面这段" ;;
  esac
  printf "%-3s %s\n" "$code" "$verdict"
  case "$code" in
    401|403) ;;
    *) sed -n '1,3p' /tmp/aiquota-probe.txt | cut -c1-160 | sed 's/^/       /' ;;
  esac
}

echo "服务商额度接口探活（用无效凭据）"
echo
probe "https://openrouter.ai/api/v1/credits"
probe "https://openrouter.ai/api/v1/key"
probe "https://api.deepseek.com/user/balance"
probe "https://api.siliconflow.cn/v1/user/info"
probe "https://api.moonshot.cn/v1/users/me/balance"
probe "https://api.anthropic.com/api/oauth/usage" "anthropic-beta: oauth-2025-04-20"
rm -f /tmp/aiquota-probe.txt
echo
echo "one-api 中转站和自定义接口靠你自己填地址，这里探不了。"
