# 任务清单：氛围灯交互与观感升级（v0.4.0）

对照 `specs/proposals/t_moodlight_v04/proposal.md`。分支 `feature/mood-light-v04/interaction-upgrade`。

**协作分工（写范围互不重叠）**

| 角色 | 独占写范围 |
|---|---|
| Lead | `client.js`、`cordis.patch.yml`、`package.json`、`README.md`、`README.en.md`、`CHANGELOG.md`、`specs/proposals/t_moodlight_v04/*.md` |
| `test-author` | `scripts/test.cjs` |
| `preview-author` | `docs/preview.html` |
| `reviewer`（实现后） | 只读；产出 review 结论 |

复杂度判定：**中高**。依据「改动多处耦合模块」——同时改状态内核、视觉引擎、交互组件、宿主集成（3 处槽位/快捷键注册）四个子系统，且需重写测试基础设施。

- [x] 1. 基线与 spec：已从 `main` 切出 `feature/mood-light-v04/interaction-upgrade`；写出 `specs/proposals/t_moodlight_v04/proposal.md`（含背景/目标/非目标/已确认需求/设计/影响面/测试与验收/开放问题）。验收：`git branch --show-current` 非基线分支；spec 文件存在且含全部章节。

- [x] 2. 状态内核重构（client.js）：删除 `resolveMode(summary, config)`，新增 `resolveSessionState(status, summary, config)` 与 `aggregateState(byId, statusMap, config)`；`MODES` 扩为 `["running","success","warning","planReview","question"]`；`STATE_PRIORITY = { warning:0, question:1, planReview:2, running:3, success:4 }`；`warning` 语义收窄为「待审批」，键名与色值不变。**这是 A1 真 bug 的修复点**：待处理信号必须从 `useSessionStatus` 的 `Map<SessionId, SessionStatus>` 读取，不得再读 `summary.pendingInteraction`。涉及：client.js。验收：`node --check client.js` 通过；`resolveSessionState` 在只给 `status` 不给 `summary.pendingInteraction` 时能返回 `warning`/`planReview`/`question`。

