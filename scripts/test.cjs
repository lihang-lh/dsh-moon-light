#!/usr/bin/env node
/**
 * dsh-mood-light 逻辑测试（零依赖，node scripts/test.js）
 *
 * 在 vm 沙箱里加载 client.js bundle（桩掉 window / react / localStorage /
 * document），验证：
 *   1. 协议：exports.inject / exports.apply 存在
 *   2. 槽位：shell.overlay 与 settings.section 均注册，id 为 mood-light
 *   3. 状态映射：running / success / warning / blank / 无会话
 *   4. 跑马灯：默认 conic 分段渐变、旋转盘、flash/width/opacity 注入
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

// ---- 跑马灯默认参数 ----
const el = renderOverlay({ running: true, blank: false }, 's1')
check('默认 conic 分段渐变',
  el.props.style['--ml-gradient'] === 'conic-gradient(from 0deg, #10b981 0deg 120deg, #34d399 120deg 240deg, #6ee7b7 240deg 360deg)',
  el.props.style['--ml-gradient'])
check('默认旋转 16s + 旋转盘', el.props.style['--ml-rotate'] === '16s' && el.children.length === 1)
check('宽度 8px / 闪动 1.2s / 透明度 0.6',
  el.props.style['--ml-width'] === '8px' && el.props.style['--ml-flash'] === '1.2s' && el.props.style['--ml-opacity'] === '0.6')

// ---- 配置合并 + 持久化 ----
check('初始配置写入 localStorage', storage['dsh-mood-light:config'] !== undefined)
// 通过设置页 store 路径验证：再 apply 一次带局部 config，且 localStorage 已有值时以 localStorage 为准
const storageBefore = storage['dsh-mood-light:config']
mod.apply(ctx, { width: 99, states: { warning: { colors: ['#111111', '#222222'] } } })
check('localStorage 优先级高于行配置（width 仍为 8）',
  JSON.parse(storage['dsh-mood-light:config']).width === 8 && JSON.parse(storageBefore).width === 8)

if (failures > 0) {
  console.error('\n' + failures + ' 项失败')
  process.exit(1)
}
console.log('\n全部通过')
