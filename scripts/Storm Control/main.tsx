import {
  Button, Dialog, HStack, List, NavigationLink,
  Section, Spacer, Text, TextField,
  useEffect, useState,
} from "scripting"
import { api, loadConfig, saveConfig, isConfigured, storageBackend } from "./api"
import type { Candidate, Country, StatusResp } from "./api"

// ---------------------------------------------------------------- 设置页

function SettingsView({ onSaved }: { onSaved: () => void }) {
  const c = loadConfig()
  const [baseUrl, setBaseUrl] = useState(c.baseUrl)
  const [token, setToken] = useState(c.token)
  const [probe, setProbe] = useState("")

  async function test() {
    setProbe("测试中…")
    const saveErr = saveConfig({ baseUrl, token })
    if (saveErr) {
      setProbe("配置保存失败：" + saveErr)
      return
    }
    try {
      await api.ping()
      const s = await api.status()
      setProbe("连接正常，服务状态：" + s.service)
      onSaved()
    } catch (e: any) {
      setProbe("失败：" + (e?.message ?? String(e)))
    }
  }

  return (
    <List navigationTitle="设置">
      <Section header={<Text>服务器</Text>}>
        <TextField title="地址" value={baseUrl} onChanged={setBaseUrl}
          prompt="https://storm.example.com" />
        <TextField title="Token" value={token} onChanged={setToken} prompt="API token" />
      </Section>
      <Section>
        <Button title="保存并测试" action={test} />
        {probe ? <Text font="footnote">{probe}</Text> : null}
      </Section>
      <Section header={<Text>诊断</Text>} footer={
        <Text font="footnote">
          手机在境内无法直连 stormproxies 的 API（会被判 224），所有请求都要经这个服务器中转。
        </Text>
      }>
        <HStack>
          <Text>存储后端</Text><Spacer />
          <Text foregroundStyle="secondaryLabel">{storageBackend()}</Text>
        </HStack>
        <HStack>
          <Text>已保存地址</Text><Spacer />
          <Text foregroundStyle="secondaryLabel">
            {loadConfig().baseUrl ? "有" : "无"}
          </Text>
        </HStack>
      </Section>
    </List>
  )
}

// -------------------------------------------------------- 可筛选的选择列表

function PickList({
  title, items, current, onPick,
}: {
  title: string
  items: string[]
  current: string
  onPick: (v: string) => void
}) {
  const [q, setQ] = useState("")
  const kw = q.trim().replace(/\s+/g, "").toUpperCase()
  const shown = kw ? items.filter(x => x.toUpperCase().includes(kw)) : items

  return (
    <List navigationTitle={title}>
      <Section>
        <TextField title="筛选" value={q} onChanged={setQ} prompt="输入关键词" />
      </Section>
      <Section header={<Text>{"共 " + shown.length + " 项 · 选好后点左上角返回"}</Text>}>
        <Button title={"（不限）" + (current === "" ? "  ✓" : "")}
          action={() => onPick("")} />
        {shown.slice(0, 300).map(x => (
          <Button key={x} title={x + (x === current ? "  ✓" : "")}
            action={() => onPick(x)} />
        ))}
      </Section>
    </List>
  )
}

function CountryList({
  countries, current, onPick,
}: {
  countries: Country[]
  current: string
  onPick: (code: string) => void
}) {
  const [q, setQ] = useState("")
  const kw = q.trim().toUpperCase()
  const shown = kw
    ? countries.filter(c =>
        c.code.toUpperCase().includes(kw) ||
        (c.country ?? "").toUpperCase().includes(kw) ||
        (c.country_zh_cn ?? "").includes(q.trim()))
    : countries

  return (
    <List navigationTitle="选择国家">
      <Section>
        <TextField title="筛选" value={q} onChanged={setQ} prompt="US / 美国 / Japan" />
      </Section>
      <Section header={<Text>{"共 " + shown.length + " 个 · 选好后点左上角返回"}</Text>}>
        <Button title={"（不限）" + (current === "" ? "  ✓" : "")}
          action={() => onPick("")} />
        {shown.slice(0, 300).map(c => (
          <Button key={c.code}
            title={c.code + "  " + (c.country_zh_cn || c.country) + (c.code === current ? "  ✓" : "")}
            action={() => onPick(c.code)} />
        ))}
      </Section>
    </List>
  )
}

