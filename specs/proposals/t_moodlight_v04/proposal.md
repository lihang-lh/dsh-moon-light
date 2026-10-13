# 提案：氛围灯交互与观感升级（v0.4.0）

- 状态：待实现
- 分支：`feature/mood-light-v04/interaction-upgrade`
- 日期：2026-10-13
- 前置：v0.3.0「柔光晕设为默认并软化观感」（`specs/proposals/t_mt89ub8k_dfx91u/`）

## 背景与动机

氛围灯当前有 717 行实现（`client.js`），只做一件事：把当前会话状态映射成屏幕四边的一圈光。它已经能工作，但有三类问题。

**一、内核有真 bug：待处理状态从未生效。**

`resolveMode`（`client.js:328-335`）从当前会话的 summary 读 `summary.pendingInteraction`：

```js
if (summary.pendingInteraction != null) return "warning";
```

但 `useSessions` 返回的 `byId` 行对象里根本没有这个字段。宿主构造该行的地方（`dsh-api-session-controller` 的 `projectList()`）写入的是 `{ id, displayTitle, running, retainedBy, blank, updatedAt, projectionValues?, title?, cwd?, parentId?, origin? }`。

`pendingInteraction` 实际位于 `useSessionStatus` 的逐会话 `SessionStatus`：

```js
next.set(id, { running, pendingInteraction, completionUnread });   // dsh-client-ui-session/lib/client.js:353
```

后果：**审批、计划待审、提问这三种「需要人介入」的情况永远不会亮黄灯**，而这恰好是氛围灯最有价值的用途——用户切到别的窗口时，唯一能把他叫回来的信号。

现有测试没能发现它，因为测试桩把字段放错了地方：`scripts/test.cjs:132-133` 通过 `renderOverlay` 桩（`scripts/test.cjs:90-94`）把 `pendingInteraction` 直接塞进 `byId` 行，而该桩只提供 `useSessions`、没有 `useSessionStatus`。**测试复制了实现里的同一个错误假设**，于是绿灯掩盖了 bug。

**二、观感不够高级。**

- 状态切换是硬切：颜色从一个值跳到另一个值，没有过渡。这是"廉价感"的首要来源。
- 所有颜色的 alpha 硬编码在 `glowShadowString`（`client.js:368-386`）里，不区分深浅色主题。浅色背景下光几乎看不见，深色背景下容易过曝。
- 只有一层边缘 `inset` 阴影，没有"环境光溢出到画面里"的氛围感。
- `glowWobble` 默认 1，会把 `filter: url(#dsh-mood-light-turb)` 加在**整个视口元素**上（`client.js:398-501` 的 glow 分支 + 隐藏 SVG 的 `feTurbulence`+`feDisplacementMap`）。SVG 位移滤镜作用于全屏，每帧重绘都要处理整屏像素，是有实际代价的性能负担。

**三、交互为零。**

氛围灯是纯装饰：`pointer-events: none`、点击穿透、不能点、不能开关（只能进设置页）、只看当前会话。多会话并行时（本产品常态——主会话跑着、另一个会话在等审批），边缘光完全无法表达"别处有事"。

## 目标

成功标准（可验证）：

1. **内核正确**：审批 / 计划待审 / 待回答三种待处理都能正确点亮边缘光，且三者用不同颜色区分。测试必须在"只提供 `useSessionStatus`、不污染 `byId` 行"的正确桩下通过。
2. **状态可平滑过渡**：任意两次状态切换之间没有颜色硬跳变，肉眼可见为渐变（默认 700ms）。
3. **深浅色主题下都好看**：同一份配置，`body[data-ds-dark-theme]` 存在与不存在时分别呈现合适的亮度，无需用户手动调两次。
4. **可交互**：鼠标贴屏幕顶部边缘可唤出胶囊，胶囊显示状态并可点击跳转到对应会话；快捷键可一键开关氛围灯。
5. **多会话可见**：光色表达全局最需要注意的状态；胶囊与输入框下方状态条用文字汇总多会话情况。
6. **性能不退化**：默认配置下不再对全屏元素施加 SVG 位移滤镜。
7. 全量测试绿：`node --check`、`node scripts/test.cjs`。

## 非目标

明确不做，避免范围蔓延：

- **不做播放/音效**。只有视觉。
- **不改 `conic` / `linear` 两种效果样式**。它们保留为可选，本次只升级 `glow`（默认）这一支。`conic`/`linear` 的渲染色仍走旧路径，但会共享状态内核（即它们也能正确亮待处理色）与深浅色适配。
- **不做 i18n**。文案继续硬编码中文，与项目现状一致（`README.md`/设置页/CHANGELOG 均为中文）。快捷键 `label` 也用中文。
- **不用 `sidebar.session.row.leading`** 做多会话标记。官方 slot 文档明确：待处理交互 / 新消息 / 活动三种更高优先级状态会用状态点**顶掉**这个席位，故占用者绝不与状态点并列，**仅在该行处于 idle 时才挂载**。语义上做不到"待办时标记"。
- **不显示会话已运行时长**。宿主 `SessionStatus` 只有 `{ running, pendingInteraction, completionUnread }`，`SessionSummary.updatedAt` 是最后更新时间而非开始时间。客户端自己计时在页面刷新、会话切换、后台标签页节流后都会失真——显示错误的时长比不显示更糟。
- **不引入构建步骤、不新增运行时依赖**。继续手写 bundle，保持"零依赖、单文件实现"的项目特征。
- **不做分段光**（四周分区、一会话一段）。已在澄清中排除：多会话时会花，实现与调试成本明显更高。

## 已确认需求

以下为澄清问答中用户已拍板的决策，实现时不再重新讨论。

**第一轮（范围与取向）**

1. 范围：修内核 + 视觉高级感 + 可读交互，三者全做。
2. 视觉取向全选：环境光（ambilight）、极简克制的平滑过渡、动态质感（噪点 + 流光 + 扫光）。
3. 交互全选：边缘悬浮胶囊 + 点击跳转、多会话聚合、输入框下常驻状态条、一键开关 + 快捷键。

**第二轮（设计细节）**

