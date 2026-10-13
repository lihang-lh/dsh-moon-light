/*
 * dsh-mood-light — 会话氛围灯（浏览器端 client bundle）
 *
 * 在屏幕最外层渲染一圈「氛围光」（shell.overlay 槽位，点击穿透、不挡操作），
 * 并根据**全部会话**的最高优先级状态自动切换光色与闪动节奏：
 *
 *   运行中（agent 正在工作）      -> 绿色呼吸
 *   完成 / 空闲                   -> 粉色稳态（刚完成时播放一次扫光）
 *   待审批（approval）            -> 琥珀色脉冲（最高优先级）
 *   计划待审（plan-review）       -> 青蓝色脉冲
 *   待回答（question）            -> 紫色脉冲
 *   无会话 / 空白会话 / 已禁用    -> 关闭
 *
 * 状态来源：shell.overlay 标准 props 的 useSessions（SessionListState 快照，
 * 提供 byId 行快照）与 useSessionStatus（ReadonlyMap<SessionId, SessionStatus>，
 * 逐会话的 running / pendingInteraction / completionUnread）。注意
 * pendingInteraction 只在 SessionStatus 里，SessionSummary 上没有该字段。
 *
 * 交互：
 *   - 屏幕顶部一条极窄触发带（默认 10px），鼠标进入后从顶部居中浮现一枚胶囊，
 *     显示「状态点 + 会话标题 + 状态说明 + 多会话汇总」，点击可跳转到该会话；
 *   - 输入框下方常驻一条 36px 状态条（conversation.composer.dock 槽位），
 *     随时可见状态并提供一键开关；
 *   - 快捷键 Ctrl/Cmd+Shift+M 切换启用状态。
 *
 * 定制：设置面板新增「氛围灯」页面（settings.section），可调启用 / 宽度 /
 * 不透明度 / 效果样式（柔光晕 vs 跑马灯 vs 线性）/ 状态过渡时长 / 噪点强度 /
 * 完成扫光 / 顶部胶囊 / 状态条 / 五状态各自的渐变色与闪动节奏。
 * 配置持久化在 localStorage（第三方命名空间不在宿主 settings wire 的白名单内，
 * 与 dsh-skin 同一模式），同浏览器生效。
 *
 * 手写 bundle 遵循 DSH client-modules 协议：
 *   window.__ModuleLoader__.load({ id, factory })，
 *   factory(require) 返回 module.exports = { inject, apply }。
 */
