# 交付说明：DSH 会话氛围灯 v0.4.0 —— 状态内核修复 + 观感升级 + 交互新增

- 分支：`feature/mood-light-v04/interaction-upgrade`（基于 `main` / `1fcae74`）
- 版本：`0.3.0` → **`0.4.0`**
- 规范：[proposal.md](proposal.md)（设计）、[tasks.md](tasks.md)（任务与完成记录）
- 截图与复核脚本：[screenshots/](screenshots/)

---

## 1. 实现逻辑说明

### 1.1 改动覆盖的子系统

| 子系统 | 文件 | 说明 |
|---|---|---|
| 状态内核 | `client.js` | 删除 `resolveMode(summary, config)`，改为 `resolveSessionState(status, summary, config)` + `aggregateState(byId, statusMap, config)` |
| 视觉引擎 | `client.js` | 新增环境光（fill）、噪点（grain）、扫光（sweep）、crossfade 双层过渡、深浅色系数 |
| 交互组件 | `client.js` | 顶部触发带 + 汇总胶囊、`conversation.composer.dock` 状态条、`Ctrl/Cmd+Shift+M` 快捷键 |
| 宿主集成 | `client.js` | 三处槽位注册全部改经 `ctx.effect(...)`；`uiWorkspace` 可选注入 |
| 测试基建 | `scripts/test.cjs` | 重写 `renderOverlay` 桩（补 `useSessionStatus`），新增 T1-T16 |
| 预览页 | `docs/preview.html` | 零依赖单文件同步五态与全部新控件 |
| 文档/元数据 | `README.md`、`README.en.md`、`CHANGELOG.md`、`package.json`、`cordis.patch.yml` | 与实现对齐 |

### 1.2 核心数据流

```
宿主 useSessions(s => s.byId[s.current])          → SessionSummary（无 pendingInteraction）
宿主 useSessionStatus(s => s)                     → ReadonlyMap<SessionId, SessionStatus>
                                                      { running, pendingInteraction, completionUnread }
        ↓
resolveSessionState(status, summary, config)      → 单会话五态
   status.pendingInteraction.kind: "approval" → warning
                                   "plan-review" → planReview
                                   "question"    → question
   running → running；否则 success；blank / !enabled → null
        ↓
aggregateState(byId, statusMap, config)           → 全局最高优先级 mode + sessionId + counts
   STATE_PRIORITY = { warning:0, question:1, planReview:2, running:3, success:4 }
        ↓
renderLayers(mode, previousMode, config)          → { mode, previousMode, fading }
        ↓
MoodLight：根元素挂 data-mode / data-flash + 全部 CSS 变量；三层 glow + fill + grain + sweep + hit + capsule
aggregateInfo / 状态条：`total > 1` 追加「另有 N 个会话」，待处理合计 `> 0` 再追加「（M 个待处理）」
```

### 1.3 设计取舍

1. **待处理信号只从 `useSessionStatus` 读**（A1 修复）。`SessionSummary` 根本没有 `pendingInteraction` 字段，v0.3.0 读它导致「待处理黄色警告」自发布起从未生效。为兼容 `kind` 的两种形态，实现同时接受 `{ kind }` 对象与 `"approval"` 字符串；未知 kind 兜底 `warning`。
2. **聚合取全局最高优先级，而非「当前会话优先」**。所以存在待审批/待回答会话时，首页恒显示对应待处理色，其它会话的 running 观察不到——这是有意为之（待处理是最需要人介入的信号）。副作用：E2E 必须先清掉待处理会话才能观察到 success/running，脚本里对应 `step 0b`。
3. **crossfade 过渡的是 wrapper 的 opacity，不对 `box-shadow` 做 transition**。box-shadow 插值在多层不同 blur 时既昂贵又易抖；快照出层 + wrapper 淡入淡出更稳，还能让环境光一起平滑过渡。flash 动画与 crossfade 会抢同一个 `opacity`，因此 flash 放在内层 `dsh-mood-light-glow-core`，过渡期间根元素 `data-flash="off"` 停掉动画。
4. **`glowWobble` 默认值 `1` → `0`**。它是全屏 `feTurbulence + feDisplacementMap` 滤镜，默认开启等于对每一帧做全屏滤镜，是 v0.3.0 的主要性能负担。改为默认关闭、滑块保留（0-10），并在设置页常驻红字提示代价。
5. **深浅色纯 CSS 适配**。宿主把主题投影为 `body[data-ds-dark-theme]`，插件只需 `--ml-theme-scale`（深 `0.85` / 浅 `1.35`）乘进不透明度与 flash 关键帧，无需 JS 监听主题变化。
6. **`mergeConfig` 是逐键白名单合并**，新增顶层键必须同时补合并分支，否则用户 localStorage 里的新键会被静默丢弃。本次新增 6 个键、6 个分支，既有键语义与色值不变（老配置无缝）。
7. **快捷键不声明 `web:linux`**（review 发现的阻断项，见 §3）。

