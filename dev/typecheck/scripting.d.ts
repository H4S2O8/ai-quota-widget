/**
 * "scripting" 模块的最小声明。
 *
 * 用的是 TypeScript 的「简写环境模块」：只写模块名、不写内容，从它导入的一切
 * 都是 any。平台没有发布类型定义，而我们要检查的也不是它——是**我们自己写的
 * 那部分**：接口字段有没有漏传、函数签名对不对。
 *
 * 这个 shim 存在的直接原因：给 FetchContext 加了两个必填字段，只改了 refresh.ts，
 * 漏了 editor.tsx。esbuild 打包照过，真机上「现在抓取」永远报「退避中」。
 * 语法检查抓不到的东西，类型检查能抓到。
 */
declare module "scripting"

declare namespace JSX {
  interface IntrinsicElements {
    [name: string]: any
  }
  interface Element {}
  interface ElementChildrenAttribute {
    children: {}
  }
}

/**
 * 用到的全局对象要写**真实签名**，不能一律 any。
 *
 * 真实教训：`Pasteboard.getString()` 返回 Promise，我当同步值用了，拿到的是
 * 字符串 "[object Promise]"。因为它当时是 any，tsc 一声不吭。
 * 只有写了签名，「漏了 await」才会被拦住。
 */
declare const Pasteboard:
  | {
      getString(): Promise<string | null>
      setString(s: string | null): Promise<void>
    }
  | undefined

// 其余全局暂时只求「存在」，用到哪个就把哪个的签名补上
declare const FileManager: any
declare const Keychain: any
declare const Storage: any
declare const Data: any
declare const SQLite: any
declare const Device: any
declare const UUID: any
declare const Crypto: any
