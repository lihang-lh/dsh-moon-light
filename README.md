# dsh-mood-light — 会话氛围灯

[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

给 DSH Web 界面加一圈氛围光：根据当前会话的运行状态，在屏幕最外层自动显示
不同颜色、不同转速/闪动节奏的光。**默认柔光晕（散光）**——无边框、由屏幕边缘
平滑向内淡出的多层内散射光，并带轻微有机不规则；跑马灯（旋转光带）与线性渐变
仍作为可选样式。

| 会话状态 | 氛围灯 | 判定依据（宿主实时下发的会话摘要） |
| --- | --- | --- |
| 运行中（agent 正在工作） | 🟢 绿色光带流动 + 闪动 | `summary.running === true` |
| 完成 / 空闲（无待处理） | 🩷 粉色光带（稳态） | 非 running、非 blank、无待处理 |
| 有待处理（审批 / 计划确认 / 提问） | 🟡 黄色光带（慢速脉冲，优先级最高） | `summary.pendingInteraction` 非空 |
| 无会话 / 空白会话 / 已禁用 | 关闭 | 无当前会话或 `blank === true` |

光带为纯装饰（`pointer-events: none`），不遮挡任何操作；支持
`prefers-reduced-motion` 时自动停止动画。

## 设置

插件会在设置面板里注册一个「氛围灯」页面（设置 -> 氛围灯），全部参数可视化调节，
修改立即生效并持久化到 localStorage：

- **启用氛围灯**：开关
- **光圈宽度**：1–40 px 滑块
- **不透明度**：5%–100% 滑块
- **效果样式**：`柔光晕（散光，默认）` / `跑马灯（旋转光带）` / `线性渐变（静止）`
- **光带样式**（仅跑马灯）：`分段跑马灯（经典）` / `平滑渐变（柔和）`
- **跑马灯转速**：0–60 秒/圈（0 = 静止）
- **扩散范围**（仅柔光晕）：0–200 px，控制光晕由屏幕边缘向内散射的程度
- **不规则强度**（仅柔光晕）：0–10，控制光晕边缘的轻微有机波动（0 = 关闭）
- **亮度闪动**：0–10 秒/周期（0 = 不闪动，可每个状态单独设置）
- **状态渐变色**：运行中 / 完成 / 待处理 三组颜色各 3 个取色器
- **恢复默认**：一键还原

## 安装

从 GitHub 仓库安装：

```sh
dsh plugin --profile web add "github:lihang-lh/dsh-moon-light"
```

装完**重启 `dsh web`**——客户端插件名录在启动时组合，重启后刷新页面即可看到
效果（设置面板里改的配置保存在 localStorage，重启后自动沿用）。

开发期改代码建议用本地 `link:` 安装（符号链接，改完重启即生效，无需重装）：

```sh
dsh plugin --profile web add "link:/你的本地路径/dsh-moon-light"
```

卸载：

```sh
dsh plugin --profile web remove dsh-moon-light
```

## 配置优先级

`localStorage`（设置面板里改的）> 插件行 `config`（`cordis.patch.yml` / profile
补丁）> 内置默认。第三方插件的命名空间不在宿主 settings wire 的暴露白名单内，
所以用户配置保存在 localStorage（与 dsh-skin 同一模式）。

通过 profile 补丁覆盖部署级默认（不修改插件本体）：

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- id: mood-light
  config:
    width: 12                # 光圈厚度（px）
    rotate: 24               # 跑马灯转速（秒/圈）
    gradientType: 'glow'     # 默认柔光晕（散光）；可选 'conic' | 'linear' | 'glow'
    glowSpread: 40           # 扩散范围（px，仅 glow）
    glowWobble: 2.5          # 不规则强度（0..10，仅 glow）
    states:
      running:
        colors: ['#22c55e', '#4ade80', '#bbf7d0']
        flash: 0.8
```

## 原理（供二次开发）

- 插件是**手写 bundle**，遵循 DSH client-modules 协议：
  `window.__ModuleLoader__.load({ id, factory })`，只依赖平台种子模块
  `react`，通过 `slots` 服务协作，无需构建步骤。
- 渲染位置：`shell.overlay`（frame 级浮层，点击穿透）+ `settings.section`
  （设置面板页面），注册 id 均为 `mood-light`。
- 状态分析：`shell.overlay` 标准 props 的 `useSessions` 快照选择器读出当前
  会话 `SessionSummary`，按 `running` / `blank` / `pendingInteraction`
  映射到 running / success / warning 三种模式（见 `client.js` 的
  `resolveMode`）。
- 跑马灯实现：`position: fixed; inset: 0` 层 + `padding` +
  `mask-composite: exclude` 抠出外圈光环；内层一个 `inset: -50%` 的
  `conic-gradient` 旋转盘被 mask 裁成光带，`rotate` 控制转速（经典分段
  跑马灯用硬边界色标，平滑模式用连续渐变），`flash` 控制整体明暗呼吸。
- 柔光晕（glow）实现：`position: fixed; inset: 0` 的满屏层（无背景、不用
  mask 抠边），由 JS 用状态主色/次色 + `width` + `glowSpread` 拼出一串
  **多层 blur>0 的嵌套 inset box-shadow**（无零模糊实心核心层，spread 由
  `width` 递增至 `width+glowSpread`、alpha 递减——光由屏幕边缘平滑向内淡出、
  无清晰棱线）注入 `--ml-glow-shadow`；再叠加一个隐藏 `<svg>` 里的
  `feTurbulence` + `feDisplacementMap` 滤镜，`glowWobble` 作为位移 scale
  让光晕边缘呈轻微有机不规则（`glowWobble = 0` 时不应用滤镜）。
- 默认效果样式为**柔光晕（散光）**：开箱即软、无边框；`conic`/`linear` 仍可在
  设置页或行配置里选回。

## 开发

```sh
node --check client.js      # bundle 语法检查
node scripts/test.cjs       # 状态映射 / 配置合并 / 持久化 / 柔光晕渲染测试
```

不安装插件也能预览效果：直接用浏览器打开 `docs/preview.html`（独立页面，
含跑马灯光环与全部参数调节）。

## 文件

| 文件 | 作用 |
| --- | --- |
| `index.js` | 服务端入口（空 apply，满足 loader 要求） |
| `client.js` | 浏览器端跑马灯氛围灯 + 设置页（核心实现） |
| `cordis.patch.yml` | 插件行 + 部署级默认配置 |
| `docs/preview.html` | 独立预览页（无需安装即可预览效果） |
| `scripts/test.cjs` | 逻辑测试（状态映射 / 配置合并 / 持久化） |
| `.github/workflows/ci.yml` | 语法检查 + 逻辑测试 CI |
| `README.en.md` / `CHANGELOG.md` | 英文文档 / 变更日志 |
| `package.json` | `dsh.bundle` / `dsh.client` 声明 |