4. **多会话聚合的表达方式**：光色取**全局最高优先级**，多会话细节由**胶囊文字汇总**。不做分段光，边缘光本身不变形。
5. **胶囊的触发与位置**：**顶部边缘触发**，**顶部居中浮现**，移开自动淡出。
6. **待处理三态配色**：三色区分——审批 = 琥珀 `#f59e0b`，计划待审 = 青蓝 `#06b6d4`，待回答 = 紫 `#a855f7`。
7. **ticketId**：本项目无严格要求（用户原话「此项目没有严格要求，随意提交即可」）。按仓库既有约定提交：`type: 中文标题`，历史 14 个 commit 均为此格式。

## 设计

### 1. 状态内核

**模式枚举**。`MODES` 由 `["running", "success", "warning"]` 扩展为：

```js
var MODES = ["running", "success", "warning", "planReview", "question"];
```

`warning` 语义由「待处理（笼统）」**收窄为「待审批」**，键名不变、色值不变（`#f59e0b` / `#fbbf24` / `#fde68a`，正好是用户选定的琥珀色）。这样老 `localStorage` 配置无需迁移。

**优先级**（数值越小越优先，用于全局聚合）：

```js
var STATE_PRIORITY = {
  warning:    0,   // 待审批：需要立即决策
  question:   1,   // 待回答：在等用户输入
  planReview: 2,   // 计划待审：需要确认方向
  running:    3,   // 运行中：有进展但无需介入
  success:    4    // 完成 / 空闲：稳态
};
```

待审批排在待回答与计划待审之前，因为审批通常阻塞了 agent 的下一步动作。

**会话级解析**。`resolveMode(summary, config)` 替换为 `resolveSessionState(status, summary, config)`：

```js
function resolveSessionState(status, summary, config) {
  if (config === undefined || config.enabled === false) return null;
  if (summary === undefined || summary === null) return null;
  if (summary.blank === true) return null;          // 空白新会话不亮灯
  if (status !== undefined && status !== null && status.pendingInteraction != null) {
    var kind = status.pendingInteraction.kind;
    if (kind === "approval") return "warning";
    if (kind === "plan-review") return "planReview";
    if (kind === "question") return "question";
    return "warning";                                // 未知 kind 兜底：按最紧急处理
  }
  if (status !== undefined && status !== null && status.running === true) return "running";
  if (summary.running === true) return "running";     // status 缺失时回退 summary
  if (status !== undefined && status !== null && status.completionUnread === true) return "success";
  return "success";
}
```

`kind` 的取值域有代码证据：`dsh-client-ui-workspace/lib/client.js:442-449` 的 `visiblePendingKind` 产生 `"approval" | "plan-review" | "question"`。

注意 `completionUnread` 不映射为独立模式，而是驱动一次「扫光」动画并在胶囊/状态条里标注「已完成（未读）」。理由：颜色上与稳态完成无区别，若亮一整圈灯提醒"有未读"会造成持续干扰；一次扫光已经足够传达。

**全局聚合**。

```js
/**
 * @returns {{ mode: string|null, sessionId: string|null, counts: object, total: number }}
 */
function aggregateState(byId, statusMap, config) {
  var counts = {};
  var best = null;
  var total = 0;
  if (byId === undefined || byId === null) return { mode: null, sessionId: null, counts: counts, total: 0 };
  for (var id in byId) {
    if (!Object.prototype.hasOwnProperty.call(byId, id)) continue;
    var mode = resolveSessionState(statusMap === undefined ? undefined : statusMap.get(id), byId[id], config);
    if (mode === null) continue;
    counts[mode] = (counts[mode] || 0) + 1;
    total += 1;
    if (best === null || STATE_PRIORITY[mode] < STATE_PRIORITY[best.mode]) {
      best = { mode: mode, sessionId: id };
    }
  }
  return { mode: best === null ? null : best.mode, sessionId: best === null ? null : best.sessionId, counts: counts, total: total };
}
```

并列时保留**先遍历到**的那个（`<` 而非 `<=`），保证结果稳定，不随对象键序抖动。

参与聚合的会话范围：`byId` 中全部非 `blank` 的行，包含带 `parentSessionId` 的子会话。子会话在跑也是真实工作，应当可见。`counts` 里按模式计数即可，不必区分主/子会话。

**数据来源**。`MoodLight` 组件不再只取当前行：

```js
var byId       = props.useSessions(function (s) { return s.byId; });
var statusMap  = props.useSessionStatus(function (m) { return m; });
var currentId  = props.useSessions(function (s) { return s.current; });
```

`useSessionStatus` 的 selector 收到的是 `ReadonlyMap<SessionId, SessionStatus>`。`shell.overlay` 的 standardProps 已包含 `useSessionStatus`，无需额外注入。

`useSessions` 被调用两次以分别订阅 `byId` 与 `current`，避免因返回新对象字面量导致的无限重渲染。

### 2. 视觉层

**DOM 结构契约**（实现与测试都以此为准）

`MoodLight` 返回**单个根元素**（`mode === null` 时返回 `null`，与现状一致）：

```
div.dsh-mood-light.is-<gradientType>        ← gradientType ∈ glow | conic | linear
  data-mode = <mode>
  data-flash = "on" | "off"
```

根元素**不再**带 `aria-hidden`（内部含可交互胶囊）；各纯装饰子层各自带 `aria-hidden: true`。

**`gradientType === "glow"`（默认）的子层，按此顺序出现：**

| 顺序 | className | 出现条件 | 关键 style / props |
|---|---|---|---|
| 1 | `dsh-mood-light-fill` | 总是 | —（取根元素继承的 `--ml-fill-a` / `--ml-fill-b`） |
| 2 | `dsh-mood-light-grain` | `config.grain > 0` | —（取根元素继承的 `--ml-grain`） |
| 3 | `dsh-mood-light-glow is-in` | 总是（入层） | `--ml-glow-shadow`、`--ml-width`、`--ml-opacity`、`--ml-flash`、`--ml-transition`；内含子元素 `div.dsh-mood-light-glow-core` |
| 4 | `dsh-mood-light-glow is-out` | 仅 crossfade 出层存在时（`previousMode` 非空且 ≠ 当前） | 同上，阴影串为**上一模式**的快照；同样内含 `div.dsh-mood-light-glow-core` |
| 5 | `dsh-mood-light-sweep is-active` | `config.sweep === true` 且刚切到 `success`（`previousMode` 非空且 ≠ `success`） | — |
| 6 | `dsh-mood-light-hit` | `config.capsule === true` | `onMouseEnter`、`onMouseLeave`（高度由根元素的 `--ml-hit-height` 决定） |
| 7 | `dsh-mood-light-capsule` | `config.capsule === true`（**总是渲染**，便于 220ms 淡出；仅 `hovered` 时附加 `is-open`） | `onClick`、`onMouseEnter`、`onMouseLeave` |
| 8 | `svg.dsh-mood-light-turb` | `glowWobble > 0` | 内含 `filter#dsh-mood-light-turb` |

