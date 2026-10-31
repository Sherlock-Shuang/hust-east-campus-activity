import { SCRIPT } from './operator-cue-data.js';

const STORAGE_KEY = 'hust-activity-script-edits-v1';
const ROLES = { host: '我说的话', codex: 'Codex 回复', announcement: '校园公告', direction: '舞台提示' };
const MAX_TEXT = 16000;
const knownIds = new Set(SCRIPT.entries.map(entry => entry.id));

export function validateEdits(value) {
  if (!value || value.version !== SCRIPT.version || typeof value.edits !== 'object' || !value.edits || Array.isArray(value.edits)) throw new Error('台词文件格式不正确');
  const edits = Object.create(null);
  for (const [id, text] of Object.entries(value.edits)) {
    if (!knownIds.has(id) || typeof text !== 'string' || text.length > MAX_TEXT) throw new Error('台词文件包含无效内容');
    edits[id] = text;
  }
  return edits;
}

export function createCueStore(storage) {
  let edits = Object.create(null), warning = '';
  const read = () => {
    if (!storage) throw new Error('storage unavailable');
    const value = storage.getItem(STORAGE_KEY);
    return value === null ? Object.create(null) : validateEdits(JSON.parse(value));
  };
  try { edits = read(); } catch { warning = '无法读取已保存的修改，当前显示剧本原文。'; }
  function commit(next) {
    edits = next;
    try {
      if (!storage) throw new Error('storage unavailable');
      storage.setItem(STORAGE_KEY, JSON.stringify({ version: SCRIPT.version, edits }));
      warning = '';
      return true;
    } catch { warning = '修改暂未保存，请导出备份后再离开页面。'; return false; }
  }
  return {
    get warning() { return warning; },
    entries() { return SCRIPT.entries.map(entry => ({ ...entry, text: edits[entry.id] ?? entry.text, edited: Object.hasOwn(edits, entry.id) })); },
    set(id, text) {
      if (!knownIds.has(id) || typeof text !== 'string' || text.length > MAX_TEXT) throw new Error('台词内容无效');
      // Merge other tabs' edits before saving, without discarding this tab's unsaved work.
      let latest = {}; try { latest = read(); } catch {}
      const next = { ...edits, ...latest };
      if (text === SCRIPT.entries.find(entry => entry.id === id).text) delete next[id]; else next[id] = text;
      return commit(next);
    },
    export() { return { version: SCRIPT.version, source: SCRIPT.source, edits: { ...edits } }; },
    import(value) { return commit({ ...edits, ...validateEdits(value) }); },
  };
}

export function filterCues(entries, { role = '', chapter = '', query = '' } = {}) {
  const search = query.trim().toLocaleLowerCase();
  return entries.filter(entry => (!role || entry.role === role) && (!chapter || entry.chapter === chapter) && (!search || `${entry.text}\n${entry.chapter}\n${ROLES[entry.role]}`.toLocaleLowerCase().includes(search)));
}

