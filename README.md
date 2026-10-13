# dsh-mood-light — 会话氛围灯

[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

给 DSH Web 界面加一圈氛围光：根据当前会话的运行状态，在屏幕最外层自动显示
不同颜色、不同节奏的光。**默认柔光晕（散光）**——无边框、由屏幕边缘平滑向内
淡出的多层内散射光，并带轻微环境光与噪点质感；跑马灯（旋转光带）与线性渐变
仍作为可选样式。

| 会话状态 | 氛围灯 | 判定依据（宿主实时下发） |
| --- | --- | --- |
| 待审批（审批待确认） | 🟡 琥珀色（优先级最高） | `useSessionStatus` 的 `pendingInteraction.kind === "approval"` |
| 待回答（agent 向你提问） | 🟣 紫色 | 同上，`kind === "question"` |
| 计划待审（计划待确认） | 🔵 青蓝色 | 同上，`kind === "plan-review"` |
| 运行中（agent 正在工作） | 🟢 绿色光晕 + 呼吸闪动 | `status.running === true` |
| 完成 / 空闲（无待处理） | 🩷 粉色光晕（稳态）+ 一次扫光 | 非 running、非 blank、无待处理 |
| 无会话 / 空白会话 / 已禁用 | 关闭 | 无当前会话或 `blank === true` |

**多会话聚合**：灯色取所有会话中的最高优先级状态；鼠标移到屏幕**顶部边缘**
（默认 10px 高的触发带）会浮现一枚胶囊，显示聚合结果与「另有 N 个会话」汇总，
点击即可跳转到对应会话。

光带为纯装饰，不遮挡任何操作（只有顶部触发带与胶囊会接收鼠标事件，其余全屏
点击穿透）；`prefers-reduced-motion` 时自动停止全部动画。

## 交互与快捷键

| 交互 | 说明 |
| --- | --- |
| 顶部边缘悬停 | 触发带（宽度可调，默认 10px）内移入鼠标 → 顶部居中浮现胶囊；移开 220ms 后淡出 |
| 点击胶囊 | 跳转到聚合结果指向的会话（若就是当前会话则不跳转） |
| 输入框下方状态条 | `conversation.composer.dock` 上的 36px 常驻条，显示当前状态与会话标题，带一键开关 |
| 快捷键 | `Ctrl/Cmd + Shift + M` 一键开关氛围灯（在输入框内同样生效；`defaults` 刻意不声明 `web:linux`，因宿主对 Linux 只放行 Slash/Comma/Period 三种键位，声明字母键会导致快捷键在所有平台都注册失败） |
| 设置面板 | 设置 → 氛围灯，全部参数可视化调节 |

## 设置

插件会在设置面板里注册一个「氛围灯」页面（设置 → 氛围灯），全部参数可视化
调节，修改立即生效并持久化到 localStorage：

- **启用氛围灯**：开关
- **光圈宽度**：1–40 px 滑块
- **不透明度**：5%–100% 滑块
- **效果样式**：`柔光晕（散光，默认）` / `跑马灯（旋转光带）` / `线性渐变（静止）`
- **光带样式**（仅跑马灯）：`分段跑马灯（经典）` / `平滑渐变（柔和）`
- **跑马灯转速**：0–60 秒/圈（0 = 静止）
- **扩散范围**（仅柔光晕）：0–200 px，控制光晕由屏幕边缘向内散射的程度
- **不规则强度**（仅柔光晕）：0–10，控制光晕边缘的轻微有机波动（**默认 0 =
  关闭**；开启后会给整个全屏层挂 SVG 位移滤镜，低性能设备可能掉帧）
- **环境光强度**（仅柔光晕）：0–200%，屏幕上下缘的极淡整体染色
- **噪点质感**（仅柔光晕）：0–0.15，叠加 160px 平铺噪点，消除大面积渐变的塑料感
- **完成扫光**（仅柔光晕）：开关，切到「完成」时沿边缘扫过一道亮带
- **过渡时长**（仅柔光晕）：0–1500 ms，状态切换时新旧颜色的交叉淡出时长
- **亮度闪动**：0–10 秒/周期（0 = 不闪动，可每个状态单独设置）
- **状态渐变色**：运行中 / 完成 / 待审批 / 计划待审 / 待回答 五组颜色各 3 个取色器
- **悬浮胶囊**：开关 + 触发带高度 4–40 px
- **输入框状态条**：开关
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
    glowWobble: 0            # 不规则强度（0..10，仅 glow；默认 0 = 关闭滤镜）
    transitionMs: 700        # 状态切换交叉淡出时长（ms，仅 glow）
    grain: 0.035            # 噪点质感（0..0.3，仅 glow）
    capsuleTriggerHeight: 10 # 顶部触发带高度（px）
    states:
      running:
        colors: ['#22c55e', '#4ade80', '#bbf7d0']
        flash: 0.8
```

## 原理（供二次开发）

- 插件是**手写 bundle**，遵循 DSH client-modules 协议：
  `window.__ModuleLoader__.load({ id, factory })`，只依赖平台种子模块
  `react`，通过 `slots` / `shortcuts` / `uiWorkspace` 服务协作，无需构建步骤。
- 注册三个槽位，注册 id 均为 `mood-light`：
  - `shell.overlay`（frame 级浮层，点击穿透）：氛围灯本体
  - `conversation.composer.dock`（输入卡下方）：常驻状态条
  - `settings.section`（设置面板页面）：设置页
  另经 `ctx.inject(["shortcuts"], ...)` 注册 `mood-light.toggle` 快捷键。
  所有注册都包在 `ctx.effect(...)` 里，宿主卸载时自动 dispose。
- **状态分析分两层**（v0.4.0 的关键修正）：
  - `useSessions` 快照 → `SessionSummary`（`running` / `blank` / `title` 等）
  - `useSessionStatus` → `Map<sessionId, { running, pendingInteraction, completionUnread }>`
  - `pendingInteraction`（审批 / 计划待审 / 提问）**只存在于第二层**。
    v0.3.0 曾从 `SessionSummary` 上读它，导致待处理黄色警告从未生效；v0.4.0
    改由 `resolveSessionState(status, summary, config)` 从 `useSessionStatus`
    读取，未知 `kind` 兜底为待审批。
  - `aggregateState(byId, statusMap, config)` 遍历全部会话，按
    `STATE_PRIORITY = { warning: 0, question: 1, planReview: 2, running: 3, success: 4 }`
    取最高优先级；并列时取先遍历者（结果稳定）。
- **crossfade**：状态切换时 `renderLayers(mode, previousMode, config)` 返回两层
  （出层在前、入层在后），两层各自带**上一模式/当前模式的阴影串快照**，用
  wrapper 的 `opacity` 过渡（`--ml-transition`）交叉淡入淡出。**不对
  `box-shadow` 加 transition**——多层带 blur 的阴影跨浏览器插值不可靠。闪光
  动画放在内层 `dsh-mood-light-glow-core` 上，避免与 wrapper 的 `opacity`
  过渡抢同一属性。
- **深浅色自适应**：宿主把主题投影为 `body[data-ds-dark-theme]`，插件据此把
  `--ml-theme-scale` 设为 `0.85`（深色，光易过曝）/ `1.35`（浅色，光易被冲淡），
  所有不透明度公式统一写成 `calc(var(--ml-opacity) * var(--ml-theme-scale))`。
- 跑马灯实现：`position: fixed; inset: 0` 层 + `padding` +
  `mask-composite: exclude` 抠出外圈光环；内层一个 `inset: -50%` 的
  `conic-gradient` 旋转盘被 mask 裁成光带，`rotate` 控制转速（经典分段
  跑马灯用硬边界色标，平滑模式用连续渐变），`flash` 控制整体明暗呼吸。
- 柔光晕（glow）实现：`position: fixed; inset: 0` 的满屏层（无背景、不用
  mask 抠边），由 JS 用状态主色/次色 + `width` + `glowSpread` 拼出一串
  **多层 blur>0 的嵌套 inset box-shadow**（无零模糊实心核心层，spread 由
  `width` 递增至 `width+glowSpread`、alpha 递减——光由屏幕边缘平滑向内淡出、
  无清晰棱线）注入 `--ml-glow-shadow`。
- 其它视觉层：环境光 `dsh-mood-light-fill`（上下缘径向渐变，强度
  `opacity × 0.16 × 主题系数`）、噪点 `dsh-mood-light-grain`（160px 的
  `data:image/svg+xml` 平铺 tile + `mix-blend-mode: overlay`，**不用全屏
  SVG 滤镜**）、扫光 `dsh-mood-light-sweep`（115° 斜向亮带，自行
  `padding + mask-composite` 只扫边缘）。
- 默认效果样式为**柔光晕（散光）**：开箱即软、无边框；`conic`/`linear` 仍可在
  设置页或行配置里选回，且**只共享新的状态内核**（因此待处理色同样正确），
  不参与本次的视觉与交互升级。

## 开发

```sh
node --check client.js      # bundle 语法检查
node scripts/test.cjs       # 状态内核 / 配置合并 / 持久化 / 渲染路径 / 交互回归测试（130 项）
```

不安装插件也能预览效果：直接用浏览器打开 `docs/preview.html`（独立单文件页面，
零外部依赖，含五态色板、全部参数调节、深浅色切换与胶囊/状态条演示）。

## 文件

| 文件 | 作用 |
| --- | --- |
| `index.js` | 服务端入口（空 apply，满足 loader 要求） |
| `client.js` | 浏览器端氛围灯 + 状态条 + 设置页（核心实现） |
| `cordis.patch.yml` | 插件行 + 部署级默认配置 |
| `docs/preview.html` | 独立预览页（无需安装即可预览效果） |
| `scripts/test.cjs` | 逻辑测试（状态映射 / 配置合并 / 持久化 / 渲染路径） |
| `.github/workflows/ci.yml` | 语法检查 + 逻辑测试 CI |
| `README.en.md` / `CHANGELOG.md` | 英文文档 / 变更日志 |
| `specs/proposals/t_moodlight_v04/` | v0.4.0 设计规范、任务清单、[交付说明](specs/proposals/t_moodlight_v04/delivery.md)与 E2E 截图 |
| `package.json` | `dsh.bundle` / `dsh.client` 声明 |