**变量摆放约定**（CSS 自定义属性沿 DOM 继承，因此位置只影响可读性、不影响行为）：全局性与主题性变量（`--ml-opacity`、`--ml-width`、`--ml-flash`、`--ml-transition`、`--ml-theme-scale`、`--ml-fill-a`、`--ml-fill-b`、`--ml-grain`、`--ml-hit-height`、`--ml-sweep-color`）统一挂在**根元素**上；只有随图层变化的 `--ml-glow-shadow` 挂在各自的 `dsh-mood-light-glow` 层上。`glowWobble > 0` 时的 `filter: url(#dsh-mood-light-turb)` 也加在**根元素**上（需要整体位移）。

**`gradientType === "conic" | "linear"` 的子层**：保持现状不变（conic 且 `rotate > 0` 时只有一个 `dsh-mood-light-disc`），**不新增** fill / grain / sweep / 胶囊，也**不做 crossfade**。这是「非目标：不改 conic / linear」的直接体现——它们仍共享新的状态内核（因此待处理色也能正确出现），但视觉与交互升级只落在默认的 glow 上。

`.dsh-mood-light` 保持 `position: fixed; inset: 0; pointer-events: none; z-index: 2147483000`（沿用现状，实测可用）；内层用 `position: absolute; inset: 0`。

**crossfade 的计算抽成纯函数**，便于单测（组件内只负责把结果映射成元素）：

```js
/**
 * @param {string} mode 当前模式
 * @param {string|null} previousMode 上一模式
 * @param {object} config
 * @returns {Array<{ mode: string, out: boolean, shadow: string }>}
 *   出层在前（仅 previousMode 非空且 !== mode 时存在），入层恒在最后。
 */
function renderLayers(mode, previousMode, config) {
  var layers = [];
  if (previousMode !== null && previousMode !== undefined && previousMode !== mode) {
    layers.push({ mode: previousMode, out: true,  shadow: shadowFor(previousMode, config) });
  }
  layers.push({ mode: mode, out: false, shadow: shadowFor(mode, config) });
  return layers;
}
```

`shadowFor(mode, config)` = `glowShadowString(config.states[mode].colors, width, glowSpread)`。

**A. 环境光 `fill`**

```css
.dsh-mood-light-fill {
  position: absolute; inset: 0;
  background:
    radial-gradient(90% 55% at 50% 0%,   var(--ml-fill-a) 0%, transparent 72%),
    radial-gradient(70% 45% at 50% 100%, var(--ml-fill-b) 0%, transparent 70%);
  opacity: calc(var(--ml-opacity) * 0.16 * var(--ml-theme-scale));
  transition: opacity var(--ml-transition) ease;
}
```

`--ml-fill-a` / `--ml-fill-b` 由 JS 按模式色计算（核色与晕色的 rgba，alpha ≈ 0.55 / 0.4），**挂在根元素**上由该层继承；缩放公式不另发变量，直接写进上面这条 CSS 的 `opacity`：`calc(var(--ml-opacity) * 0.16 * var(--ml-theme-scale))`（`--ml-opacity` 在根元素、`--ml-theme-scale` 在 `.dsh-mood-light`，继承链路均覆盖 fill 层）。

上方靠顶部（顶栏与标题区，视觉密度低）、下方靠底部（输入区外围），避开正文中央，因此不干扰阅读。

**B. 边缘光 `glow` 与 crossfade**

`glowShadowString(colors, width, spread)` 算法**完全不变**（5 层全 blur>0 的 `inset 0 0 blur spread`，`layerSpread = w + (max-w)*t`、`blur = max(w, layerSpread*0.7)`、`alpha = max(0.02, 0.6*(1-t)+0.12)`，`i <= 1` 用 `colors[0]` 否则 `colors[1]`）。不改算法是有意的：它已被上一轮验证过，层数从 5 提到 7 的收益递减，却会拉长 style 字符串并牵动既有断言；本次把改动集中在真正缺失的地方（过渡、主题、环境光、交互）。

crossfade 由组件维护：

```js
var mode = aggregate.mode;
var [layers, setLayers] = React.useState({ current: mode, previous: null });
React.useEffect(function () {
  if (mode === layers.current) return undefined;
  setLayers({ current: mode, previous: layers.current });
  var timer = setTimeout(function () {
    setLayers(function (s) { return s.current === mode ? { current: mode, previous: null } : s; });
  }, transitionMs + 60);
  return function () { clearTimeout(timer); };
}, [mode, transitionMs]);
```

出层用 **上一模式的阴影串**（在 `useEffect` 里把 `previous` 的样式快照存住），入层用当前阴影串。两层各自 `transition: opacity var(--ml-transition) ease`，出层 `opacity: 0`、入层 `opacity: 1`。

为什么用双层 crossfade 而不是直接对 `box-shadow` 加 transition：多层带 blur 的 `box-shadow` 跨浏览器插值行为不一致（层数不同或颜色空间不同时会退化为突跳）。双层 opacity 过渡是纯合成器操作，GPU 友好且行为确定。

`transitionMs` 来自配置，默认 700，范围 **0-1500**（`mergeConfig` 归一与设置页滑块上限都按此收口）。为 0 时不做可感知过渡：实现仍按双层结构渲染，但把 `--ml-transition` 置为 `0s` 让出层瞬间透明，效果等同直接切换，以尊重 `prefers-reduced-motion` 用户与低配设备。

