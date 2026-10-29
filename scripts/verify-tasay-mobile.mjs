// Run after building the tasay adapter and starting the local campus server.
// BASE_URL, QA_OUTPUT_DIR, PLAYWRIGHT_MODULE and CHROME_EXECUTABLE are optional.
// QA_FOCUS=unread reruns only the group unread regression after a targeted fix.
// Fresh browser contexts + intercepted API requests prevent real model/data writes.
import {access, mkdir, writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const origin = (process.env.BASE_URL || 'http://127.0.0.1:5178').replace(/\/$/, '');
const out = process.env.QA_OUTPUT_DIR || path.join(root, 'artifacts/tasay-mobile-2026-10-28');
const exists = async file => access(file).then(() => true, () => false);
const bundledPlaywright = path.join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const moduleName = process.env.PLAYWRIGHT_MODULE || (await exists(bundledPlaywright) ? pathToFileURL(bundledPlaywright).href : 'playwright');
const {chromium} = await import(moduleName);
const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const executablePath = process.env.CHROME_EXECUTABLE || (await exists(macChrome) ? macChrome : undefined);
await mkdir(out, {recursive: true});

const checks = [], failures = [], errors = [], blockedRequests = [];
const focus = process.env.QA_FOCUS || 'full';
const loadedBundles = new Set();
const browser = await chromium.launch({headless: true, ...(executablePath ? {executablePath} : {})});
let activePage;
const check = (name, passed, detail) => {
  const result = {name, passed: Boolean(passed), ...(detail !== undefined ? {detail} : {})};
  checks.push(result);
  if (!passed) failures.push(result);
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`);
};
const snapshot = async (page, name) => {
  await page.waitForTimeout(280); // Let sheet transitions settle before capturing pixels.
  await page.screenshot({path: path.join(out, `qa-${name}.png`)});
};
const storedState = page => page.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([key]) => key.startsWith('ta-say:'))));
async function open(size, {mobile = true, storage = null, pathname = '/works/tasay/chat'} = {}) {
  const context = await browser.newContext({viewport: size, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1});
  // Block every API, including the model route, before navigation. Static app assets still load.
  await context.route('**/api/**', route => {
    blockedRequests.push({url: route.request().url(), method: route.request().method()});
    return route.abort('blockedbyclient');
  });
  if (storage) await context.addInitScript(values => { for (const [key, value] of Object.entries(values)) localStorage.setItem(key, value); }, storage);
  const page = await context.newPage();
  page.setDefaultTimeout(7000);
  page.on('pageerror', error => errors.push(error.message));
  activePage = page;
  await page.goto(origin + pathname);
  await page.locator('.desktop-chat-input').waitFor({state: 'attached'});
  for (const src of await page.locator('script[src]').evaluateAll(nodes => nodes.map(node => node.src))) loadedBundles.add(src);
  return page;
}
const input = page => page.locator('.desktop-chat-input');
const goList = async page => {
  await page.getByRole('button', {name: '返回会话列表', exact: true}).click();
  await page.locator('.wx-tabbar').waitFor({state: 'visible'});
};
const choose = async (page, name) => {
  await page.locator('.desktop-conversation-item').filter({has: page.locator('strong', {hasText: name})}).click();
  await page.locator('.desktop-chat-main').waitFor({state: 'visible'});
};
const geometry = page => page.evaluate(() => {
  const rect = selector => {
    const el = document.querySelector(selector), r = el?.getBoundingClientRect();
    return r ? {x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom} : null;
  };
  return {viewport: {width: innerWidth, height: innerHeight}, width: document.documentElement.scrollWidth,
    header: rect('.desktop-chat-header'), stream: rect('.desktop-chat-stream'), composer: rect('.desktop-chat-composer'), menu: rect('#wx-chat-actions')};
});

try {
  if (focus === 'unread') {
    const page = await open({width: 390, height: 844});
    await goList(page);
    await choose(page, '工作群');
    await input(page).fill('离开会话后等待回复');
    await page.locator('.desktop-send-button').click();
    await goList(page);
    await page.waitForTimeout(900);
    const groupItem = page.locator('.desktop-conversation-item').filter({has: page.locator('strong', {hasText: '工作群'})});
    check('Reply received on the list stays unread', await groupItem.locator('.desktop-conversation-unread-dot').count() === 1);
    await snapshot(page, '390-group-unread');
    await choose(page, '工作群');
    check('Opening the conversation clears its unread marker', await groupItem.locator('.desktop-conversation-unread-dot').count() === 0);
    await goList(page);
    await snapshot(page, '390-group-read');
  } else {
  const phone = await open({width: 390, height: 844});
  const initial = await geometry(phone);
  check('390px header is 48px and document fits', initial.header.height === 48 && initial.width === 390, initial);
  await snapshot(phone, '390-chat');

  await input(phone).fill('保留给宝宝的草稿');
  await goList(phone);
  check('Conversation list has four WeChat tabs', await phone.locator('.wx-tabbar button').count() === 4);
  const hiddenFocus = await input(phone).evaluate(el => {el.focus(); return {focused: document.activeElement === el, inert: el.closest('.desktop-chat-main').inert, aria: el.closest('.desktop-chat-main').getAttribute('aria-hidden')};});
  check('Hidden conversation is inert and cannot receive focus', !hiddenFocus.focused && hiddenFocus.inert && hiddenFocus.aria === 'true', hiddenFocus);
  await snapshot(phone, '390-list');
  const names = await phone.locator('.desktop-conversation-item strong').allTextContents();
  const assistantName = names.find(name => name.includes('助手'));
  const groupName = names.find(name => name.includes('工作群'));
  if (!assistantName || !groupName) throw new Error(`Expected assistant and group conversations: ${JSON.stringify(names)}`);
  await choose(phone, assistantName);
  await input(phone).fill('助手发送检查');
  await phone.locator('.desktop-send-button').click();
  const sendResult = await input(phone).evaluate(el => ({focused: document.activeElement === el, value: el.value}));
  check('Assistant send keeps input focus and clears the draft', sendResult.focused && sendResult.value === '', sendResult);
  check('Assistant message appears once', await phone.locator('.desktop-chat-stream').getByText('助手发送检查', {exact: true}).count() === 1);

  const beforeIme = await phone.locator('.desktop-message-row.user').count();
  await input(phone).fill('拼音输入未确认');
  await input(phone).evaluate(el => {
    el.dispatchEvent(new CompositionEvent('compositionstart', {data: '拼音', bubbles: true}));
    el.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true}));
  });
  check('Composition start followed by Enter does not send', await input(phone).inputValue() === '拼音输入未确认' && await phone.locator('.desktop-message-row.user').count() === beforeIme);
  await input(phone).evaluate(el => {
    el.dispatchEvent(new CompositionEvent('compositionend', {data: '拼音', bubbles: true}));
    el.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', code: 'Enter', keyCode: 229, bubbles: true, cancelable: true}));
  });
  check('IME keyCode 229 does not send', await input(phone).inputValue() === '拼音输入未确认' && await phone.locator('.desktop-message-row.user').count() === beforeIme);
  await goList(phone);
  await choose(phone, '宝宝');
  check('Per-conversation draft survives switching', await input(phone).inputValue() === '保留给宝宝的草稿');

  await input(phone).fill('');
  await phone.getByRole('button', {name: '表情', exact: true}).click();
  await phone.getByRole('button', {name: '插入😊', exact: true}).click();
  check('Emoji panel inserts into the current draft', await input(phone).inputValue() === '😊');
  await snapshot(phone, '390-emoji');
  await input(phone).fill('');
  await phone.getByRole('button', {name: '更多功能', exact: true}).click();
  check('Plus panel retains moments, favorites and chat info', await phone.locator('.wx-more-grid button').count() >= 3);
  await snapshot(phone, '390-plus');
  await phone.getByRole('button', {name: '聊天信息与操作', exact: true}).click();
  check('More menu retains rollback and story exit', await phone.getByRole('button', {name: '进入回退模式', exact: true}).isVisible() && await phone.locator('.windows-close-button').isVisible());
  await snapshot(phone, '390-menu');
  await phone.getByRole('button', {name: '关闭聊天信息', exact: true}).click();
  await phone.getByRole('button', {name: '聊天信息与操作', exact: true}).focus();
  const menuFocus = await phone.locator('#wx-chat-actions button').first().evaluate(el => {el.focus(); return {focused: document.activeElement === el, inert: el.closest('#wx-chat-actions').inert};});
  check('Closed more menu cannot receive focus', !menuFocus.focused && menuFocus.inert, menuFocus);

  await input(phone).fill('即时保存草稿');
  await phone.reload();
  await input(phone).waitFor();
  check('Draft survives immediate reload before debounce', await input(phone).inputValue() === '即时保存草稿');

  for (const [name, size] of [['320', {width: 320, height: 568}], ['landscape', {width: 844, height: 390}]]) {
    await phone.setViewportSize(size);
    await phone.waitForTimeout(80);
    const bounds = await geometry(phone);
    check(`${name} chat fits viewport and keeps a useful message area`, bounds.width <= size.width && bounds.composer.bottom <= size.height + 0.5 && bounds.stream.height > 60, bounds);
    await snapshot(phone, `${name}-chat`);
    await phone.getByRole('button', {name: '聊天信息与操作', exact: true}).click();
    await snapshot(phone, `${name}-menu`);
    const menu = await phone.locator('#wx-chat-actions').evaluate(el => {const r = el.getBoundingClientRect(); return {top: r.top, bottom: r.bottom, height: r.height, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, overflowY: getComputedStyle(el).overflowY};});
    check(`${name} more menu is contained and can scroll`, menu.top >= 0 && menu.bottom <= size.height + 0.5 && (menu.scrollHeight <= menu.clientHeight || ['auto', 'scroll'].includes(menu.overflowY)), menu);
    await phone.getByRole('button', {name: '关闭聊天信息', exact: true}).click();
  }
  await phone.setViewportSize({width: 390, height: 844});
  const rapid = [];
  for (let i = 0; i < 8; i++) {
    await goList(phone);
    await phone.waitForTimeout(i % 2 ? 40 : 260);
    rapid.push(await phone.locator('.desktop-chat-list').evaluate(el => {const r = el.getBoundingClientRect(); const hit = document.elementFromPoint(120, 100); return {left: r.left, right: r.right, visibility: getComputedStyle(el).visibility, hitList: el.contains(hit)};}));
    await choose(phone, '宝宝');
  }
  check('Repeated fast list navigation stays visible and interactive', rapid.every(item => item.visibility === 'visible' && item.left < 1 && item.right > 290 && item.hitList), rapid);
  await snapshot(phone, '390-after-rapid-navigation');
  await goList(phone);
  await phone.getByRole('button', {name: '发现', exact: true}).click();
  await phone.locator('.wx-home-content').getByRole('button', {name: '朋友圈', exact: true}).click();
  await phone.locator('.space-mobile-topbar').waitFor();
  await snapshot(phone, '390-moments');
  check('Discover opens the moments story page', /\/space$/.test(new URL(phone.url()).pathname));
  const visitCount = await phone.evaluate(() => JSON.parse(localStorage.getItem('ta-say:original-story:session')).spaceVisitCount);
  check('Entering moments increments visits once', visitCount === 1, visitCount);
  await phone.getByRole('button', {name: '返回聊天', exact: true}).click();
  await input(phone).waitFor();
  const storage = await storedState(phone);

  // Use a new context to seed synthetic history; pagehide in a live page would flush over it.
  const longStorage = {...storage};
  const longUi = JSON.parse(longStorage['ta-say:original-story:chat-ui:v1']);
  longUi.selectedConversationId = 'group';
  longUi.drafts.group = '';
  longUi.conversations.group.messages = Array.from({length: 90}, (_, i) => ({id: `qa-long-${i}`, role: i % 3 === 0 ? 'user' : 'ta', displayedText: `第 ${i + 1} 条历史消息：核对工作群的测试安排，保留阅读位置。`, kind: 'normal', timestamp: Date.now() - (90 - i) * 60000}));
  longStorage['ta-say:original-story:chat-ui:v1'] = JSON.stringify(longUi);
  const history = await open({width: 390, height: 844}, {storage: longStorage});
  check('Long-history fixture loaded the group conversation', (await history.locator('.desktop-chat-header').innerText()).includes(groupName), {groupName, rows: await history.locator('.desktop-message-row').count()});
  await input(history).fill('等待群聊回复');
  await history.locator('.desktop-send-button').click();
  const topBefore = await history.locator('.desktop-chat-stream').evaluate(el => {el.scrollTop = 120; el.dispatchEvent(new Event('scroll', {bubbles: true})); return el.scrollTop;});
  await history.waitForTimeout(900);
  const topAfter = await history.locator('.desktop-chat-stream').evaluate(el => el.scrollTop);
  const newMessageShown = await history.locator('.wx-new-messages').isVisible();
  check('Reply does not steal an older-history scroll position', Math.abs(topAfter - topBefore) < 2, {topBefore, topAfter});
  check('Reply while reading history offers a new-message button', newMessageShown);
  await snapshot(history, '390-history');
  if (newMessageShown) {
    await history.locator('.wx-new-messages').click();
    await history.waitForFunction(() => {const el = document.querySelector('.desktop-chat-stream'); return el.scrollHeight - el.scrollTop - el.clientHeight < 3;}, null, {timeout: 4000}).catch(() => {});
    const bottomGap = await history.locator('.desktop-chat-stream').evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight);
    check('New-message button scrolls to latest reply', bottomGap < 3, bottomGap);
  }
  await history.locator('.desktop-chat-stream').evaluate(el => {el.scrollTo({top: 420, behavior: 'instant'}); el.dispatchEvent(new Event('scroll', {bubbles: true}));});
  await history.waitForTimeout(80);
  const savedTop = await history.locator('.desktop-chat-stream').evaluate(el => el.scrollTop);
  await goList(history);
  await choose(history, '宝宝');
  await goList(history);
  await choose(history, groupName);
  await history.waitForTimeout(280);
  const restoredTop = await history.locator('.desktop-chat-stream').evaluate(el => el.scrollTop);
  check('Switching away and back preserves the reading position', Math.abs(restoredTop - savedTop) < 2, {savedTop, restoredTop});
  await goList(history);
  await choose(history, groupName);
  await history.waitForTimeout(280);
  const sameConversationTop = await history.locator('.desktop-chat-stream').evaluate(el => el.scrollTop);
  check('Returning from list to the same conversation preserves history position', Math.abs(sameConversationTop - savedTop) < 2, {savedTop, sameConversationTop});
  await input(history).fill('离开会话后等待回复');
  await history.locator('.desktop-send-button').click();
  await goList(history);
  await history.waitForTimeout(900);
  const groupItem = history.locator('.desktop-conversation-item').filter({has: history.locator('strong', {hasText: groupName})});
  check('Reply received on the list stays unread', await groupItem.locator('.desktop-conversation-unread-dot').count() === 1);
  await choose(history, groupName);
  check('Opening the conversation clears its unread marker', await groupItem.locator('.desktop-conversation-unread-dot').count() === 0);
  const exitCount = await history.evaluate(() => JSON.parse(localStorage.getItem('ta-say:original-story:session')).exitClickCount);
  check('Normal list navigation does not trigger the story exit action', exitCount === 0, exitCount);

  await input(history).fill('键盘缩小视口时继续输入');
  await history.setViewportSize({width: 390, height: 520});
  await history.waitForTimeout(100);
  const keyboardBounds = await geometry(history);
  check('Reduced visual area retains the composer and draft', keyboardBounds.composer.bottom <= 520.5 && keyboardBounds.stream.height > 60 && await input(history).inputValue() === '键盘缩小视口时继续输入', keyboardBounds);
  await snapshot(history, '390-keyboard-sized-viewport');

  const lateStorage = {...storage};
  const lateSession = JSON.parse(lateStorage['ta-say:original-story:session']);
  lateSession.stage = 'location_reveal';
  lateSession.chatHistory.push({id: 'qa-location', role: 'ta', displayedText: '你想知道我在哪里，对吗？', kind: 'location_notice', timestamp: Date.now()});
  lateStorage['ta-say:original-story:session'] = JSON.stringify(lateSession);
  const lateUi = JSON.parse(lateStorage['ta-say:original-story:chat-ui:v1']);
  lateUi.selectedConversationId = 'z'; lateUi.drafts.z = '';
  lateStorage['ta-say:original-story:chat-ui:v1'] = JSON.stringify(lateUi);
  const late = await open({width: 390, height: 844}, {storage: lateStorage});
  check('Location story stage disables free text', await input(late).isDisabled());
  await late.getByRole('button', {name: '更多功能', exact: true}).click();
  check('Location story stage retains plus-panel location entry', await late.locator('.wx-more-grid').getByRole('button', {name: '位置', exact: true}).isVisible());
  await snapshot(late, '390-location-stage');
  await late.locator('.wx-more-grid').getByRole('button', {name: '位置', exact: true}).click();
  check('Location entry reaches the location story page', /\/location$/.test(new URL(late.url()).pathname));
  await snapshot(late, '390-location');

  const desktop = await open({width: 1280, height: 900}, {mobile: false});
  check('Desktop retains list and chat without phone navigation', await desktop.locator('.desktop-chat-list').isVisible() && await desktop.locator('.desktop-chat-main').isVisible() && !await desktop.locator('.wx-back').isVisible() && !await desktop.locator('.wx-tabbar').isVisible());
  await snapshot(desktop, 'desktop');
  }
} catch (error) {
  failures.push({name: 'QA execution', passed: false, detail: error.message});
  console.error(error.stack || error);
  if (activePage && !activePage.isClosed()) await activePage.screenshot({path: path.join(out, 'qa-execution-failure.png')}).catch(() => {});
} finally {
  check('No browser runtime errors', errors.length === 0, errors);
  const report = {passed: failures.length === 0, focus, loadedBundles: [...loadedBundles], browser: browser.version(), checks, failures, errors, blockedRequests,
    scope: 'Isolated local browser contexts with all /api/ requests blocked. No real model calls or server-data writes.',
    limitation: 'Real desktop Chrome with mobile viewport/touch emulation. Hardware iOS/Android keyboards and OS Chinese IME were not exercised.'};
  const reportName = focus === 'unread' ? 'qa-unread-report.json' : 'qa-report.json';
  await writeFile(path.join(out, reportName), JSON.stringify(report, null, 2));
  await browser.close();
  console.log(`Report: ${path.join(out, reportName)}`);
  if (!report.passed) process.exitCode = 1;
}