### 1.4 与 v0.3.0 的兼容性

- `states.warning` 键名与色值 `#f59e0b/#fbbf24/#fde68a` 完全不变，老配置无缝；`warning.flash` 由 `1.6` 调到 `1.1`（语义收窄为「待审批」，不再需要那么强的闪动）。
- 新增 `planReview` / `question` 两态，缺失时由 `mergeConfig` 补默认。
- `conic` / `linear` 两种渐变样式与 `glowShadowString` 算法**未改动**（已与 HEAD 逐行 diff 验证为空），新视觉层全部在 `if (glow)` 分支内。
- `exports.inject` 仍只声明 `["slots"]`；`uiWorkspace` 经 `ctx.get()` 软获取，缺失时 `openSession()` 返回 `false` 并静默降级，不抛错。

---

## 2. 影响面

| 受影响 | 说明 |
|---|---|
| `client.js` | +992/-… 行，最大改动面；状态内核 / 视觉 / 交互全在此文件 |
| `scripts/test.cjs` | 测试从 34 → 130 条断言；桩结构变更 |
| `docs/preview.html` | 重写为 1177 行，零外部资源 |
| `README.md`、`README.en.md`、`CHANGELOG.md`、`package.json`、`cordis.patch.yml` | 文档与部署默认同步 |
| 未受影响 | `index.js`（仍为空 `apply`）、`.github/workflows/ci.yml`、`conic`/`linear` 渲染路径、既有快捷键与其它插件 |

`cordis.patch.yml` 部署级默认新增：`transitionMs: 700`、`sweep: true`、`grain: 0.035`、`capsule: true`、`capsuleTriggerHeight: 10`、`statusBar: true`、`planReview`、`question`；`glowWobble: 0`、`warning.flash: 1.1`。

---

## 3. 关键缺陷与修复（摘要）

| # | 问题 | 根因 | 修法 |
|---|---|---|---|
| A1 | 「待处理」黄色警告自 v0.3.0 起从未生效 | `resolveMode` 读 `summary.pendingInteraction`，但 `SessionSummary` 无此字段；测试桩把该字段直接塞进 `byId` 行，自证了错误假设 | 改从 `useSessionStatus` 的 `Map<SessionId, SessionStatus>` 读；测试桩改为只经 `useSessionStatus` 下发（T8 锁定） |
| A2 | 短任务（约 0.5s）状态切换在 UI 上完全看不见 | 无过渡，颜色硬切 | crossfade 双层 + `transitionMs`（默认 700ms） |
| A3 | 默认开启全屏 `feTurbulence` 滤镜 | `glowWobble: 1` | 默认 `0`，仅 `> 0` 时挂 `filter` 与 `<svg>` 滤镜节点 |
| R1（review） | `Ctrl/Cmd+Shift+M` 在任何平台都注册不上 | 宿主 `register()` 急切遍历 `["desktop","web"] × ["macos","windows","linux"]`，`isWebBindingAllowed()` 对 linux 只放行 `Slash+primary`/`Comma+primary+shift`/`Period+primary+shift`，故 `web:linux: KeyM` 必抛 `Unsupported Web shortcut`，且抛错发生在 `commands.set` 之前 → 桌面端一起失效；实现的 `catch` 静默吞掉 | 删除 `web:linux` 一行；`catch` 改 `console.warn` |
| R2-R6（review） | 胶囊关闭定时器泄漏、扫光过宽且无保持帧、胶囊缺 `cursor`/`title`、状态条漏标「已完成（未读）」、配置范围宽于 spec | —— | 定时器改 `useRef` + 卸载清理；扫光改 `38%/50%/62%` 窄带 + `cubic-bezier(0.33,0,0.2,1)` + `82%` 保持帧；补 `cursor: pointer` 与 `title`；补未读后缀；范围收口到 0-1500 / 0-0.15 / 4-40 |

---

## 4. 测试结果

### 4.1 单元测试（零依赖 vm 沙箱）

```
$ node --check client.js && node --check index.js   # 通过
$ node scripts/test.cjs
130 PASS / 0 FAIL   （exit 0；v0.3.0 为 34 条）
```

红灯验证（把新测试跑在旧实现上）：

```
$ rm -rf /tmp/rev16 && mkdir -p /tmp/rev16/scripts
$ git show HEAD:client.js > /tmp/rev16/client.js
$ cp scripts/test.cjs /tmp/rev16/scripts/ && cd /tmp/rev16 && node scripts/test.cjs
→ T16 共 20/21 条 FAIL / exit 1；T8 四条全部 (got running)（待处理态从未生效的直接证据）
```

