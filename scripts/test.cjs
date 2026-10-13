#!/usr/bin/env node
/**
 * dsh-mood-light 逻辑测试（零依赖，node scripts/test.cjs）
 *
 * 在 vm 沙箱里加载 client.js bundle（桩掉 window / react / localStorage / document），验证：
 *   1. 协议：exports.inject / exports.apply，以及 v0.4 新增导出（MODES / DEFAULT_CONFIG /
 *      mergeConfig / resolveSessionState / aggregateState / renderLayers / glowShadowString）
 *   2. 槽位：shell.overlay / settings.section / conversation.composer.dock 均注册，id 为 mood-light
 *   3. 状态内核（T1-T5）：优先级、三种待处理 kind、未知 kind 兜底、
 *      blank / 缺 summary / enabled=false、status 缺失时回退 summary.running
 *   4. 多会话聚合（T6-T7）：取全局最高优先级、并列保留先遍历者、counts / total（blank 不计入）
 *   5. 核心回归（T8）：pendingInteraction 【只】经 useSessionStatus 的 Map 通道下发时
 *      仍渲染出待处理色 —— 这条在读 summary.pendingInteraction 的旧实现下必定失败
 *   6. 视觉层：柔光晕多层软晕、无零模糊硬核、fill / grain / glow 子层、glowWobble 默认 0（T13）
 *   7. crossfade 纯函数 renderLayers（T10）、配置深合并向后兼容（T9）、注入 CSS 关键选择器（T11）
 *   8. 状态条注册与关闭行为（T12）；向后兼容：conic / linear 与设置页 set/get、持久化（T14）
 *
 * 任一条失败以非零码退出（CI 使用）。
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const ROOT = path.join(__dirname, '..')
const src = fs.readFileSync(path.join(ROOT, 'client.js'), 'utf8')

let failures = 0
function check(name, ok, detail) {
  if (ok) {
    console.log('PASS  ' + name)
  } else {
    failures += 1
    console.log('FAIL  ' + name + (detail !== undefined ? '  (' + detail + ')' : ''))
  }
}

// ---- 桩 ----
let captured = null
const storage = {}
const windowStub = { __ModuleLoader__: { load: (entry) => { captured = entry } } }
const localStorageStub = {
  getItem: (k) => (k in storage ? storage[k] : null),
  setItem: (k, v) => { storage[k] = String(v) },
}
// 记录注入的 <style>：旧桩丢弃了 textContent，T11 需要读回样式表内容
const styleTags = []
const documentStub = {
  getElementById: (id) => styleTags.find((t) => t.id === id) || null,
  createElement: () => ({ dataset: {}, style: {}, textContent: '', appendChild() {} }),
  head: { appendChild: (tag) => { if (tag) styleTags.push(tag) } },
}
function injectedStyles() {
  return styleTags.map((t) => String(t.textContent || '')).join('\n')
}
const ReactStub = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
  // noop setter：组件内的 crossfade 出层在测试里不会出现，因此把 crossfade 计算抽成
  // 纯函数 renderLayers 单测（T10），不在桩里模拟 state 更新。
  useState: (init) => [init, () => {}],
  useEffect: () => {},
  useLayoutEffect: () => {},
  useRef: (init) => ({ current: init }),
  useMemo: (fn) => (typeof fn === 'function' ? fn() : fn),
  useCallback: (fn) => fn,
}
const requireStub = (id) => {
  if (id === 'react') return ReactStub
  throw new Error('unexpected require: ' + id)
}

vm.runInNewContext(src, {
  window: windowStub,
  localStorage: localStorageStub,
  document: documentStub,
  require: requireStub,
  console: console,
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
})

check('bundle 协议：factory 被捕获', captured !== null)
if (!captured) process.exit(1)

const mod = captured.factory(requireStub)
check('exports.inject 含 "slots"',
  Array.isArray(mod.inject) && mod.inject.indexOf('slots') >= 0, JSON.stringify(mod.inject))
check('exports.apply 是函数', typeof mod.apply === 'function')

/* ================= v0.4 新增导出 ================= */
/*
 * 导出缺失时不让整轮测试崩掉：下面的包装函数返回具名哨兵值，
 * 于是每条断言都以「got <未导出 xxx>」具名变红，便于红灯阶段定位。
 */
const NEW_EXPORTS = ['MODES', 'DEFAULT_CONFIG', 'mergeConfig', 'resolveSessionState',
  'aggregateState', 'renderLayers', 'glowShadowString']
const missingExports = NEW_EXPORTS.filter((n) => mod[n] === undefined)
check('v0.4 契约导出齐全（' + NEW_EXPORTS.join(' / ') + '）',
  missingExports.length === 0, '缺 ' + missingExports.join(', '))

function resolveSessionState(status, summary, config) {
  if (typeof mod.resolveSessionState !== 'function') return '<未导出 resolveSessionState>'
  return mod.resolveSessionState(status, summary, config)
}
function aggregateState(byId, statusMap, config) {
  if (typeof mod.aggregateState !== 'function') {
    return { mode: '<未导出 aggregateState>', sessionId: null, counts: {}, total: -1 }
  }
  return mod.aggregateState(byId, statusMap, config)
}
function renderLayers(mode, previous, config) {
  if (typeof mod.renderLayers !== 'function') return []
  return mod.renderLayers(mode, previous, config)
}
function mergeConfig(cfg) {
  if (typeof mod.mergeConfig !== 'function') return {}
  return mod.mergeConfig(cfg)
}
function glowShadowString(colors, width, spread) {
  if (typeof mod.glowShadowString !== 'function') return ''
  return mod.glowShadowString(colors, width, spread)
}

/* ================= 槽位注册 ================= */
const regs = {}
const shortcutRegs = []
const disposers = []
function makeScope() {
  return {
    effect: (fn) => {
      const dispose = fn()
      if (typeof dispose === 'function') disposers.push(dispose)
      return dispose
    },
    shortcuts: {
      register: (opts) => { shortcutRegs.push(opts); return () => {} },
    },
  }
}
const ctx = {
  slots: {
    // 立即调用 cb（scope 提供 effect），并把注册结果存入 regs[key]
    inject: (key, cb) => { regs[key] = cb(makeScope()) },
    register: (opts, renderer) => ({ opts, renderer }),
  },
  // ctx.effect(fn)：立即执行 fn() 并返回它的返回值（dispose）
  effect: (fn) => {
    const dispose = fn()
    if (typeof dispose === 'function') disposers.push(dispose)
    return dispose
  },
  // 可选注入：立即以 scope 调用 cb(scope)；缺失服务时插件应静默降级
  inject: (services, cb) => { cb(makeScope()); return () => {} },
  // 缺少 uiWorkspace 等宿主服务（渲染必须照常，只是点击不跳转）
  get: () => undefined,
}
mod.apply(ctx, {})
check('注册 shell.overlay', !!(regs['shell.overlay'] && regs['shell.overlay'].opts.id === 'mood-light'))
check('注册 settings.section', !!(regs['settings.section'] && regs['settings.section'].opts.id === 'mood-light'))
check('T12 注册 conversation.composer.dock（id=mood-light 状态条）',
  !!(regs['conversation.composer.dock'] && regs['conversation.composer.dock'].opts.id === 'mood-light'),
  regs['conversation.composer.dock'] ? 'id=' + regs['conversation.composer.dock'].opts.id : '未注册')

