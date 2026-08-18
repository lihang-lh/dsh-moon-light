/*
 * dsh-mood-light — 会话氛围灯（浏览器端 client bundle）
 *
 * 在屏幕最外层渲染一圈「跑马灯」渐变光圈（shell.overlay 槽位，点击穿透、
 * 不挡任何操作），并根据当前会话状态自动切换颜色与闪动节奏：
 *
 *   运行中（agent 正在工作）     -> 绿色光带流动 + 闪动
 *   完成 / 空闲（无待处理）     -> 粉色光带（稳态）
 *   有待处理（审批/计划确认/提问）-> 黄色光带（慢速脉冲，优先级最高）
 *   无会话 / 空白会话 / 已禁用  -> 关闭
 *
 * 状态来源：shell.overlay 标准 props 的 useSessions（SessionListState 快照），
 * 每条 SessionSummary 携带 running / blank / pendingInteraction —— 宿主端按
 * 会话实时下发的状态信号。
 *
 * 定制：设置面板新增「氛围灯」页面（settings.section），可调
 * 启用 / 宽度 / 不透明度 / 效果样式（跑马灯 vs 线性）/ 转速 / 闪动频率 /
 * 三状态的渐变色。配置持久化在 localStorage（第三方命名空间不在宿主
 * settings wire 的白名单内，与 dsh-skin 同一模式），同浏览器生效。
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
      width: 8,               // 光圈厚度 px
      opacity: 0.6,           // 最大不透明度 0..1
      gradientType: "conic",  // 'conic' 跑马灯旋转光带 | 'linear' 线性渐变
      segments: true,         // 光带样式：true 分段跑马灯 | false 平滑渐变（仅 conic）
      rotate: 16,             // 跑马灯旋转一圈的秒数（0 = 静止）
      flash: 1.2,             // 未单独指定时各状态的默认闪动秒数（0 = 稳态）
      states: {
        running: { colors: ["#10b981", "#34d399", "#6ee7b7"], flash: 1.2 },
        success: { colors: ["#ec4899", "#f472b6", "#f9a8d4"], flash: 0 },
        warning: { colors: ["#f59e0b", "#fbbf24", "#fde68a"], flash: 1.6 }
      }
    };

    var STORAGE_KEY = "dsh-mood-light:config";
    var STYLE_ID = "dsh-mood-light-style";
    var MODES = [
      { key: "running", label: "运行中" },
      { key: "success", label: "完成" },
      { key: "warning", label: "待处理" }
    ];

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

    /** 深度合并 config：只覆盖给出的字段，states 逐状态合并。 */
    function mergeConfig(cfg) {
      var merged = {
        enabled: DEFAULT_CONFIG.enabled,
        width: DEFAULT_CONFIG.width,
        opacity: DEFAULT_CONFIG.opacity,
        gradientType: DEFAULT_CONFIG.gradientType,
        segments: DEFAULT_CONFIG.segments,
        rotate: DEFAULT_CONFIG.rotate,
        flash: DEFAULT_CONFIG.flash,
        states: {}
      };
      if (cfg && typeof cfg === "object") {
        if (typeof cfg.enabled === "boolean") merged.enabled = cfg.enabled;
        if (typeof cfg.width === "number") merged.width = cfg.width;
        if (typeof cfg.opacity === "number") merged.opacity = cfg.opacity;
        if (cfg.gradientType === "conic" || cfg.gradientType === "linear") merged.gradientType = cfg.gradientType;
        if (typeof cfg.segments === "boolean") merged.segments = cfg.segments;
        if (typeof cfg.rotate === "number") merged.rotate = cfg.rotate;
        if (typeof cfg.flash === "number") merged.flash = cfg.flash;
      }
      for (var i = 0; i < MODES.length; i++) {
        var mode = MODES[i].key;
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
        /* --- 跑马灯光圈 --- */
        ".dsh-mood-light {",
        "  position: fixed;",
        "  inset: 0;",
        "  z-index: 2147483000;",
        "  pointer-events: none;",
        "  box-sizing: border-box;",
        "  padding: var(--ml-width);",
        "  background: var(--ml-gradient);",
        "  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);",
        "  -webkit-mask-composite: xor;",
        "  mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);",
        "  mask-composite: exclude;",
        "  opacity: var(--ml-opacity);",
        "  animation: dsh-mood-light-flash var(--ml-flash) ease-in-out infinite;",
        "  will-change: opacity;",
        "}",
        ".dsh-mood-light[data-flash=\"off\"] { animation: none; }",
        "@keyframes dsh-mood-light-flash {",
        "  0%, 100% { opacity: var(--ml-opacity); }",
        "  50% { opacity: calc(var(--ml-opacity) * 0.18); }",
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
        "@media (prefers-reduced-motion: reduce) {",
        "  .dsh-mood-light, .dsh-mood-light-disc { animation: none; }",
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
    function resolveMode(summary, config) {
      if (!config.enabled) return null;
      if (summary === undefined) return null;       // 无会话
      if (summary.blank === true) return null;      // 空白会话（还没有对话）
      if (summary.pendingInteraction != null) return "warning"; // 待处理优先
      if (summary.running === true) return "running";
      return "success";
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

    /** 订阅配置变化的 hook（React 18 安全写法）。 */
    function useConfig() {
      var force = React.useState(0)[1];
      React.useEffect(function () {
        return subscribe(function () { force(function (n) { return n + 1; }); });
      }, []);
      return getConfig();
    }

    /* ============ 氛围灯组件 ============ */
    function MoodLight(props) {
      var config = useConfig();
      var summary = props.useSessions(function (s) {
        var cur = s.current;
        return cur === undefined ? undefined : (s.byId[cur] || undefined);
      });

      var mode = resolveMode(summary, config);
      if (mode === null) return null;

      var stateCfg = config.states[mode] || DEFAULT_CONFIG.states[mode];
      var colors = stateCfg.colors || DEFAULT_CONFIG.states[mode].colors;
      var flash = numberOr(stateCfg.flash, numberOr(config.flash, 0));
      var width = clamp(numberOr(config.width, DEFAULT_CONFIG.width), 1, 60);
      var opacity = clamp01(numberOr(config.opacity, DEFAULT_CONFIG.opacity));
      var rotate = Math.max(0, numberOr(config.rotate, DEFAULT_CONFIG.rotate));
      var conic = config.gradientType === "conic";

      var children = [];
      if (conic && rotate > 0) {
        children.push(React.createElement("div", {
          key: "disc",
          className: "dsh-mood-light-disc"
        }));
      }

      return React.createElement(
        "div",
        {
          className: "dsh-mood-light",
          "data-mode": mode,
          "data-flash": flash > 0 ? "on" : "off",
          "aria-hidden": true,
          style: {
            "--ml-gradient": gradientString(config, colors),
            "--ml-width": width + "px",
            "--ml-opacity": String(opacity),
            "--ml-flash": (flash > 0 ? flash : 0) + "s",
            "--ml-rotate": (conic && rotate > 0 ? rotate : 0) + "s"
          }
        },
        children
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

    function SettingsPage(props) {
      var config = useConfig();
      var close = typeof props.close === "function" ? props.close : null;

      return React.createElement(
        "div",
        { className: "dsh-mood-light-settings" },
        React.createElement("h2", null, "氛围灯设置"),
        React.createElement("p", { className: "ml-hint" },
          "会话运行时在屏幕边缘显示一圈跑马灯光圈：运行中绿色流动、完成粉色、有待处理（审批/提问）黄色警告。"
        ),
        /* 启用 */
        React.createElement(
          "label",
          { className: "ml-field" },
          React.createElement("span", { className: "ml-label" }, "启用氛围灯"),
          React.createElement("input", {
            type: "checkbox",
            checked: config.enabled === true,
            onChange: function (ev) { setConfig({ enabled: ev.target.checked }); }
          })
        ),
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
            React.createElement("option", { value: "linear" }, "线性渐变（静止）")
          )
        ),
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
          var sc = config.states[mode.key] || DEFAULT_CONFIG.states[mode.key];
          return React.createElement(
            "div",
            { key: mode.key, className: "ml-state" },
            React.createElement(
              "div",
              { className: "ml-state-head" },
              React.createElement("span", { className: "ml-label" }, "状态：" + mode.label),
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
                    onChange: function (ev) { setStateColor(mode.key, index, ev.target.value); }
                  });
                })
              )
            ),
            React.createElement(SliderField, {
              label: "该状态闪动",
              min: 0, max: 10, step: 0.2,
              value: sc.flash,
              display: sc.flash > 0 ? sc.flash.toFixed(1) + " 秒/周期" : "不闪动",
              onChange: function (v) { setStateConfig(mode.key, { flash: v }); }
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
      ctx.slots.inject("shell.overlay", function () {
        return ctx.slots.register(
          { name: "shell.overlay", id: "mood-light", order: 9999, label: "氛围灯" },
          function (props) {
            return React.createElement(MoodLight, props);
          }
        );
      });
      ctx.slots.inject("settings.section", function () {
        return ctx.slots.register(
          { name: "settings.section", id: "mood-light", order: 60, label: "氛围灯" },
          function (props) {
            return React.createElement(SettingsPage, props);
          }
        );
      });
    }

    exports.apply = apply;
    exports.inject = ["slots"];
    return module.exports;
  }
});
