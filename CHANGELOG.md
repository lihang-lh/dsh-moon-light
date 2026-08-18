# Changelog

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