// ------------------------------------------------------------------ 主界面

export function MainView() {
  const [ready, setReady] = useState(isConfigured())
  const [status, setStatus] = useState<StatusResp | null>(null)
  const [err, setErr] = useState("")
  const [busy, setBusy] = useState("")

  const [countries, setCountries] = useState<Country[]>([])
  const [states, setStates] = useState<string[]>([])
  const [cities, setCities] = useState<string[]>([])

  const [country, setCountry] = useState("")
  const [state, setState] = useState("")
  const [city, setCity] = useState("")
  const [cand, setCand] = useState<Candidate[] | null>(null)

  async function refresh() {
    if (!isConfigured()) { setReady(false); return }
    setReady(true)
    setErr("")
    try {
      setStatus(await api.status())
    } catch (e: any) {
      setErr(e?.message ?? String(e))
    }
  }

  useEffect(() => { refresh() }, [])

  async function loadCountries() {
    if (countries.length > 0) return
    setBusy("加载国家…")
    try { setCountries(await api.countries()) }
    catch (e: any) { setErr(e?.message ?? String(e)) }
    finally { setBusy("") }
  }

  async function pickCountry(code: string) {
    setCountry(code); setState(""); setCity(""); setStates([]); setCities([]); setCand(null)
    if (!code) return
    setBusy("加载州/省…")
    try { setStates(await api.states(code)) }
    catch (e: any) { setErr(e?.message ?? String(e)) }
    finally { setBusy("") }
  }

  async function pickState(s: string) {
    setState(s); setCity(""); setCities([]); setCand(null)
    if (!s || !country) return
    setBusy("加载城市…")
    try { setCities(await api.cities(country, s)) }
    catch (e: any) { setErr(e?.message ?? String(e)) }
    finally { setBusy("") }
  }

  async function preview() {
    setBusy("查询候选…"); setErr("")
    try {
      const r = await api.ips(country, state, city)
      setCand(r.candidates)
    } catch (e: any) { setErr(e?.message ?? String(e)); setCand(null) }
    finally { setBusy("") }
  }

  async function doUp() {
    const where = [country || "不限", state, city].filter(Boolean).join(" / ")
    if (typeof Dialog === "undefined" || Dialog == null ||
        typeof (Dialog as any).confirm !== "function") {
      // Never spend an IP without a confirmation the user actually saw.
      setErr("这个 Scripting 版本没有 Dialog.confirm，为避免误扣额度已中止。")
      return
    }
    const ok = await Dialog.confirm({
      title: "更换出口 IP",
      message: "将提取一条新的住宅 IP（" + where + "），这会消耗 1 条套餐额度，有效期约 24 小时。",
      confirmLabel: "确认提取",
      cancelLabel: "取消",
    })
    if (!ok) return
    setBusy("提取中，约需 10 秒…"); setErr("")
    try {
      const r = await api.up(country, state, city)
      setStatus(r.status)
      setCand(null)
    } catch (e: any) { setErr(e?.message ?? String(e)) }
    finally { setBusy("") }
  }

  async function doStop() {
    setBusy("停止中…")
    try { setStatus((await api.down()).status) }
    catch (e: any) { setErr(e?.message ?? String(e)) }
    finally { setBusy("") }
  }

  async function doStart() {
    setBusy("启动中…")
    try { setStatus((await api.start()).status) }
    catch (e: any) { setErr(e?.message ?? String(e)) }
    finally { setBusy("") }
  }

  const t = status?.tunnel ?? null
  const running = status?.service === "active"

  return (
    <List navigationTitle="住宅代理">
      {!ready ? (
        <Section header={<Text>未配置</Text>}>
          <NavigationLink destination={<SettingsView onSaved={refresh} />}>
            <Text>先去设置服务器地址和 Token</Text>
          </NavigationLink>
        </Section>
      ) : null}

      <Section header={<Text>当前状态</Text>}>
        {busy ? <Text font="footnote">{"⏳ " + busy}</Text> : null}
        <HStack>
          <Text>代理服务</Text><Spacer />
          <Text foregroundStyle={running ? "systemGreen" : "secondaryLabel"}>
            {running ? "运行中" : (status?.service ?? "未知")}
          </Text>
        </HStack>
        <HStack>
          <Text>出口 IP</Text><Spacer />
          <Text foregroundStyle="secondaryLabel">{t?.ip ?? "无"}</Text>
        </HStack>
        <HStack>
          <Text>地区</Text><Spacer />
          <Text foregroundStyle="secondaryLabel">
            {t ? [t.country, t.state, t.city].filter(Boolean).join(" / ") || "未知" : "—"}
          </Text>
        </HStack>
        <HStack>
          <Text>剩余有效期</Text><Spacer />
          <Text foregroundStyle={t?.expired ? "systemRed" : "secondaryLabel"}>
            {t?.hours_left == null ? "未知" :
              (t.hours_left <= 0 ? "已过期" : t.hours_left.toFixed(1) + " 小时")}
          </Text>
        </HStack>
        <HStack>
          <Text>今日已消耗</Text><Spacer />
          <Text foregroundStyle="secondaryLabel">
            {(status?.spends_today ?? 0) + " / " + (status?.max_spend_per_day ?? 0) + " 条"}
          </Text>
        </HStack>
        <Button title="刷新" action={refresh} />
      </Section>

      {err ? (
        <Section header={<Text>出错</Text>}>
          <Text foregroundStyle="systemRed" font="footnote">{err}</Text>
        </Section>
      ) : null}

      <Section header={<Text>选择地区</Text>} footer={
        <Text font="footnote">留空表示不限。查询地区和候选都不消耗额度。</Text>
      }>
        <NavigationLink destination={
          <CountryList countries={countries} current={country} onPick={pickCountry} />
        }>
          <HStack>
            <Text>国家</Text><Spacer />
            <Text foregroundStyle="secondaryLabel">{country || "不限"}</Text>
          </HStack>
        </NavigationLink>
        <Button title={countries.length ? "国家列表已加载" : "加载国家列表"}
          action={loadCountries} />

        <NavigationLink destination={
          <PickList title="选择州/省" items={states} current={state} onPick={pickState} />
        }>
          <HStack>
            <Text>州/省</Text><Spacer />
            <Text foregroundStyle="secondaryLabel">{state || "不限"}</Text>
          </HStack>
        </NavigationLink>

        <NavigationLink destination={
          <PickList title="选择城市" items={cities} current={city} onPick={setCity} />
        }>
          <HStack>
            <Text>城市</Text><Spacer />
            <Text foregroundStyle="secondaryLabel">{city || "不限"}</Text>
          </HStack>
        </NavigationLink>

        <Button title="查看候选（免费）" action={preview} />
        {cand ? (
          <Text font="footnote">
            {cand.length > 0
              ? "共 " + cand.length + " 条可用，例：" + cand[0].userip + "  " + cand[0].city
              : "该地区没有候选，换一个"}
          </Text>
        ) : null}
      </Section>

      <Section header={<Text>操作</Text>} footer={
        <Text font="footnote">
          提取会消耗 1 条额度，拿到的是一个新的出口 IP，约 24 小时后失效。
        </Text>
      }>
        <Button title="提取新 IP 并启动（消耗 1 条）" action={doUp} />
        <Button title="用现有隧道启动" action={doStart} />
        <Button title="停止代理" action={doStop} />
      </Section>

      <Section>
        <NavigationLink destination={<SettingsView onSaved={refresh} />}>
          <Text>设置</Text>
        </NavigationLink>
      </Section>
    </List>
  )
}