### 4.2 真机 E2E（web profile 独立实例 + Playwright）

启动（另起一个实例，不影响用户当前 GUI）：

```bash
DSH_DESKTOP_NODE_EXECUTABLE="/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" \
  "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" \
  --profile web --port 19487 --no-open      # 打印出带 token 的 URL
/usr/bin/python3 specs/proposals/t_moodlight_v04/screenshots/e2e_v04.py "<token-url>"
```

**结果：19/19 PASS，`consoleErrors: []`**（`screenshots/e2e-report.json`）。要点：

| 步骤 | 实测 |
|---|---|
| 登录/首页 | `.dsh-mood-light.is-glow[data-mode=success][data-flash=off]`，1×glow / 1×fill / 1×grain，`--ml-theme-scale=1.35` |
| 顶部悬浮 | 胶囊展开：「确认收到消息 / 已完成 / 另有 909 个会话」 |
| 真实 agent 运行 | MutationObserver 记录 `success→running` t=2093ms、`running→success` t=3036ms，同刻 `.dsh-mood-light-sweep.is-active` |
| 状态条 | 「氛围灯 / 已完成 · 另有 910 个会话 / ◉」+ `关闭氛围灯` 按钮，点击后整根氛围灯卸载 |
| 快捷键 | `Ctrl/Cmd+Shift+M` 可关闭；**关闭态下同一快捷键可重新开启** |
| 深色主题 | `body[data-ds-dark-theme]` → `--ml-theme-scale=0.85` |
| **待处理态** | 让 agent 反问 → `data-mode=question`、`data-flash=on`、胶囊「等待你的回答」、状态条「氛围灯 / 等待你的回答 · 另有 … / ◉」——**A1 修复在真实宿主的实证** |

运行中帧单独用 `screenshots/capture_running_v04.py`（发 `sleep 8` 指令）稳定抓取：**5/5 PASS**，截图时状态条为「氛围灯 / 正在运行 · 另有 909 个会话 / ◉」。

预览页 `screenshots/capture_preview_v04.py`：7 张截图、`consoleErrors: []`、五态色板与扫光 `opacity: 0.85` 实测正确。

### 4.3 截图清单（`screenshots/`）

实机（web profile）：

- `e2e-01-home-light-success.png` 首页浅色 success 全貌
- `e2e-02-capsule-hover.png` 顶部胶囊展开
- `e2e-03a-composer-typed.png` 首页草稿已输入
- `e2e-04-running.png` / `e2e-04b-running-status-bar.png` 真实运行中（含状态条）
- `e2e-05-success-after-run.png` 任务完成（扫光后）
- `e2e-06-settings-section.png` 设置页氛围灯配置区
- `e2e-07-session-status-bar.png` 会话内 composer dock 状态条
- `e2e-08-toggle-off.png` 一键关闭后
- `e2e-09-dark-theme.png` 深色主题
- `e2e-10-shortcut-off.png` 快捷键关闭后
- `e2e-11-pending-question.png` 真实「待回答」紫色态（A1 实证）
- `e2e-12-pending-question-session.png`、`e2e-13-question-ui.png` 待回答会话与问题卡

预览页（`docs/preview.html`）：`preview-mode-{running,success,warning,planReview,question}.png`、`preview-sweep.png`、`preview-light-theme.png`

> 说明：本模型无图像输入能力（`read_image` 报 `model "deepseek-flash" does not declare image input`），因此视觉正确性以 computed style / DOM 断言为准（见 4.1/4.2），截图作为人工复核证据。

---

## 5. 遗留与已知限制

1. **`Ctrl/Cmd+Shift+M` 在 Linux Web 端不可用**——宿主对 Web+Linux 只放行三条硬编码键位，且 `Slash+primary` 已被 `shortcuts.open` 占用，插件无法在此平台注册字母类快捷键。桌面端与 macOS/Windows Web 端正常。
2. **待处理态实机截图只覆盖了 `question`**。`approval`（待审批）与 `plan-review`（计划待审）未在真实宿主复现截图；这两条由 T8 单元测试与预览页覆盖（`preview-mode-warning.png`、`preview-mode-planReview.png`）。
3. **crossfade 的真实双层 DOM 渲染在单测里是盲区**：vm 沙箱的 React 桩 `useState` setter 为 noop，出层恒为 `null`，因此单测只能验证纯函数 `renderLayers`；真实双层已由实机 E2E 观察确认。
4. 预览页与实现的文案有一处 cosmetic 差异：汇总后缀预览页写「（M 待处理）」，实现与 README 为「（M 个待处理）」。
5. 未做 i18n（文案硬编码中文）、未引入任何构建步骤或运行时依赖（仍是手写 bundle + 唯一 `require("react")`）。