**C. 深浅色自适应**

宿主把主题投影为 `body[data-ds-dark-theme]`（`dsh-client-ui-layout/README.zh.md:46`）。纯 CSS 判定即可，无需 JS 监听或读取主题服务：

```css
.dsh-mood-light { --ml-theme-scale: 1; }
body[data-ds-dark-theme] .dsh-mood-light { --ml-theme-scale: 0.85; }
body:not([data-ds-dark-theme]) .dsh-mood-light { --ml-theme-scale: 1.35; }
```

语义：深色底上光更容易过曝，压低到 0.85；浅色底上光很容易被冲淡，提到 1.35。

不透明度统一由 CSS 计算，JS 只写裸值：

```css
.dsh-mood-light { opacity: calc(var(--ml-opacity) * var(--ml-theme-scale)); }
@keyframes dsh-mood-light-flash {
  0%, 100% { opacity: calc(var(--ml-opacity) * var(--ml-theme-scale)); }
  50%      { opacity: calc(var(--ml-opacity) * var(--ml-theme-scale) * var(--ml-flash-floor)); }
}
```

`--ml-opacity` 由 JS 以 inline style 写（用户设置值），`--ml-theme-scale` 来自 CSS 规则，二者不冲突。`--ml-flash-floor` 沿用现状 `0.35`。

这样"深浅色适配"完全落在 CSS 层：新增主题只需加一条选择器，无需改 JS，也不会因主题服务异步就绪而闪一下。

**D. 噪点质感 `grain`**

```css
.dsh-mood-light-grain {
  position: absolute; inset: 0;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  background-repeat: repeat;
  background-size: 160px 160px;
  opacity: var(--ml-grain);
  mix-blend-mode: overlay;
}
```

关键取舍：噪点用 **tile 化的 data-URI 背景**，而不是对全屏施加 `feTurbulence` 滤镜。后者每帧要重新生成并位移全屏噪声，是持续的开销；前者是一张 160×160 的静态贴图重复平铺，浏览器的合成器直接处理。

`--ml-grain` 默认 `0.035`，范围 0-0.15。设为 0 时该层不渲染。

**E. 性能修复：`glowWobble` 默认改为 0**

现状 `glowWobble: 1` 意味着默认配置下就在全屏元素上挂了 `filter: url(#dsh-mood-light-turb)`。改为默认 `0`。

配套：

- 保留能力与设置项（0-10），用户想要那层不规则感仍可打开。
- `glowWobble > 0` 时才插入隐藏 SVG 与 `filter` 样式（现状已如此，保持不变）。
- 老用户 `localStorage` 里若已固化 `glowWobble: 1`，其行为不变；只有全新用户（或恢复默认后）得到 0。
- 在 `CHANGELOG.md` 明确记为性能修复，说明原因。

这是一次**默认观感变化**，但理由充分：用户选的是"动态质感噪点"，而全屏滤镜是"边缘抖动"且代价高；噪点改由 `grain` 层承担后，观感目标仍达成。

**F. 完成扫光 `sweep`**

触发：`mode` 由 `running` 变为 `success`（即一次运行结束）。

实现：复用 `glow` 的抠环遮罩，背景是一条 115° 斜向亮带，横向扫过一遍后自行消失。

```css
.dsh-mood-light-sweep {
  position: absolute; inset: 0;
  -webkit-mask: <与 .dsh-mood-light-glow 相同的抠环>;
  mask: <同上>;
  background: linear-gradient(115deg, transparent 38%, var(--ml-sweep-color) 50%, transparent 62%);
  background-size: 260% 100%;
  background-position: 160% 0;
  opacity: 0;
  pointer-events: none;
}
.dsh-mood-light-sweep.is-active {
  animation: dsh-mood-light-sweep 1150ms cubic-bezier(0.33, 0, 0.2, 1) 1 forwards;
}
@keyframes dsh-mood-light-sweep {
  0%   { background-position: 160% 0; opacity: 0;    }
  18%  {                             opacity: 0.85; }
  82%  {                             opacity: 0.85; }
  100% { background-position: -60% 0; opacity: 0;    }
}
```

`.is-active` 的作用时机与 `renderLayers` 的 out 层一致：仅当 `previousMode !== null && previousMode !== mode`（真正发生状态切换）时渲染扫光层。**实现采用 keyed remount**（`key: "sweep-" + previousMode + "-" + mode`）＋定时清理，而不是 `onAnimationEnd` + 本地 `sweep: false` 标志位——前者保证每次切换都重放动画、且不依赖动画事件在 `prefers-reduced-motion` 或后台标签页下是否派发，行为更确定。`prefers-reduced-motion` 下整段动画禁用（沿用现有媒体查询块）。动画填充模式实测用 `both`（`animation: dsh-mood-light-sweep 1150ms cubic-bezier(0.33, 0, 0.2, 1) 1 both`），首尾都保持关键帧给出的状态，避免起手闪一帧。

**G. 状态差异化节奏**

`flash`（闪动周期秒数）默认值：

| 模式 | 语义 | flash | 说明 |
|---|---|---|---|
| `warning` | 待审批 | 1.1 | 最急促，需要立刻决策 |
| `question` | 待回答 | 1.6 | 沿用旧 warning 节奏 |
| `planReview` | 计划待审 | 2.0 | 慢，只需"知道" |
| `running` | 运行中 | 1.2 | 呼吸感（沿用现状） |
| `success` | 完成 / 空闲 | 0 | 稳态不闪（沿用现状） |

色板：

| 模式 | colors[0] | colors[1] | colors[2] |
|---|---|---|---|
| `running` | `#10b981` | `#34d399` | `#6ee7b7` |
| `success` | `#ec4899` | `#f472b6` | `#f9a8d4` |
| `warning`（待审批） | `#f59e0b` | `#fbbf24` | `#fde68a` |
| `planReview` | `#06b6d4` | `#22d3ee` | `#67e8f9` |
| `question` | `#a855f7` | `#c084fc` | `#d8b4fe` |

前三行是现有值，**一字不改**；后两行为新增。

### 3. 交互层

**A. 顶部触发带 + 胶囊**

