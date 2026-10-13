#!/usr/bin/env python3
"""氛围灯 v0.4.0：抓一张「真实 agent 运行中」的实机截图。

背景：普通短任务（如「回复两个字」）只需约 520ms，浏览器轮询常常整段错过运行态，
所以 e2e_v04.py 用 MutationObserver 日志判定 running，但截图会缺帧。本脚本专门发一个
需要数秒的指令（bash sleep），以便稳定抓到 data-mode=running 那一帧。

产出：e2e-04-running.png、e2e-04b-running-status-bar.png

用法：/usr/bin/python3 capture_running_v04.py "http://127.0.0.1:19487/?token=..."
"""
import json, os, sys
from playwright.sync_api import sync_playwright

SHOT = os.path.dirname(os.path.abspath(__file__))
TOKEN_URL = sys.argv[1]
BASE = TOKEN_URL.split("/?")[0] + "/"

MODE = """() => {
  const r = document.querySelector('.dsh-mood-light');
  return {
    present: !!r, mode: r ? r.getAttribute('data-mode') : null, cls: r ? r.className : null,
    bars: document.querySelectorAll('.dsh-mood-light-bar').length,
    barText: ((document.querySelector('.dsh-mood-light-bar') || {}).innerText || '').replace(/\\n/g, ' / '),
  };
}"""

report = {"steps": [], "consoleErrors": []}
def step(name, ok, detail=""):
    report["steps"].append({"step": name, "ok": bool(ok), "detail": str(detail)[:300]})
    print(("PASS " if ok else "FAIL ") + name + (" | " + str(detail)[:250] if detail else ""))

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1440, "height": 900})
    page = ctx.new_page()
    page.on("console", lambda m: report["consoleErrors"].append(f"[{m.type}] {m.text}") if m.type == "error" else None)
    page.on("pageerror", lambda e: report["consoleErrors"].append(f"[pageerror] {e}"))
    page.goto(TOKEN_URL, wait_until="domcontentloaded"); page.wait_for_timeout(1000)
    page.goto(BASE, wait_until="domcontentloaded"); page.wait_for_timeout(3500)
    step("登录并进入应用", page.title() == "DeepSeek Harness", page.url)

    # 前置清理：若存在遗留的「待回答」会话，它会按最高优先级聚合到首页，
    # 使 data-mode 恒为 question，看不到 running。先清掉。
    for _ in range(5):
        m0 = page.evaluate("() => { const r = document.querySelector('.dsh-mood-light'); return r ? r.getAttribute('data-mode') : null }")
        if m0 != "question":
            break
        page.mouse.move(720, 4); page.wait_for_timeout(600)
        cap0 = page.query_selector('.dsh-mood-light-capsule')
        if cap0:
            cap0.click(); page.wait_for_timeout(2200)
        dis = page.query_selector('button[aria-label="Dismiss all questions"]')
        if dis:
            dis.click(); page.wait_for_timeout(1500)
        page.goto(BASE, wait_until="domcontentloaded"); page.wait_for_timeout(3000)
    step("前置清理：无遗留待回答", page.evaluate("() => { const r = document.querySelector('.dsh-mood-light'); return !r || r.getAttribute('data-mode') !== 'question' }"))

    ed = page.query_selector('div[contenteditable="true"]')
    step("首页草稿 composer 可用", ed is not None)
    if ed:
        ed.click()
        page.keyboard.type("请用 bash 执行命令 sleep 8，然后只回复两个字：收到。不要做其它任何事。", delay=6)
        page.wait_for_timeout(400)
        send = page.query_selector('button[aria-label="Send message"]')
        send.click() if send else page.keyboard.press("Enter")

        got = None
        for i in range(240):  # 最多 48s
            page.wait_for_timeout(200)
            m = page.evaluate(MODE)
            if m["mode"] == "running":
                got = m
                page.screenshot(path=f"{SHOT}/e2e-04-running.png")
                if m["bars"]:
                    page.screenshot(path=f"{SHOT}/e2e-04b-running-status-bar.png")
                break
        step("抓到 data-mode=running 实机帧", got is not None, json.dumps(got, ensure_ascii=False) if got else json.dumps(page.evaluate(MODE), ensure_ascii=False))
        if got:
            for _ in range(200):
                page.wait_for_timeout(200)
                if page.evaluate(MODE)["mode"] != "running":
                    break
            ended = page.evaluate(MODE)
            step("运行结束后回到非 running 态", ended["mode"] != "running", json.dumps(ended, ensure_ascii=False))

    report["consoleErrors"] = list(report["consoleErrors"])
    b.close()

ok = sum(1 for s in report["steps"] if s["ok"])
print(f"\n=== {ok}/{len(report['steps'])} 项通过 ===")
print("consoleErrors:", json.dumps(report["consoleErrors"], ensure_ascii=False))
with open(f"{SHOT}/running-report.json", "w") as f:
    json.dump(report, f, ensure_ascii=False, indent=1)