// 持久化：初始默认写入 localStorage；localStorage 优先级高于 cordis 行配置
check('初始配置写入 localStorage', storage['dsh-mood-light:config'] !== undefined)
const storageBefore = storage['dsh-mood-light:config']
mod.apply(ctx, { width: 99, states: { warning: { colors: ['#111111', '#222222'] } } })
check('localStorage 优先级高于行配置（width 仍为 8）',
  JSON.parse(storage['dsh-mood-light:config']).width === 8 && JSON.parse(storageBefore).width === 8)

/* ================= 渲染辅助 ================= */
function renderEl(el) {
  while (el && typeof el.type === 'function') el = el.type(el.props)
  return el
}
// 渲染抛错时不中断整轮：返回 undefined，错误文本交给断言详情
let lastRenderError = null
function safeRender(fn) {
  lastRenderError = null
  try {
    return fn()
  } catch (e) {
    lastRenderError = (e && e.message) ? e.message : String(e)
    return undefined
  }
}
function renderErrText() {
  return lastRenderError === null ? '' : ('渲染抛错: ' + lastRenderError)
}
// 遍历渲染树（兼容数组 / 嵌套数组 / 元素 / 函数组件如 SliderField）
function walk(node, fn) {
  if (!node) return
  if (Array.isArray(node)) { node.forEach((n) => walk(n, fn)); return }
  if (typeof node.type === 'function') node = node.type(node.props) // 展开函数组件
  if (!node) return
  fn(node)
  const kids = node.children || []
  for (let i = 0; i < kids.length; i++) walk(kids[i], fn)
}
function hasClass(n, cls) {
  const c = n && n.props && n.props.className
  return typeof c === 'string' && c.split(/\s+/).indexOf(cls) >= 0
}
function findEl(node, predicate) {
  let found = null
  walk(node, (n) => {
    if (!found && n && typeof n === 'object' && n.props && predicate(n)) found = n
  })
  return found
}
// 按 className 找节点；without 用于排除出层（dsh-mood-light-glow is-out）
function byClass(node, cls, without) {
  return findEl(node, (n) => hasClass(n, cls) && (!without || !hasClass(n, without)))
}
function countByClass(node, cls, without) {
  let n = 0
  walk(node, (x) => { if (hasClass(x, cls) && (!without || !hasClass(x, without))) n += 1 })
  return n
}
function styleOf(node) {
  return (node && node.props && node.props.style) || {}
}
function styleValues(node, key) {
  const vals = []
  walk(node, (x) => {
    const st = (x && typeof x === 'object' && x.props && x.props.style) || null
    if (st && st[key] !== undefined) vals.push(st[key])
  })
  return vals
}
function firstStyleValue(node, key) {
  const vals = styleValues(node, key)
  return vals.length ? vals[0] : undefined
}
// glow 层优先、根元素兜底：DOM 契约把 --ml-* 放在 glow 入层上，但 CSS 变量也可能写在根
function layerStyleValue(root, layer, key) {
  const own = styleValues(layer, key)
  if (own.length) return own[0]
  return firstStyleValue(root, key)
}
function allText(node) {
  const out = []
  walk(node, (n) => { if (typeof n === 'string') out.push(n) })
  return out.join(' ')
}
function rangeByValue(node, want) {
  let found = null
  walk(node, (n) => {
    if (!found && n.type === 'input' && n.props && n.props.type === 'range' && String(n.props.value) === String(want)) found = n
  })
  return found
}
function selectOptionValues(node) {
  const opts = []
  walk(node, (n) => {
    if (n.type === 'select') (n.children || []).forEach((o) => { if (o && o.props && o.props.value) opts.push(o.props.value) })
  })
  return opts
}
function firstSelectValue(node) {
  let sel = null
  walk(node, (n) => { if (!sel && n.type === 'select') sel = n })
  return sel ? sel.props.value : undefined
}

/*
 * 组装槽位 props：宿主会调用注册项的 inject() 并把返回值并入 props。
 * ctx.get("uiWorkspace") 返回 undefined —— 缺少该服务时插件必须照常注册与渲染。
 */
function propsFor(key, hooks) {
  const base = Object.assign({}, hooks)
  const reg = regs[key]
  if (reg && reg.opts && typeof reg.opts.inject === 'function') {
    try {
      const extra = reg.opts.inject()
      if (extra && typeof extra === 'object') Object.assign(base, extra)
    } catch (e) { /* 「inject 静默降级」断言负责报告 */ }
  }
  return base
}
// useSessions 会被调用两次（选 byId / 选 current），同一个桩要能处理两种 selector 形态
function hooksFor(byId, current, statusMap) {
  return {
    useSessions: (sel) => sel({ current, byId }),
    useSessionStatus: (sel) => sel(statusMap),
  }
}
function byIdOfOp(opts) {
  const o = opts || {}
  if (o.byId !== undefined) return o.byId
  return o.current === undefined ? {} : { [o.current]: o.summary }
}
function statusMapOfOp(opts) {
  const o = opts || {}
  const map = new Map()
  if (o.statusMap) {
    for (const [k, v] of o.statusMap) map.set(k, v)
  } else if (o.current !== undefined && o.status !== undefined) {
    map.set(o.current, o.status)
  }
  return map
}
/*
 * 渲染 shell.overlay。待处理信号【只】经 useSessionStatus 的 Map 通道下发：
 * byId 行里绝不放 pendingInteraction（宿主 SessionSummary 里也没有这个字段）。
 */
function renderOverlay(opts) {
  const o = opts || {}
  const reg = regs['shell.overlay']
  if (!reg) return undefined
  const byId = byIdOfOp(o)
  const statusMap = statusMapOfOp(o)
  return safeRender(() => renderEl(reg.renderer(propsFor('shell.overlay', hooksFor(byId, o.current, statusMap)))))
}
function renderDock(opts) {
  const o = opts || {}
  const reg = regs['conversation.composer.dock']
  if (!reg) return undefined
  const byId = byIdOfOp(o)
  const statusMap = statusMapOfOp(o)
  return safeRender(() => renderEl(reg.renderer(propsFor('conversation.composer.dock', hooksFor(byId, o.current, statusMap)))))
}
function renderSettings() {
  const reg = regs['settings.section']
  if (!reg) return undefined
  return safeRender(() => renderEl(reg.renderer({ close: null })))
}
function checkMode(name, el, expect) {
  const got = el === undefined
    ? '<渲染抛错>'
    : (el === null ? null : (el.props ? el.props['data-mode'] : '<无 props>'))
  check(name, got === expect, 'got ' + got + (el === undefined ? '（' + renderErrText() + '）' : ''))
}

