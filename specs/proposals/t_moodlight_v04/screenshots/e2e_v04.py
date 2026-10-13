#!/usr/bin/env python3
"""氛围灯 v0.4.0 真机 E2E（独立 web 实例 127.0.0.1:19487）。

覆盖：真实登录 → 首页成功态 → 顶部胶囊 → 真实 agent 运行(running) → 完成(success+扫光)
→ 状态条一键开关 → 深色主题适配 → 设置区 → 快捷键。
截图输出到本目录。
"""
import json, os, sys
from playwright.sync_api import sync_playwright

# 用法：python3 e2e_v04.py [带 token 的完整 URL]
# 每次重启 dsh web 都会打印新的 token URL，从这里传入可避免改脚本。
TOKEN_URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:19487/?token=vmopn38476xxt5fafbbvWnzEUbuvn1C7Q-O_uFkL9lM"
BASE = TOKEN_URL.split("/?")[0] + "/"
SHOT = os.path.dirname(os.path.abspath(__file__))
report = {"steps": [], "consoleErrors": [], "mlLog": [], "timeline": []}

def step(name, ok, detail=""):
    report["steps"].append({"step": name, "ok": bool(ok), "detail": str(detail)[:400]})
    print(("PASS " if ok else "FAIL ") + name + ((" | " + str(detail)[:300]) if detail else ""))

RECORDER = """() => {
  window.__ML_LOG = [];
  const t0 = performance.now();
  const push = (o) => { o.t = Math.round(performance.now() - t0); window.__ML_LOG.push(o); };
  const ring0 = document.querySelector('.dsh-mood-light');
  push({ type: 'init', mode: ring0 ? ring0.getAttribute('data-mode') : null });
  new MutationObserver((muts) => {
    for (const m of muts) {
      for (const n of m.addedNodes) {
        if (n.nodeType === 1) {
          if (n.matches && n.matches('.dsh-mood-light-sweep')) push({ type: 'sweep-added', cls: n.className });
          else if (n.querySelector && n.querySelector('.dsh-mood-light-sweep')) push({ type: 'sweep-added', cls: 'nested' });
        }
      }
      if (m.type === 'attributes' && m.attributeName === 'data-mode')
        push({ type: 'mode', from: m.oldValue, to: m.target.getAttribute('data-mode') });
    }
  }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-mode'], attributeOldValue: true });
}
"""