```css
.dsh-mood-light-hit {
  position: fixed; top: 0; left: 0; right: 0;
  height: var(--ml-hit-height);   /* 默认 10px */
  z-index: 2147483000;
  pointer-events: auto;           /* 只有这条带子接收鼠标，其余仍穿透 */
}
```

`onMouseEnter` 开启 `hovered`，`onMouseLeave` 延时 220ms 关闭（容错：鼠标从带子移向胶囊途中的空隙）。

```js
var [hovered, setHovered] = React.useState(false);
var hideTimer = React.useRef(null);
var enter = function () { if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; } setHovered(true); };
var leave = function () { if (hideTimer.current) clearTimeout(hideTimer.current); hideTimer.current = setTimeout(function () { setHovered(false); }, 220); };
```

胶囊（顶部居中浮现）：

```css
.dsh-mood-light-capsule {
  position: fixed; top: 10px; left: 50%;
  transform: translateX(-50%) translateY(-6px);
  display: flex; align-items: center; gap: 10px;
  max-width: min(70vw, 620px);
  padding: 4px 5px 4px 12px;
  border-radius: var(--dsw-radius-md, 10px);
  background: var(--dsw-specific-menu, rgba(28, 28, 30, 0.86));
  backdrop-filter: var(--dsw-menu-backdrop-filter, blur(18px));
  box-shadow: var(--dsw-elevation-panel, 0 8px 28px rgba(0, 0, 0, 0.28));
  color: var(--dsw-alias-label-primary, #e8e8ea);
  font-size: 12px; line-height: 18px;
  pointer-events: auto; cursor: pointer;
  opacity: 0; transition: opacity 220ms ease, transform 220ms ease;
}
.dsh-mood-light-capsule.is-open { opacity: 1; transform: translateX(-50%) translateY(0); }
```

视觉语言直接对齐 `goal` 插件在 `conversation.composer.dock` 的 `GoalBar`（`dsh-client-ui-goal/lib/client.js:130`）：`--dsw-elevation-panel` 阴影、`--dsw-specific-menu` 底、`--dsw-menu-backdrop-filter` 毛玻璃、`--dsw-radius-md` 圆角、`--dsw-alias-label-*` 文字。**与宿主设计系统一致是"显高级"最可靠的来源**，优于自创配色；且每个 token 都带 fallback，token 缺失时仍可读。

胶囊内容（多会话汇总的落点）：

```
[●] 当前会话标题            正在运行 · 另有 2 个会话（1 待审批）
```

- 左侧：8px 圆点，颜色 = 全局最高优先级模式色（即边缘光同色），让用户把胶囊和光色关联起来。
- 主文字：当前会话的 `displayTitle`，`text-overflow: ellipsis` 截断，`min-width: 0`。
- 右侧次要文字（`--dsw-alias-label-tertiary`）：当前会话状态文案 + 多会话汇总。
- 状态文案表：`warning` → 「待审批」、`planReview` → 「计划待审」、`question` → 「待回答」、`running` → 「正在运行」、`success` → 「已完成」。
- 汇总文案规则：`total > 1` 时追加「另有 N 个会话」；其中待处理类（`warning`/`planReview`/`question`）合计 `p > 0` 时再追加「（M 个待处理）」。仅 1 个会话时省略。

点击行为：跳转到聚合结果指向的 `sessionId`（即最需要注意的会话）。若它已经是当前会话，则不做跳转（避免无意义导航）。

```js
var openSession = props.openSession;   // 由注册时的 inject 注入，见下文
var navigate = function () {
  if (targetId === null || targetId === currentId) return;
  if (typeof openSession === "function") openSession(targetId);
};
```

`escape` / `tabIndex`：胶囊是可选交互的辅助入口，不做成模态；不加 `role="dialog"`，避免抢焦点。但提供 `title` 属性说明点击行为。

**B. 跳转能力的注入**

`shell.overlay` 的注册范式（取自 `dsh-client-ui-schedule/lib/client.js`）支持用 `inject` 向组件 props 注入业务能力：

```js
ctx.slots.inject("shell.overlay", function () {
  return ctx.slots.register({
    name: "shell.overlay",
    id: "mood-light",
    inject: function () {
      return {
        openSession: function (sessionId) {
          var uiWorkspace = ctx.get === undefined ? undefined : ctx.get("uiWorkspace");
          if (uiWorkspace === undefined || uiWorkspace === null) return;
          try { uiWorkspace.openSession(sessionId); } catch (error) { console.warn("mood-light: openSession 失败", error); }
        }
      };
    }
  }, MoodLight);
});
```

`ctx.uiWorkspace.openSession(sessionId)` 是宿主既有的会话跳转入口（证据：`dsh-client-ui-schedule/lib/client.js:6764`、`dsh-client-ui-chat/lib/client.js:12467`、`dsh-client-ui-workspace/lib/client.js:4165`）。

**用 `ctx.get("uiWorkspace")` 而不是把 `"uiWorkspace"` 写进 `exports.inject`**：后者会让插件在缺少该服务的组合下整体不激活，氛围灯作为纯装饰不应因此消失。`ctx.get` 返回 `undefined` 时静默降级（胶囊仍可看见状态，只是点了不跳转）。这也是 `dsh-client-ui-conversation/lib/client.js:17949` 的用法。

**C. 输入框下方状态条**

槽位 `conversation.composer.dock`，`kind: list`、`scope: session`，文档说明为「Ambient entries below the composer card」。注册 id 用 `mood-light`。

布局照抄 `goal` 插件的 `GoalBar`（`dsh-client-ui-goal/lib/client.js:130`），这些变量由宿主提供、用于和输入卡对齐：