/* ================= T1-T5：会话级状态解析 ================= */
const CFG = mergeConfig({}) // 完整默认配置（mergeConfig 缺失时为 {}，断言会具名变红）
const LIVE = { running: false, pendingInteraction: null, completionUnread: false }
const IDLE_ROW = { running: false, blank: false, displayTitle: '会话 A' }

function expectState(name, status, summary, expect, config) {
  const got = resolveSessionState(status, summary, config === undefined ? CFG : config)
  check(name, got === expect, 'got ' + got)
}

// T1 优先级：待处理 > 运行中 >（未读不产生独立模式）> success
expectState('T1 运行中 + 待审批 → warning（待处理优先于运行中）',
  { running: true, pendingInteraction: { kind: 'approval' } }, IDLE_ROW, 'warning')
expectState('T1 运行中 + 待回答 → question（待处理优先于运行中）',
  { running: true, pendingInteraction: { kind: 'question' } }, IDLE_ROW, 'question')
expectState('T1 运行中 + 计划待审 → planReview',
  { running: true, pendingInteraction: { kind: 'plan-review' } }, IDLE_ROW, 'planReview')
expectState('T1 仅 status.running → running',
  { running: true, completionUnread: false }, IDLE_ROW, 'running')
expectState('T1 运行中 + 完成未读 → running（未读不产生独立模式）',
  { running: true, completionUnread: true }, IDLE_ROW, 'running')
expectState('T1 非运行 + 完成未读 → success（未读由扫光表达，不改变颜色）',
  { running: false, completionUnread: true }, IDLE_ROW, 'success')

// T2 三种 kind：对象形态与字符串形态各测一遍
const KINDS = [['approval', 'warning'], ['plan-review', 'planReview'], ['question', 'question']]
for (const [kind, mode] of KINDS) {
  expectState('T2 pendingInteraction.kind="' + kind + '"（对象形态）→ ' + mode,
    { running: false, pendingInteraction: { kind } }, IDLE_ROW, mode)
  expectState('T2 pendingInteraction="' + kind + '"（字符串形态）→ ' + mode,
    { running: false, pendingInteraction: kind }, IDLE_ROW, mode)
}

// T3 未知 kind 兜底为 warning
expectState('T3 未知 kind="something-else"（对象形态）→ warning 兜底',
  { running: false, pendingInteraction: { kind: 'something-else' } }, IDLE_ROW, 'warning')
expectState('T3 未知 kind="mystery"（字符串形态）→ warning 兜底',
  { running: false, pendingInteraction: 'mystery' }, IDLE_ROW, 'warning')

// T4 关闭条件
expectState('T4 summary.blank=true → null', { running: false }, { running: false, blank: true }, null)
expectState('T4 summary 缺失 → null', { running: true }, undefined, null)
expectState('T4 summary=null → null', { running: true }, null, null)
expectState('T4 enabled=false → null', { running: true }, IDLE_ROW, null, { enabled: false, states: CFG.states })

// T5 status 缺失 → 回退 summary.running
expectState('T5 status 缺失 + summary.running=true → running（降级路径）',
  undefined, { running: true, blank: false }, 'running')
expectState('T5 status=null + summary.running=false → success',
  null, IDLE_ROW, 'success')

// T15 config 缺省 → 降级到 DEFAULT_CONFIG，不得抛错
{
  let got
  try {
    got = mod.resolveSessionState
      ? mod.resolveSessionState({ running: false, pendingInteraction: null }, { running: false, blank: false }, undefined)
      : '<未导出 resolveSessionState>'
  } catch (err) {
    got = '抛错：' + (err && err.message)
  }
  check('T15 config 缺省（undefined）→ 降级 DEFAULT_CONFIG，返回 success',
    got === 'success', 'got ' + got)
}
{
  let got
  try {
    got = mod.resolveSessionState
      ? mod.resolveSessionState(undefined, undefined, undefined)
      : '<未导出 resolveSessionState>'
  } catch (err) {
    got = '抛错：' + (err && err.message)
  }
  check('T15 三个参数全缺省 → 返回 null（不抛错）', got === null, 'got ' + got)
}

/* ================= T6-T7：多会话聚合 ================= */
const agg1 = aggregateState(
  { s1: { running: true, blank: false }, s2: IDLE_ROW, s3: IDLE_ROW },
  new Map([
    ['s1', { running: true, pendingInteraction: null, completionUnread: false }],
    ['s2', { running: false, pendingInteraction: { kind: 'question' }, completionUnread: false }],
    ['s3', { running: false, pendingInteraction: { kind: 'approval' }, completionUnread: false }],
  ]),
  CFG)
check('T6 aggregateState 取全局最高优先级（待审批 > 待回答 > 运行中）',
  agg1.mode === 'warning' && agg1.sessionId === 's3',
  'mode=' + agg1.mode + ' sessionId=' + agg1.sessionId)

const agg2 = aggregateState(
  { a: IDLE_ROW, b: { running: false, blank: false, displayTitle: '会话 B' } },
  new Map([
    ['a', { running: false, pendingInteraction: { kind: 'plan-review' }, completionUnread: false }],
    ['b', { running: false, pendingInteraction: { kind: 'plan-review' }, completionUnread: false }],
  ]),
  CFG)
check('T6 并列时保留先遍历到的会话（planReview 并列 → a）',
  agg2.mode === 'planReview' && agg2.sessionId === 'a',
  'mode=' + agg2.mode + ' sessionId=' + agg2.sessionId)

const agg3 = aggregateState(
  {
    a: { running: true, blank: false },
    b: IDLE_ROW,
    c: { running: false, blank: true },
    d: { running: false, blank: false, displayTitle: '会话 D' },
  },
  new Map([
    ['a', { running: true, pendingInteraction: null, completionUnread: false }],
    ['b', { running: false, pendingInteraction: { kind: 'plan-review' }, completionUnread: false }],
    ['c', { running: false, pendingInteraction: { kind: 'approval' }, completionUnread: false }], // blank：不计入
    ['d', { running: false, pendingInteraction: null, completionUnread: false }], // → success
  ]),
  CFG)
check('T7 counts/total：blank 行不计入，其余按 mode 计数',
  agg3.total === 3 && agg3.counts.running === 1 && agg3.counts.planReview === 1 &&
  agg3.counts.success === 1 && agg3.counts.warning === undefined,
  'total=' + agg3.total + ' counts=' + JSON.stringify(agg3.counts))
