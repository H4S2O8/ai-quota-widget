import { FileManager, Storage } from "scripting"

const K_BASE = "storm.baseUrl"
const K_TOKEN = "storm.token"

export type Config = { baseUrl: string; token: string }

export type TunnelInfo = {
  ip: string | null
  gateway: string | null
  country: string | null
  state: string | null
  city: string | null
  postal: string | null
  age_hours: number | null
  hours_left: number | null
  expired: boolean
}

export type StatusResp = {
  service: string
  spends_today: number
  max_spend_per_day: number
  tunnel: TunnelInfo | null
}

export type Country = { code: string; country: string; country_zh_cn: string; db: string }
export type Candidate = {
  userip: string; userarea: string; province: string; city: string
  postal: string; id: string
}

// ---------------------------------------------------------------- 配置存储
//
// `Storage` does not exist in every Scripting build -- on older ones the
// import resolves to undefined and the first `Storage.get` throws during
// render, which shows up as a blank screen with no error. So probe for it and
// fall back to a JSON file.
//
// The file lives in the app-group directory when available: widgets run in a
// separate extension process and only see app-group storage.

function storageAvailable(): boolean {
  try {
    return typeof Storage !== "undefined" && Storage != null &&
           typeof (Storage as any).get === "function" &&
           typeof (Storage as any).set === "function"
  } catch {
    return false
  }
}

function configPath(): string {
  const fm: any = FileManager
  const dir = fm.appGroupDocumentsDirectory ?? fm.documentsDirectory
  return dir + "/storm-control.json"
}

export function storageBackend(): string {
  return storageAvailable() ? "Storage" : "FileManager"
}

export function loadConfig(): Config {
  try {
    if (storageAvailable()) {
      return {
        baseUrl: (Storage.get<string>(K_BASE) ?? "").trim(),
        token: (Storage.get<string>(K_TOKEN) ?? "").trim(),
      }
    }
    const p = configPath()
    if (!FileManager.existsSync(p)) return { baseUrl: "", token: "" }
    const o = JSON.parse(FileManager.readAsStringSync(p))
    return { baseUrl: String(o?.baseUrl ?? "").trim(), token: String(o?.token ?? "").trim() }
  } catch {
    return { baseUrl: "", token: "" }
  }
}

export function saveConfig(c: Config): string {
  const baseUrl = c.baseUrl.trim().replace(/\/+$/, "")
  const token = c.token.trim()
  try {
    if (storageAvailable()) {
      Storage.set(K_BASE, baseUrl)
      Storage.set(K_TOKEN, token)
      return ""
    }
    FileManager.writeAsStringSync(configPath(), JSON.stringify({ baseUrl, token }))
    return ""
  } catch (e: any) {
    return String(e?.message ?? e)
  }
}

export function isConfigured(): boolean {
  const c = loadConfig()
  return c.baseUrl.length > 0 && c.token.length > 0
}

async function req<T>(path: string, init?: { method?: string; body?: any }): Promise<T> {
  const c = loadConfig()
  if (!c.baseUrl) throw new Error("尚未配置服务器地址")
  const headers: Record<string, string> = { Authorization: "Bearer " + c.token }
  let body: string | undefined
  if (init?.body !== undefined) {
    headers["Content-Type"] = "application/json"
    body = JSON.stringify(init.body)
  }
  const resp = await fetch(c.baseUrl + path, {
    method: init?.method ?? "GET",
    headers,
    body,
  })
  const text = await resp.text()
  let data: any = null
  try { data = text ? JSON.parse(text) : null } catch { /* non-JSON error page */ }
  if (!resp.ok) {
    const msg = (data && (data.error || data.detail)) || text.slice(0, 200) || ("HTTP " + resp.status)
    throw new Error("HTTP " + resp.status + ": " + msg)
  }
  return data as T
}

export const api = {
  ping: () => req<{ ok: boolean }>("/api/ping"),
  status: () => req<StatusResp>("/api/status"),
  countries: () => req<{ countries: Country[] }>("/api/countries").then(r => r.countries),
  states: (country: string) =>
    req<{ states: string[] }>("/api/states?country=" + encodeURIComponent(country))
      .then(r => r.states),
  cities: (country: string, state: string) =>
    req<{ cities: string[] }>("/api/cities?country=" + encodeURIComponent(country) +
      "&state=" + encodeURIComponent(state)).then(r => r.cities),
  ips: (country: string, state: string, city: string) =>
    req<{ count: number; candidates: Candidate[] }>(
      "/api/ips?country=" + encodeURIComponent(country) +
      "&state=" + encodeURIComponent(state) +
      "&city=" + encodeURIComponent(city)),
  up: (country: string, state: string, city: string) =>
    req<{ ok: boolean; status: StatusResp }>("/api/up", {
      method: "POST",
      body: { confirm: true, country, state, city },
    }),
  down: () => req<{ ok: boolean; status: StatusResp }>("/api/down", { method: "POST" }),
  start: () => req<{ ok: boolean; status: StatusResp }>("/api/start", { method: "POST" }),
}

export function describeTunnel(t: TunnelInfo | null): string {
  if (!t || !t.ip) return "无隧道"
  const where = [t.country, t.city].filter(Boolean).join(" / ") || "未知地区"
  if (t.hours_left == null) return t.ip + "  " + where
  if (t.hours_left <= 0) return t.ip + "  已过期"
  return t.ip + "  剩 " + t.hours_left.toFixed(1) + "h"
}