export function mountCueSidebar({ host, toggle, onUse, actionRole, actionLabel }) {
  if (!host || !toggle) return;
  let storage; try { storage = window.localStorage; } catch {}
  const store = createCueStore(storage);
  const make = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const button = (label, handler, cls = '') => {
    const node = make('button', cls, label); node.type = 'button'; node.addEventListener('click', handler); return node;
  };
  host.classList.add('cue-sidebar');
  host.setAttribute('aria-label', '活动台词');
  const heading = make('div', 'cue-heading'), headingCopy = make('div');
  const title = make('h2', '', '活动台词'); title.id = 'cue-title';
  headingCopy.append(make('p', 'cue-eyebrow', 'AI竟可以这么玩！'), title);
  heading.append(headingCopy, button('收起', () => setOpen(false), 'cue-close'));
  const filters = make('div', 'cue-filters');
  const search = make('input'); search.type = 'search'; search.placeholder = '搜索台词'; search.setAttribute('aria-label', '搜索台词');
  const chapter = make('select'); chapter.setAttribute('aria-label', '剧本环节');
  for (const [value, label] of [['', '全部环节'], ...[...new Set(SCRIPT.entries.map(entry => entry.chapter))].map(value => [value, value])]) {
    const option = make('option', '', label); option.value = value; chapter.append(option);
  }
  const roles = make('select', 'cue-roles'); roles.setAttribute('aria-label', '台词类型');
  for (const [value, label] of [['', '全部台词与提示'], ...Object.entries(ROLES)]) {
    const option = make('option', '', label); option.value = value; roles.append(option);
  }
  roles.addEventListener('change', render);
  filters.append(search, chapter, roles);
  const summary = make('p', 'cue-summary'), list = make('div', 'cue-list');
  const status = make('p', 'cue-status', store.warning || '文字可直接编辑 · 修改保存在当前浏览器');
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const footer = make('footer', 'cue-footer'), tools = make('div', 'cue-tools');
  const importInput = make('input'); importInput.type = 'file'; importInput.accept = '.json,application/json'; importInput.hidden = true;
  tools.append(button('导出修改', () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(store.export(), null, 2)], { type: 'application/json' }));
    const link = make('a'); link.href = url; link.download = 'AI活动台词修改.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    announce('已导出修改，可在另一个后台导入。');
  }), button('导入修改', () => importInput.click()), importInput);
  footer.append(status, tools);
  host.replaceChildren(heading, filters, summary, list, footer);
  const scrim = button('关闭台词栏', () => setOpen(false), 'cue-scrim'); scrim.tabIndex = -1; scrim.hidden = true; host.before(scrim);

  function announce(message, error = false) { status.textContent = message; status.dataset.error = String(error); }
  function sizeInput(input) { input.style.height = 'auto'; input.style.height = `${Math.max(44, input.scrollHeight)}px`; }
  function setOpen(open) {
    host.hidden = !open; toggle.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('cue-sidebar-open', open);
    scrim.hidden = !open;
    if (open) requestAnimationFrame(() => host.querySelectorAll('textarea').forEach(sizeInput));
    else if (host.contains(document.activeElement)) toggle.focus();
  }
  async function copy(text) {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else throw new Error('clipboard unavailable');
    } catch {
      const previous = document.activeElement, selection = previous?.selectionStart, end = previous?.selectionEnd;
      const fallback = make('textarea', 'cue-copy-buffer'); fallback.value = text; document.body.append(fallback); fallback.select();
      let copied = false; try { copied = document.execCommand('copy'); } finally { fallback.remove(); previous?.focus(); if (typeof selection === 'number') previous.setSelectionRange(selection, end); }
      if (!copied) throw new Error('复制失败，请选中文字手动复制。');
    }
  }
  function render() {
    const entries = filterCues(store.entries(), { role: roles.value, chapter: chapter.value, query: search.value });
    summary.textContent = `显示 ${entries.length} / ${SCRIPT.entries.length} 条 · 按剧本顺序`;
    list.replaceChildren();
    let previousChapter = '';
    for (const entry of entries) {
      if (entry.chapter !== previousChapter) { list.append(make('h3', 'cue-chapter', entry.chapter)); previousChapter = entry.chapter; }
      const card = make('article', 'cue-card'); card.dataset.cueId = entry.id; card.dataset.role = entry.role;
      const meta = make('div', 'cue-meta'), edited = make('span', 'cue-edited', '已修改'); edited.hidden = !entry.edited;
      meta.append(make('span', 'cue-number', entry.id.slice(5)), make('strong', 'cue-role', ROLES[entry.role]), edited);
      const input = make('textarea', 'cue-text'); input.value = entry.text; input.rows = 2; input.maxLength = MAX_TEXT;
      input.spellcheck = false; input.setAttribute('aria-label', `编辑第 ${entry.id.slice(5)} 条${ROLES[entry.role]}`);
      const actions = make('div', 'cue-actions');
      actions.append(button('复制', async () => {
        try { await copy(input.value); announce(`已复制第 ${entry.id.slice(5)} 条${ROLES[entry.role]}。`); }
        catch (error) { announce(error.message, true); }
      }));
      if (entry.role === actionRole && onUse) actions.append(button(actionLabel, () => {
        try {
          if (!input.value.trim()) throw new Error('这条台词为空，请先填写内容。');
          announce(onUse(input.value, entry) || '已填入，请核对后发送。');
          if (matchMedia('(max-width: 760px)').matches) setOpen(false);
        } catch (error) { announce(error.message, true); }
      }, 'cue-use'));
      const reset = button('恢复原文', () => {
        input.value = SCRIPT.entries.find(item => item.id === entry.id).text;
        persist(); sizeInput(input);
      }, 'cue-reset'); reset.hidden = !entry.edited; actions.append(reset);
      function persist() {
        const saved = store.set(entry.id, input.value), changed = input.value !== SCRIPT.entries.find(item => item.id === entry.id).text;
        edited.hidden = reset.hidden = !changed;
        announce(saved ? '已自动保存 · 仅当前浏览器，可导出到另一个后台' : store.warning, !saved);
      }
      input.addEventListener('input', () => { persist(); sizeInput(input); });
      card.append(meta, input, actions); list.append(card);
    }
    if (!entries.length) list.append(make('p', 'cue-no-results', '没有匹配的台词，试试其他关键词或环节。'));
    list.scrollTop = 0;
    requestAnimationFrame(() => list.querySelectorAll('textarea').forEach(sizeInput));
  }
  importInput.addEventListener('change', async () => {
    const file = importInput.files?.[0]; if (!file) return;
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('文件过大，请选择导出的台词 JSON 文件。');
      const value = JSON.parse(await file.text());
      const saved = store.import(value); render(); announce(saved ? '修改已合并导入并保存在当前浏览器。' : store.warning, !saved);
    } catch (error) { announce(`未导入：${error.message}`, true); }
    importInput.value = '';
  });
  search.addEventListener('input', render); chapter.addEventListener('change', render);
  toggle.setAttribute('aria-controls', host.id); toggle.addEventListener('click', () => setOpen(host.hidden));
  host.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); toggle.focus(); } });
  const resize = () => requestAnimationFrame(() => host.querySelectorAll('textarea').forEach(sizeInput));
  window.addEventListener('resize', resize);
  render(); setOpen(!matchMedia('(max-width: 1100px)').matches);
  return { store, setOpen, resize };
}
