// Run after building tasay and starting the local campus server.
// Each case uses an isolated browser context and blocks every API request.
// BASE_URL, QA_OUTPUT_DIR, PLAYWRIGHT_MODULE, CHROME_EXECUTABLE are optional.
import {access, mkdir, writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const origin = (process.env.BASE_URL || 'http://127.0.0.1:5178').replace(/\/$/, '');
const output = process.env.QA_OUTPUT_DIR || path.join(root, 'artifacts/tasay-unlock-2026-10-29/browser');
const exists = async file => access(file).then(() => true, () => false);
const bundledPlaywright = path.join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || (await exists(bundledPlaywright) ? pathToFileURL(bundledPlaywright).href : 'playwright'));
const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const executablePath = process.env.CHROME_EXECUTABLE || (await exists(macChrome) ? macChrome : undefined);
const browser = await chromium.launch({headless: true, ...(executablePath ? {executablePath} : {})});
await mkdir(output, {recursive: true});
const checks = [], errors = [], blockedRequests = [], bundles = new Set();
const legacySave = JSON.stringify({version: 2, hasFinishedGame: true, autoSaveSnapshot: {stage: 'qa-legacy-not-restored'}, metaMemory: ['qa-legacy-not-restored']});
const check = (name, passed, detail) => {
  const result = {name, passed: Boolean(passed), ...(detail === undefined ? {} : {detail})};
  checks.push(result);
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`);
};
const screenshot = (page, name) => page.screenshot({path: path.join(output, `${name}.png`)});
const entryName = '她不一样 · 恋情分析室';

async function openContext(viewport, mobile, legacy = legacySave) {
  const context = await browser.newContext({viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1});
  await context.route('**/api/**', route => {
    blockedRequests.push({url: route.request().url(), method: route.request().method()});
    return route.abort('blockedbyclient');
  });
  if (legacy !== null) await context.addInitScript(value => localStorage.setItem('ta-say:persisted', value), legacy);
  const page = await context.newPage();
  page.setDefaultTimeout(7000);
  page.on('pageerror', error => errors.push({viewport, error: error.message}));
  await page.goto(`${origin}/works/tasay/chat`);
  await page.locator('.desktop-chat-input').waitFor({state: 'attached'});
  for (const src of await page.locator('script[src]').evaluateAll(nodes => nodes.map(node => node.src))) bundles.add(src);
  return {context, page};
}

async function layoutCase(label, viewport, mobile) {
  const {context, page} = await openContext(viewport, mobile);
  try {
    const initial = await page.evaluate(() => ({legacy: localStorage.getItem('ta-say:persisted'), marker: localStorage.getItem('ta-say:she-love-me:completed'), original: JSON.parse(localStorage.getItem('ta-say:original-story:persisted') || 'null')}));
    check(`${label}: legacy completion does not rewrite or restore old story`, initial.legacy === legacySave && initial.marker === 'true' && !initial.original?.hasFinishedGame && !initial.original?.metaMemory?.includes('qa-legacy-not-restored'), initial);
    check(`${label}: document fits before opening`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if (mobile) await page.getByRole('button', {name: '聊天信息与操作', exact: true}).click();
    const entry = page.locator('#wx-chat-actions').getByRole('button', {name: entryName, exact: true});
    await entry.focus();
    const chatTop = await page.locator('.desktop-chat-stream').evaluate(node => node.scrollTop);
    const bodyOverflow = await page.evaluate(() => document.body.style.overflow);
    await entry.click();
    const dialog = page.getByRole('dialog', {name: '她不一样', exact: true});
    await dialog.waitFor({state: 'visible'});
    const geometry = await dialog.evaluate(node => {
      const r = node.getBoundingClientRect();
      return {viewport: {width: innerWidth, height: innerHeight}, documentWidth: document.documentElement.scrollWidth, x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height, clientWidth: node.clientWidth, scrollWidth: node.scrollWidth, scrollHeight: node.scrollHeight, clientHeight: node.clientHeight, overflow: getComputedStyle(node).overflowY, modal: node.matches(':modal'), bodyOverflow: document.body.style.overflow, focused: document.activeElement?.getAttribute('aria-label')};
    });
    check(`${label}: native modal fits viewport without horizontal overflow`, geometry.modal && geometry.documentWidth <= viewport.width && geometry.scrollWidth <= geometry.clientWidth && geometry.x >= -0.5 && geometry.y >= -0.5 && geometry.right <= viewport.width + 0.5 && geometry.bottom <= viewport.height + 0.5, geometry);
    check(`${label}: opening focuses close and locks background scroll`, geometry.focused === '返回聊天' && geometry.bodyOverflow === 'hidden');
    await screenshot(page, `${label}-project-top`);

    const focusSequence = [];
    for (let index = 0; index < 15; index++) {
      await page.keyboard.press(index % 4 === 0 ? 'Shift+Tab' : 'Tab');
      focusSequence.push(await dialog.evaluate(node => ({inside: node.contains(document.activeElement), pageHasFocus: document.hasFocus(), tag: document.activeElement?.tagName, label: document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent?.slice(0, 30)})));
    }
    // Native dialogs allow browser-toolbar focus. Chrome reports BODY as activeElement
    // while document.hasFocus() is false; this must not be mistaken for background focus.
    check(`${label}: native Tab and Shift+Tab never focus background content`, focusSequence.every(state => state.inside || (!state.pageHasFocus && state.tag === 'BODY')), focusSequence);
    const externalFocusBlocked = await page.locator('.desktop-chat-input').evaluate(node => { node.focus(); return document.querySelector('dialog').contains(document.activeElement); });
    check(`${label}: background input cannot receive programmatic focus`, externalFocusBlocked);

    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {writeText: async () => {throw new DOMException('QA denied', 'NotAllowedError');}}}));
    await dialog.getByRole('button', {name: '复制给 AI 的指令', exact: true}).click();
    await dialog.getByRole('status').filter({hasText: '已选中'}).waitFor();
    const selection = await dialog.locator('textarea').evaluate(node => ({focused: document.activeElement === node, readOnly: node.readOnly, start: node.selectionStart, end: node.selectionEnd, length: node.value.length, fontSize: parseFloat(getComputedStyle(node).fontSize), clientWidth: node.clientWidth, scrollWidth: node.scrollWidth, text: node.value}));
    check(`${label}: denied clipboard selects complete readable instruction`, selection.focused && selection.readOnly && selection.start === 0 && selection.end === selection.length && selection.scrollWidth <= selection.clientWidth && selection.fontSize >= (viewport.width <= 640 ? 16 : 14) && selection.text.includes('https://github.com/863401402/she-love-me'), selection);
    check(`${label}: project has no upload or online analysis form`, await dialog.locator('input[type=file], form').count() === 0);
    const links = await dialog.locator('a').evaluateAll(nodes => nodes.map(node => ({href: node.href, target: node.target, rel: node.rel})));
    check(`${label}: project links point to GitHub with safe new-tab attributes`, links.length >= 2 && links.every(link => link.href.startsWith('https://github.com/863401402/she-love-me') && link.target === '_blank' && link.rel.includes('noopener') && link.rel.includes('noreferrer')), links);
    await dialog.evaluate(node => {node.scrollTop = node.scrollHeight;});
    await screenshot(page, `${label}-project-instructions`);
    const footer = await dialog.locator('footer').boundingBox();
    check(`${label}: dialog scroll reaches license/footer`, footer && footer.y >= -1 && footer.y + footer.height <= viewport.height + 1, footer);
    await page.keyboard.press('Escape');
    await dialog.waitFor({state: 'detached'});
    const closed = await entry.evaluate(node => ({focusReturned: document.activeElement === node, bodyOverflow: document.body.style.overflow, menuExpanded: document.querySelector('[aria-label="聊天信息与操作"]')?.getAttribute('aria-expanded'), scrollTop: document.querySelector('.desktop-chat-stream').scrollTop}));
    check(`${label}: Escape restores opener, background scroll and chat position`, closed.focusReturned && closed.bodyOverflow === bodyOverflow && closed.scrollTop === chatTop && (!mobile || closed.menuExpanded === 'true'), closed);
    await screenshot(page, `${label}-returned`);

    await entry.click();
    await dialog.getByRole('button', {name: '返回聊天', exact: true}).click();
    await dialog.waitFor({state: 'detached'});
    check(`${label}: visible return button restores opener`, await entry.evaluate(node => document.activeElement === node));
    await page.reload();
    await page.locator('.desktop-chat-input').waitFor({state: 'attached'});
    if (mobile) await page.getByRole('button', {name: '聊天信息与操作', exact: true}).click();
    check(`${label}: refresh retains unlocked entry`, await entry.isVisible());
    if (mobile) {
      await page.getByRole('button', {name: '关闭聊天信息', exact: true}).click();
      await page.getByRole('button', {name: '返回会话列表', exact: true}).click();
      for (const tab of ['发现', '我']) {
        await page.getByRole('button', {name: tab, exact: true}).click();
        const homeEntry = page.locator('.wx-home-content').getByRole('button', {name: entryName});
        check(`${label}: ${tab} exposes completion entry`, await homeEntry.isVisible());
        await homeEntry.click();
        await dialog.getByRole('button', {name: '返回聊天', exact: true}).click();
        check(`${label}: ${tab} entry gets focus back`, await homeEntry.evaluate(node => document.activeElement === node));
      }
      await screenshot(page, `${label}-me-entry`);
      check(`${label}: home entry does not cause horizontal overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
  } catch (error) {
    check(`${label}: browser scenario completed`, false, error.stack || error.message);
    await screenshot(page, `${label}-failure`).catch(() => {});
  } finally {
    await context.close();
  }
}