```css
.dsh-mood-light-bar-dock {
  box-sizing: border-box;
  width: calc(100% - var(--dsh-composer-side-clearance) - var(--dsh-composer-side-clearance) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset));
  margin: 0 auto;
}
.dsh-mood-light-bar {
  box-sizing: border-box;
  position: relative; isolation: isolate;
  display: flex; align-items: center; gap: 9px;
  width: 100%;
  max-width: calc(var(--dsh-composer-card-max-width) - 4 * var(--dsh-composer-dock-inset));
  height: 36px; margin: 0 auto; padding: 4px 5px 4px 12px;
  border-radius: var(--dsw-radius-md, 10px);
  box-shadow: var(--dsw-elevation-panel, 0 2px 8px rgba(0, 0, 0, 0.08));
  color: var(--dsw-alias-label-primary, #e8e8ea);
  font-size: 13px; line-height: 20px;
}
.dsh-mood-light-bar:before {
  content: ""; position: absolute; inset: 0; z-index: -1;
  border-radius: inherit;
  background: var(--dsw-specific-menu, rgba(28, 28, 30, 0.86));
  backdrop-filter: var(--dsw-menu-backdrop-filter, blur(18px));
  pointer-events: none;
}
```

内容：

```
[●] 氛围灯 · 正在运行            [另有 1 待审批]        [关闭按钮]
```

- 状态点 + 「氛围灯」标签 + 当前会话状态文案。
- 中段次要文字：多会话汇总（同胶囊规则）。
- 右侧：28px 图标按钮**关闭**氛围灯（`aria-label`/`title` 为「关闭氛围灯」，`border-radius: 999px`、hover 用 `var(--dsw-alias-interactive-bg-hover)`，与 `GoalBar` 的 `.iconBtn` 一致）。注意这是**单向**动作：`enabled === false` 时状态条自身不再渲染（见第 5 节渲染条件），所以它不可能在原地切回 `true`；重新开启走设置页或快捷键。

仅当 `enabled === true` 且 `statusBar === true` 时渲染。`enabled === false` 时状态条自身也不显示，否则用户关掉氛围灯后还会看到一个不亮的条，反而困惑。

**D. 设置页扩展**

沿用现有 `SettingsPage`（`client.js:525-689`）的结构与 `--dsw-*` 样式，新增三个分组：

1. **交互动效**：过渡时长（0-1500ms，默认 700）、噪点强度（0-0.15，默认 0.035）、完成扫光（开关，默认开）。
2. **悬浮胶囊**：启用（默认开）、触发带高度（4-40px，默认 10）。
3. **状态条**：启用（默认开）。

「状态颜色」区由三态扩为五态：运行中 / 已完成 / 待审批 / 计划待审 / 待回答，各 3 个取色器 + 该状态闪动秒数。

「不规则强度」的说明文案补一句代价提示（开启会在全屏施加 SVG 滤镜，可能影响低配设备帧率），因为它现在默认关闭、用户主动打开时应当知情。

**E. 快捷键**

```js
ctx.inject(["shortcuts"], function (scope) {
  scope.effect(function () {
    return scope.shortcuts.register({
      id: "mood-light.toggle",
      label: function () { return "切换氛围灯"; },
      aliases: ["mood light", "氛围灯", "toggle mood light"],
      defaults: {
        "desktop:macos":   { code: "KeyM", modifiers: ["primary", "shift"] },
        "desktop:windows": { code: "KeyM", modifiers: ["primary", "shift"] },
        "desktop:linux":   { code: "KeyM", modifiers: ["primary", "shift"] },
        "web:macos":       { code: "KeyM", modifiers: ["primary", "shift"] },
        "web:windows":     { code: "KeyM", modifiers: ["primary", "shift"] },
        // 不声明 "web:linux"：见下方「宿主限制」
      },
      regions: ["page", "editable"],
      modals: [],
      resolve: function () {
        return { status: "handled", run: function () { setConfig({ enabled: getConfig().enabled === false }); } };
      }
    });
  });
});
```

契约取自 `dsh-client-ui-open-in-app/lib/client.js:778-825`：`resolve` 返回 `{ status: "handled", run }` 或 `{ status: "blocked", reason }`。

**宿主限制（必须遵守，否则整条快捷键在任何平台都注册不上）**：`@deepseek-ai/dsh-client-shortcuts` 的 `register()` 会**急切遍历 `["desktop","web"] × ["macos","windows","linux"]` 全部 6 个 profile**，任一非法即 `throw new Error("Unsupported Web shortcut: " + id)`，且抛错发生在 `this.commands.set(command.id, command)` **之前** —— 所以一个非法 profile 会让**桌面端也一起注册不上**。其 `isWebBindingAllowed(binding, platform)` 对 `linux` 只放行 `Slash+primary`、`Comma+primary+shift`、`Period+primary+shift` 三条硬编码键位（宽松分支只覆盖 windows/macos），**任何字母键在 `web:linux` 上必被拒**。因此 `defaults` 里绝不能出现 `web:linux`（`desktop:linux` 不参与该校验，可保留）。同时 `catch` 不得静默吞掉异常，须 `console.warn` 出具体 message，便于日后定位。

`regions: ["page", "editable"]` 让快捷键在输入框内也生效（用户很可能正在打字时想关掉灯）。组合键 `Ctrl/Cmd+Shift+M` 与输入无冲突。

**用 `ctx.inject(["shortcuts"], cb)` 可选注入**：缺失该服务时插件照常工作，只是没有快捷键——不影响核心功能。若直接写进 `exports.inject`，缺服务会整体不激活。

**F. 资源清理**

现状 `apply`（`client.js:692-711`）没有做清理。本次所有注册都包进 `ctx.effect(...)`，返回 `dispose`，使插件热重载/卸载时能正确摘除槽位、快捷键、监听。

`ensureStyles()` 维持"一次性注入、按 `STYLE_ID` 去重"的现状（样式表随文档存续，重复注入无副作用）。但样式内容会随实现变化，注入前按 id 检查已存在即可——热重载后需刷新页面才换新样式，这一点与现状一致，不引入更复杂的版本化逻辑。

### 4. 配置 schema

```js
var DEFAULT_CONFIG = {
  enabled: true,
  width: 8,
  opacity: 0.6,
  gradientType: "glow",
  segments: true,
  rotate: 16,
  flash: 1.2,
  glowSpread: 24,
  glowWobble: 0,              // 原 1，见「性能修复」
  transitionMs: 700,          // 新增
  sweep: true,                // 新增
  grain: 0.035,               // 新增
  capsule: true,              // 新增
  capsuleTriggerHeight: 10,   // 新增
  statusBar: true,            // 新增
  states: {
    running:    { colors: ["#10b981", "#34d399", "#6ee7b7"], flash: 1.2 },
    success:    { colors: ["#ec4899", "#f472b6", "#f9a8d4"], flash: 0 },
    warning:    { colors: ["#f59e0b", "#fbbf24", "#fde68a"], flash: 1.1 },  // 待审批，色值不变、flash 1.6→1.1
    planReview: { colors: ["#06b6d4", "#22d3ee", "#67e8f9"], flash: 2.0 },  // 新增
    question:   { colors: ["#a855f7", "#c084fc", "#d8b4fe"], flash: 1.6 }   // 新增
  }
};
```

