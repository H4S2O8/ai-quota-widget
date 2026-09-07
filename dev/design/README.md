# 小组件视觉方案

`mock.html` 是三版方案的静态样张，用无头 Chrome 渲染成 `mock.png`：

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless --disable-gpu --screenshot=mock.png \
  --window-size=1300,2450 --hide-scrollbars --force-device-scale-factor=2 mock.html
```

`compare.html` / `compare.png` 是只含中小尺寸的对照图。

## 为什么用 HTML 打样而不是直接改 widget.tsx

真机是唯一的渲染事实，但一轮真机验证的成本是「改代码 → 发版 → 手机更新 → 看」。
配色和排版这种需要来回比较的事，用 HTML 先收敛到一版，再一次性搬进 TSX，
省掉大部分往返。**样张不能替代真机验证，只能减少次数。**

## 深浅色怎么适配

不用 `{light, dark}` 动态色，也不用 `"secondaryLabel"` 这类语义色——两者在这个
小组件里都没验证过，而且曾经和「一片漆黑」搅在一起分不清。

改用 `Device.colorScheme`（TS 版 Device API 里文档化的，返回 `"light"` / `"dark"`），
渲染时读一次，从两套**扁平 hex** 里选一套。背景自己画，前景对比度就完全可控。

## 配色是校验过的，但校验的是正确的那一项

先用 dataviz 的分类调色板校验器跑，结果 FAIL：警告色和危险色在色觉障碍下
ΔE 只有 2.8。但那个校验器的 scope 写着「仅限分类调色板；单独的状态/文字色
应当查 WCAG 文字对比度」——状态色不是分类色，它有二重编码（数字本身、条长）。

所以按 WCAG 文字对比度重新查，并把警告色和危险色拉开：

| | 日间 | 夜间 |
| --- | --- | --- |
| good | `#15803D` | `#4ADE80` |
| warn | `#A16207` | `#F5C451` |
| bad  | `#BE123C` | `#FF8080` |

六种表面下全部 ≥ 4.5:1。三级文字（时间戳）也从 2.4 提到 3.3 以上。

**教训：校验器报 FAIL 时，先确认它检查的是不是你这件事。** 硬凑一组能过分类
校验的状态色，反而会牺牲「红=危险、黄=警告」这个更重要的约定。
