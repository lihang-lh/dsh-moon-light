# Changelog

## [0.4.0] - 2026-10-13

### 修复：待处理警告从未生效（真 bug）

- **根因**：v0.3.0 的 `resolveMode` 从 `useSessions` 返回的会话行对象上读
  `summary.pendingInteraction`，但该字段实际只由 `useSessionStatus` 提供
  （`SessionSummary` 根本没有这个字段）。结果是「审批 / 计划待审 / 提问」
  三种待处理情况**永远不会点亮待处理色**，氛围灯只在绿色与粉色之间切换。
- **修复**：新增 `resolveSessionState(status, summary, config)`，状态从
  `useSessionStatus` 的 `Map<sessionId, { running, pendingInteraction,
  completionUnread }>` 读取；未知 `kind` 兜底为待审批。旧测试用桩把
  `pendingInteraction` 直接塞进会话行，掩盖了这个 bug——新测试改为**只经
  `useSessionStatus` 通道下发**该字段，并已验证同一份测试对旧实现报
  `FAIL (got running)`、对新实现全绿。

### 修复：快捷键在任何平台都注册不上（review 发现）

- **根因**：`mood-light.toggle` 的 `defaults` 为 6 个 profile 全声明了
  `KeyM + primary + shift`，其中 `web:linux` 被宿主
  `@deepseek-ai/dsh-client-shortcuts` 的 `isWebBindingAllowed()` 拒绝——它对
  Linux 只放行 `Slash+primary`、`Comma+primary+shift`、`Period+primary+shift`
  三条硬编码键位（宽松分支只覆盖 windows/macos），**任何字母键在
  `web:linux` 上都不可能通过**。而 `register()` 会**急切遍历全部 6 个
  profile 做校验**，任一非法即抛 `Unsupported Web shortcut`，且抛错发生在
  `commands.set()` **之前** —— 于是这一个非法 profile 让**桌面端也一起注册
  不上**，再被实现的 `catch { return undefined }` 静默吞掉，用户完全无感。
- **修复**：删掉 `web:linux` 这一行（`desktop:linux` 不参与该校验，保留），
  并把 `catch` 改为 `console.warn` 输出具体 message，避免同类问题再次静默。
  该问题由独立 review 子代理通过本机 asar 内的真实校验函数复现确证；修复后
  真机 E2E 中 `Cmd+Shift+M` 已实测可关闭/恢复。

### 修复：其它 review 发现

- 胶囊的 220ms 延迟关闭定时器此前是模块级变量、组件卸载不清理，改为
  `React.useRef` + `useEffect` 卸载时 `clearTimeout`。
- 完成扫光窄带此前是 18%–82%（宽 64%）且缓动 `ease-out`，收到 spec 的
  38%–62%（宽 24%）+ `cubic-bezier(0.33, 0, 0.2, 1)`，并补上 82% 保持帧，
  否则亮带一亮起就匀速变淡。
- 胶囊补 `cursor: pointer` 与 `title`（「点击前往该会话」/「当前会话」），
  点击行为可发现。
- 状态条此前漏了「已完成（未读）」后缀（只有胶囊有），已补齐。
- 配置范围收口：`transitionMs` 0–1500、`grain` 0–0.15、
  `capsuleTriggerHeight` 4–40，`mergeConfig` 的 clamp 与设置页滑块
  `min`/`max` 同区间，避免「设置页能选到但被静默夹紧」。

### 新增：待处理细分为三色

- `pendingInteraction.kind` 精确映射：`approval` → **待审批（琥珀）**、
  `plan-review` → **计划待审（青蓝）**、`question` → **待回答（紫色）**。
  `warning` 模式的键名与色值保持 v0.3 一致（语义收窄为「待审批」），因此
  老配置无需迁移。
- 多会话聚合：`aggregateState` 遍历全部会话，按
  `STATE_PRIORITY = { warning, question, planReview, running, success }`
  取最高优先级，并列取先遍历者（结果稳定）；模式键从 3 个扩到 5 个。

### 新增：视觉升级（仅默认的柔光晕样式）