- [x] 3. 视觉层（client.js）：`DEFAULT_CONFIG` 新增 `transitionMs:700`、`sweep:true`、`grain:0.035`、`capsule:true`、`capsuleTriggerHeight:10`、`statusBar:true`，且 `glowWobble` 由 `1` 改为 `0`；`states` 新增 `planReview`(#06b6d4/#22d3ee/#67e8f9, flash 2.0) 与 `question`(#a855f7/#c084fc/#d8b4fe, flash 1.6)，`warning.flash` 由 1.6 改 1.1；`glowShadowString` 算法不变；新增纯函数 `renderLayers(mode, previousMode, config)`。`ensureStyles()` 增补：`body[data-ds-dark-theme]` 驱动的 `--ml-theme-scale`（深 0.85 / 浅 1.35）、以 `calc(var(--ml-opacity) * var(--ml-theme-scale))` 重写不透明度与 flash 关键帧、`.dsh-mood-light-fill`、`.dsh-mood-light-grain`（tile 化 data-URI，非全屏滤镜）、`.dsh-mood-light-glow.is-out` 的 opacity 过渡、`@keyframes dsh-mood-light-sweep`。涉及：client.js。验收：`node --check client.js`；注入 CSS 含 `body[data-ds-dark-theme]`、`--ml-theme-scale`、`.dsh-mood-light-grain`、`@keyframes dsh-mood-light-sweep`；默认配置下不再出现 `filter: url(#dsh-mood-light-turb)`；扫光为窄亮带（`transparent 38%, var(--ml-sweep-color) 50%, transparent 62%`）＋ `1150ms cubic-bezier(0.33, 0, 0.2, 1) 1 both`，keyframes 含 `18%` 与 `82%` 两个 `opacity: 0.85` 保持帧（T16 锁定）。

- [x] 4. 交互层（client.js）：`MoodLight` 改为容器结构（见 spec DOM 契约）；接入 crossfade 双层；顶部触发带 + 胶囊（进入即显、移开 220ms 淡出、点击跳转最需要注意的会话）；胶囊与状态条的文案汇总规则（`total > 1` 追加「另有 N 个会话」，待处理合计 `p > 0` 再追加「（M 个待处理）」）。新增 `conversation.composer.dock` 的 `mood-light` 条目（36px，布局照 `GoalBar` 的 `--dsh-composer-*` 变量对齐，右侧 28px **关闭**按钮；单向动作——`enabled=false` 后状态条自身不再渲染，故不能原地切回 true）。跳转能力经注册选项 `inject: () => ({ openSession })` 注入，内部用 `ctx.get("uiWorkspace")` 取服务并静默降级，**不把 `uiWorkspace` 写进 `exports.inject`**。快捷键 `mood-light.toggle`（`Ctrl/Cmd+Shift+M`，`regions: ["page","editable"]`）经 `ctx.inject(["shortcuts"], cb)` 可选注册；**`defaults` 不得声明 `web:linux`**（宿主 `isWebBindingAllowed()` 对 Linux 只放行 `Slash+primary`/`Comma+primary+shift`/`Period+primary+shift`，任何字母键都会让 `register()` 抛错，且抛错发生在写命令表之前 → 桌面端也一起注册不上），`catch` 必须 `console.warn` 出具体 message 而非静默吞掉。所有注册包进 `ctx.effect(...)` 返回 dispose。涉及：client.js。验收：`node --check client.js`；`enabled:false` 时根元素与状态条均不渲染；`capsuleTriggerHeight` 归一（clamp 4..40）后落到 `--ml-hit-height`，`hit` 层用 `height: var(--ml-hit-height)` 取高；胶囊含 `cursor: pointer`、`title`、`onMouseEnter/onMouseLeave/onClick`；缺少 `uiWorkspace` 时 `openSession()` 返回 `false` 且不抛错。

- [x] 5. 设置页（client.js）：新增三组——交互动效（过渡时长 0-1500、噪点强度 0-0.15、完成扫光开关）、悬浮胶囊（启用、触发带高度 4-40）、状态条（启用）；三态取色器扩为五态；「不规则强度」补代价说明文案。**滑块 `min`/`max` 必须与 `mergeConfig` 的 clamp 同区间**（`transitionMs` 0-1500、`grain` 0-0.15、`capsuleTriggerHeight` 4-40），否则会出现「设置页能选到但被静默夹紧」。涉及：client.js。验收：设置页渲染出新增滑块；五态各 3 个取色器；`glowSpread` 滑块 set/get 路径仍通；三个新滑块的 min/max 有断言。

- [x] 6. 测试改造（scripts/test.cjs，test-author）：重写 `renderOverlay` 桩，使其提供 `useSessions`（`{current, byId}`）**与** `useSessionStatus`（`Map`），且 `pendingInteraction` **只经 `useSessionStatus` 通道**提供；新增 spec「测试与验收」表中的 T1-T14。T8 是核心回归：在未修复的实现上必须失败。涉及：scripts/test.cjs。验收：先跑一次确认 T1/T2/T5/T6/T7/T8/T9/T10/T11/T12 在旧实现下为红；实现完成后 `node scripts/test.cjs` 全绿。**T16（review 回归块）**：`--ml-hit-height` 归一、胶囊 DOM 契约与 `cursor: pointer`、扫光窄带/缓动/保持帧、胶囊与状态条的「已完成（未读）」、三个新滑块 min/max、缺 `uiWorkspace` 时 `openSession()` 静默降级、快捷键 `defaults` 不含 `web:linux`。实测：旧实现下 T16 有 20/21 条为红。

- [x] 7. 预览页（docs/preview.html，preview-author）：同步五态色板与状态文案、新增 `--ml-theme-scale` 深浅色切换预览（可手动切换 body 上的 `data-ds-dark-theme`）、过渡时长、噪点、扫光、胶囊与状态条的静态演示。保持零依赖单文件。涉及：docs/preview.html。验收：浏览器打开即见默认柔光晕；五态切换色差明显；深浅色底都清晰；无 console 报错。

- [x] 8. 文档与元数据：`README.md` / `README.en.md` 更新设置项、五态色板、交互说明、快捷键、配置示例；`CHANGELOG.md` 新增 v0.4.0 条目，明确记录 `glowWobble` 默认值变更属性能修复、`warning.flash` 变化、A1 bug 修复；`package.json` 版本 0.3.0 → 0.4.0；`cordis.patch.yml` 部署默认同步新键。涉及：上述 4 文件。验收：文档与实现一致；`node --check` 与测试仍绿。

- [x] 9. Review（reviewer，只读）：对照 spec 逐条检查 `client.js`——状态内核是否彻底摆脱 `summary.pendingInteraction`、聚合优先级与并列稳定性、CSS 变量名与 spec 是否一致、`ctx.effect` 是否覆盖全部注册、`uiWorkspace` 是否确实为可选注入、是否存在越界改动（如误改 conic/linear 渲染）。产出问题清单（文件:行号 + 复现条件 + 建议）。验收：明确给出「通过 / 需修复项」。

  **review 结论（已闭环）**：A1 真 bug 修复正确、`glowShadowString` 与 HEAD 逐行等价、`mergeConfig` 向后兼容、`exports.inject` 仅 `slots`、非目标全部遵守（conic/linear 未改、无 i18n、无新构建步骤、未用 `sidebar.session.row.leading`）。**阻断项已修**：快捷键 `web:linux` 导致全平台注册失败（已删该行 + `catch` 改 `console.warn`）。低优先级项已修：胶囊关闭定时器改 `useRef` + 卸载清理、扫光窄带/缓动/`82%` 保持帧、胶囊 `cursor: pointer` + `title`、状态条补「已完成（未读）」、注释订正、配置范围收口。spec 侧已订正：`mergeConfig` 语义、胶囊/状态条 CSS 取值、取值范围表、扫光移除机制、状态条按钮单向性、快捷键宿主限制。

- [x] 10. E2E 与交付：`node --check client.js`、`node --check index.js`、`node scripts/test.cjs` 全绿；重启 `dsh web` + 刷新页面实机验证（三态待处理色、胶囊唤出与跳转、状态条、快捷键、深浅色自适应）；`docs/preview.html` 截图；产出交付说明与禅道回复。涉及：`specs/proposals/t_moodlight_v04/screenshots/`。验收：截图反映实际界面；三态待处理色实机可见。

---

## 完成记录（E2E 与验收证据）

| 验收项 | 结果 | 证据 |
|---|---|---|
| `node --check client.js` / `index.js` | 通过 | 本轮实测 |
| `node scripts/test.cjs` | **130 PASS / 0 FAIL / exit 0** | 原 109 条 → 新增 T16 共 21 条 |
| 旧实现跑新测试（红灯验证） | **T16 20/21 条 FAIL / exit 1**；T8 四条 `(got running)` | `/tmp/rev16`、`/tmp/rev` 沙箱 |
| 真机 E2E（web profile 独立实例，Playwright） | **19/19 PASS，console error 0** | `screenshots/e2e-report.json` |
| 实机待处理态（A1 修复实证） | `data-mode=question`、`data-flash=on`、胶囊「等待你的回答」 | `e2e-11-pending-question.png` |
| 实机运行中态 | `data-mode=running`，扫光 `is-active` | `e2e-04-running.png`、`capture_running_v04.py` 5/5 PASS |
| 快捷键开关 | `Ctrl/Cmd+Shift+M` 可关、关闭态下可再开启 | `e2e-08-toggle-off.png`、`e2e-10-shortcut-off.png` |
| 深浅色自适应 | 深 `--ml-theme-scale=0.85` / 浅 `1.35` | `e2e-09-dark-theme.png` |
| 预览页（零外部资源） | console error 0，五态色板正确 | `screenshots/preview-*.png`、`preview-report.json` |

说明：本模型无图像输入能力（`read_image` 报 `model "deepseek-flash" does not declare image input`），视觉正确性以 computed style / DOM 断言为准，截图作为人工复核证据。

复核脚本用法（需先启动独立 web 实例）：

```bash
DSH_DESKTOP_NODE_EXECUTABLE="/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" \
  "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" --profile web --port 19487 --no-open
# 用打印出的 token URL 执行
/usr/bin/python3 specs/proposals/t_moodlight_v04/screenshots/e2e_v04.py "<token-url>"
/usr/bin/python3 specs/proposals/t_moodlight_v04/screenshots/capture_running_v04.py "<token-url>"
/usr/bin/python3 specs/proposals/t_moodlight_v04/screenshots/capture_preview_v04.py
```