`mergeConfig`（`client.js:71-107`）**可以新增键，但不得改动既有键的语义**。它虽被描述为「深合并」，实际是**逐键白名单合并**（对每个已知键分别取默认值 + 类型校验）：新增 `transitionMs`/`sweep`/`grain`/`capsule`/`capsuleTriggerHeight`/`statusBar` 六个顶层键时，必须同时补上对应的合并分支，否则用户存在 `localStorage` 里的这几个键会被静默丢弃；`states` 段新增 `planReview`/`question` 时同理。既有键名与色值（尤其 `warning`）一律保持不动，这是老配置无缝升级的关键。

新增键的取值范围（`mergeConfig` 的 clamp 与设置页滑块的 `min`/`max` **必须同区间**，否则「设置页能选到但被静默夹紧」）：

| 键 | 范围 | 默认 |
|---|---|---|
| `transitionMs` | 0 - 1500 | 700 |
| `grain` | 0 - 0.15 | 0.035 |
| `capsuleTriggerHeight` | 4 - 40 | 10 |
| `glowSpread`（既有） | 0 - 200 | 24 |
| `glowWobble` | 0 - 10 | 0 |

`cordis.patch.yml` 的部署级默认同步补上新键（与 `DEFAULT_CONFIG` 一致），并更新注释。

## 影响面

| 文件 | 改动 |
|---|---|
| `client.js` | 主要改动：状态内核重写（`resolveSessionState` + `aggregateState`）、`MODES`/`DEFAULT_CONFIG` 扩展、`ensureStyles` 大量新增 CSS、`MoodLight` 重构（crossfade 双层 + fill/grain/sweep + 胶囊 + 触发带）、新增状态条组件与注册、`SettingsPage` 新增分组与两态取色、`apply` 改用 `ctx.effect` 清理并新增三处注册 |
| `docs/preview.html` | 同步新算法与五态、新视觉层，保持独立可预览（不依赖宿主） |
| `scripts/test.cjs` | **必须改**：桩要提供 `useSessionStatus`（这是 A1 回归的载体）；新增内核与聚合断言、CSS 断言、状态条注册断言 |
| `README.md` / `README.en.md` | 配置项、设置列表、原理、快捷键说明、五态色板 |
| `CHANGELOG.md` | v0.4.0 条目；明确记录 `glowWobble` 默认值变更属性能修复 |
| `cordis.patch.yml` | 部署默认同步新键 |
| `package.json` | 版本 `0.3.0` → `0.4.0` |
| `specs/proposals/t_moodlight_v04/` | 本 spec + `tasks.md` + 截图 |
| `.github/workflows/ci.yml` | 预计无需改（已跑 `node --check` + `node scripts/test.cjs`）；若新增文件需纳入语法检查则补 |

**兼容性**

- 老 `localStorage` 配置：`states` 三键命名不变，深合并补齐新键 → 无缝。
- 老的 `gradientType: "conic"` / `"linear"` 用户：仍走原渲染路径，但会共享新的状态内核（因此待处理色也能正确出现）与深浅色 `--ml-theme-scale`。
- 默认观感变化两处：`glowWobble` 1 → 0（不再有边缘抖动，改由 `grain` 提供质感）、`warning.flash` 1.6 → 1.1（待审批更急促）。均在 CHANGELOG 说明。
- 新增顶部 10px 触发带会占用该区域鼠标事件。宿主顶栏按钮通常垂直居中于约 44px 高的标题栏，内容区落在 y≈10~34，预期不冲突。**实机验证结论（web profile 独立实例，Playwright）**：鼠标移到 `y=4` 即命中触发带、胶囊 `is-open` 弹出并可点击（成功跳转目标会话），过程中宿主顶栏按钮未被遮挡 —— 默认 10px 保留。若后续在其它客户端（Linux/窄窗口）复现遮挡，把 `capsuleTriggerHeight` 收窄即可，无需改代码。
- `conversation.composer.dock` 新增一个 36px 条目，会把输入区上方内容下推；与 `goal` 插件并存时两条堆叠。这是宿主 list 槽位的正常行为，但**需在实机确认与 `goal` 条同时出现时的间距观感**。

## 测试与验收

### 单元测试（`scripts/test.cjs`，零依赖 vm 沙箱）

必须新增/修改：

| # | 断言 | 类型 |
|---|---|---|
| T1 | `resolveSessionState` 优先级：同时挂多种信号时取最高 | 新增 |
| T2 | `pendingInteraction.kind` 三值映射到 `warning`/`planReview`/`question` | 新增 |
| T3 | 未知 `kind` 兜底为 `warning` | 新增 |
| T4 | `blank: true` → `null`；`summary` 缺失 → `null`；`enabled: false` → `null` | 保留并改造 |
| T5 | `status` 缺失但 `summary.running` 为真 → `running`（降级路径） | 新增 |
| T6 | `aggregateState` 多会话取最高优先级，并列时取先遍历者 | 新增 |
| T7 | `aggregateState.counts` 与 `total` 计数正确，`blank` 不计入 | 新增 |
| T8 | **A1 回归**：桩只提供 `useSessionStatus`（不把 `pendingInteraction` 塞进 `byId` 行）时，渲染仍进入待处理模式 | 新增（核心） |
| T9 | `mergeConfig` 向后兼容：老配置（无 `planReview`/`question`/`transitionMs`）合并后结构完整 | 新增 |
| T10 | 根元素 `data-mode` 随状态变化；crossfade 时存在双层 glow | 新增 |
| T11 | 注入的 CSS 含 `body[data-ds-dark-theme]`、`@keyframes dsh-mood-light-sweep`、`--ml-theme-scale`、`.dsh-mood-light-grain` | 新增 |
| T12 | 注册了 `conversation.composer.dock` 的 `mood-light` 条目，且 `enabled: false` 时不渲染 | 新增 |
| T13 | `glowShadowString` **算法不变**（设计节口径）：仍 5 层、全部 blur>0（无零模糊硬核）、最外层 spread 随 `glowSpread` 增长 | 保留 |
| T14 | 原有 conic/linear 覆盖用例仍绿 | 保留 |
| T15 | `resolveSessionState` 在 `config` 缺省时降级到 `DEFAULT_CONFIG`（不抛错），三槽位注册仍完整 | 新增 |

