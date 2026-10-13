#!/usr/bin/env python3
"""氛围灯 v0.4.0 独立预览页截图（docs/preview.html，file:// 直开，无宿主依赖）。

产出：
  preview-mode-<mode>.png   五态色板对照（running / success / warning / planReview / question）
  preview-sweep.png         扫光进行中（点「播放扫光」后立刻抓帧）
  preview-light-theme.png   浅色主题下的同一界面

用法：/usr/bin/python3 capture_preview_v04.py
"""
import json, os
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
PAGE = "file://" + os.path.abspath(os.path.join(HERE, "..", "..", "..", "..", "docs", "preview.html"))
MODES = ["running", "success", "warning", "planReview", "question"]

report = {"page": PAGE, "shots": [], "errors": []}

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    page = ctx.new_page()
    page.on("console", lambda m: report["errors"].append(f"[{m.type}] {m.text}") if m.type == "error" else None)
    page.on("pageerror", lambda e: report["errors"].append(f"[pageerror] {e}"))
    page.goto(PAGE, wait_until="load")
    page.wait_for_timeout(900)

    for mode in MODES:
        page.click(f'#modeBtns button[data-mode="{mode}"]')
        page.wait_for_timeout(1400)  # 等 crossfade + flash 稳定
        path = f"{HERE}/preview-mode-{mode}.png"
        page.screenshot(path=path)
        ring = page.evaluate("() => { const r = document.querySelector('#ring'); return r ? {mode: r.getAttribute('data-mode'), cls: r.className} : null }")
        report["shots"].append({"mode": mode, "file": os.path.basename(path), "ring": ring})
        print(f"PASS 预览页 {mode} -> {os.path.basename(path)} | {json.dumps(ring, ensure_ascii=False)}")

    # 扫光：播放后立刻抓帧，再等一会儿抓一帧「已结束」
    page.click('#modeBtns button[data-mode="success"]'); page.wait_for_timeout(900)
    if page.query_selector('#playSweep'):
        page.click('#playSweep')
        page.wait_for_timeout(320)  # 动画 1150ms，取中前段
        page.screenshot(path=f"{HERE}/preview-sweep.png")
        sweep = page.evaluate("() => { const s = document.querySelector('.dsh-mood-light-sweep'); return s ? {cls: s.className, opacity: getComputedStyle(s).opacity} : null }")
        report["sweep"] = sweep
        print(f"PASS 预览页扫光中 -> preview-sweep.png | {json.dumps(sweep, ensure_ascii=False)}")

    # 浅色主题
    if page.query_selector('#themeBtn'):
        page.click('#themeBtn')
        page.wait_for_timeout(1200)
        page.screenshot(path=f"{HERE}/preview-light-theme.png")
        theme = page.evaluate("() => ({dark: document.body.hasAttribute('data-ds-dark-theme'), scale: getComputedStyle(document.body).getPropertyValue('--ml-theme-scale').trim()})")
        report["theme"] = theme
        print(f"PASS 预览页浅色主题 -> preview-light-theme.png | {json.dumps(theme, ensure_ascii=False)}")

    report["finalErrors"] = list(report["errors"])
    browser.close()

print("=== consoleErrors ===")
print(json.dumps(report["errors"], ensure_ascii=False, indent=1))
with open(f"{HERE}/preview-report.json", "w") as f:
    json.dump(report, f, ensure_ascii=False, indent=1)