- **状态切换交叉淡出**：`renderLayers(mode, previousMode, config)` 在切换时
  返回出层 + 入层两层，各自持自己的阴影串快照，用 wrapper 的 `opacity`
  过渡（`transitionMs`，默认 700ms）淡入淡出。**不对 `box-shadow` 加
  transition**（多层带 blur 的阴影跨浏览器插值不可靠）；闪光动画移到内层
  `dsh-mood-light-glow-core`，避免与 wrapper 抢同一属性。
- **深浅色自适应**：宿主把主题投影为 `body[data-ds-dark-theme]`，据此把
  `--ml-theme-scale` 设为 0.85（深色，光易过曝）/ 1.35（浅色，光易被冲淡），
  所有不透明度公式统一为 `calc(var(--ml-opacity) * var(--ml-theme-scale))`。
  此前 alpha 硬编码，在浅色主题下氛围灯几乎看不见。
- **环境光**：上下缘极淡的整体染色层（强度 `opacity × 0.16 × 主题系数`），
  让屏幕不再是「只有一圈边」。
- **噪点质感**：160px 的 `data:image/svg+xml` 平铺 tile +
  `mix-blend-mode: overlay`，消除大面积渐变的塑料感。**刻意不用全屏 SVG
  滤镜**。
- **完成扫光**：切到「完成」时沿边缘扫过一道 115° 亮带，自行
  `padding + mask-composite` 只扫边缘。

### 新增：交互（此前完全为零，纯装饰且点击穿透）

- **顶部悬停胶囊**：屏幕顶部一条极窄触发带（`capsuleTriggerHeight`，默认
  10px）内移入鼠标 → 顶部居中浮现毛玻璃胶囊，显示聚合状态 + 会话标题 +
  「另有 N 个会话（M 个待处理）」，移开 220ms 后淡出。点击跳转到聚合结果
  指向的会话（经 `uiWorkspace.openSession`，即当前会话时不跳）。
- **输入框下方常驻状态条**：注册 `conversation.composer.dock`，36px 状态条
  显示当前状态与会话标题，带一键开关；布局沿用宿主 goal 条的
  `--dsh-composer-*` 变量公式并带 fallback。
- **快捷键**：`mood-light.toggle`，默认 `Ctrl/Cmd + Shift + M`，在输入框内
  也生效。
- 只有顶部触发带与胶囊接收鼠标事件，其余仍全屏点击穿透。

### 性能

- **`glowWobble` 默认 1 → 0**：v0.3 默认就给整个全屏层挂
  `feTurbulence` + `feDisplacementMap` SVG 位移滤镜，开销大且低帧率设备明显
  掉帧。质感改由噪点层承担，滤镜仅在用户显式调大时启用，并在设置页标注
  性能代价。
- 待审批 `warning.flash` 1.6 → 1.1（脉冲更收敛）。
- 所有注册（三个槽位 + 快捷键）包进 `ctx.effect(...)`，宿主卸载时统一
  dispose；此前没有任何清理。

### 其它

- 新增第四个导出面：状态内核（`resolveSessionState` / `aggregateState` /
  `renderLayers` / `shadowFor` 等）全部从 `client.js` 导出，便于单测与二次开发。
- `glowShadowString` 阴影串算法**未改动**（仍 5 层全 blur>0、无零模糊硬核）。
- 测试从 34 项扩到 130 项（`scripts/test.cjs`，零依赖 vm 沙箱），其中 T16 为 review 回归块（触发带归一 / 胶囊契约 / 扫光窄带与保持帧 / 未读标注 / 滑块范围 / 快捷键 `defaults`）；独立预览页
  `docs/preview.html` 同步到 v0.4（五态、环境光/噪点/扫光、深浅色切换、
  胶囊与状态条演示）；中英文 README 与 `cordis.patch.yml` 部署默认同步更新。
- 范围外（有意不做）：不改 `conic`/`linear` 两种样式的渲染与交互（它们只共享
  新状态内核）；不做 i18n（文案仍硬编码中文）；不引入构建步骤与运行时依赖。

## [0.3.0] - 2026-08-25

### 变更：柔光晕（glow）升级为默认样式并软化观感

