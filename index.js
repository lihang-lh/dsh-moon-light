/**
 * dsh-mood-light — DSH 服务端插件入口。
 *
 * 本插件的实际功能只运行在浏览器端（见 client.js，通过 package.json 的
 * `dsh.client` 声明被 web 前端加载）。这里保留一个空的 apply 函数，用于满足
 * Cordis loader 对根插件入口的加载要求，避免服务端启动阶段直接导入浏览器代码。
 */
export function apply() {}
