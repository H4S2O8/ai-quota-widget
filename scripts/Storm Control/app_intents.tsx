import { AppIntentManager, AppIntentProtocol, Widget } from "scripting"
import { api, isConfigured } from "./api"

// AppIntentPerform is `(params) => Promise<void>`: the return value is
// discarded, so these report through the widget rather than a result string.

export const RefreshIntent = AppIntentManager.register({
  name: "StormRefreshIntent",
  protocol: AppIntentProtocol.AppIntent,
  perform: async () => {
    if (!isConfigured()) return
    try {
      await api.status()
      Widget.reloadAll()
    } catch { /* widget shows the error on its next refresh */ }
  },
})

// SPENDS ONE IP each time it runs. Bind it to a Shortcut deliberately, not to
// anything that can fire on a schedule.
export const RotateIntent = AppIntentManager.register({
  name: "StormRotateIntent",
  protocol: AppIntentProtocol.AppIntent,
  perform: async (params: { country?: string; state?: string; city?: string } | undefined) => {
    if (!isConfigured()) return
    try {
      await api.up(params?.country ?? "", params?.state ?? "", params?.city ?? "")
    } catch { /* surfaced by the widget / main UI */ }
    Widget.reloadAll()
  },
})

export const StopIntent = AppIntentManager.register({
  name: "StormStopIntent",
  protocol: AppIntentProtocol.AppIntent,
  perform: async () => {
    if (!isConfigured()) return
    try { await api.down() } catch { /* ignore */ }
    Widget.reloadAll()
  },
})
