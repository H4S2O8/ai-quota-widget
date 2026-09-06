/**
 * 小组件上的「刷新」按钮。
 *
 * 所有 AppIntent 必须定义在这个文件里（Script.env === "app_intents"），
 * 不能挪进 widget.tsx。
 *
 * 这里干的活和小组件自刷新是同一段代码，区别只是它由用户点触发，因此
 * **不看数据新不新，一律抓**——用户点刷新就是不信任当前这份数据。
 */
import { AppIntentManager, AppIntentProtocol, Widget } from "scripting"
import { refreshAccounts } from "./refresh"
import { loadConfig, loadSnapshot, saveSnapshot } from "./store"

export const RefreshQuotaIntent = AppIntentManager.register({
  name: "RefreshQuotaIntent",
  protocol: AppIntentProtocol.AppIntent,
  perform: async (_params: undefined) => {
    const config = await loadConfig()
    const snapshot = await loadSnapshot()
    const outcome = await refreshAccounts(config, snapshot)
    await saveSnapshot(outcome.snapshot)
    // 抓完必须让 WidgetKit 重画，否则用户看到按钮按下去但数字没动。
    Widget.reloadAll()
  },
})
