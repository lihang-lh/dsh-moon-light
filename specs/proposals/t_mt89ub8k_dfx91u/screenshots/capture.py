#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""截图脚本：打开 docs/preview.html，切换效果样式/状态并截图柔光晕效果。"""
import pathlib
import sys
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[4]  # -> 仓库根（specs/.../screenshots 上溯 4 级）
OUT = pathlib.Path(__file__).resolve().parent       # 截图输出目录 = screenshots
PAGE = (ROOT / "docs" / "preview.html").as_uri()

def set_style(page, value):
    page.select_option("#style", value)

def set_state(page, mode):
    page.click('.mode-btns button[data-mode="%s"]' % mode)

def set_slider(page, selector, value):
    page.fill(selector, str(value))
    page.dispatch_event(selector, "input")

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1280, "height": 800})
        page.goto(PAGE)
        page.wait_for_timeout(300)

        # 1) 柔光晕（运行中/绿，默认参数）：散射光 + 不平整边缘
        set_style(page, "glow")
        set_state(page, "running")
        page.wait_for_timeout(400)
        page.screenshot(path=str(OUT / "glow-running-default.png"))

        # 2) 柔光晕（待处理/黄）换一种状态色
        set_state(page, "warning")
        page.wait_for_timeout(300)
        page.screenshot(path=str(OUT / "glow-warning.png"))

        # 3) 柔光晕 + 调大扩散范围/不规则强度，演示参数实时生效
        set_state(page, "running")
        set_slider(page, "#glowSpread", 60)
        set_slider(page, "#glowWobble", 4)
        page.wait_for_timeout(300)
        page.screenshot(path=str(OUT / "glow-running-spread60-wobble4.png"))

        # 4) 兼容对照：跑马灯（conic）仍在
        set_slider(page, "#glowSpread", 24)
        set_slider(page, "#glowWobble", 1)
        set_style(page, "segments")
        set_state(page, "running")
        page.wait_for_timeout(300)
        page.screenshot(path=str(OUT / "marquee-running-default.png"))

        browser.close()
    print("screenshots written to", OUT)

if __name__ == "__main__":
    sys.exit(main())