`renderOverlay` 桩必须重写：提供 `useSessions`（返回 `byId` + `current`）**与** `useSessionStatus`（返回 `Map`）两个 hook，并允许按 case 构造 `pendingInteraction`，且**只通过 `useSessionStatus` 通道**提供它。

### E2E 验证

1. `node --check client.js`、`node --check index.js`、`node scripts/test.cjs` 全绿。
2. `docs/preview.html`：打开即见默认柔光晕；五种状态逐一切换截图，确认颜色区分明显、过渡平滑、浅色与深色底都清楚；噪点与扫光可见且不刺眼。
3. 宿主实机（`dsh web` 重启 + 刷新页面）：
   - 默认能看到边缘光。
   - 用测试账号构造三种待处理（审批 / 计划待审 / 提问），确认边缘光分别变为琥珀 / 青蓝 / 紫。**这是本次的核心验收点。**
   - 鼠标贴顶部边缘 → 胶囊居中浮现；移开 → 淡出。
   - 另一个会话有待处理时，胶囊文字出现汇总；点击胶囊跳到该会话。
   - 输入框下方出现状态条，与 `goal` 条并存时观感正常；点开关能关掉。
   - `Ctrl/Cmd+Shift+M` 切换开关，且在输入框聚焦时仍生效。
   - 系统/应用主题切浅色与深色，确认亮度自适应。
4. 设置页面板：新分组可用，滑块实时生效，刷新后持久化。

### 验收标准

- 上述 14 条单元断言全绿，且 T8 在**未修复的实现上必定失败**（先在红灯阶段证明它抓得住 bug）。
- 三态待处理色实机可见且可区分。
- 任意状态切换处不再有肉眼可辨的硬跳变。
- 默认配置下不再有全屏 SVG 滤镜（`glowWobble: 0`）。
- 深色与浅色两种主题下，光都清晰可见且不过曝。
- 老配置、conic/linear 用户无回归。

## 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 顶部 10px 触发带遮挡宿主顶栏按钮 | 用户点不到顶栏 | 实机实测；冲突则收窄默认至 4px，并把高度做成设置项 |
| `conversation.composer.dock` 与 `goal` 条堆叠 | 输入区上方变拥挤 | 实机确认；必要时默认关闭状态条，由设置开启 |
| 全屏多层元素（fill + grain + 2×glow + sweep）绘制成本上升 | 低配设备掉帧 | 噪点用 tile 而非滤镜；crossfade 用 opacity（合成器友好）；过渡时长可设 0；`prefers-reduced-motion` 全关 |
| 全局聚合后，边缘光可能反映"别的会话"的状态 | 用户误以为是当前会话 | 胶囊与状态条都显示当前会话状态并明确汇总"另有 N 个"；胶囊圆点即全局色，建立关联 |
| 多会话计数把子会话算进去 | 数字比预期大 | 属有意设计（子会话在跑也是真实工作），文案只说"N 个会话"，不做主/子区分，避免误导 |
| `useSessionStatus` 在 `shell.overlay` 中不可用 | 内核修复失效 | 已核对 slot catalog：`shell.overlay` 的 standardProps 明确包含 `useSessionStatus` |
| 快捷键服务缺失 | 没有快捷键 | 用 `ctx.inject(["shortcuts"], …)` 可选注入，缺失时静默降级 |
| 改 `glowWobble` 默认值引起观感争议 | 老用户觉得变了 | CHANGELOG 记为性能修复并说明原因；能力与设置项保留；老 localStorage 用户不受影响 |

## 澄清问答

**第一轮 · 范围与取向**

- 问：本次范围？答：修内核 + 视觉高级感 + 可读交互（推荐组合）。
- 问：视觉取向？答：全选——环境光 ambilight / 极简克制平滑过渡 / 动态质感（噪点 + 流光 + 扫光）。
- 问：交互取向？答：全选——边缘悬浮胶囊 + 点击跳转 / 多会话聚合 / 输入框下常驻状态条 / 一键开关 + 快捷键。

**第二轮 · 设计细节**

- 问：多会话时边缘光本身怎么表达？答：**光色取全局最高优先级 + 胶囊文字汇总**（不做分段光）。
- 问：胶囊怎么触发、从哪里冒出来？答：**顶部边缘触发，顶部居中浮现**。
- 问：审批 / 计划待审 / 待回答三种待处理颜色怎么定？答：**三色区分——琥珀 / 青蓝 / 紫**。
- 问：任务编号？答：**本项目无严格要求，随意提交即可**（故按仓库既有 `type: 中文标题` 格式提交）。

## 开放问题

1. **触发带高度的最终值**：默认暂定 10px，需实机确认是否遮挡宿主顶栏。若遮挡，是收窄到 4px，还是改为「按住修饰键 + 靠近顶部」才唤出？倾向先收窄。
2. **状态条与 `goal` 条并存的堆叠顺序**：两者都在 `conversation.composer.dock`。是否需要为我方条目设置 `order`，使其排在 `goal` 之下？实现时按实机观感定，默认不设置（按注册顺序）。
3. **扫光的触发时机**：目前只在 `running → success` 时触发一次。若用户希望「完成未读」在切回该会话前持续有提示，需要另立方案（例如边缘光短暂加亮脉冲）。本次不做。
4. **是否需要在胶囊中列出全部活跃会话**（而非只给汇总结论）：v1 只给汇总。若日后会话数常态超过 3，可考虑展开列表。
5. **多显示器**：`shell.overlay` 只覆盖主窗口。本次不涉及。