MODE = """() => {
  const r = document.querySelector('.dsh-mood-light');
  const cs = r ? getComputedStyle(r) : null;
  return {
    present: !!r, mode: r ? r.getAttribute('data-mode') : null, cls: r ? r.className : null,
    flash: r ? r.getAttribute('data-flash') : null,
    sweeps: document.querySelectorAll('.dsh-mood-light-sweep').length,
    glows: document.querySelectorAll('.dsh-mood-light-glow').length,
    fills: document.querySelectorAll('.dsh-mood-light-fill').length,
    grains: document.querySelectorAll('.dsh-mood-light-grain').length,
    bars: document.querySelectorAll('.dsh-mood-light-bar').length,
    barText: ((document.querySelector('.dsh-mood-light-bar') || {}).innerText || '').replace(/\\n/g, ' / '),
    barBtn: !!document.querySelector('.dsh-mood-light-bar-btn'),
    capsuleOpen: !!document.querySelector('.dsh-mood-light-capsule.is-open'),
    capsuleText: ((document.querySelector('.dsh-mood-light-capsule') || {}).innerText || '').replace(/\\n/g, ' / '),
    themeScale: cs ? cs.getPropertyValue('--ml-theme-scale').trim() : null,
  };
}"""

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    page = ctx.new_page()
    page.on("console", lambda m: report["consoleErrors"].append(f"[{m.type}] {m.text}") if m.type == "error" else None)
    page.on("pageerror", lambda e: report["consoleErrors"].append(f"[pageerror] {e}"))

    # 0) 真实登录：token URL → 服务端下发签名 Cookie
    page.goto(TOKEN_URL, wait_until="domcontentloaded"); page.wait_for_timeout(1200)
    page.goto(BASE, wait_until="domcontentloaded"); page.wait_for_timeout(3500)
    step("0. 登录并进入应用", page.title() == "DeepSeek Harness", page.url)

    # 0b) 前置清理：上一轮 step 11 会让 agent 反问并留下「待回答」，它按最高优先级聚合到首页，
    #     会让后面的 success→running 断言失去意义。先把遗留问题清掉，保证脚本可重复运行。
    for _ in range(5):
        m = page.evaluate("() => { const r = document.querySelector('.dsh-mood-light'); return r ? r.getAttribute('data-mode') : null }")
        if m != "question":
            break
        page.mouse.move(720, 4); page.wait_for_timeout(600)
        cap0 = page.query_selector('.dsh-mood-light-capsule')
        if cap0:
            cap0.click(); page.wait_for_timeout(2200)
        dis = page.query_selector('button[aria-label="Dismiss all questions"]')
        if dis:
            dis.click(); page.wait_for_timeout(1500)
        page.goto(BASE, wait_until="domcontentloaded"); page.wait_for_timeout(3000)
    step("0b. 前置清理：首页回到非待处理态（可重复运行）",
         page.evaluate("() => { const r = document.querySelector('.dsh-mood-light'); return !r || r.getAttribute('data-mode') !== 'question' }"))
    page.evaluate(RECORDER)

    # 1) 首页成功态
    s = page.evaluate(MODE)
    step("1. 首页渲染氛围灯 success 态（glow 三层）",
         s["present"] and s["mode"] == "success" and s["cls"] == "dsh-mood-light is-glow" and s["glows"] == 1 and s["fills"] == 1 and s["grains"] == 1,
         json.dumps(s, ensure_ascii=False))
    step("1b. 浅色主题 --ml-theme-scale=1.35", s["themeScale"] == "1.35", s["themeScale"])
    page.screenshot(path=f"{SHOT}/e2e-01-home-light-success.png")

    # 2) 顶部触发带 → 胶囊
    page.mouse.move(720, 4); page.wait_for_timeout(600)
    s2 = page.evaluate(MODE)
    step("2. 顶部悬浮展开胶囊", s2["capsuleOpen"], s2["capsuleText"])
    page.screenshot(path=f"{SHOT}/e2e-02-capsule-hover.png")
    page.mouse.move(720, 400); page.wait_for_timeout(400)

    # 3) 真实 agent 运行：新建草稿会话
    ed = page.query_selector('div[contenteditable="true"]')
    step("3. 首页草稿 composer 可用", ed is not None)
    if ed:
        ed.click(); page.keyboard.type("请只回复两个字：收到", delay=12); page.wait_for_timeout(400)
        page.screenshot(path=f"{SHOT}/e2e-03a-composer-typed.png")
        send = page.query_selector('button[aria-label="Send message"]')
        send.click() if send else page.keyboard.press("Enter")
        page.wait_for_timeout(300)
        step("3b. 消息已发出", page.query_selector('div[contenteditable="true"]') is not None,
             repr(page.evaluate("() => { const e = document.querySelector('div[contenteditable=true]'); return e ? e.innerText : null; }")))

        # 轮询只用于「抓到 running 那一帧」的截图；判定以 MutationObserver 日志为准 ——
        # agent 可能几百毫秒就跑完，轮询会整段错过（实测 success→running→success 只用 519ms）。
        saw_running = False
        for i in range(60):
            page.wait_for_timeout(200)
            m = page.evaluate(MODE)
            if i % 5 == 0:
                report["timeline"].append({"i": i, "mode": m["mode"], "sweeps": m["sweeps"], "bars": m["bars"]})
            if m["mode"] == "running":
                page.screenshot(path=f"{SHOT}/e2e-04-running.png")
                saw_running = True
                break
        log4 = page.evaluate("() => window.__ML_LOG || []")
        to_running = [e for e in log4 if e.get("type") == "mode" and e.get("to") == "running"]
        step("4. 进入 running 态（以 MutationObserver 记录为准）", len(to_running) > 0,
             ("实时抓到运行帧" if saw_running else "轮询未抓到帧，但日志有转场") + " | " + json.dumps(to_running[:2], ensure_ascii=False))

        if saw_running or len(to_running) > 0:
            got_success = False
            for i in range(400):
                page.wait_for_timeout(120)
                m = page.evaluate(MODE)
                if m["mode"] == "success":
                    got_success = True
                    page.screenshot(path=f"{SHOT}/e2e-05-success-after-run.png")
                    break
            step("5. 结束回到 data-mode=success", got_success, page.evaluate("() => (document.querySelector('.dsh-mood-light')||{}).className || null"))
            page.wait_for_timeout(300)
            log = page.evaluate("() => window.__ML_LOG || []")
            report["mlLog"] = log
            step("6. 记录到 running→success 状态切换", any(e.get("type") == "mode" and e.get("to") == "running" for e in log), json.dumps(log, ensure_ascii=False)[:400])
            step("6b. success 触发一次性扫光", any(e.get("type") == "sweep-added" for e in log), json.dumps([e for e in log if e.get("type") == "sweep-added"], ensure_ascii=False)[:200])
            st = page.evaluate(MODE)
            step("7. 会话内渲染状态条", st["bars"] == 1 and "氛围灯" in st["barText"], st["barText"])
            page.screenshot(path=f"{SHOT}/e2e-07-session-status-bar.png")

            # 8) 状态条一键开关
            btn = page.query_selector('.dsh-mood-light-bar-btn')
            step("8. 状态条内一键开关存在", btn is not None, btn.get_attribute("aria-label") if btn else None)
            if btn:
                btn.click(); page.wait_for_timeout(1000)
                off = page.evaluate(MODE)
                step("8b. 点击后氛围灯关闭（状态条随之消失 —— 单向关闭，符合 spec）",
                     not off["present"], json.dumps(off, ensure_ascii=False))
                page.screenshot(path=f"{SHOT}/e2e-08-toggle-off.png")
                # 8c) 用快捷键把它开回来：这一步同时验证「关闭态下快捷键仍可恢复」
                page.keyboard.press("Escape"); page.wait_for_timeout(300)
                page.keyboard.press("Meta+Shift+KeyM"); page.wait_for_timeout(1000)
                back_on = page.evaluate(MODE)
                step("8c. 快捷键 Cmd+Shift+M 在关闭态下可重新开启", back_on["present"],
                     json.dumps(back_on, ensure_ascii=False))

    # 9) 深色主题适配
    page.evaluate("document.body.setAttribute('data-ds-dark-theme','')"); page.wait_for_timeout(700)
    s5 = page.evaluate(MODE)
    step("9. 深色主题 --ml-theme-scale=0.85", s5["themeScale"] == "0.85", s5["themeScale"])
    page.screenshot(path=f"{SHOT}/e2e-09-dark-theme.png")
    page.evaluate("document.body.removeAttribute('data-ds-dark-theme')"); page.wait_for_timeout(400)

    # 10) 快捷键关闭（先确保焦点在页面、无模态）
    page.keyboard.press("Escape"); page.wait_for_timeout(400)
    page.mouse.click(720, 700); page.wait_for_timeout(400)
    before = page.evaluate(MODE)
    page.keyboard.press("Meta+Shift+KeyM"); page.wait_for_timeout(1200)
    after = page.evaluate(MODE)
    step("10. 快捷键 Cmd+Shift+M 关闭", before["present"] and not after["present"], f"{before['present']}->{after['present']}")
    if before["present"] and not after["present"]:
        page.screenshot(path=f"{SHOT}/e2e-10-shortcut-off.png")
        page.keyboard.press("Meta+Shift+KeyM"); page.wait_for_timeout(1200)
        step("10b. 再按恢复", page.evaluate(MODE)["present"])
    else:
        # 合成事件兜底探测（记录是否为宿主拦截）
        fired = page.evaluate("""() => {
          const before = !!document.querySelector('.dsh-mood-light');
          for (const t of [window, document, document.body]) {
            t.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM', key: 'M', metaKey: true, shiftKey: true, bubbles: true, cancelable: true }));
          }
          return { before, after: !!document.querySelector('.dsh-mood-light') };
        }""")
        page.wait_for_timeout(800)
        fired["afterAsync"] = page.evaluate("() => !!document.querySelector('.dsh-mood-light')")
        step("10b. 合成快捷键事件探测", False, json.dumps(fired, ensure_ascii=False))

    # 11) 待处理态实机验证（best effort）：请 agent 反问用户 → question 态
    #    覆盖「待处理色只在 useSessionStatus 通道下发」这条链路在真实宿主里的表现。
    ed2 = page.query_selector('div[contenteditable="true"]')
    if ed2:
        ed2.click()
        page.keyboard.type("请立即调用 ask_user_question 工具问我一个问题：今天要做什么？只问这一个问题，不要做其它任何事。", delay=6)
        page.wait_for_timeout(400)
        send2 = page.query_selector('button[aria-label="Send message"]')
        send2.click() if send2 else page.keyboard.press("Enter")
        got_pending = None
        for _ in range(200):
            page.wait_for_timeout(250)
            m = page.evaluate(MODE)
            if m["mode"] in ("warning", "planReview", "question"):
                got_pending = m["mode"]
                page.screenshot(path=f"{SHOT}/e2e-11-pending-{m['mode']}.png")
                break
        step("11. 待处理态（approval/plan-review/question）实机可见",
             got_pending is not None,
             got_pending or json.dumps(page.evaluate(MODE), ensure_ascii=False))
        report["pendingMode"] = got_pending

    report["mlLog"] = page.evaluate("() => window.__ML_LOG || []")
    report["finalState"] = page.evaluate(MODE)
    browser.close()

print("\n=== ML_LOG ===")
print(json.dumps(report.get("mlLog"), ensure_ascii=False, indent=1)[:2500])
print("=== timeline ===")
print(json.dumps(report.get("timeline"), ensure_ascii=False))
print("=== consoleErrors ===")
print(json.dumps(report["consoleErrors"], ensure_ascii=False, indent=1))
ok = sum(1 for s in report["steps"] if s["ok"])
print(f"\n=== {ok}/{len(report['steps'])} 项通过 ===")
with open(f"{SHOT}/e2e-report.json", "w") as f:
    json.dump(report, f, ensure_ascii=False, indent=1)