check('T7 blank 会话不参与取最高优先级（否则会误报 warning）',
  agg3.mode === 'planReview' && agg3.sessionId === 'b',
  'mode=' + agg3.mode + ' sessionId=' + agg3.sessionId)

const aggEmpty = aggregateState({ x: { running: false, blank: true } }, new Map(), CFG)
check('T7 全部为 null → {mode:null,sessionId:null,counts:{},total:0}',
  aggEmpty.mode === null && aggEmpty.sessionId === null && aggEmpty.total === 0 &&
  Object.keys(aggEmpty.counts).length === 0,
  JSON.stringify(aggEmpty))
const aggNull = aggregateState(null, new Map(), CFG)
check('T7 byId 为 null → total=0 且不抛错', aggNull.total === 0 && aggNull.mode === null, JSON.stringify(aggNull))

/* ================= 渲染层：data-mode 随状态变化 ================= */
storage['dsh-mood-light:config'] = JSON.stringify({ gradientType: 'glow' })
mod.apply(ctx, {})
checkMode('渲染：运行中 → data-mode=running',
  renderOverlay({ summary: { running: true, blank: false }, current: 's1', status: { running: true, ...LIVE } }), 'running')
checkMode('渲染：空闲 → data-mode=success',
  renderOverlay({ summary: IDLE_ROW, current: 's1', status: { running: false, completionUnread: false } }), 'success')
checkMode('渲染：blank 会话 → null（不渲染）',
  renderOverlay({ summary: { running: false, blank: true }, current: 's1', status: { running: false } }), null)
checkMode('渲染：无会话 → null（不渲染）',
  renderOverlay({ summary: undefined, current: undefined }), null)

/* ================= T8：核心回归 —— 只走 useSessionStatus 通道 ================= */
const baseRow = { running: true, blank: false, displayTitle: '会话 A' }
check('T8 前置：桩提供的 byId 行不含 pendingInteraction（不再复制实现的错误假设）',
  !('pendingInteraction' in baseRow))
const regression = [
  ['T8 待审批：byId 行无 pendingInteraction、仅 useSessionStatus 给出 approval → warning',
    { kind: 'approval' }, 'warning'],
  ['T8 待审批（字符串形态）：仅 useSessionStatus 给出 "approval" → warning',
    'approval', 'warning'],
  ['T8 计划待审：仅 useSessionStatus 给出 plan-review → planReview',
    { kind: 'plan-review' }, 'planReview'],
  ['T8 待回答：仅 useSessionStatus 给出 question → question',
    { kind: 'question' }, 'question'],
]
for (const [name, pi, expect] of regression) {
  checkMode(name, renderOverlay({
    summary: baseRow,
    current: 's1',
    status: { running: true, pendingInteraction: pi, completionUnread: false },
  }), expect)
}

/* ================= T9：配置深合并（向后兼容） ================= */
const merged = mergeConfig({ gradientType: 'glow' })
const newTopKeys = ['transitionMs', 'grain', 'sweep', 'capsule', 'statusBar']
check('T9 mergeConfig 补齐新顶层键（transitionMs/grain/sweep/capsule/statusBar）',
  newTopKeys.every((k) => merged[k] !== undefined),
  newTopKeys.filter((k) => merged[k] === undefined).join(',') || '')
check('T9 mergeConfig 补齐新状态键（planReview/question 含 colors）',
  !!(merged.states && merged.states.planReview && Array.isArray(merged.states.planReview.colors) &&
     merged.states.question && Array.isArray(merged.states.question.colors)))
check('T9 老配置键保留（width=8 / gradientType=glow / glowSpread=24）',
  merged.width === 8 && merged.gradientType === 'glow' && merged.glowSpread === 24,
  'width=' + merged.width + ' type=' + merged.gradientType + ' spread=' + merged.glowSpread)
check('T9 新键内置默认值（transitionMs=700 / grain=0.035 / sweep=true / capsule=true / statusBar=true / glowWobble=0）',
  merged.transitionMs === 700 && merged.grain === 0.035 && merged.sweep === true &&
  merged.capsule === true && merged.statusBar === true && merged.glowWobble === 0,
  [merged.transitionMs, merged.grain, merged.sweep, merged.capsule, merged.statusBar, merged.glowWobble].join('/'))
const mergedOverride = mergeConfig({ transitionMs: 200, grain: 0, capsule: false })
check('T9 显式覆盖生效（transitionMs=200 / grain=0 / capsule=false）',
  mergedOverride.transitionMs === 200 && mergedOverride.grain === 0 && mergedOverride.capsule === false,
  [mergedOverride.transitionMs, mergedOverride.grain, mergedOverride.capsule].join('/'))

/* ================= T10：crossfade 纯函数 ================= */
const twoLayers = renderLayers('warning', 'running', CFG)
check('T10 renderLayers(mode, previous≠mode) 返回 2 层：出层在前、入层在后',
  Array.isArray(twoLayers) && twoLayers.length === 2 &&
  twoLayers[0].mode === 'running' && twoLayers[0].out === true &&
  twoLayers[1].mode === 'warning' && twoLayers[1].out === false,
  Array.isArray(twoLayers) ? JSON.stringify(twoLayers.map((l) => l.mode + ':' + l.out)) : String(twoLayers))
check('T10 crossfade 两层 shadow 均为 inset 阴影串',
  Array.isArray(twoLayers) && twoLayers.length === 2 &&
  typeof twoLayers[0].shadow === 'string' && twoLayers[0].shadow.indexOf('inset') === 0 &&
  typeof twoLayers[1].shadow === 'string' && twoLayers[1].shadow.indexOf('inset') === 0,
  Array.isArray(twoLayers) ? JSON.stringify(twoLayers.map((l) => String(l.shadow).slice(0, 24))) : '')
const oneLayer = renderLayers('warning', null, CFG)
check('T10 renderLayers(mode, null) 只返回入层 1 项',
  Array.isArray(oneLayer) && oneLayer.length === 1 && oneLayer[0].mode === 'warning' && oneLayer[0].out === false,
  Array.isArray(oneLayer) ? JSON.stringify(oneLayer.map((l) => l.mode + ':' + l.out)) : String(oneLayer))
const sameLayer = renderLayers('warning', 'warning', CFG)
check('T10 renderLayers(mode, mode) 只返回入层 1 项（不与自己 crossfade）',
  Array.isArray(sameLayer) && sameLayer.length === 1 && sameLayer[0].mode === 'warning' && sameLayer[0].out === false,
  Array.isArray(sameLayer) ? sameLayer.length + ' 项' : String(sameLayer))