- **默认效果样式改为柔光晕（散光）**：`DEFAULT_CONFIG.gradientType` 与
  `cordis.patch.yml` 部署默认由 `conic` 改为 `glow`（开箱即软、无边框）；
  `conic`/`linear` 仍可在设置页或行配置里选回（向后兼容）。
- **去掉柔光晕硬边线**：重写 `glowShadowString`，删除零模糊实心核心层
  （`inset 0 0 0 w px rgba(core,0.9)`，即「边框」来源），改为纯多层 blur>0、
  spread 由 `width` 递增至 `width+glowSpread`、alpha 递减的内散射软晕，
  光从屏幕边缘平滑向内淡出、无清晰棱线；保留 `feTurbulence` +
  `feDisplacementMap` 滤镜（`glowWobble` 控制轻微不规则，0 = 关闭）。
- **软化闪动节奏**：`@keyframes dsh-mood-light-flash` 的 50% 谷底从
  `opacity*0.18` 抬到约 `opacity*0.35`（配合 ease-in-out），闪动由刺眼硬闪
  变为柔和呼吸；周期与三态色不变。
- 同步更新：设置页文案与默认选中、独立预览页 `docs/preview.html`（默认即
  glow + 新软晕算法）、中英文 README、逻辑测试 `scripts/test.cjs`
  （默认断言改 glow，并显式补 conic/linear 用例与「阴影串不含零模糊硬核」断言）。
- 注意：`localStorage` 优先级高于行配置，已装用户若存了 `gradientType:'conic'`
  切默认后不会自动变 glow（仅新装/清存储后生效）。

## [0.2.0] - 2026-08-25

### 新增

- 新增第三种效果样式「柔光晕（散光，glow）」：
  - 多层嵌套 inset box-shadow：内层清晰边线 + 多层 blur/spread 递增、
    alpha 递减的软晕，由内向外柔和散逸的散射光
  - 隐藏 SVG 的 `feTurbulence` + `feDisplacementMap` 滤镜让光晕边缘呈
    轻微有机不规则（`glowWobble` 作为位移 scale，0 = 关闭）
  - 新参数 `glowSpread`（扩散范围，0..200）与 `glowWobble`（不规则强度，
    0..10），设置面板在切换柔光晕时条件显示
- 向后兼容：默认效果样式仍为 `conic` 跑马灯；旧 localStorage 与旧行配置
  缺少新字段时用默认值兜底

### 技术要点

- 柔光晕用 `position: fixed; inset: 0` 满屏层 + `box-shadow`，不用
  mask 抠边；阴影由 JS 根据状态色 + 宽度 + 扩散范围拼成 `--ml-glow-shadow`
- 位移滤镜只在 `glowWobble > 0` 时注入，`glowWobble = 0` 不应用，弱设备
  可关掉降低开销
- 预览页 `docs/preview.html` 支持柔光晕独立预览并实时调参

## [0.1.0] - 2026-08-18

### 新增

- 跑马灯氛围灯：屏幕边缘渐变光环随会话状态自动变色
  - 运行中：绿色光带流动 + 闪动
  - 完成 / 空闲：粉色稳态光带
  - 有待处理（审批 / 计划确认 / 提问）：黄色慢速脉冲
- 设置面板新增「氛围灯」页面（settings.section），可视化调节：
  - 启用开关、光圈宽度、不透明度
  - 效果样式（跑马灯 / 线性）、光带样式（分段经典 / 平滑柔和）
  - 跑马灯转速、亮度闪动频率、各状态渐变色
- 配置持久化到 localStorage（第三方命名空间不在宿主 settings wire 白名单内）
- 独立预览页 `docs/preview.html`：不安装插件即可预览效果并调参
- 逻辑测试 `scripts/test.js`：状态映射 / 配置合并 / 持久化
- CI 工作流：bundle 语法检查 + 逻辑测试
- 中英文 README

### 技术要点

- 手写 client bundle，遵循 DSH client-modules 协议
  （`window.__ModuleLoader__.load({ id, factory })`），零构建
- 光环：`padding` + `mask-composite: exclude` 抠出外圈，旋转
  `conic-gradient` 盘实现跑马灯
- 状态来源：`shell.overlay` 标准 props `useSessions` 的会话摘要