try {
  for (const [label, viewport, mobile] of [
    ['320x568', {width: 320, height: 568}, true],
    ['390x844', {width: 390, height: 844}, true],
    ['844x390', {width: 844, height: 390}, true],
    ['1440x960', {width: 1440, height: 960}, false],
  ]) await layoutCase(label, viewport, mobile);
  for (const [label, legacy] of [['new-player', null], ['missing-version', '{"hasFinishedGame":true}'], ['wrong-version', '{"version":3,"hasFinishedGame":true}'], ['nonboolean-completion', '{"version":2,"hasFinishedGame":"true"}']]) {
    const {context, page} = await openContext({width: 390, height: 844}, true, legacy);
    try { check(`${label}: no project entry is rendered`, await page.getByRole('button', {name: entryName, exact: true, includeHidden: true}).count() === 0); }
    finally { await context.close(); }
  }
  check('No browser runtime errors', errors.length === 0, errors);
} finally {
  await browser.close();
  const failed = checks.filter(result => !result.passed);
  await writeFile(path.join(output, 'browser-verification.json'), JSON.stringify({passed: failed.length === 0, checks, errors, blockedRequests, bundles: [...bundles], scope: 'Isolated local browser contexts, legacy completion fixtures only; every API request intercepted; no user chat files or production writes.'}, null, 2));
  if (failed.length) process.exitCode = 1;
}
