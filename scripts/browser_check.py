"""Run against `npm run preview -- --port 4173` (requires Python Playwright)."""
import argparse
import json
import math
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://127.0.0.1:4173/')
parser.add_argument('--output', default='test-results')
args = parser.parse_args()
output = Path(args.output)
output.mkdir(parents=True, exist_ok=True)
checks = []
KEY = 'shilun.wheel.v1'

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(viewport={'width': 1440, 'height': 1000})
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(args.url)
    page.wait_for_load_state('networkidle')
    expect(page).to_have_title('ShiLun · 今天吃什么')
    expect(page.get_by_role('heading', name='今天吃什么？')).to_be_visible()
    expect(page.locator('.menu-chip')).to_have_count(8)
    assert page.locator('.video-card').count() == 3
    page.screenshot(path=str(output / 'shilun-desktop.png'), full_page=True)
    checks.append('initial default menu, title and three curated videos')

    menu_input = page.get_by_role('textbox', name='想吃什么', exact=True)
    add = page.get_by_role('button', name='添加', exact=True)
    menu_input.fill('  螺蛳粉  ')
    menu_input.press('Enter')
    expect(page.get_by_role('button', name='删除螺蛳粉', exact=True)).to_be_visible()
    page.reload()
    page.wait_for_load_state('networkidle')
    expect(page.get_by_role('button', name='删除螺蛳粉', exact=True)).to_be_visible()
    page.get_by_role('button', name='删除螺蛳粉', exact=True).click()
    page.reload()
    expect(page.get_by_role('button', name='删除螺蛳粉', exact=True)).to_have_count(0)
    checks.append('add/trim/Enter, delete and persistence across reload')

    menu_input.fill(' ')
    add.click()
    expect(page.locator('#menu-feedback')).to_contain_text('先写一个')
    menu_input.fill('牛肉面')
    add.click()
    expect(page.locator('#menu-feedback')).to_contain_text('已经在转盘')
    menu_input.fill('面' * 17)
    add.click()
    expect(page.locator('#menu-feedback')).to_contain_text('16 个字')
    checks.append('empty, duplicate and oversized names rejected')

    for i in range(8):
        menu_input.fill(f'新选择{i}')
        add.click()
    expect(page.locator('.menu-chip')).to_have_count(16)
    menu_input.fill('第十七项')
    add.click()
    expect(page.locator('#menu-feedback')).to_contain_text('装满了')
    expect(page.locator('.menu-chip')).to_have_count(16)
    checks.append('16 item limit')

    page.get_by_role('button', name='恢复默认选项', exact=True).click()
    expect(page.get_by_role('button', name='保留我的菜单')).to_be_focused()
    page.keyboard.press('Escape')
    expect(page.locator('.menu-chip')).to_have_count(16)
    expect(page.get_by_role('button', name='恢复默认选项', exact=True)).to_be_focused()
    page.get_by_role('button', name='恢复默认选项', exact=True).click()
    page.get_by_role('button', name='确认恢复', exact=True).click()
    expect(page.locator('.menu-chip')).to_have_count(8)
    checks.append('restore confirmation, cancel/Escape and focus restoration')

    # Keep normal motion for this check so the input locking is observable.
    page.get_by_role('button', name='转一下，开饭！', exact=True).click()
    expect(page.get_by_role('button', name='美味正在路上…', exact=True)).to_be_disabled()
    expect(menu_input).to_be_disabled()
    expect(add).to_be_disabled()
    for button in page.locator('.menu-chip button').all():
        expect(button).to_be_disabled()
    expect(page.get_by_role('button', name='再转一次，换个灵感', exact=True)).to_be_enabled(timeout=7000)
    selected = page.get_by_test_id('spin-result').inner_text()
    stored = page.evaluate('(key) => JSON.parse(localStorage.getItem(key))', KEY)
    assert stored['history'][0]['name'] == selected
    transform = page.locator('.rotor').evaluate('(node) => getComputedStyle(node).transform')
    matrix = [float(value) for value in transform.removeprefix('matrix(').removesuffix(')').split(',')]
    degrees = math.degrees(math.atan2(matrix[1], matrix[0])) % 360
    index = int(((-degrees) % 360) / (360 / len(stored['items'])))
    assert stored['items'][index] == selected, (degrees, index, selected)
    checks.append('normal animation locks editing and pointer/result/history agree')

    page.emulate_media(reduced_motion='reduce')
    for _ in range(9):
        page.get_by_role('button', name='再转一次，换个灵感', exact=True).click()
        expect(page.get_by_role('button', name='再转一次，换个灵感', exact=True)).to_be_enabled()
    expect(page.locator('.history-list li')).to_have_count(8)
    page.get_by_role('button', name='清空记录', exact=True).click()
    expect(page.locator('.history-list li')).to_have_count(0)
    checks.append('reduced-motion spins, eight-history cap and clear')

    while page.locator('.menu-chip button').count():
        page.locator('.menu-chip button').first.click()
    expect(page.get_by_role('button', name='先添加想吃的吧', exact=True)).to_be_disabled()
    page.reload()
    expect(page.locator('.menu-chip')).to_have_count(0)
    expect(page.get_by_role('button', name='先添加想吃的吧', exact=True)).to_be_disabled()
    menu_input.fill('只想吃面')
    add.click()
    page.get_by_role('button', name='转一下，开饭！', exact=True).click()
    expect(page.get_by_test_id('spin-result')).to_have_text('只想吃面')
    expect(page.locator('.history-name')).to_have_text('只想吃面')
    checks.append('empty menu persists, disables spin; one-item wheel works')

    page.locator('.storage-note summary').click()
    expect(page.locator('.storage-note')).to_contain_text('不跨设备同步')
    expect(page.locator('.storage-note')).to_contain_text('清除网站数据')
    before = page.locator('.video-body h3').all_text_contents()
    page.get_by_role('button', name='换一批', exact=True).click()
    after = page.locator('.video-body h3').all_text_contents()
    assert set(before).isdisjoint(after)
    for anchor in page.locator('.video-link').all():
        assert anchor.get_attribute('target') == '_blank'
        assert 'noopener' in anchor.get_attribute('rel')
        assert anchor.get_attribute('href').startswith('https://www.bilibili.com/')
    assert page.locator('video, iframe').count() == 0
    checks.append('clear storage explanation; new batch, external links, no player')

    # Restore a clean view and inspect every required width.
    page.evaluate('(key) => localStorage.removeItem(key)', KEY)
    page.reload()
    for width in [375, 768, 1440]:
        page.set_viewport_size({'width': width, 'height': 900})
        assert not page.evaluate('document.documentElement.scrollWidth > innerWidth'), width
        expect(page.get_by_role('button', name='转一下，开饭！', exact=True)).to_be_visible()
        if width == 375:
            page.screenshot(path=str(output / 'shilun-mobile.png'), full_page=True)
        if width == 768:
            page.screenshot(path=str(output / 'shilun-tablet.png'), full_page=True)
    checks.append('375/768/1440 layouts without horizontal overflow')

    page.evaluate('(key) => localStorage.setItem(key, "{")', KEY)
    page.reload()
    expect(page.locator('.storage-warning')).to_contain_text('无法读取')
    expect(page.locator('.menu-chip')).to_have_count(8)
    checks.append('corrupt persisted data recovers to usable defaults')

    page.evaluate('(key) => localStorage.setItem(key, JSON.stringify({version:1, items:["保留的饭"], history:"broken"}))', KEY)
    page.reload()
    expect(page.locator('.menu-chip')).to_have_count(1)
    expect(page.get_by_role('button', name='删除保留的饭', exact=True)).to_be_visible()
    checks.append('history corruption preserves valid custom menu')

    future = {'version': 2, 'items': ['未来的饭']}
    page.evaluate('([key, data]) => localStorage.setItem(key, JSON.stringify(data))', [KEY, future])
    page.reload()
    menu_input.fill('当前页的饭')
    add.click()
    assert page.evaluate('(key) => JSON.parse(localStorage.getItem(key))', KEY) == future
    checks.append('unknown storage version is not overwritten')

    blocked = browser.new_context(viewport={'width': 375, 'height': 812}, reduced_motion='reduce')
    blocked.add_init_script("Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Blocked', 'SecurityError'); } });")
    blocked_page = blocked.new_page()
    blocked_page.on('pageerror', lambda error: errors.append(str(error)))
    blocked_page.goto(args.url)
    blocked_page.wait_for_load_state('networkidle')
    expect(blocked_page.locator('.storage-warning')).to_contain_text('暂时无法记住')
    blocked_page.get_by_role('textbox', name='想吃什么', exact=True).fill('临时的饭')
    blocked_page.get_by_role('button', name='添加', exact=True).click()
    expect(blocked_page.get_by_role('button', name='删除临时的饭', exact=True)).to_be_visible()
    blocked_page.get_by_role('button', name='转一下，开饭！', exact=True).click()
    expect(blocked_page.get_by_role('button', name='再转一次，换个灵感', exact=True)).to_be_enabled()
    checks.append('localStorage access denied: add and spin remain functional')
    blocked.close()

    quota = browser.new_context(reduced_motion='reduce')
    quota.add_init_script("Storage.prototype.setItem = function() { throw new DOMException('Full', 'QuotaExceededError'); };")
    quota_page = quota.new_page()
    quota_page.on('pageerror', lambda error: errors.append(str(error)))
    quota_page.goto(args.url)
    quota_page.wait_for_load_state('networkidle')
    expect(quota_page.locator('.storage-warning')).to_contain_text('暂时无法记住')
    expect(quota_page.get_by_role('button', name='转一下，开饭！', exact=True)).to_be_enabled()
    quota.close()
    checks.append('storage quota failure: clear warning and usable page')

    assert not errors, errors
    checks.append('no browser runtime errors')
    context.close()
    browser.close()

report = {'status': 'passed', 'checks': checks, 'browser': 'Chromium', 'base_url': args.url}
(output / 'shilun-browser-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'status': 'passed', 'checks': len(checks), 'report': str(output / 'shilun-browser-report.json')}, ensure_ascii=True))