/* ================= T11：注入的样式表 ================= */
const css = injectedStyles()
check('T11 注入 <style> 且含深浅色主题适配（body[data-ds-dark-theme] + --ml-theme-scale）',
  css.length > 0 && css.indexOf('body[data-ds-dark-theme]') >= 0 && css.indexOf('--ml-theme-scale') >= 0,
  css.length === 0 ? '未捕获到样式内容' : 'len=' + css.length)
check('T11 CSS 含环境光层 .dsh-mood-light-fill', css.indexOf('.dsh-mood-light-fill') >= 0)
check('T11 CSS 含噪点层 .dsh-mood-light-grain', css.indexOf('.dsh-mood-light-grain') >= 0)
check('T11 CSS 含扫光关键帧 @keyframes dsh-mood-light-sweep',
  css.indexOf('@keyframes dsh-mood-light-sweep') >= 0)
check('T11 CSS 保留闪烁关键帧与 reduced-motion 兜底',
  css.indexOf('@keyframes dsh-mood-light-flash') >= 0 && css.indexOf('prefers-reduced-motion') >= 0)

/* ================= T13：默认配置 / 五态色板 / 阴影串 ================= */
check('T13 mod.MODES 为五态字符串枚举',
  Array.isArray(mod.MODES) && String(mod.MODES.join(',')) === 'running,success,warning,planReview,question',
  'MODES=' + JSON.stringify(mod.MODES))
check('T13 DEFAULT_CONFIG.glowWobble === 0（性能修复：默认不再全屏滤镜）',
  !!mod.DEFAULT_CONFIG && mod.DEFAULT_CONFIG.glowWobble === 0,
  'glowWobble=' + (mod.DEFAULT_CONFIG && mod.DEFAULT_CONFIG.glowWobble))
const palette = (mod.DEFAULT_CONFIG && mod.DEFAULT_CONFIG.states) || {}
check('T13 五态核色正确（warning 仍是 #f59e0b；planReview #06b6d4；question #a855f7）',
  !!(palette.running && palette.running.colors[0] === '#10b981') &&
  !!(palette.success && palette.success.colors[0] === '#ec4899') &&
  !!(palette.warning && palette.warning.colors[0] === '#f59e0b') &&
  !!(palette.planReview && palette.planReview.colors[0] === '#06b6d4') &&
  !!(palette.question && palette.question.colors[0] === '#a855f7'),
  Object.keys(palette).map((k) => k + '=' + (palette[k].colors && palette[k].colors[0])).join(' '))
const shadowStr = glowShadowString(palette.running ? palette.running.colors : ['#10b981', '#34d399'], 8, 24)
check('T13 glowShadowString 仍无零模糊硬核（!/inset 0 0 0 /）',
  shadowStr !== '' && !/inset 0 0 0 /.test(shadowStr), String(shadowStr).slice(0, 60))
check('T13 glowShadowString 层数 ≥2',
  shadowStr !== '' && (shadowStr.split('inset').length - 1) >= 2,
  '层数=' + (shadowStr.split('inset').length - 1))

/* ================= 默认（柔光晕 glow）渲染与子层 ================= */
storage['dsh-mood-light:config'] = JSON.stringify({ gradientType: 'glow' })
mod.apply(ctx, {})
const el = renderOverlay({
  summary: baseRow,
  current: 's1',
  status: { running: true, pendingInteraction: null, completionUnread: false },
})
check('根元素 className 为 dsh-mood-light + is-glow（统一契约，不再是 dsh-mood-light-glow）',
  el !== undefined && el !== null && hasClass(el, 'dsh-mood-light') && hasClass(el, 'is-glow') &&
  !hasClass(el, 'is-conic') && !hasClass(el, 'is-linear'),
  'className=' + (el && el.props && el.props.className))
check('根元素 data-flash=on（运行中 flash 1.2s > 0）',
  el !== undefined && el !== null && el.props['data-flash'] === 'on',
  el && el.props && el.props['data-flash'])

const fillLayer = byClass(el, 'dsh-mood-light-fill')
const grainLayer = byClass(el, 'dsh-mood-light-grain')
const glowLayer = byClass(el, 'dsh-mood-light-glow', 'is-out')
check('glow 分支渲染 dsh-mood-light-fill（环境光层，总是）', fillLayer !== null)
check('glow 分支渲染 dsh-mood-light-grain（默认 grain=0.035 > 0）', grainLayer !== null)
check('glow 分支渲染 dsh-mood-light-glow 入层（无 is-out）', glowLayer !== null)
// CSS 自定义属性可继承：写在根元素上对该层同样生效，故按「自身样式 → 根元素样式」解析，
// 只锁「该层拿得到这个变量」，不锁它写在哪个节点（避免把实现摆放当成契约）。
check('附加：fill 层颜色变量 --ml-fill-a / --ml-fill-b 可解析',
  !!fillLayer && layerStyleValue(el, fillLayer, '--ml-fill-a') !== undefined &&
  layerStyleValue(el, fillLayer, '--ml-fill-b') !== undefined,
  fillLayer ? JSON.stringify([layerStyleValue(el, fillLayer, '--ml-fill-a'), layerStyleValue(el, fillLayer, '--ml-fill-b')]) : '无 fill 层')