window.__ModuleLoader__.load({
  id: "dsh-mood-light",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require("react");

    /* ============ 默认配置 ============ */
    var DEFAULT_CONFIG = {
      enabled: true,
      width: 8,                 // 光圈厚度 px
      opacity: 0.6,             // 最大不透明度 0..1（深浅色再乘 --ml-theme-scale）
      gradientType: "glow",     // 默认 'glow' 柔光晕；可选 'conic' 跑马灯旋转光带 | 'linear' 线性渐变
      segments: true,           // 光带样式：true 分段跑马灯 | false 平滑渐变（仅 conic）
      rotate: 16,               // 跑马灯旋转一圈的秒数（0 = 静止）
      flash: 1.2,               // 未单独指定时各状态的默认闪动秒数（0 = 稳态）
      glowSpread: 24,           // 柔光晕散射范围 px（0..200，仅 glow）
      glowWobble: 0,            // 柔光晕不规则强度（0..10，仅 glow；0 = 不应用全屏位移滤镜，默认关闭以省性能）
      transitionMs: 700,        // 状态切换的 crossfade 时长 ms（0 = 硬切）
      sweep: true,              // 完成时播放一次斜向扫光
      grain: 0.035,             // 噪点层强度 0..0.15（0 = 不渲染噪点层）
      capsule: true,            // 顶部触发带 + 悬浮胶囊
      capsuleTriggerHeight: 10, // 顶部触发带高度 px
      statusBar: true,          // 输入框下方常驻状态条
      states: {
        running: { colors: ["#10b981", "#34d399", "#6ee7b7"], flash: 1.2 },
        success: { colors: ["#ec4899", "#f472b6", "#f9a8d4"], flash: 0 },
        warning: { colors: ["#f59e0b", "#fbbf24", "#fde68a"], flash: 1.1 },
        planReview: { colors: ["#06b6d4", "#22d3ee", "#67e8f9"], flash: 2.0 },
        question: { colors: ["#a855f7", "#c084fc", "#d8b4fe"], flash: 1.6 }
      }
    };

    var STORAGE_KEY = "dsh-mood-light:config";
    var STYLE_ID = "dsh-mood-light-style";

    /* 五态模式键。warning 的键名与色值与 v0.3 完全一致（语义由「待处理」收窄为
     * 「待审批」），因此老 localStorage 配置无需迁移。 */
    var MODES = ["running", "success", "warning", "planReview", "question"];
    var MODE_LABELS = {
      running: "运行中",
      success: "完成",
      warning: "待审批",
      planReview: "计划待审",
      question: "待回答"
    };
    var MODE_CAPTIONS = {
      running: "正在运行",
      success: "已完成",
      warning: "等待你的审批",
      planReview: "等待确认计划",
      question: "等待你的回答"
    };
    /* 数值越小优先级越高：待审批 > 待回答 > 计划待审 > 运行中 > 完成。 */
    var STATE_PRIORITY = { warning: 0, question: 1, planReview: 2, running: 3, success: 4 };

    /* 160px tile 的噪点（SVG fractalNoise），用 CSS 平铺代替全屏滤镜 —— 廉价得多。 */
    var GRAIN_URI = "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='160' height='160' filter='url(%23n)'/></svg>\")";

    /* ============ 工具 ============ */
    function numberOr(value, fallback) {
      return typeof value === "number" && Number.isFinite(value) ? value : fallback;
    }
    function clamp01(value) {
      return Math.max(0, Math.min(1, value));
    }
    function clamp(value, lo, hi) {
      return Math.max(lo, Math.min(hi, value));
    }

    /** 深度合并 config：只覆盖给出的字段，states 逐状态合并。老配置缺新键时自动补默认值。 */
    function mergeConfig(cfg) {
      var merged = {
        enabled: DEFAULT_CONFIG.enabled,
        width: DEFAULT_CONFIG.width,
        opacity: DEFAULT_CONFIG.opacity,
        gradientType: DEFAULT_CONFIG.gradientType,
        segments: DEFAULT_CONFIG.segments,
        rotate: DEFAULT_CONFIG.rotate,
        flash: DEFAULT_CONFIG.flash,
        glowSpread: DEFAULT_CONFIG.glowSpread,
        glowWobble: DEFAULT_CONFIG.glowWobble,
        transitionMs: DEFAULT_CONFIG.transitionMs,
        sweep: DEFAULT_CONFIG.sweep,
        grain: DEFAULT_CONFIG.grain,
        capsule: DEFAULT_CONFIG.capsule,
        capsuleTriggerHeight: DEFAULT_CONFIG.capsuleTriggerHeight,
        statusBar: DEFAULT_CONFIG.statusBar,
        states: {}
      };
      if (cfg && typeof cfg === "object") {
        if (typeof cfg.enabled === "boolean") merged.enabled = cfg.enabled;
        if (typeof cfg.width === "number") merged.width = cfg.width;
        if (typeof cfg.opacity === "number") merged.opacity = cfg.opacity;
        if (cfg.gradientType === "conic" || cfg.gradientType === "linear" || cfg.gradientType === "glow") merged.gradientType = cfg.gradientType;
        if (typeof cfg.segments === "boolean") merged.segments = cfg.segments;
        if (typeof cfg.rotate === "number") merged.rotate = cfg.rotate;
        if (typeof cfg.flash === "number") merged.flash = cfg.flash;
        if (typeof cfg.glowSpread === "number") merged.glowSpread = clamp(numberOr(cfg.glowSpread, DEFAULT_CONFIG.glowSpread), 0, 200);
        if (typeof cfg.glowWobble === "number") merged.glowWobble = clamp(numberOr(cfg.glowWobble, DEFAULT_CONFIG.glowWobble), 0, 10);
        if (typeof cfg.transitionMs === "number") merged.transitionMs = clamp(numberOr(cfg.transitionMs, DEFAULT_CONFIG.transitionMs), 0, 1500);
        if (typeof cfg.sweep === "boolean") merged.sweep = cfg.sweep;
        if (typeof cfg.grain === "number") merged.grain = clamp(numberOr(cfg.grain, DEFAULT_CONFIG.grain), 0, 0.15);
        if (typeof cfg.capsule === "boolean") merged.capsule = cfg.capsule;
        if (typeof cfg.capsuleTriggerHeight === "number") merged.capsuleTriggerHeight = clamp(numberOr(cfg.capsuleTriggerHeight, DEFAULT_CONFIG.capsuleTriggerHeight), 4, 40);
        if (typeof cfg.statusBar === "boolean") merged.statusBar = cfg.statusBar;
      }
      for (var i = 0; i < MODES.length; i++) {
        var mode = MODES[i];
        var def = DEFAULT_CONFIG.states[mode];
        var user = (cfg && cfg.states && cfg.states[mode]) || {};
        merged.states[mode] = {
          colors: Array.isArray(user.colors) && user.colors.length >= 2
            ? user.colors.slice()
            : def.colors.slice(),
          flash: typeof user.flash === "number" ? user.flash : def.flash
        };
      }
      return merged;
    }

    /* ============ 配置存储（localStorage + 内存订阅） ============ */
    var listeners = [];
    var state = null;

    function readStored() {
      if (typeof localStorage === "undefined") return null;
      try {
        var raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch (e) {
        return null;
      }
    }
    function writeStored(cfg) {
      if (typeof localStorage === "undefined") return;
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
      } catch (e) { /* 忽略配额/隐私模式错误 */ }
    }
    function notify() {
      for (var i = 0; i < listeners.length; i++) listeners[i]();
    }
    function getConfig() {
      return state;
    }
    function setConfig(patch) {
      state = mergeConfig(Object.assign({}, state, patch));
      writeStored(state);
      notify();
    }
    function setStateConfig(mode, patch) {
      var states = Object.assign({}, state.states);
      states[mode] = Object.assign({}, states[mode], patch);
      setConfig({ states: states });
    }
    function setStateColor(mode, index, color) {
      var colors = state.states[mode].colors.slice();
      colors[index] = color;
      setStateConfig(mode, { colors: colors });
    }
    function resetConfig() {
      state = mergeConfig(DEFAULT_CONFIG);
      writeStored(state);
      notify();
    }
    function subscribe(fn) {
      listeners.push(fn);
      return function () {
        var i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
      };
    }
    /** 初始化：localStorage（用户设置） > cordis 行 config（部署默认） > 内置默认。 */
    function initState(rowConfig) {
      var stored = readStored();
      state = mergeConfig(stored !== null ? stored : rowConfig);
      if (stored === null) writeStored(state);
    }

    /* ============ 样式（一次性注入） ============ */
    function ensureStyles() {
      if (typeof document === "undefined") return;
      if (document.getElementById(STYLE_ID)) return;
      var tag = document.createElement("style");
      tag.id = STYLE_ID;
      tag.dataset.plugin = "dsh-mood-light";
      tag.textContent = [
        /* --- 根容器：只负责定位与主题系数，装饰都在子层 --- */
        ".dsh-mood-light {",
        "  position: fixed;",
        "  inset: 0;",
        "  z-index: 2147483000;",
        "  pointer-events: none;",
        "  box-sizing: border-box;",
        "  --ml-theme-scale: 1.35;",
        "}",
        /* 深色主题下光线在暗底上更显眼，把整体亮度系数压下来，避免过曝。 */
        "body[data-ds-dark-theme] .dsh-mood-light { --ml-theme-scale: 0.85; }",
        /* --- 跑马灯 / 线性光圈（保持 v0.3 行为，仅选择器加上 is-* 后缀） --- */
        ".dsh-mood-light.is-conic, .dsh-mood-light.is-linear {",
        "  padding: var(--ml-width);",
        "  background: var(--ml-gradient);",
        "  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);",
        "  -webkit-mask-composite: xor;",
        "  mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);",
        "  mask-composite: exclude;",
        "  opacity: calc(var(--ml-opacity) * var(--ml-theme-scale));",
        "  animation: dsh-mood-light-flash var(--ml-flash) ease-in-out infinite;",
        "  will-change: opacity;",
        "}",
        ".dsh-mood-light.is-conic[data-flash=\"off\"], .dsh-mood-light.is-linear[data-flash=\"off\"] { animation: none; }",
        "@keyframes dsh-mood-light-flash {",
        "  0%, 100% { opacity: calc(var(--ml-opacity) * var(--ml-theme-scale)); }",
        "  50% { opacity: calc(var(--ml-opacity) * var(--ml-theme-scale) * 0.35); }",
        "}",
        /* 旋转盘：inset -50% 撑成 2 倍尺寸的方块，绕中心旋转，被 mask 裁成光圈 —— 跑马灯效果。 */
        ".dsh-mood-light-disc {",
        "  position: absolute;",
        "  inset: -50%;",
        "  background: var(--ml-gradient);",
        "  animation: dsh-mood-light-spin var(--ml-rotate) linear infinite;",
        "  will-change: transform;",
        "}",
        ".dsh-mood-light-disc[data-spin=\"off\"] { animation: none; }",
        "@keyframes dsh-mood-light-spin { to { transform: rotate(360deg); } }",
        /* --- 环境光：顶部与底部各一层大范围径向染色，给屏幕一点「被照亮」的场 --- */
        ".dsh-mood-light-fill {",
        "  position: absolute;",
        "  inset: 0;",
        "  pointer-events: none;",
        "  background:",
        "    radial-gradient(90% 55% at 50% 0%, var(--ml-fill-a) 0%, transparent 72%),",
        "    radial-gradient(70% 45% at 50% 100%, var(--ml-fill-b) 0%, transparent 70%);",
        "  opacity: calc(var(--ml-opacity) * 0.16 * var(--ml-theme-scale));",
        "  will-change: opacity;",
        "}",
        /* --- 噪点：160px 平铺的 SVG noise，overlay 混合，替代昂贵的全屏滤镜 --- */
        ".dsh-mood-light-grain {",
        "  position: absolute;",
        "  inset: 0;",
        "  pointer-events: none;",
        "  background-image: " + GRAIN_URI + ";",
        "  background-repeat: repeat;",
        "  background-size: 160px 160px;",
        "  mix-blend-mode: overlay;",
        "  opacity: var(--ml-grain);",
        "}",
        /* --- 柔光晕（散光）：外层负责 crossfade，内层负责 box-shadow 与闪动 --- */
        ".dsh-mood-light-glow {",
        "  position: absolute;",
        "  inset: 0;",
        "  pointer-events: none;",
        "  will-change: opacity;",
        "}",
        ".dsh-mood-light-glow.is-in { animation: dsh-mood-light-fade-in var(--ml-transition) ease-out 1 both; }",
        ".dsh-mood-light-glow.is-out { animation: dsh-mood-light-fade-out var(--ml-transition) ease-in 1 both; }",
        "@keyframes dsh-mood-light-fade-in { from { opacity: 0; } to { opacity: 1; } }",
        "@keyframes dsh-mood-light-fade-out { from { opacity: 1; } to { opacity: 0; } }",
        ".dsh-mood-light-glow-core {",
        "  position: absolute;",
        "  inset: 0;",
        "  box-sizing: border-box;",
        "  box-shadow: var(--ml-glow-shadow);",
        "  opacity: calc(var(--ml-opacity) * var(--ml-theme-scale));",
        "  animation: dsh-mood-light-flash var(--ml-flash) ease-in-out infinite;",
        "  will-change: opacity;",
        "}",
        ".dsh-mood-light[data-flash=\"off\"] .dsh-mood-light-glow-core { animation: none; }",
        /* --- 完成扫光：一条 115° 斜向亮带，复用抠环遮罩，只扫边缘 --- */
        ".dsh-mood-light-sweep {",
        "  position: absolute;",
        "  inset: 0;",
        "  pointer-events: none;",
        "  box-sizing: border-box;",
        "  padding: var(--ml-width);",
        "  background-image: linear-gradient(115deg, transparent 38%, var(--ml-sweep-color) 50%, transparent 62%);",
        "  background-size: 260% 100%;",
        "  background-position: 160% 0;",
        "  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);",
        "  -webkit-mask-composite: xor;",
        "  mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);",
        "  mask-composite: exclude;",
        "  opacity: 0;",
        "}",
        ".dsh-mood-light-sweep.is-active { animation: dsh-mood-light-sweep 1150ms cubic-bezier(0.33, 0, 0.2, 1) 1 both; }",
        "@keyframes dsh-mood-light-sweep {",
        "  0% { background-position: 160% 0; opacity: 0; }",
        "  18% { opacity: 0.85; }",
        "  82% { opacity: 0.85; }",
        "  100% { background-position: -60% 0; opacity: 0; }",
        "}",
        /* --- 顶部触发带：极窄的一条，只有它和胶囊会接事件，其余全屏点击穿透 --- */
        ".dsh-mood-light-hit {",
        "  position: absolute;",
        "  top: 0;",
        "  left: 0;",
        "  right: 0;",
        "  height: var(--ml-hit-height);",
        "  pointer-events: auto;",
        "  cursor: default;",
        "}",
        /* --- 悬浮胶囊：顶部居中浮现，毛玻璃 + 宿主设计 token --- */
        ".dsh-mood-light-capsule {",
        "  position: absolute;",
        "  top: 10px;",
        "  left: 50%;",
        "  z-index: 2;",
        "  display: flex;",
        "  align-items: center;",
        "  gap: 8px;",
        "  box-sizing: border-box;",
        "  max-width: min(70vw, 620px);",
        "  padding: 6px 12px 6px 10px;",
        "  border-radius: var(--dsw-radius-md, 10px);",
        "  background: var(--dsw-specific-menu, rgba(28, 30, 34, 0.86));",
        "  -webkit-backdrop-filter: var(--dsw-menu-backdrop-filter, blur(12px));",
        "  backdrop-filter: var(--dsw-menu-backdrop-filter, blur(12px));",
        "  box-shadow: var(--dsw-elevation-panel, 0 8px 24px rgba(0, 0, 0, 0.18));",
        "  color: var(--dsw-alias-label-primary, #1f2329);",
        "  font-size: 12px;",
        "  line-height: 18px;",
        "  white-space: nowrap;",
        "  overflow: hidden;",
        "  opacity: 0;",
        "  pointer-events: none;",
        "  cursor: pointer;",
        "  transform: translateX(-50%) translateY(-6px);",
        "  transition: opacity 220ms ease, transform 220ms ease;",
        "}",
        ".dsh-mood-light-capsule.is-open {",
        "  opacity: 1;",
        "  pointer-events: auto;",
        "  transform: translateX(-50%) translateY(0);",
        "}",
        ".dsh-mood-light-capsule-dot {",
        "  width: 8px; height: 8px;",
        "  border-radius: 999px;",
        "  flex: none;",
        "}",
        ".dsh-mood-light-capsule-title {",
        "  flex: none;",
        "  max-width: 240px;",
        "  overflow: hidden;",
        "  text-overflow: ellipsis;",
        "  font-weight: 500;",
        "  color: var(--dsw-alias-label-primary, #1f2329);",
        "}",
        ".dsh-mood-light-capsule-caption {",
        "  flex: none;",
        "  color: var(--dsw-alias-label-secondary, #646a73);",
        "}",
        ".dsh-mood-light-capsule-extra {",
        "  flex: none;",
        "  padding-left: 8px;",
        "  border-left: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.08));",
        "  color: var(--dsw-alias-label-tertiary, #8a9099);",
        "}",
        /* --- 藏起来的 SVG 滤镜（仅在开启不规则强度且默认关闭时使用） --- */
        ".dsh-mood-light-turb {",
        "  position: absolute;",
        "  width: 0;",
        "  height: 0;",
        "  overflow: hidden;",
        "}",
        /* --- 输入框下方的常驻状态条（conversation.composer.dock） --- */
        ".dsh-mood-light-dock {",
        "  box-sizing: border-box;",
        "  width: calc(100% - var(--dsh-composer-side-clearance, 0px) - var(--dsh-composer-side-clearance, 0px) - var(--dsh-composer-dock-inset, 0px) - var(--dsh-composer-dock-inset, 0px) - var(--dsh-composer-dock-inset, 0px) - var(--dsh-composer-dock-inset, 0px));",
        "  margin: 0 auto;",
        "}",
        ".dsh-mood-light-bar {",
        "  isolation: isolate;",
        "  box-sizing: border-box;",
        "  position: relative;",
        "  display: flex;",
        "  align-items: center;",
        "  gap: 10px;",
        "  width: 100%;",
        "  max-width: calc(var(--dsh-composer-card-max-width, 100%) - 4 * var(--dsh-composer-dock-inset, 0px));",
        "  height: 36px;",
        "  margin: 0 auto;",
        "  padding: 4px 5px 4px 12px;",
        "  border: 0;",
        "  border-radius: var(--dsw-radius-md, 10px);",
        "  box-shadow: var(--dsw-elevation-panel, 0 2px 8px rgba(0, 0, 0, 0.08));",
        "  --dsw-elevation-stroke-color: var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.08));",
        "}",
        ".dsh-mood-light-bar:before {",
        "  content: \"\";",
        "  position: absolute;",
        "  inset: 0;",
        "  z-index: -1;",
        "  border-radius: inherit;",
        "  background: var(--dsw-specific-menu, rgba(255, 255, 255, 0.86));",
        "  -webkit-backdrop-filter: var(--dsw-menu-backdrop-filter, blur(12px));",
        "  backdrop-filter: var(--dsw-menu-backdrop-filter, blur(12px));",
        "  pointer-events: none;",
        "}",
        ".dsh-mood-light-bar-dot {",
        "  width: 8px; height: 8px;",
        "  border-radius: 999px;",
        "  flex: none;",
        "}",
        ".dsh-mood-light-bar-label {",
        "  flex: none;",
        "  font-size: 13px;",
        "  font-weight: 500;",
        "  line-height: 24px;",
        "  color: var(--dsw-alias-label-primary, #1f2329);",
        "}",
        ".dsh-mood-light-bar-text {",
        "  min-width: 0;",
        "  flex: 1;",
        "  overflow: hidden;",
        "  text-overflow: ellipsis;",
        "  white-space: nowrap;",
        "  font-size: 13px;",
        "  line-height: 20px;",
        "  color: var(--dsw-alias-label-primary-dimmed, #4d5359);",
        "}",
        ".dsh-mood-light-bar-btn {",
        "  corner-shape: round;",
        "  display: inline-flex;",
        "  flex: none;",
        "  align-items: center;",
        "  justify-content: center;",
        "  width: 28px; height: 28px;",
        "  padding: 0;",
        "  border: none;",
        "  border-radius: 999px;",
        "  background: 0 0;",
        "  color: var(--dsw-alias-label-tertiary, #8a9099);",
        "  font-size: 13px;",
        "  cursor: pointer;",
        "}",
        ".dsh-mood-light-bar-btn:hover {",
        "  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.06));",
        "  color: var(--dsw-alias-label-secondary, #646a73);",
        "}",
        /* --- 无障碍：动效全关 --- */
        "@media (prefers-reduced-motion: reduce) {",
        "  .dsh-mood-light.is-conic, .dsh-mood-light.is-linear, .dsh-mood-light-disc,",
        "  .dsh-mood-light-glow.is-in, .dsh-mood-light-glow.is-out,",
        "  .dsh-mood-light-glow-core { animation: none; }",
        "  .dsh-mood-light-glow.is-out, .dsh-mood-light-sweep { display: none; }",
        "  .dsh-mood-light-capsule { transition: none; }",
        "}",
        /* --- 设置页 --- */
        ".dsh-mood-light-settings {",
        "  display: flex;",
        "  flex-direction: column;",
        "  gap: 14px;",
        "  max-width: 460px;",
        "  padding: 4px 0 16px;",
        "}",
        ".dsh-mood-light-settings h2 {",
        "  margin: 0;",
        "  font-size: 15px;",
        "  line-height: 1.4;",
        "  color: var(--dsw-alias-label-primary, #1f2329);",
        "}",
        ".dsh-mood-light-settings .ml-hint {",
        "  margin: -6px 0 0;",
        "  font-size: 12px;",
        "  line-height: 1.6;",
        "  color: var(--dsw-alias-label-secondary, #646a73);",
        "}",
        ".dsh-mood-light-settings .ml-field {",
        "  display: flex;",
        "  align-items: center;",
        "  justify-content: space-between;",
        "  gap: 12px;",
        "}",
        ".dsh-mood-light-settings .ml-label {",
        "  font-size: 13px;",
        "  color: var(--dsw-alias-label-secondary, #646a73);",
        "  white-space: nowrap;",
        "}",
        ".dsh-mood-light-settings .ml-controls { display: flex; align-items: center; gap: 8px; }",
        ".dsh-mood-light-settings input[type=\"range\"] {",
        "  width: 180px;",
        "  accent-color: var(--dsw-brand-color-6, #1668dc);",
        "}",
        ".dsh-mood-light-settings input[type=\"checkbox\"] {",
        "  width: 16px; height: 16px;",
        "  accent-color: var(--dsw-brand-color-6, #1668dc);",
        "}",
        ".dsh-mood-light-settings input[type=\"color\"] {",
        "  width: 34px; height: 26px;",
        "  padding: 0;",
        "  border: 1px solid var(--dsw-alias-border-l2-darkmode-thin, rgba(0,0,0,0.12));",
        "  border-radius: 6px;",
        "  background: transparent;",
        "  cursor: pointer;",
        "}",
        ".dsh-mood-light-settings select {",
        "  padding: 4px 8px;",
        "  font-size: 13px;",
        "  border: 1px solid var(--dsw-alias-border-l2-darkmode-thin, rgba(0,0,0,0.12));",
        "  border-radius: 6px;",
        "  background: var(--dsw-specific-input-major, #ffffff);",
        "  color: var(--dsw-alias-label-primary, #1f2329);",
        "}",
        ".dsh-mood-light-settings .ml-state {",
        "  display: flex;",
        "  flex-direction: column;",
        "  gap: 8px;",
        "  padding: 10px 12px;",
        "  border: 1px solid var(--dsw-alias-border-l2-darkmode-thin, rgba(0,0,0,0.12));",
        "  border-radius: 10px;",
        "}",
        ".dsh-mood-light-settings .ml-state-head {",
        "  display: flex;",
        "  align-items: center;",
        "  justify-content: space-between;",
        "}",
        ".dsh-mood-light-settings .ml-swatch {",
        "  width: 72px; height: 12px;",
        "  border-radius: 6px;",
        "  border: 1px solid var(--dsw-alias-border-l2-darkmode-thin, rgba(0,0,0,0.12));",
        "}",
        ".dsh-mood-light-settings .ml-actions {",
        "  display: flex;",
        "  justify-content: flex-end;",
        "  gap: 8px;",
        "  margin-top: 4px;",
        "}",
        ".dsh-mood-light-settings button {",
        "  padding: 5px 14px;",
        "  font-size: 13px;",
        "  border-radius: 8px;",
        "  cursor: pointer;",
        "  border: 1px solid var(--dsw-alias-border-l2-darkmode-thin, rgba(0,0,0,0.12));",
        "  background: var(--dsw-specific-input-major, #ffffff);",
        "  color: var(--dsw-alias-label-primary, #1f2329);",
        "}",
        ".dsh-mood-light-settings button.ml-reset:hover {",
        "  background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.06));",
        "}"
      ].join("\n");
      document.head.appendChild(tag);
    }

    /* ============ 会话状态 -> 氛围灯模式 ============ */

    /**
     * 单个会话的状态解析。
     *
     * 注意：pendingInteraction 来自 useSessionStatus 的 SessionStatus，
     * 而不是 useSessions 的 SessionSummary —— SessionSummary 上没有这个字段，
     * v0.3 因为读错了来源，导致「待处理」永远不会亮黄。
     *
     * @param status  SessionStatus | undefined
     * @param summary SessionSummary | undefined
     * @param config  合并后的配置
     * @returns 模式键，或 null（不渲染）
     */
    function resolveSessionState(status, summary, config) {
      var cfg = config || DEFAULT_CONFIG;
      if (cfg.enabled === false) return null;
      if (summary === undefined || summary === null) return null;
      if (summary.blank === true) return null;              // 空白会话尚未开始对话
      var pi = status ? status.pendingInteraction : undefined;
      if (pi !== undefined && pi !== null) {
        /* 兼容两种形态：字符串 kind，或 { kind } 对象。 */
        var kind = typeof pi === "string" ? pi : (pi && pi.kind);
        if (kind === "plan-review" || kind === "planReview") return "planReview";
        if (kind === "question") return "question";
        return "warning";                                   // approval 及未知 kind 兜底
      }
      if (status && status.running === true) return "running";
      if (summary.running === true) return "running";       // status 缺失时降级到 row 快照
      return "success";
    }

    /**
     * 多会话聚合：光色取全局最高优先级，并给出该优先级的代表会话。
     * blank / 已禁用 / 缺失的会话不计入；并列时保留先遍历到的那一个（稳定）。
     *
     * @returns { mode, sessionId, counts, total }
     */
    function aggregateState(byId, statusMap, config) {
      var counts = {};
      var best = null;
      var bestId = null;
      var total = 0;
      if (byId && typeof byId === "object") {
        var ids = Object.keys(byId);
        for (var i = 0; i < ids.length; i++) {
          var id = ids[i];
          var status = statusMap && typeof statusMap.get === "function" ? statusMap.get(id) : undefined;
          var mode = resolveSessionState(status, byId[id], config);
          if (mode === null) continue;
          total += 1;
          counts[mode] = (counts[mode] || 0) + 1;
          if (best === null || STATE_PRIORITY[mode] < STATE_PRIORITY[best]) {
            best = mode;
            bestId = id;
          }
        }
      }
      return { mode: best, sessionId: bestId, counts: counts, total: total };
    }

    /** 某个模式的光晕阴影串（宽度/扩散取全局配置）。 */
    function shadowFor(mode, config) {
      var cfg = config || DEFAULT_CONFIG;
      var sc = (cfg.states && cfg.states[mode]) || DEFAULT_CONFIG.states[mode] || DEFAULT_CONFIG.states.running;
      var width = clamp(numberOr(cfg.width, DEFAULT_CONFIG.width), 1, 60);
      var spread = clamp(numberOr(cfg.glowSpread, DEFAULT_CONFIG.glowSpread), 0, 200);
      return glowShadowString(sc.colors, width, spread);
    }

    /**
     * crossfade 图层：出层在前、入层恒在最后。
     * previousMode 为 null 或与 mode 相同时只返回一层。
     */
    function renderLayers(mode, previousMode, config) {
      var layers = [];
      if (previousMode && previousMode !== mode) {
        layers.push({ mode: previousMode, out: true, shadow: shadowFor(previousMode, config) });
      }
      layers.push({ mode: mode, out: false, shadow: shadowFor(mode, config) });
      return layers;
    }

    /** 构造渐变字符串。segments 仅在 conic 下生效：把每个颜色切成等份扇形（经典跑马灯）。 */
    function gradientString(config, colors) {
      var type = config.gradientType === "conic" ? "conic" : "linear";
      if (type === "linear") {
        return "linear-gradient(135deg, " + colors.join(", ") + ")";
      }
      if (config.segments === true) {
        var n = colors.length;
        var slice = 360 / n;
        var stops = [];
        for (var i = 0; i < n; i++) {
          stops.push(colors[i] + " " + Math.round(i * slice) + "deg " + Math.round((i + 1) * slice) + "deg");
        }
        return "conic-gradient(from 0deg, " + stops.join(", ") + ")";
      }
      return "conic-gradient(from 0deg, " + colors.join(", ") + ")";
    }

    /** 把 #rrggbb 十六进制色转成带 alpha 的 rgba()，非 hex 时原样返回。 */
    function hexToRgba(hex, alpha) {
      var m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex));
      if (!m) return hex;
      var r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
      return "rgba(" + r + ", " + g + ", " + b + ", " + alpha + ")";
    }

    /**
     * 柔光晕 box-shadow 串：纯多层 blur>0 的内散射软晕，由屏幕边缘平滑向内
     * 淡出、无清晰棱线。首层紧贴边缘（spread 接近 w），随后 spread 递增至
     * w+spread、blur 递增、alpha 递减；近边缘用核心色、外沿用晕色。
     * 算法自 v0.3 起未改动。
     */
    function glowShadowString(colors, width, spread) {
      var core = (colors && colors[0]) || "#10b981";
      var halo = (colors && colors.length > 1) || false;
      var haloColor = halo ? colors[1] : core;
      var w = clamp(numberOr(width, DEFAULT_CONFIG.width), 1, 60);
      var s = clamp(numberOr(spread, DEFAULT_CONFIG.glowSpread), 0, 200);
      var max = w + s;
      var parts = [];
      var N = 5;
      for (var i = 0; i < N; i++) {
        var t = i / (N - 1);                       // 0 = 紧贴边，1 = 最深处
        var layerSpread = Math.round(w + (max - w) * t);
        var blur = Math.max(w, Math.round(layerSpread * 0.7));
        var alpha = Math.max(0.02, 0.6 * (1 - t) + 0.12).toFixed(3);
        var color = i <= 1 ? core : haloColor;     // 近边缘核心色，外沿晕色
        parts.push("inset 0 0 " + blur + "px " + layerSpread + "px " + hexToRgba(color, alpha));
      }
      return parts.join(", ");
    }

    /* ============ 状态描述（胶囊 / 状态条共用） ============ */
    function modeColors(mode, config) {
      var cfg = config || DEFAULT_CONFIG;
      var sc = (cfg.states && cfg.states[mode]) || DEFAULT_CONFIG.states[mode];
      return (sc && sc.colors) || DEFAULT_CONFIG.states.running.colors;
    }
    function modeFlash(mode, config) {
      var cfg = config || DEFAULT_CONFIG;
      var sc = (cfg.states && cfg.states[mode]) || DEFAULT_CONFIG.states[mode];
      if (sc && typeof sc.flash === "number") return sc.flash;
      return numberOr(cfg.flash, 0);
    }
    function pendingCount(counts) {
      if (!counts) return 0;
      return (counts.warning || 0) + (counts.question || 0) + (counts.planReview || 0);
    }
    function describeAggregate(aggregate, byId, statusMap) {
      var id = aggregate ? aggregate.sessionId : null;
      var row = id !== null && byId ? byId[id] : undefined;
      var status = id !== null && statusMap && typeof statusMap.get === "function" ? statusMap.get(id) : undefined;
      var title = row && typeof row.displayTitle === "string" && row.displayTitle !== ""
        ? row.displayTitle
        : "当前会话";
      return {
        mode: aggregate ? aggregate.mode : null,
        title: title,
        caption: MODE_CAPTIONS[aggregate && aggregate.mode] || "",
        unread: !!(status && status.completionUnread === true)
      };
    }
    function aggregateExtra(aggregate) {
      if (!aggregate || aggregate.total <= 1) return "";
      var others = aggregate.total - 1;
      var pend = pendingCount(aggregate.counts);
      return "另有 " + others + " 个会话" + (pend > 0 ? "（" + pend + " 个待处理）" : "");
    }

    /** 订阅配置变化的 hook（React 18 安全写法）。 */
    function useConfig() {
      var force = React.useState(0)[1];
      React.useEffect(function () {
        return subscribe(function () { force(function (n) { return n + 1; }); });
      }, []);
      return getConfig();
    }

    /**
     * 返回「正在淡出的上一模式」，transitionMs 后清空。
     *
     * 用 React 官方的「渲染期依据 props 调整 state」写法：渲染期检测到 mode
     * 变化时同步登记出层，提交后再由定时器清除 —— 这样即便期间有其它 re-render
     * （会话快照更新很频繁）也不会把出层提前摘掉。
     *
     * 注意：测试沙箱里的 React 桩 useState 是 noop setter，因此沙箱内出层恒为
     * null；crossfade 的算法本身由纯函数 renderLayers 覆盖。
     */
    function useFadingOut(mode, transitionMs) {
      var pair = React.useState({ tracked: mode, out: null });
      var current = pair[0];
      var setCurrent = pair[1];
      if (current.tracked !== mode) {
        setCurrent({ tracked: mode, out: current.tracked });
      }
      var out = current.tracked !== mode ? current.tracked : current.out;
      React.useEffect(function () {
        if (out === null) return undefined;
        /* 扫光动画比 crossfade 长，兜住两者的完整时长再摘掉出层。 */
        var hold = Math.max(numberOr(transitionMs, 0), 1200) + 80;
        var timer = setTimeout(function () {
          setCurrent(function (cur) {
            return { tracked: cur.tracked, out: null };
          });
        }, hold);
        return function () { clearTimeout(timer); };
      }, [out, transitionMs]);
      return out;
    }

    /**
     * 单个光晕层：外层 div 负责 crossfade（透明度关键帧，进出场各一次），
     * 内层 div 负责 box-shadow 与呼吸闪动 —— 拆两层是为了避免 opacity 上的
     * animation 与 transition 互相覆盖。
     */
    function renderGlowLayer(layer, isOut, config, width, opacity, transitionMs) {
      var layerFlash = modeFlash(layer.mode, config);
      return React.createElement(
        "div",
        {
          key: (isOut ? "out-" : "in-") + layer.mode,
          className: "dsh-mood-light-glow" + (isOut ? " is-out" : " is-in"),
          "aria-hidden": true,
          style: {
            "--ml-glow-shadow": layer.shadow,
            "--ml-width": width + "px",
            "--ml-opacity": String(opacity),
            "--ml-flash": (layerFlash > 0 ? layerFlash : 0) + "s",
            "--ml-transition": (transitionMs / 1000) + "s"
          }
        },
        React.createElement("div", { key: "core", className: "dsh-mood-light-glow-core" })
      );
    }

    /* ============ 氛围灯组件 ============ */
    function MoodLight(props) {
      var config = useConfig();

      /* 三个 selector 分别返回稳定引用，避免 useSyncExternalStore 的 getSnapshot 抖动。 */
      var current = props.useSessions(function (s) { return s.current; });
      var byId = props.useSessions(function (s) { return s.byId; });
      var statusMap = typeof props.useSessionStatus === "function"
        ? props.useSessionStatus(function (m) { return m; })
        : undefined;

      var aggregate = aggregateState(byId, statusMap, config);
      var mode = aggregate.mode;

      var hoverPair = React.useState(false);
      var hovered = hoverPair[0];
      var setHovered = hoverPair[1];
      /* 胶囊关闭延时用 ref 持有，卸载时清掉，避免对已卸载组件 setState。 */
      var closeTimerRef = React.useRef(null);

      var previousMode = useFadingOut(mode, config.transitionMs);
      React.useEffect(function () {
        return function () {
          if (closeTimerRef.current !== null) {
            clearTimeout(closeTimerRef.current);
            closeTimerRef.current = null;
          }
        };
      }, []);
      if (mode === null) return null;

      var colors = modeColors(mode, config);
      var flash = modeFlash(mode, config);
      var width = clamp(numberOr(config.width, DEFAULT_CONFIG.width), 1, 60);
      var opacity = clamp01(numberOr(config.opacity, DEFAULT_CONFIG.opacity));
      var transitionMs = clamp(numberOr(config.transitionMs, DEFAULT_CONFIG.transitionMs), 0, 1500);
      var rotate = Math.max(0, numberOr(config.rotate, DEFAULT_CONFIG.rotate));
      var grain = clamp(numberOr(config.grain, DEFAULT_CONFIG.grain), 0, 0.15);
      var glow = config.gradientType === "glow";
      var conic = config.gradientType === "conic";
      var rootClass = "dsh-mood-light is-" + (glow ? "glow" : (conic ? "conic" : "linear"));

      var rootStyle = {
        "--ml-width": width + "px",
        "--ml-opacity": String(opacity),
        "--ml-flash": (flash > 0 ? flash : 0) + "s",
        "--ml-transition": (transitionMs / 1000) + "s"
      };

      function openCapsule() {
        if (closeTimerRef.current !== null) {
          clearTimeout(closeTimerRef.current);
          closeTimerRef.current = null;
        }
        setHovered(true);
      }
      function closeCapsule() {
        if (closeTimerRef.current !== null) clearTimeout(closeTimerRef.current);
        closeTimerRef.current = setTimeout(function () {
          closeTimerRef.current = null;
          setHovered(false);
        }, 220);
      }

      var children = [];

      if (glow) {
        var glowSpread = clamp(numberOr(config.glowSpread, DEFAULT_CONFIG.glowSpread), 0, 200);
        var glowWobble = clamp(numberOr(config.glowWobble, DEFAULT_CONFIG.glowWobble), 0, 10);
        var capsuleOn = config.capsule === true;
        var hitHeight = clamp(numberOr(config.capsuleTriggerHeight, DEFAULT_CONFIG.capsuleTriggerHeight), 4, 40);

        rootStyle["--ml-fill-a"] = hexToRgba(colors[0], 0.55);
        rootStyle["--ml-fill-b"] = hexToRgba(colors[1] || colors[0], 0.4);
        rootStyle["--ml-grain"] = String(grain);
        rootStyle["--ml-hit-height"] = hitHeight + "px";
        rootStyle["--ml-sweep-color"] = hexToRgba(colors[2] || colors[1] || colors[0], 0.9);
        if (glowWobble > 0) rootStyle.filter = "url(#dsh-mood-light-turb)";

        /* 1) 环境光 */
        children.push(React.createElement("div", {
          key: "fill",
          className: "dsh-mood-light-fill",
          "aria-hidden": true
        }));

        /* 2) 噪点（可选） */
        if (grain > 0) {
          children.push(React.createElement("div", {
            key: "grain",
            className: "dsh-mood-light-grain",
            "aria-hidden": true
          }));
        }

        /* 3) 光晕层：入层在前，出层在后 */
        var layers = renderLayers(mode, previousMode, config);
        var inLayer = null;
        var outLayer = null;
        for (var li = 0; li < layers.length; li++) {
          if (layers[li].out) outLayer = layers[li];
          else inLayer = layers[li];
        }
        if (inLayer !== null) children.push(renderGlowLayer(inLayer, false, config, width, opacity, transitionMs));
        if (outLayer !== null) children.push(renderGlowLayer(outLayer, true, config, width, opacity, transitionMs));

        /* 4) 完成扫光：从非 success 切到 success 时播一次 */
        var sweepOn = config.sweep === true && mode === "success" && previousMode !== null && previousMode !== "success";
        if (sweepOn) {
          children.push(React.createElement("div", {
            key: "sweep-" + previousMode + "-" + mode,
            className: "dsh-mood-light-sweep is-active",
            "aria-hidden": true
          }));
        }

        /* 5) 顶部触发带 + 悬浮胶囊 */
        if (capsuleOn) {
          children.push(React.createElement("div", {
            key: "hit",
            className: "dsh-mood-light-hit",
            onMouseEnter: openCapsule,
            onMouseLeave: closeCapsule
          }));
          var info = describeAggregate(aggregate, byId, statusMap);
          var extra = aggregateExtra(aggregate);
          var caption = info.caption + (info.unread ? " · 已完成（未读）" : "");
          children.push(React.createElement(
            "div",
            {
              key: "capsule",
              className: "dsh-mood-light-capsule" + (hovered ? " is-open" : ""),
              title: aggregate.sessionId !== null && aggregate.sessionId !== current
                ? "点击前往该会话"
                : "当前会话",
              onMouseEnter: openCapsule,
              onMouseLeave: closeCapsule,
              onClick: function () {
                if (typeof props.openSession !== "function") return;
                if (aggregate.sessionId === null || aggregate.sessionId === current) return;
                props.openSession(aggregate.sessionId);
              }
            },
            React.createElement("span", {
              key: "dot",
              className: "dsh-mood-light-capsule-dot",
              style: { background: colors[0] }
            }),
            React.createElement("span", { key: "title", className: "dsh-mood-light-capsule-title" }, info.title),
            React.createElement("span", { key: "caption", className: "dsh-mood-light-capsule-caption" }, caption),
            extra !== ""
              ? React.createElement("span", { key: "extra", className: "dsh-mood-light-capsule-extra" }, extra)
              : null
          ));
        }

        /* 6) 可选的不规则位移滤镜载体 */
        if (glowWobble > 0) {
          children.push(React.createElement(
            "svg",
            {
              key: "turb",
              className: "dsh-mood-light-turb",
              "aria-hidden": true,
              style: { position: "absolute", width: 0, height: 0, overflow: "hidden" }
            },
            React.createElement(
              "defs",
              null,
              React.createElement(
                "filter",
                { id: "dsh-mood-light-turb" },
                React.createElement("feTurbulence", {
                  type: "fractalNoise",
                  baseFrequency: 0.011,
                  numOctaves: 2,
                  result: "noise",
                  seed: 2
                }),
                React.createElement("feDisplacementMap", {
                  in: "SourceGraphic",
                  in2: "noise",
                  scale: glowWobble,
                  xChannelSelector: "R",
                  yChannelSelector: "G"
                })
              )
            )
          ));
        }
      } else if (conic && rotate > 0) {
        children.push(React.createElement("div", {
          key: "disc",
          className: "dsh-mood-light-disc"
        }));
      }

      if (!glow) {
        rootStyle["--ml-gradient"] = gradientString(config, colors);
        rootStyle["--ml-rotate"] = (conic && rotate > 0 ? rotate : 0) + "s";
      }

      return React.createElement(
        "div",
        {
          className: rootClass,
          "data-mode": mode,
          "data-flash": flash > 0 ? "on" : "off",
          style: rootStyle
        },
        children
      );
    }

    /* ============ 输入框下方的常驻状态条 ============ */
    function MoodLightStatusBar(props) {
      var config = useConfig();
      var byId = props.useSessions(function (s) { return s.byId; });
      var statusMap = typeof props.useSessionStatus === "function"
        ? props.useSessionStatus(function (m) { return m; })
        : undefined;
      var aggregate = aggregateState(byId, statusMap, config);
      var mode = aggregate.mode;

      if (config.enabled !== true || config.statusBar !== true || mode === null) return null;

      var colors = modeColors(mode, config);
      var info = describeAggregate(aggregate, byId, statusMap);
      var extra = aggregateExtra(aggregate);
      var caption = info.caption + (info.unread ? " · 已完成（未读）" : "") + (extra === "" ? "" : " · " + extra);

      return React.createElement(
        "div",
        { className: "dsh-mood-light-dock" },
        React.createElement(
          "div",
          { className: "dsh-mood-light-bar", "data-mode": mode },
          React.createElement("span", {
            key: "dot",
            className: "dsh-mood-light-bar-dot",
            style: { background: colors[0] }
          }),
          React.createElement("span", { key: "label", className: "dsh-mood-light-bar-label" }, "氛围灯"),
          React.createElement("span", { key: "text", className: "dsh-mood-light-bar-text" }, caption),
          React.createElement(
            "button",
            {
              key: "toggle",
              type: "button",
              className: "dsh-mood-light-bar-btn",
              title: "关闭氛围灯",
              "aria-label": "关闭氛围灯",
              onClick: function () { setConfig({ enabled: false }); }
            },
            "◉"
          )
        )
      );
    }

    /* ============ 设置页组件 ============ */
    function SliderField(props) {
      return React.createElement(
        "label",
        { className: "ml-field" },
        React.createElement("span", { className: "ml-label" }, props.label),
        React.createElement(
          "span",
          { className: "ml-controls" },
          React.createElement("input", {
            type: "range",
            min: props.min,
            max: props.max,
            step: props.step,
            value: props.value,
            onChange: function (ev) { props.onChange(parseFloat(ev.target.value)); }
          }),
          React.createElement("span", { className: "ml-label" }, props.display)
        )
      );
    }

    function ToggleField(props) {
      return React.createElement(
        "label",
        { className: "ml-field" },
        React.createElement("span", { className: "ml-label" }, props.label),
        React.createElement("input", {
          type: "checkbox",
          checked: props.checked === true,
          onChange: function (ev) { props.onChange(ev.target.checked); }
        })
      );
    }

    function SettingsPage(props) {
      var config = useConfig();
      var close = typeof props.close === "function" ? props.close : null;

      return React.createElement(
        "div",
        { className: "dsh-mood-light-settings" },
        React.createElement("h2", null, "氛围灯设置"),
        React.createElement("p", { className: "ml-hint" },
          "在屏幕边缘渲染一圈柔和氛围光：运行中绿色呼吸、完成粉色稳态、待审批琥珀、计划待审青蓝、待回答紫色（多会话取最高优先级）。顶部悬浮胶囊可查看全局状态并一键跳转，输入框下方常驻状态条随时可关。"
        ),
        /* 启用 */
        React.createElement(ToggleField, {
          label: "启用氛围灯",
          checked: config.enabled,
          onChange: function (v) { setConfig({ enabled: v }); }
        }),
        /* 宽度 */
        React.createElement(SliderField, {
          label: "光圈宽度",
          min: 1, max: 40, step: 1,
          value: config.width,
          display: config.width + " px",
          onChange: function (v) { setConfig({ width: v }); }
        }),
        /* 不透明度 */
        React.createElement(SliderField, {
          label: "不透明度",
          min: 0.05, max: 1, step: 0.05,
          value: config.opacity,
          display: Math.round(config.opacity * 100) + "%",
          onChange: function (v) { setConfig({ opacity: v }); }
        }),
        /* 效果样式 */
        React.createElement(
          "div",
          { className: "ml-field" },
          React.createElement("span", { className: "ml-label" }, "效果样式"),
          React.createElement(
            "select",
            {
              value: config.gradientType,
              onChange: function (ev) { setConfig({ gradientType: ev.target.value }); }
            },
            React.createElement("option", { value: "conic" }, "跑马灯（旋转光带）"),
            React.createElement("option", { value: "linear" }, "线性渐变（静止）"),
            React.createElement("option", { value: "glow" }, "柔光晕（散光）")
          )
        ),
        /* 扩散范围（仅柔光晕） */
        config.gradientType === "glow"
          ? React.createElement(SliderField, {
              label: "扩散范围",
              min: 0, max: 200, step: 1,
              value: config.glowSpread,
              display: config.glowSpread + " px",
              onChange: function (v) { setConfig({ glowSpread: v }); }
            })
          : null,
        /* 不规则强度（仅柔光晕） */
        config.gradientType === "glow"
          ? React.createElement(SliderField, {
              label: "不规则强度",
              min: 0, max: 10, step: 0.1,
              value: config.glowWobble,
              display: config.glowWobble > 0 ? config.glowWobble.toFixed(1) : "关闭",
              onChange: function (v) { setConfig({ glowWobble: v }); }
            })
          : null,
        /* 状态过渡时长 */
        config.gradientType === "glow"
          ? React.createElement(SliderField, {
              label: "状态过渡",
              min: 0, max: 1500, step: 50,
              value: config.transitionMs,
              display: config.transitionMs > 0 ? config.transitionMs + " ms" : "硬切",
              onChange: function (v) { setConfig({ transitionMs: v }); }
            })
          : null,
        /* 噪点强度 */
        config.gradientType === "glow"
          ? React.createElement(SliderField, {
              label: "噪点强度",
              min: 0, max: 0.15, step: 0.005,
              value: config.grain,
              display: config.grain > 0 ? config.grain.toFixed(3) : "关闭",
              onChange: function (v) { setConfig({ grain: v }); }
            })
          : null,
        /* 完成扫光 */
        config.gradientType === "glow"
          ? React.createElement(ToggleField, {
              label: "完成扫光",
              checked: config.sweep,
              onChange: function (v) { setConfig({ sweep: v }); }
            })
          : null,
        /* 顶部胶囊 */
        config.gradientType === "glow"
          ? React.createElement(ToggleField, {
              label: "顶部状态胶囊",
              checked: config.capsule,
              onChange: function (v) { setConfig({ capsule: v }); }
            })
          : null,
        /* 触发带高度 */
        config.gradientType === "glow" && config.capsule === true
          ? React.createElement(SliderField, {
              label: "触发带高度",
              min: 4, max: 40, step: 1,
              value: config.capsuleTriggerHeight,
              display: config.capsuleTriggerHeight + " px",
              onChange: function (v) { setConfig({ capsuleTriggerHeight: v }); }
            })
          : null,
        /* 常驻状态条 */
        React.createElement(ToggleField, {
          label: "输入框下方状态条",
          checked: config.statusBar,
          onChange: function (v) { setConfig({ statusBar: v }); }
        }),
        /* 光带样式（仅跑马灯） */
        config.gradientType === "conic"
          ? React.createElement(
              "div",
              { className: "ml-field" },
              React.createElement("span", { className: "ml-label" }, "光带样式"),
              React.createElement(
                "select",
                {
                  value: config.segments === true ? "segments" : "smooth",
                  onChange: function (ev) { setConfig({ segments: ev.target.value === "segments" }); }
                },
                React.createElement("option", { value: "segments" }, "分段跑马灯（经典）"),
                React.createElement("option", { value: "smooth" }, "平滑渐变（柔和）")
              )
            )
          : null,
        /* 转速 */
        config.gradientType === "conic"
          ? React.createElement(SliderField, {
              label: "跑马灯转速",
              min: 0, max: 60, step: 1,
              value: config.rotate,
              display: config.rotate > 0 ? config.rotate + " 秒/圈" : "静止",
              onChange: function (v) { setConfig({ rotate: v }); }
            })
          : null,
        /* 全局闪动默认值 */
        React.createElement(SliderField, {
          label: "亮度闪动（默认）",
          min: 0, max: 10, step: 0.2,
          value: config.flash,
          display: config.flash > 0 ? config.flash.toFixed(1) + " 秒/周期" : "不闪动",
          onChange: function (v) { setConfig({ flash: v }); }
        }),
        /* 各状态渐变色 + 闪动 */
        MODES.map(function (mode) {
          var sc = config.states[mode] || DEFAULT_CONFIG.states[mode];
          return React.createElement(
            "div",
            { key: mode, className: "ml-state" },
            React.createElement(
              "div",
              { className: "ml-state-head" },
              React.createElement("span", { className: "ml-label" }, "状态：" + MODE_LABELS[mode]),
              React.createElement("span", {
                className: "ml-swatch",
                style: { background: "linear-gradient(90deg, " + sc.colors.join(", ") + ")" }
              })
            ),
            React.createElement(
              "div",
              { className: "ml-field" },
              React.createElement("span", { className: "ml-label" }, "渐变色"),
              React.createElement(
                "span",
                { className: "ml-controls" },
                sc.colors.map(function (color, index) {
                  return React.createElement("input", {
                    key: index,
                    type: "color",
                    value: color,
                    title: "颜色 " + (index + 1),
                    onChange: function (ev) { setStateColor(mode, index, ev.target.value); }
                  });
                })
              )
            ),
            React.createElement(SliderField, {
              label: "该状态闪动",
              min: 0, max: 10, step: 0.2,
              value: sc.flash,
              display: sc.flash > 0 ? sc.flash.toFixed(1) + " 秒/周期" : "不闪动",
              onChange: function (v) { setStateConfig(mode, { flash: v }); }
            })
          );
        }),
        React.createElement(
          "div",
          { className: "ml-actions" },
          React.createElement(
            "button",
            { type: "button", className: "ml-reset", onClick: resetConfig },
            "恢复默认"
          ),
          close !== null
            ? React.createElement("button", { type: "button", onClick: close }, "完成")
            : null
        )
      );
    }

    /* ============ 插件体 ============ */
    function apply(ctx, config) {
      ensureStyles();
      initState(mergeConfig(config));

      /* 缺 ctx.effect 时直接执行并返回其结果，保证桩环境与老宿主都能工作。 */
      function effect(fn, label) {
        if (typeof ctx.effect === "function") return ctx.effect(fn, label);
        return fn() || undefined;
      }

      /* 用 ctx.get 惰性取 uiWorkspace：缺该服务时静默降级（返回 false），
       * 而不是写进 exports.inject 让整个插件在缺服务时无法激活。 */
      function openSession(sessionId) {
        if (typeof sessionId !== "string" || sessionId === "") return false;
        if (typeof ctx.get !== "function") return false;
        var workspace = null;
        try {
          workspace = ctx.get("uiWorkspace");
        } catch (e) {
          return false;
        }
        if (!workspace || typeof workspace.openSession !== "function") return false;
        try {
          workspace.openSession(sessionId);
          return true;
        } catch (e) {
          return false;
        }
      }

      /* 1) 全屏氛围光 + 顶部胶囊 */
      effect(function () {
        return ctx.slots.inject("shell.overlay", function () {
          return ctx.slots.register(
            {
              name: "shell.overlay",
              id: "mood-light",
              order: 9999,
              label: "氛围灯",
              inject: function () { return { openSession: openSession }; }
            },
            function (props) {
              return React.createElement(MoodLight, props);
            }
          );
        });
      }, "mood-light: shell.overlay");

      /* 2) 输入框下方的常驻状态条 */
      effect(function () {
        return ctx.slots.inject("conversation.composer.dock", function () {
          return ctx.slots.register(
            { name: "conversation.composer.dock", id: "mood-light", order: 60, label: "氛围灯" },
            function (props) {
              return React.createElement(MoodLightStatusBar, props);
            }
          );
        });
      }, "mood-light: composer.dock");

      /* 3) 设置面板 */
      effect(function () {
        return ctx.slots.inject("settings.section", function () {
          return ctx.slots.register(
            { name: "settings.section", id: "mood-light", order: 60, label: "氛围灯" },
            function (props) {
              return React.createElement(SettingsPage, props);
            }
          );
        });
      }, "mood-light: settings.section");

      /* 4) 快捷键（可选注入：宿主没提供 shortcuts 服务时静默跳过） */
      if (typeof ctx.inject !== "function") return;
      ctx.inject(["shortcuts"], function (scope) {
        var shortcuts = scope && scope.shortcuts;
        if (!shortcuts || typeof shortcuts.register !== "function") return;
        var scopeEffect = scope && typeof scope.effect === "function" ? scope.effect : effect;
        scopeEffect(function () {
          try {
            return shortcuts.register({
              id: "mood-light.toggle",
              label: function () { return "切换氛围灯"; },
              aliases: ["mood light", "toggle mood light", "氛围灯"],
              defaults: {
                "desktop:macos": { code: "KeyM", modifiers: ["primary", "shift"] },
                "desktop:windows": { code: "KeyM", modifiers: ["primary", "shift"] },
                "desktop:linux": { code: "KeyM", modifiers: ["primary", "shift"] },
                "web:macos": { code: "KeyM", modifiers: ["primary", "shift"] },
                "web:windows": { code: "KeyM", modifiers: ["primary", "shift"] }
                /* 不声明 web:linux：宿主 isWebBindingAllowed() 对 Linux 只放行
                   Slash/Comma/Period 三条硬编码键位，任何字母键都会让 register()
                   抛错，且该校验急切遍历全部 profile，会把桌面端一起拖死。 */
              },
              regions: ["page", "editable"],
              modals: [],
              resolve: function () {
                var now = getConfig();
                var next = !(now && now.enabled === true);
                return {
                  status: "handled",
                  run: function () { setConfig({ enabled: next }); }
                };
              }
            });
          } catch (e) {
            /* 键位冲突等注册失败不应该拖垮整个插件，但必须留痕，否则静默失效无法排查。 */
            if (typeof console !== "undefined" && console.warn) {
              console.warn("[mood-light] 快捷键注册失败：", e && e.message ? e.message : e);
            }
            return undefined;
          }
        }, "mood-light: toggle shortcut");
      });
    }

    exports.apply = apply;
    exports.inject = ["slots"];

    /* 供单元测试与外部工具使用的纯函数 / 常量（不影响宿主协议）。 */
    exports.MODES = MODES;
    exports.MODE_LABELS = MODE_LABELS;
    exports.STATE_PRIORITY = STATE_PRIORITY;
    exports.DEFAULT_CONFIG = DEFAULT_CONFIG;
    exports.mergeConfig = mergeConfig;
    exports.resolveSessionState = resolveSessionState;
    exports.aggregateState = aggregateState;
    exports.renderLayers = renderLayers;
    exports.shadowFor = shadowFor;
    exports.glowShadowString = glowShadowString;
    exports.gradientString = gradientString;
    exports.hexToRgba = hexToRgba;
    exports.MoodLight = MoodLight;
    exports.MoodLightStatusBar = MoodLightStatusBar;
    exports.SettingsPage = SettingsPage;

    return module.exports;
  }
});
