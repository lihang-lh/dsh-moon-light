# 提案：氛围灯优化

- 任务 ID：`t_mt89ub8k_dfx91u`
- 状态：已规划（由任务面板维护）
- 创建时间：2026-08-25T06:15:58.052Z
- 来源会话：`session-81dad139-83cd-4068-a32b-f724f65165b0`
- 目标仓库：`/Users/lihang/gitlab1/dsh-mood-light`

## 背景与动机
当前这个项目的闪动的边框有点太硬了，我希望能变的圆滑一些，或者是用阴影的效果来做，做成那种可以散出来的光，可以稍微不规则一些

## 目标与方案
本轮把柔光晕（glow）升级为默认样式，并彻底“软化”其观感：将 client.js 的 DEFAULT_CONFIG.gradientType 与 cordis.patch.yml 的部署默认从 'conic' 改为 'glow'（conic/linear 仍在设置页可选，向后兼容）；重写 glowShadowString，删除当前首层 `inset 0 0 0 w px rgba(core,0.9)`（零模糊实心核心带，即截图中的“边框/硬边线”来源），改为纯多层 blur>0、spread 由 w 递增到 w+glowSpread、alpha 递减的内散射软晕，让光从屏幕边缘平滑向内淡出、无清晰棱线；同时把 @keyframes dsh-mood-light-flash 的 50% 谷底从 opacity*0.18 抬到约 opacity*0.35（配 ease-in-out），使“闪动”成为柔和呼吸而非刺眼硬闪。所有默认值/断言/预览/文档/补丁随默认切换同步更新：scripts/test.cjs 原有“默认 conic”断言改为“默认 glow”，并显式补 conic/linear 用例与“阴影串不含零模糊硬核”断言，conic/linear 覆盖不丢。验收按老板 Q3：node --check client.js、node --check index.js、node scripts/test.cjs 全绿，并打开 docs/preview.html（默认即 glow）与 DSH「设置→氛围灯」截图，确认柔和内散射、无边框、略不规则、闪动不硬、参数实时生效。

## 实施步骤
- 见 [tasks.md](./tasks.md)（9 个编号任务）

## 风险
- 视觉验收依赖人眼/截图：不同显示器/gamma 下“无边框/柔和”观感可能不同，需在默认档与 spread60-wobble4 档两张截图核对；项目无自动化视觉断言，只能人工比对。
- localStorage 优先级高于行配置：已安装用户若存了 gradientType='conic'，切默认后不会自动变 glow（仅新装/清存储后生效），可能被误判为“没改默认”。按现状保留（不越权覆盖用户偏好），并在文档与验收里说明。
- 去掉实心核心带后，纯内散射在紧贴屏幕边缘处亮度可能偏低或出现轻微缝隙；需在预览用默认档与高 spread 档核验亮度连续性，必要时微调首层 blur/spread/alpha，避免过度弱化导致光太弱看不清。
- 闪动谷底调浅（0.18→0.35）可能降低“待处理黄色警告”的警觉性；需在 warning 态确认仍可辨（黄色对比足够即可），必要时按状态差异化谷底——默认只改全局 keyframes，不改状态级。
- 默认值（glowSpread=24、glowWobble=1）可能不够“散/不规则”；若视觉核验偏弱，仅微调这两个数值，避免引入新字段或扩改动面。
- conic/linear 不再是默认，但旧文档/注释/测试/README 多处仍写“默认跑马灯”，与实现不一致会造成文档漂移；需全量 grep 同步（client.js 注释、cordis.patch.yml、preview、README*.md、CHANGELOG、test.cjs）。
- 测试与默认强联动，改动面超出单纯“调参数”（默认断言 conic→glow + 补 conic/linear 用例），需严格按“先 node --check 再 node scripts/test.cjs”推进，避免红图或漏同步。

## 验收方式
（任务未单独填写验收标准，以下方澄清问答为准）

## 澄清问答（老板确认）
- Q1：仓库 v0.2.0 已把「柔光晕(glow)」做成可选样式（默认仍是生硬的 conic 跑马灯）。这次「太硬」的未满足点更接近哪种：(a) 把柔光晕设为默认效果（开箱即软，conic/linear 仍可选）；(b) 仅继续打磨现有 glow（更软/更散/更有机），conic 仍作默认；(c) 只软化现有 conic（平滑渐变 + 呼吸闪动），不换默认？ → a
- Q2：「散出来的光」——当前满屏 inset box-shadow 只能从屏幕边缘向内扩散，物理上无法在视口外显示溢出光。是否需要在屏幕边缘外额外补一层「向外微溢」的近光层（增加立体散射感，但需权衡实现复杂与性能），还是边缘向内散射即可？ → 向内散射即可，但是如果选择散射的效果就不要显示边框了，我看截图中还是 有边框的
- Q3：验收标准未指定。以下判定是否可接受：node --check client.js/index.js + node scripts/test.cjs 全绿，并打开 docs/preview.html 与 DSH「设置→氛围灯」截图确认柔和/散射/略不规则、闪动不硬的观看效果（参数实时生效）；若你有更具体的视觉基准图/效果参考，请一并提供以便对照？ → 接受