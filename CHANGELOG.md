# Changelog

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
