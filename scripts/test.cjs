#!/usr/bin/env node
/**
 * dsh-mood-light 逻辑测试（零依赖，node scripts/test.js）
 *
 * 在 vm 沙箱里加载 client.js bundle（桩掉 window / react / localStorage /
 * document），验证：
 *   1. 协议：exports.inject / exports.apply 存在
 *   2. 槽位：shell.overlay 与 settings.section 均注册，id 为 mood-light
 *   3. 状态映射：running / success / warning / blank / 无会话
 *   4. 氛围灯：默认柔光晕（glow）多层软晕、无零模糊硬核、width/opacity/flash 注入；
 *      显式回归 conic（分段渐变+旋转盘）与 linear（linear-gradient）
 *   5. 配置合并：局部覆盖保留其他默认
 *   6. 持久化：初始默认写入 localStorage，setConfig 后更新
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
const documentStub = {
  getElementById: () => null,
  createElement: () => ({ dataset: {}, style: {}, appendChild() {} }),
  head: { appendChild() {} },
}
const ReactStub = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
  useState: (init) => [init, () => {}],
  useEffect: () => {},
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
})

check('bundle 协议：factory 被捕获', captured !== null)
if (!captured) process.exit(1)

const mod = captured.factory(requireStub)
check('exports.inject = ["slots"]', Array.isArray(mod.inject) && mod.inject[0] === 'slots')
check('exports.apply 是函数', typeof mod.apply === 'function')

// ---- 槽位注册 ----
const regs = {}
const ctx = {
  slots: {
    inject: (key, cb) => { regs[key] = cb() },
    register: (opts, renderer) => ({ opts, renderer }),
  },
}
mod.apply(ctx, {})
check('注册 shell.overlay', regs['shell.overlay'] && regs['shell.overlay'].opts.id === 'mood-light')
check('注册 settings.section', regs['settings.section'] && regs['settings.section'].opts.id === 'mood-light')

// ---- 渲染辅助 ----
function renderEl(el) {
  while (el && typeof el.type === 'function') el = el.type(el.props)
  return el
}
function renderOverlay(summary, current) {
  return renderEl(regs['shell.overlay'].renderer({
    useSessions: (sel) => sel({ current, byId: current ? { [current]: summary } : {} }),
  }))
}
function renderSettings() {
  return renderEl(regs['settings.section'].renderer({ close: null }))
}
// 遍历渲染树（兼容数组/嵌套数组/元素/函数组件如 SliderField）
function walk(node, fn) {
  if (!node) return
  if (Array.isArray(node)) { node.forEach((n) => walk(n, fn)); return }
  if (typeof node.type === 'function') node = node.type(node.props) // 展开函数组件
  if (!node) return
  fn(node)
  const kids = node.children || []
  for (let i = 0; i < kids.length; i++) walk(kids[i], fn)
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

// ---- 状态映射 ----
const cases = [
  ['运行中 -> running', { running: true, blank: false }, 's1', 'running'],
  ['完成 -> success', { running: false, blank: false }, 's1', 'success'],
  ['待处理 -> warning', { running: true, blank: false, pendingInteraction: 'approval' }, 's1', 'warning'],
  ['计划确认 -> warning', { running: false, blank: false, pendingInteraction: 'plan-review' }, 's1', 'warning'],
  ['空白会话 -> 关闭', { running: false, blank: true }, 's1', null],
  ['无会话 -> 关闭', undefined, undefined, null],
]
for (const [name, summary, current, expect] of cases) {
  const el = renderOverlay(summary, current)
  const got = el === null ? null : el.props['data-mode']
  check(name, got === expect, 'got ' + got)
}

// ---- 默认（柔光晕 glow）参数 ----
const el = renderOverlay({ running: true, blank: false }, 's1')
check('默认渲染为柔光晕（glow）元素',
  el.props.className === 'dsh-mood-light-glow', 'className=' + el.props.className)
check('默认 glow 含 --ml-glow-shadow',
  typeof el.props.style['--ml-glow-shadow'] === 'string' && el.props.style['--ml-glow-shadow'].indexOf('inset') === 0)
check('默认 glow 阴影串不含零模糊硬核（无边框）', !/inset 0 0 0 /.test(el.props.style['--ml-glow-shadow']))
check('默认 glow 含 ≥2 层软晕', (el.props.style['--ml-glow-shadow'].split('inset').length - 1) >= 2)
check('默认 glow 宽 8px / 闪动 1.2s / 透明度 0.6',
  el.props.style['--ml-width'] === '8px' && el.props.style['--ml-flash'] === '1.2s' && el.props.style['--ml-opacity'] === '0.6')
check('设置页默认效果样式 select value==glow', firstSelectValue(renderSettings()) === 'glow')

// ---- 配置合并 + 持久化 ----
check('初始配置写入 localStorage', storage['dsh-mood-light:config'] !== undefined)
// 通过设置页 store 路径验证：再 apply 一次带局部 config，且 localStorage 已有值时以 localStorage 为准
const storageBefore = storage['dsh-mood-light:config']
mod.apply(ctx, { width: 99, states: { warning: { colors: ['#111111', '#222222'] } } })
check('localStorage 优先级高于行配置（width 仍为 8）',
  JSON.parse(storage['dsh-mood-light:config']).width === 8 && JSON.parse(storageBefore).width === 8)

// ---- 向后兼容：conic / linear 显式回归 ----
storage['dsh-mood-light:config'] = JSON.stringify({ gradientType: 'conic' })
mod.apply(ctx, {})
const conicEl = renderOverlay({ running: true, blank: false }, 's1')
check('conic 分段渐变',
  conicEl.props.style['--ml-gradient'] === 'conic-gradient(from 0deg, #10b981 0deg 120deg, #34d399 120deg 240deg, #6ee7b7 240deg 360deg)',
  conicEl.props.style['--ml-gradient'])
check('conic 旋转 16s + 旋转盘', conicEl.props.style['--ml-rotate'] === '16s' && conicEl.children.length === 1)
check('conic 渲染不是 glow 元素', conicEl.props.className !== 'dsh-mood-light-glow')

storage['dsh-mood-light:config'] = JSON.stringify({ gradientType: 'linear' })
mod.apply(ctx, {})
const linearEl = renderOverlay({ running: true, blank: false }, 's1')
check('linear 线性渐变',
  linearEl.props.style['--ml-gradient'] === 'linear-gradient(135deg, #10b981, #34d399, #6ee7b7)',
  linearEl.props.style['--ml-gradient'])
check('linear 渲染不是 glow 元素', linearEl.props.className !== 'dsh-mood-light-glow')

// ---- 柔光晕（glow）：配置默认 + 渲染分支 + SVG 位移滤镜 ----
function hasFilterNode(node) {
  if (!node) return false
  // React 子节点可能是嵌套数组（stub 的 ...children 会套一层）
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      if (hasFilterNode(node[i])) return true
    }
    return false
  }
  if (node.type === 'filter' && node.props && node.props.id === 'dsh-mood-light-turb') return true
  const kids = node.children || []
  for (let i = 0; i < kids.length; i++) {
    if (hasFilterNode(kids[i])) return true
  }
  return false
}

// gradientType='glow' 且不提供新字段 => 新字段落默认（向后兼容旧 localStorage / 旧 config）
storage['dsh-mood-light:config'] = JSON.stringify({ gradientType: 'glow' })
mod.apply(ctx, {})
const glowEl = renderOverlay({ running: true, blank: false }, 's1')
check('mergeConfig 接受 gradientType=glow（渲染为 glow 元素）',
  glowEl.props.className === 'dsh-mood-light-glow', 'className=' + glowEl.props.className)
check('glow 含 --ml-glow-shadow',
  typeof glowEl.props.style['--ml-glow-shadow'] === 'string' && glowEl.props.style['--ml-glow-shadow'].indexOf('inset') === 0)
check('glow 阴影串不含零模糊硬核', !/inset 0 0 0 /.test(glowEl.props.style['--ml-glow-shadow']))
check('glow 含 width/opacity/flash',
  glowEl.props.style['--ml-width'] === '8px' && glowEl.props.style['--ml-opacity'] === '0.6' && glowEl.props.style['--ml-flash'] === '1.2s')
check('glow 默认 glowSpread=24（阴影含多层软晕）',
  (glowEl.props.style['--ml-glow-shadow'].split('inset').length - 1) >= 2)
check('glow 默认 glowWobble>0 => 应用位移滤镜',
  glowEl.props.style['filter'] === 'url(#dsh-mood-light-turb)')
check('渲染树含 id=dsh-mood-light-turb 的 SVG filter 定义', hasFilterNode(glowEl))

// glowWobble=0 => 不应用滤镜、不渲染 SVG filter
storage['dsh-mood-light:config'] = JSON.stringify({ gradientType: 'glow', glowWobble: 0 })
mod.apply(ctx, {})
const glowEl0 = renderOverlay({ running: true, blank: false }, 's1')
check('glowWobble=0 时不应用滤镜', glowEl0.props.style['filter'] === undefined)
check('glowWobble=0 时渲染树无 SVG filter', !hasFilterNode(glowEl0))

// ---- 设置页：glow 选项 + 条件滑块 + set/get 路径 ----
// glow 专属参数用一个不冲突的值，便于在渲染树里定位对应滑块
storage['dsh-mood-light:config'] = JSON.stringify({ gradientType: 'glow', glowSpread: 77, glowWobble: 3 })
mod.apply(ctx, {})
let settingsEl = renderSettings()
check('设置页效果样式 select 含 glow 选项', selectOptionValues(settingsEl).includes('glow'))
check('glow 时渲染「扩散范围」滑块（value=77）', rangeByValue(settingsEl, 77) !== null)
check('glow 时渲染「不规则强度」滑块（value=3）', rangeByValue(settingsEl, 3) !== null)

// set 路径：调用「扩散范围」滑块 onChange 触发 setConfig，重渲染后值更新
const spreadInput = rangeByValue(settingsEl, 77)
spreadInput.props.onChange({ target: { value: '120' } })
const settingsEl2 = renderSettings()
check('glowSpread 经设置页滑块 set 后生效（value=120）', rangeByValue(settingsEl2, 120) !== null)

// conic（跑马灯）下不显示 glow 专属滑块（向后兼容条件显示）
storage['dsh-mood-light:config'] = JSON.stringify({ gradientType: 'conic', glowSpread: 77 })
mod.apply(ctx, {})
const settingsConic = renderSettings()
check('conic 时不渲染「扩散范围」滑块', rangeByValue(settingsConic, 77) === null)
check('conic 时效果样式 select 仍含跑马灯与线性', ['conic', 'linear'].every((v) => selectOptionValues(settingsConic).includes(v)))

if (failures > 0) {
  console.error('\n' + failures + ' 项失败')
  process.exit(1)
}
console.log('\n全部通过')