check('附加：fill 层透明度由 --ml-opacity 以 0.16 系数推导',
  /--ml-fill-opacity|calc\(var\(--ml-opacity\)\s*\*\s*0\.16/.test(css),
  (css.match(/[^;{}]*0\.16[^;{}]*/g) || []).join(' | ').slice(0, 120))
check('附加：grain 层强度变量 --ml-grain 可解析为 grain 配置值',
  !!grainLayer && String(layerStyleValue(el, grainLayer, '--ml-grain')).trim() === String(CFG.grain),
  grainLayer ? '--ml-grain=' + layerStyleValue(el, grainLayer, '--ml-grain') + ' 期望 ' + CFG.grain : '无 grain 层')
check('默认渲染只有入层（无 crossfade 出层）',
  countByClass(el, 'dsh-mood-light-glow', 'is-out') === 1 && countByClass(el, 'dsh-mood-light-glow') === 1,
  '入层=' + countByClass(el, 'dsh-mood-light-glow', 'is-out') + ' 总=' + countByClass(el, 'dsh-mood-light-glow'))

const shadowVar = layerStyleValue(el, glowLayer, '--ml-glow-shadow')
check('glow 入层含 --ml-glow-shadow 且以 inset 开头',
  typeof shadowVar === 'string' && shadowVar.indexOf('inset') === 0, String(shadowVar).slice(0, 48))
check('glow 阴影串不含零模糊硬核（无边框）',
  typeof shadowVar === 'string' && !/inset 0 0 0 /.test(shadowVar))
check('glow 阴影串含 ≥2 层软晕',
  typeof shadowVar === 'string' && (shadowVar.split('inset').length - 1) >= 2)
check('glow 宽 8px / 闪动 1.2s / 透明度 0.6',
  layerStyleValue(el, glowLayer, '--ml-width') === '8px' &&
  layerStyleValue(el, glowLayer, '--ml-flash') === '1.2s' &&
  layerStyleValue(el, glowLayer, '--ml-opacity') === '0.6',
  [layerStyleValue(el, glowLayer, '--ml-width'), layerStyleValue(el, glowLayer, '--ml-flash'),
    layerStyleValue(el, glowLayer, '--ml-opacity')].join('/'))
check('T13 默认 glowWobble=0 → 渲染树不应用位移滤镜',
  firstStyleValue(el, 'filter') === undefined, 'filter=' + firstStyleValue(el, 'filter'))
check('T13 默认不渲染 id=dsh-mood-light-turb 的 SVG filter',
  findEl(el, (n) => n.type === 'filter' && n.props && n.props.id === 'dsh-mood-light-turb') === null)

// success 稳态：flash 0 → data-flash=off
const idleEl = renderOverlay({
  summary: IDLE_ROW, current: 's1', status: { running: false, pendingInteraction: null, completionUnread: false },
})
check('success 稳态 data-flash=off（flash=0 不闪动）',
  idleEl !== undefined && idleEl !== null && idleEl.props['data-flash'] === 'off',
  idleEl && idleEl.props && idleEl.props['data-flash'])

// glowWobble>0：显式开启时才加位移滤镜与隐藏 SVG
storage['dsh-mood-light:config'] = JSON.stringify({ gradientType: 'glow', glowWobble: 4 })
mod.apply(ctx, {})
const wobbleEl = renderOverlay({
  summary: baseRow, current: 's1', status: { running: true, pendingInteraction: null, completionUnread: false },
})
check('glowWobble>0 时应用位移滤镜 filter=url(#dsh-mood-light-turb)',
  firstStyleValue(wobbleEl, 'filter') === 'url(#dsh-mood-light-turb)', String(firstStyleValue(wobbleEl, 'filter')))
check('glowWobble>0 时渲染 id=dsh-mood-light-turb 的 SVG filter 定义',
  findEl(wobbleEl, (n) => n.type === 'filter' && n.props && n.props.id === 'dsh-mood-light-turb') !== null)
check('glowWobble>0 时含 svg.dsh-mood-light-turb 节点',
  findEl(wobbleEl, (n) => n.type === 'svg' && hasClass(n, 'dsh-mood-light-turb')) !== null)

/* ================= T12：状态条与关闭行为 ================= */
const overlayInject = regs['shell.overlay'] && regs['shell.overlay'].opts && regs['shell.overlay'].opts.inject
let injectError = null
try {
  if (typeof overlayInject === 'function') overlayInject()
} catch (e) {
  injectError = (e && e.message) ? e.message : String(e)
}
check('T12 缺少 uiWorkspace 服务时注册项 inject() 静默降级（存在且不抛错）',
  typeof overlayInject === 'function' && injectError === null,
  typeof overlayInject !== 'function' ? 'opts.inject 缺失' : String(injectError))

storage['dsh-mood-light:config'] = JSON.stringify({ gradientType: 'glow', enabled: true, statusBar: true })
mod.apply(ctx, {})
const dockEl = renderDock({
  summary: baseRow, current: 's1', status: { running: true, pendingInteraction: null, completionUnread: false },
})
check('T12 状态条渲染（enabled=true && statusBar=true）',
  dockEl !== undefined && dockEl !== null,
  dockEl === undefined ? renderErrText() : 'null')
check('T12 状态条内容含「氛围灯」标签',
  dockEl !== undefined && dockEl !== null && allText(dockEl).indexOf('氛围灯') >= 0,
  JSON.stringify(allText(dockEl).slice(0, 80)))

storage['dsh-mood-light:config'] = JSON.stringify({ gradientType: 'glow', enabled: false })
mod.apply(ctx, {})
const offEl = renderOverlay({ summary: baseRow, current: 's1', status: { running: true, pendingInteraction: null } })
check('T12 enabled=false 时氛围灯根元素为 null',
  offEl === null, offEl === undefined ? renderErrText() : String(offEl && offEl.props['data-mode']))
const offDock = renderDock({ summary: baseRow, current: 's1', status: { running: true, pendingInteraction: null } })
check('T12 enabled=false 时状态条不渲染（避免用户以为没关掉）',
  offDock === null, offDock === undefined ? renderErrText() : String(offDock && offDock.type))

/* ================= T14：conic / linear 向后兼容 ================= */
storage['dsh-mood-light:config'] = JSON.stringify({ gradientType: 'conic' })
mod.apply(ctx, {})
const conicEl = renderOverlay({
  summary: baseRow, current: 's1', status: { running: true, pendingInteraction: null, completionUnread: false },
})
check('T14 conic 分段渐变（--ml-gradient 精确值）',
  styleOf(conicEl)['--ml-gradient'] === 'conic-gradient(from 0deg, #10b981 0deg 120deg, #34d399 120deg 240deg, #6ee7b7 240deg 360deg)',
  String(styleOf(conicEl)['--ml-gradient']))
check('T14 conic 旋转 16s + 唯一旋转盘',
  styleOf(conicEl)['--ml-rotate'] === '16s' && countByClass(conicEl, 'dsh-mood-light-disc') === 1,
  'rotate=' + styleOf(conicEl)['--ml-rotate'] + ' disc=' + countByClass(conicEl, 'dsh-mood-light-disc'))
check('T14 conic 根元素 className 为 dsh-mood-light + is-conic',
  hasClass(conicEl, 'dsh-mood-light') && hasClass(conicEl, 'is-conic') && !hasClass(conicEl, 'is-glow'),
  'className=' + (conicEl && conicEl.props && conicEl.props.className))
check('T14 conic 不新增 fill / grain / 胶囊层',
  countByClass(conicEl, 'dsh-mood-light-fill') === 0 && countByClass(conicEl, 'dsh-mood-light-grain') === 0 &&
  countByClass(conicEl, 'dsh-mood-light-hit') === 0,
  'fill=' + countByClass(conicEl, 'dsh-mood-light-fill') + ' grain=' + countByClass(conicEl, 'dsh-mood-light-grain'))

storage['dsh-mood-light:config'] = JSON.stringify({ gradientType: 'linear' })
mod.apply(ctx, {})
const linearEl = renderOverlay({
  summary: baseRow, current: 's1', status: { running: true, pendingInteraction: null, completionUnread: false },
})
check('T14 linear 线性渐变（--ml-gradient 精确值）',
  styleOf(linearEl)['--ml-gradient'] === 'linear-gradient(135deg, #10b981, #34d399, #6ee7b7)',
  String(styleOf(linearEl)['--ml-gradient']))
check('T14 linear 根元素 className 为 dsh-mood-light + is-linear',
  hasClass(linearEl, 'dsh-mood-light') && hasClass(linearEl, 'is-linear') && !hasClass(linearEl, 'is-glow'),
  'className=' + (linearEl && linearEl.props && linearEl.props.className))
check('T14 linear 无旋转盘', countByClass(linearEl, 'dsh-mood-light-disc') === 0)

/* ================= T14：设置页 set/get 与持久化 ================= */
storage['dsh-mood-light:config'] = JSON.stringify({ gradientType: 'glow' })
mod.apply(ctx, {})
check('T14 设置页效果样式 select 默认值为 glow', firstSelectValue(renderSettings()) === 'glow',
  String(firstSelectValue(renderSettings())))

// glow 专属参数用不冲突的值，便于在渲染树里定位对应滑块
storage['dsh-mood-light:config'] = JSON.stringify({ gradientType: 'glow', glowSpread: 77, glowWobble: 3 })
mod.apply(ctx, {})
const settingsEl = renderSettings()
check('T14 设置页效果样式 select 含 glow 选项', selectOptionValues(settingsEl).indexOf('glow') >= 0)
check('T14 glow 时渲染「扩散范围」滑块（value=77）', rangeByValue(settingsEl, 77) !== null)
check('T14 glow 时渲染「不规则强度」滑块（value=3）', rangeByValue(settingsEl, 3) !== null)

// set 路径：调用「扩散范围」滑块 onChange 触发 setConfig，重渲染后值更新并落盘
const spreadInput = rangeByValue(settingsEl, 77)
if (spreadInput) spreadInput.props.onChange({ target: { value: '120' } })
check('T14 glowSpread 经设置页滑块 set 后生效（value=120）', rangeByValue(renderSettings(), 120) !== null)
check('T14 set 后写入 localStorage（glowSpread=120）',
  JSON.parse(storage['dsh-mood-light:config']).glowSpread === 120, storage['dsh-mood-light:config'])

// conic（跑马灯）下不显示 glow 专属滑块（向后兼容条件显示）
storage['dsh-mood-light:config'] = JSON.stringify({ gradientType: 'conic', glowSpread: 77 })
mod.apply(ctx, {})
const settingsConic = renderSettings()
check('T14 conic 时不渲染「扩散范围」滑块', rangeByValue(settingsConic, 77) === null)
check('T14 conic 时效果样式 select 仍含跑马灯与线性',
  ['conic', 'linear'].every((v) => selectOptionValues(settingsConic).indexOf(v) >= 0))

/* ================= T16：审查回归（触发带归一 / 胶囊 / 扫光 / 范围 / 未读 / 快捷键默认值） ================= */
// 这些断言锁定的是「审查发现并已修复」的行为，防止再次退化。

// T16-1 顶部触发带高度：归一后落到 --ml-hit-height（tasks.md 任务 4 的验收项，此前零覆盖）
storage['dsh-mood-light:config'] = JSON.stringify({ gradientType: 'glow', capsuleTriggerHeight: 18 })
mod.apply(ctx, {})
const hitRow = { running: true, blank: false, displayTitle: '会话 A' }
const hitStatus = { running: true, pendingInteraction: null, completionUnread: false }
const hitEl = renderOverlay({ summary: hitRow, current: 's1', status: hitStatus })
check('T16 --ml-hit-height 随 capsuleTriggerHeight 归一（18 → 18px）',
  hitEl !== undefined && hitEl !== null && hitEl.props && hitEl.props.style['--ml-hit-height'] === '18px',
  hitEl && hitEl.props ? 'got ' + hitEl.props.style['--ml-hit-height'] : '<渲染失败>' + renderErrText())
check('T16 触发带 CSS 用 var(--ml-hit-height) 取高',
  /\.dsh-mood-light-hit \{[^}]*height: var\(--ml-hit-height\)/.test(injectedStyles()))

// 越界归一：120 → 40、1 → 4（clamp 4..40）
storage['dsh-mood-light:config'] = JSON.stringify({ gradientType: 'glow', capsuleTriggerHeight: 120 })
mod.apply(ctx, {})
const hitMax = renderOverlay({ summary: hitRow, current: 's1', status: hitStatus })
check('T16 capsuleTriggerHeight 上限归一 120 → 40px',
  !!hitMax && hitMax.props.style['--ml-hit-height'] === '40px',
  hitMax && hitMax.props ? 'got ' + hitMax.props.style['--ml-hit-height'] : '<渲染失败>')
storage['dsh-mood-light:config'] = JSON.stringify({ gradientType: 'glow', capsuleTriggerHeight: 1 })
mod.apply(ctx, {})
const hitMin = renderOverlay({ summary: hitRow, current: 's1', status: hitStatus })
check('T16 capsuleTriggerHeight 下限归一 1 → 4px',
  !!hitMin && hitMin.props.style['--ml-hit-height'] === '4px',
  hitMin && hitMin.props ? 'got ' + hitMin.props.style['--ml-hit-height'] : '<渲染失败>')

// T16-2 胶囊 DOM 契约：可点、可悬停、有 title；关闭态不吃鼠标事件
storage['dsh-mood-light:config'] = JSON.stringify({ gradientType: 'glow', capsuleTriggerHeight: 10 })
mod.apply(ctx, {})
const capEl = renderOverlay({ summary: hitRow, current: 's1', status: hitStatus })
const capNode = byClass(capEl, 'dsh-mood-light-capsule')
check('T16 胶囊元素存在（capsule 默认开启）', capNode !== null)
check('T16 胶囊绑定 onMouseEnter / onMouseLeave / onClick',
  !!capNode && typeof capNode.props.onMouseEnter === 'function' &&
  typeof capNode.props.onMouseLeave === 'function' && typeof capNode.props.onClick === 'function',
  capNode ? typeof capNode.props.onMouseEnter + '/' + typeof capNode.props.onMouseLeave + '/' + typeof capNode.props.onClick : '<无胶囊>')
check('T16 胶囊提供 title 说明（点击行为可发现）',
  !!capNode && typeof capNode.props.title === 'string' && capNode.props.title.length > 0,
  capNode ? String(capNode.props.title) : '<无胶囊>')
check('T16 胶囊 CSS 含 cursor: pointer',
  /\.dsh-mood-light-capsule \{[^}]*cursor: pointer/.test(injectedStyles()))

// T16-3 扫光：窄亮带 38%/50%/62% + 1150ms cubic-bezier + 82% 保持帧（此前只有 @keyframes 存在性断言）
const injected = injectedStyles()
check('T16 扫光渐变窄带（transparent 38% / 50% / transparent 62%）',
  injected.indexOf('transparent 38%, var(--ml-sweep-color) 50%, transparent 62%') >= 0)
check('T16 扫光动画 1150ms cubic-bezier(0.33, 0, 0.2, 1)',
  injected.indexOf('dsh-mood-light-sweep 1150ms cubic-bezier(0.33, 0, 0.2, 1) 1 both') >= 0)
check('T16 扫光 keyframes 含 82% 保持帧',
  /@keyframes dsh-mood-light-sweep \{[\s\S]*?18% \{ opacity: 0\.85; \}[\s\S]*?82% \{ opacity: 0\.85; \}/.test(injected))

// T16-4 状态条补「已完成（未读）」后缀（胶囊与状态条两条路径都要有）
const unreadEl = renderDock({
  summary: { running: false, blank: false, displayTitle: '会话 A' },
  current: 's1',
  status: { running: false, pendingInteraction: null, completionUnread: true },
})
check('T16 状态条标注「已完成（未读）」', allText(unreadEl).indexOf('已完成（未读）') >= 0, allText(unreadEl))
const capUnread = byClass(renderOverlay({
  summary: { running: false, blank: false, displayTitle: '会话 A' },
  current: 's1',
  status: { running: false, pendingInteraction: null, completionUnread: true },
}), 'dsh-mood-light-capsule')
check('T16 胶囊同样标注「已完成（未读）」', !!capUnread && allText(capUnread).indexOf('已完成（未读）') >= 0,
  capUnread ? allText(capUnread) : '<无胶囊>')

// T16-5 设置页范围与 spec 对齐（transitionMs ≤1500 / grain ≤0.15 / 触发带 ≥4）
storage['dsh-mood-light:config'] = JSON.stringify({
  gradientType: 'glow', transitionMs: 900, grain: 0.1, capsuleTriggerHeight: 30,
})
mod.apply(ctx, {})
const settingsRange = renderSettings()
const transitionInput = rangeByValue(settingsRange, 900)
const grainInput = rangeByValue(settingsRange, 0.1)
const hitInput = rangeByValue(settingsRange, 30)
check('T16 过渡时长滑块上限 1500ms',
  !!transitionInput && String(transitionInput.props.max) === '1500',
  transitionInput ? 'max=' + transitionInput.props.max : '<无滑块>')
check('T16 噪点滑块上限 0.15',
  !!grainInput && String(grainInput.props.max) === '0.15',
  grainInput ? 'max=' + grainInput.props.max : '<无滑块>')
check('T16 触发带高度滑块下限 4',
  !!hitInput && String(hitInput.props.min) === '4',
  hitInput ? 'min=' + hitInput.props.min : '<无滑块>')

// T16-6 胶囊点击跳转：宿主未提供 uiWorkspace 时必须静默降级（不抛错、返回 false）
const t16OverlayInject = regs['shell.overlay'] && regs['shell.overlay'].opts && regs['shell.overlay'].opts.inject
let openSessionFn = null
check('T16 shell.overlay 的 inject 提供 openSession', !!t16OverlayInject && (function () {
  try {
    const extra = t16OverlayInject()
    openSessionFn = extra && typeof extra.openSession === 'function' ? extra.openSession : null
    return openSessionFn !== null
  } catch (e) { return false }
})())
check('T16 缺少 uiWorkspace 时 openSession 静默返回 false（不抛错）', (function () {
  if (!openSessionFn) return false
  try { return openSessionFn('s9') === false } catch (e) { return false }
})())

/* ================= 快捷键（设计 E 节）：可选注入 + 一键开关 ================= */
// 放在最后：下面的 run() 会真的切换 enabled，不污染前面各块的配置前提
// apply 会被多次调用（每次注册一条），故只锁「每次注册的都是这个 id」，不锁次数
check('快捷键：注册 mood-light.toggle（id 契约）',
  shortcutRegs.length >= 1 && shortcutRegs.every((o) => o.id === 'mood-light.toggle'),
  shortcutRegs.length ? shortcutRegs.map((o) => o.id).join(',') : '未注册')
const shortcut = shortcutRegs[0] || {}
check('快捷键：regions 含 page 与 editable（输入框内也能生效）',
  Array.isArray(shortcut.regions) && shortcut.regions.indexOf('page') >= 0 && shortcut.regions.indexOf('editable') >= 0,
  JSON.stringify(shortcut.regions))
check('快捷键：label 为函数且返回中文文案',
  typeof shortcut.label === 'function' && String(shortcut.label()).indexOf('氛围灯') >= 0,
  typeof shortcut.label === 'function' ? String(shortcut.label()) : typeof shortcut.label)
let shortcutRun = null
try {
  const resolved = typeof shortcut.resolve === 'function' ? shortcut.resolve() : null
  if (resolved && resolved.status === 'handled' && typeof resolved.run === 'function') shortcutRun = resolved.run
} catch (e) { /* 由下面的断言报告 */ }
check('快捷键：resolve() 返回 { status: "handled", run }', shortcutRun !== null)
if (shortcutRun) shortcutRun()
check('快捷键：执行 run() 后 enabled 取反并落盘（true → false）',
  JSON.parse(storage['dsh-mood-light:config']).enabled === false,
  storage['dsh-mood-light:config'])

/*
 * T16-7 快捷键默认键位（审查回归）：宿主 dsh-client-shortcuts 的 register() 会急切遍历
 * ["desktop","web"] × ["macos","windows","linux"] 全部 6 个 profile，任一非法即抛
 * "Unsupported Web shortcut"，且抛错发生在写入命令表之前 —— 于是桌面端也一起注册不上。
 * 其 isWebBindingAllowed() 对 linux 只放行 Slash+primary / Comma+primary+shift /
 * Period+primary+shift，字母键在 web:linux 上必被拒，所以这里锁死「不得声明 web:linux」。
 */
const shortcutDefaults = (shortcutRegs[0] || {}).defaults || {}
check('T16 快捷键 defaults 不含 web:linux（否则整条快捷键在任何平台都注册不上）',
  Object.prototype.hasOwnProperty.call(shortcutDefaults, 'web:linux') === false,
  Object.keys(shortcutDefaults).join(',') || '<无 defaults>')
check('T16 快捷键声明 desktop:macos / web:macos / web:windows 三个可用 profile',
  ['desktop:macos', 'web:macos', 'web:windows'].every((k) => shortcutDefaults[k] !== undefined),
  Object.keys(shortcutDefaults).join(',') || '<无 defaults>')
check('T16 快捷键键位为 KeyM + primary + shift',
  ['desktop:macos', 'web:macos', 'web:windows'].every((k) => {
    const b = shortcutDefaults[k]
    return !!b && b.code === 'KeyM' &&
      Array.isArray(b.modifiers) && b.modifiers.indexOf('primary') >= 0 && b.modifiers.indexOf('shift') >= 0
  }),
  JSON.stringify(shortcutDefaults))

if (failures > 0) {
  console.error('\n' + failures + ' 项失败')
  process.exit(1)
}
console.log('\n全部通过')
