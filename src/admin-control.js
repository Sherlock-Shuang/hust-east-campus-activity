import './admin-control.css';
import { geoToLocal } from './geospatial.js';
import { createLiveMapFrame, getLiveLocationPresets } from './live-locations.js';
import { ACTIVITY_PHASES, ACTIVITY_WORKS, activityPortals, getTasayPortal, isTasayLinkedPortal, SHE_LOVE_POINT_ID } from './activity-catalog.js';
import { readAdminCoordinates, bindAdminCoordinateInputs } from './admin-coordinates.js';
import { activitySelectionSignature, selectActivitiesNow } from './activity-launch.js';

const $ = id => document.getElementById(id);
let csrfToken = '', snapshot = null, busy = false, loggedIn = false, serverOffset = 0;
let presets = [], mapReady = false, mapView = null, defaultMapView = null, pollInFlight = false;
let pauseMessageDirty = false, pauseMessageBase = '';
let phaseDirty=false, phaseBase='', audienceData=null, audiencePending=false, selectedAudienceId=null, selectedAudience=null, detailLimit=100, searchTimer, detailRequest=0;
let launchDirty=false, launchBase='', launchSelection=new Set();
let skyQrReady = false;
const defaultPauseMessage = '请稍候，活动即将继续';
let selection = { x: 58.2, z: 17.6, label: '东九 B/C 前场' };
const NS = 'http://www.w3.org/2000/svg';
const now = () => Date.now() + serverOffset;
const id = prefix => `${prefix}-${crypto.randomUUID()}`;
const clone = value => structuredClone(value);
const dateLabel = value => new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(value);
function toLocalInput(value) {
  if (!value) return '';
  const d = new Date(value);
  return new Date(value - d.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
}
function eventStatus(item) {
  if (!item || item.enabled === false) return { text: '已关闭', type: 'off' };
  if (item.startAt != null && item.startAt > now()) return { text: '等待开始', type: 'scheduled' };
  if (item.endAt != null && item.endAt <= now()) return { text: '已结束', type: 'off' };
  return { text: '正在显示', type: 'active' };
}
function schedule(prefix) {
  const read = suffix => {
    const input = $(`${prefix}-${suffix}`);
    if (!input.value) return null;
    const value = new Date(input.value).getTime();
    if (!Number.isFinite(value)) throw new Error('请填写有效的日期和时间。');
    return value;
  };
  const startAt = read('start'), endAt = read('end');
  if (endAt != null && endAt <= (startAt ?? now())) throw new Error('结束时间需要晚于开始时间；立即发布时，结束时间需要在当前时间之后。');
  return { startAt, endAt };
}
function showNotice(message, error = false) {
  const el = $('admin-notice'); el.textContent = message; el.dataset.error = String(error); el.hidden = false;
}
function connection(online) {
  const el = $('connection-state'); el.dataset.status = online ? 'online' : 'offline';
  el.replaceChildren(); el.append(document.createElement('i'), document.createTextNode(online ? '控制服务已连接' : '连接中断 · 正在重试'));
}
function setBusy(value) {
  busy = value;
  document.querySelectorAll('#dashboard button, #dashboard input, #dashboard textarea, #dashboard select').forEach(el => { el.disabled = value; });
  renderSkyQr();renderActivityChoices();syncLinkedPortalControls();
}
function renderSkyQr() {
  const ready = loggedIn && skyQrReady && Boolean(snapshot);
  const visible = ready && snapshot.state.skyQrVisible === true;
  $('sky-qr-status').textContent = ready ? (visible ? '已显示' : '已收起') : '等待同步';
  $('sky-qr-status').dataset.status = visible ? 'active' : 'off';
  $('show-sky-qr').disabled = busy || !ready || visible;
  $('hide-sky-qr').disabled = busy || !ready || !visible;
}
async function request(path, options = {}) {
  const headers = { ...options.headers };
  if (options.body) headers['Content-Type'] = 'application/json';
  if (csrfToken && options.method && options.method !== 'GET') headers['X-CSRF-Token'] = csrfToken;
  let response;
  try { response = await fetch(path, { ...options, headers, credentials: 'same-origin', cache: 'no-store' }); }
  catch { connection(false); throw new Error('无法连接控制服务，请检查服务是否启动。'); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && path !== '/api/admin/login') showLogin('登录已过期，请重新输入管理员密码。');
    if (response.status === 409) {
      if (data.state) applySnapshot(data);
      else if (data.snapshot) applySnapshot(data.snapshot);
      throw new Error('另一位管理员刚更新了活动。本次修改未保存，请检查最新状态后重试。');
    }
    throw new Error(typeof data.error === 'string' ? data.error : data.message || '操作未成功，请稍后重试。');
  }
  return data;
}
function showLogin(message = '') {
  loggedIn = false; csrfToken = ''; $('dashboard').hidden = true; $('login-screen').hidden = false;
  skyQrReady = false; renderSkyQr();
  launchDirty=false;launchBase='';launchSelection.clear();delete $('activity-choices').dataset.signature;
  audienceData=null;selectedAudienceId=null;selectedAudience=null;detailRequest++;$('audience-list').replaceChildren();$('audience-detail').replaceChildren();delete $('audience-list').dataset.signature;delete $('audience-detail').dataset.signature;
  $('login-error').textContent = message;
}
function showDashboard() {
  loggedIn = true; $('login-screen').hidden = true; $('dashboard').hidden = false;
  skyQrReady = false; renderSkyQr();
  $('admin-password').value = '';
}
function applySnapshot(data) {
  if (!data?.state) return;
  if (snapshot && data.state.revision < snapshot.state.revision) return;
  snapshot = data;
  skyQrReady = loggedIn;
  syncPauseMessage();
  if (Number.isFinite(data.serverTime)) serverOffset = data.serverTime - Date.now();
  connection(true);
  $('online-count').textContent = String(data.onlineAudienceCount ?? audienceData?.summary?.onlineParticipants ?? '—');
  $('last-sync').textContent = `最近同步 ${dateLabel(Date.now())}`;
  renderState();
}
async function refresh() {
  if (!loggedIn || pollInFlight || busy) return;
  pollInFlight = true;
  try { const [live]=await Promise.all([request('/api/live/state'),refreshAudience()]);applySnapshot(live); }
  catch { connection(false); }
  finally { pollInFlight = false; }
}
async function mutate(change, message) {
  if (busy || !loggedIn) return;
  setBusy(true);
  try {
    const current = await request('/api/live/state');
    applySnapshot(current);
    const next = clone(current.state);
    change(next);
    const saved = await request('/api/admin/state', { method: 'PUT', body: JSON.stringify({ state: next, expectedRevision: current.state.revision }) });
    applySnapshot(saved); showNotice(message);
    return true;
  } catch (error) { showNotice(error.message, true); return false; }
  finally { setBusy(false); }
}
function renderState() {
  if (!snapshot) return;
  const state = snapshot.state;
  renderSkyQr();
  syncPhase();
  document.querySelector('.session-bar').dataset.paused = String(state.paused);
  $('session-title').textContent = state.paused ? '全场已暂停' : `当前阶段 · ${state.phase?.label||'自由探索'}`;
  $('session-description').textContent = state.paused ? state.pauseMessage || '请稍候，活动即将继续' : state.phase?.guidance||'玩家可以自由行动，公告和地图事件持续同步。';
  $('toggle-pause').textContent = state.paused ? '恢复全体玩家' : '暂停全体玩家';
  $('toggle-pause').dataset.paused = String(state.paused);
  $('marker-count').textContent = String(state.markers.length);
  $('portal-count').textContent = String(state.portals.filter(portal=>eventStatus(portal).type==='active').length);
  const status = state.announcement ? eventStatus(state.announcement) : { text: '暂无公告', type: 'off' };
  $('announcement-status').textContent = status.text; $('announcement-status').dataset.status = status.type;
  const announcement = state.announcement;
  $('announcement-timing').textContent = announcement ? `${announcement.startAt ? dateLabel(announcement.startAt) : '立即'} → ${announcement.endAt ? dateLabel(announcement.endAt) : '持续显示'}` : '';
  renderActivityChoices();renderObjects('marker', state.markers); renderObjects('portal', state.portals);syncLinkedPortalControls();renderPins();
}
function renderActivityChoices() {
  if (!snapshot) return;
  const portals=snapshot.state.portals,host=$('activity-choices');
  if (!launchDirty) {
    launchBase=activitySelectionSignature(portals);
    launchSelection=new Set(portals.filter(portal=>portal.enabled&&!isTasayLinkedPortal(portal)).map(portal=>portal.id));
  }
  const active=portals.filter(portal=>eventStatus(portal).type==='active');
  $('activity-launch-status').textContent=active.length?`${active.length} 个活动开放中`:'等待主持人开启';
  $('activity-launch-status').dataset.status=active.length?'active':'off';
  const signature=JSON.stringify([portals.map(portal=>[portal.id,portal.label,portal.description,eventStatus(portal).type]),[...launchSelection],busy]);
  if (host.dataset.signature!==signature) {
    host.dataset.signature=signature;host.replaceChildren();
    if (!portals.length) host.append(element('p','尚无活动点位，请先载入下方的作品点位，或添加自定义作品。','empty-list'));
    for (const portal of portals) {
      const row=element('label',null,'activity-choice'),input=document.createElement('input');
      const linked=isTasayLinkedPortal(portal),master=getTasayPortal(portals);
      input.type='checkbox';input.value=portal.id;input.checked=launchSelection.has(linked?master?.id:portal.id);input.disabled=busy||linked;
      if(linked)input.dataset.tasayLinkedControl='true';
      input.setAttribute('aria-label',`选择${portal.label}`);
      const info=element('span',null,'activity-choice-copy');
      info.append(element('strong',portal.label),element('small',linked?'随过拟合恋人同步开放与定时；无需通关，可独立前往爱因斯坦广场。':portal.description||'靠近地图光柱后进入体验'));
      const status=eventStatus(portal),pill=element('span',status.type==='active'?'光柱已亮 · 可进入':status.text,'status-pill');pill.dataset.status=status.type;
      input.addEventListener('change',()=>{
        if(linked)return;
        launchDirty=true;if(input.checked)launchSelection.add(portal.id);else launchSelection.delete(portal.id);
        renderActivityChoices();
      });
      row.append(input,info,pill);host.append(row);
    }
  }
  $('activity-selection-note').textContent=launchDirty?'选择尚未发布。点击“开启所选活动”后，所选光柱与入口一起开启，其余活动关闭。':'可多选。勾选只编辑草稿，发布后才影响观众；开启立即生效。';
  if(getTasayPortal(portals)&&!portals.some(portal=>portal.id===SHE_LOVE_POINT_ID))$('activity-selection-note').textContent+=' 联动点位尚未补齐；请为它留出一个入口名额，并避免占用 point-she-love-me 标识。';
}
function launchActivities(selectedIds, message) {
  const baseline=launchBase;
  return mutate(state=>{
    if(activitySelectionSignature(state.portals)!==baseline)throw new Error('活动开放状态或地点已被其他管理员更新。请点击“同步当前选择”后重新选择。');
    state.portals=selectActivitiesNow(state.portals,selectedIds);
  },message).then(ok=>{if(ok){launchDirty=false;renderActivityChoices();}});
}
function renderObjects(type, items) {
  const list = $(`${type}-list`);
  const signature = JSON.stringify(items.map(item => [item, eventStatus(item).type]));
  if (list.dataset.signature === signature) return;
  list.dataset.signature = signature; list.replaceChildren();
  if (!items.length) {
    const el = document.createElement('p'); el.className = 'empty-list'; el.textContent = type === 'marker' ? '还没有光柱。选一个地点，为大家留下清晰的方向。' : '还没有入口。添加一个程序地址，安排它在校园里开放。'; list.append(el); return;
  }
  for (const item of items) {
    const row = document.createElement('div'); row.className = 'object-row';
    const swatch = document.createElement('span'); swatch.className = 'object-swatch'; swatch.style.backgroundColor = type === 'marker' ? item.color : '#b49b6b';
    const info = document.createElement('div'); info.className = 'object-info';
    const title = document.createElement('strong'); title.textContent = item.label;
    const note = document.createElement('small'); const status = eventStatus(item);
    const linked=type==='portal'&&isTasayLinkedPortal(item);
    note.textContent = `${linked?'随过拟合恋人 · ':''}${status.text} · X ${item.x.toFixed(1)} / Z ${item.z.toFixed(1)}${item.startAt ? ` · ${dateLabel(item.startAt)}` : ''}`;
    info.append(title, note);
    const actions = document.createElement('div'); actions.className = 'object-actions';
    for (const [action, text] of [['edit', '编辑'], ['toggle', item.enabled ? '关闭' : '开启'], ['delete', '删除']]) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = text; button.dataset.action = action; button.disabled = busy||(linked&&action!=='edit');
      if(linked&&action!=='edit')button.dataset.tasayLinkedControl='true';
      button.setAttribute('aria-label', `${text}${item.label}`);
      button.addEventListener('click', () => objectAction(type, item.id, action)); actions.append(button);
    }
    row.append(swatch, info, actions); list.append(row);
  }
}
async function objectAction(type, itemId, action) {
  const key = type === 'marker' ? 'markers' : 'portals';
  const item = snapshot?.state[key].find(entry => entry.id === itemId);
  if (!item) return;
  if(type==='portal'&&isTasayLinkedPortal(item)&&action!=='edit')return showNotice('该点位随过拟合恋人开放，请调整过拟合恋人的开关与时间。');
  if (action === 'edit') { fillObjectForm(type, item); return; }
  if (action === 'delete' && !window.confirm(`删除“${item.label}”？对应的${type === 'marker' ? '光柱' : '入口'}会从玩家地图中移除。`)) return;
  await mutate(state => {
    const target = state[key].find(entry => entry.id === itemId);
    if (!target) throw new Error('此项目已被其他管理员删除，请刷新后操作。');
    if (action === 'delete') state[key] = state[key].filter(entry => entry.id !== itemId);
    else target.enabled = !target.enabled;
  }, action === 'delete' ? '已删除，玩家界面将同步更新。' : '开放状态已更新。');
}
function fillObjectForm(type, item) {
  if(type==='portal')document.querySelector('.activity-configuration').open=true;
  $(`${type}-id`).value = item.id; $(`${type}-label`).value = item.label;
  $(`${type}-enabled`).checked = item.enabled; $(`${type}-radius`).value = item.radius;
  $(`${type}-start`).value = toLocalInput(item.startAt); $(`${type}-end`).value = toLocalInput(item.endAt);
  if (type === 'marker') { $('marker-color').value = item.color; $('marker-height').value = item.height; }
  else { $('portal-description').value = item.description; $('portal-url').value = item.url;const known=ACTIVITY_WORKS.some(work=>work.id===item.workId);$('portal-work').value=known?item.workId:'';$('portal-custom-work-id').value=known?'':item.workId||item.id;syncCustomWork(); }
  setSelection(item.x, item.z, item.label); $(`${type}-submit`).textContent = '保存修改';
  $(`${type}-label`).focus();
}
function clearObjectForm(type) {
  $(`${type}-form`).reset(); $(`${type}-id`).value = '';
  if(type==='portal')syncCustomWork();
  $(`${type}-submit`).textContent = type === 'marker' ? '添加光柱' : '添加入口';
}
function submitObject(type, event) {
  event.preventDefault();
  try {
    const key = type === 'marker' ? 'markers' : 'portals';
    const objectId = $(`${type}-id`).value || id(type);
    const coordinates = coordinateInputs.read();
    const item = { id: objectId, label: $(`${type}-label`).value.trim(), ...coordinates,
      enabled: $(`${type}-enabled`).checked, radius: Number($(`${type}-radius`).value), ...schedule(type) };
    if (!item.label) throw new Error('请填写名称。');
    if (type === 'marker') Object.assign(item, { color: $('marker-color').value, height: Number($('marker-height').value) });
    else Object.assign(item, { workId:$('portal-work').value||$('portal-custom-work-id').value.trim()||objectId, description: $('portal-description').value.trim(), url: $('portal-url').value.trim() });
    mutate(state => {
      const index = state[key].findIndex(entry => entry.id === objectId);
      if ($(`${type}-id`).value && index < 0) throw new Error('此项目已被删除。清空表单后可重新添加。');
      if (index >= 0) state[key][index] = item;
      else { if (state[key].length >= 12) throw new Error('已达到 12 个的上限，请先删除不再使用的项目。'); state[key].push(item); }
    }, type==='portal'&&isTasayLinkedPortal(item)?'点位已保存；开放状态与时段跟随过拟合恋人。':`${type === 'marker' ? '光柱' : '入口'}已保存${item.enabled ? '并启用' : '，当前保持关闭'}。`).then(ok => { if (ok) clearObjectForm(type); });
  } catch (error) { showNotice(error.message, true); }
}
function previewAnnouncement() {
  $('preview-title').textContent = $('announcement-title').value || '下一站，东九！';
  $('preview-body').textContent = $('announcement-body').value || '把大家的目光，带到同一个地方。';
  $('announcement-preview').dataset.tone = $('announcement-tone').value;
}
function syncPhase() {
  if (!snapshot || phaseDirty) return;
  const phase = snapshot.state.phase || ACTIVITY_PHASES[0];
  if (![...$('activity-phase').options].some(option => option.value === phase.id)) $('activity-phase').add(new Option(phase.label, phase.id));
  $('activity-phase').value = phase.id;
  $('phase-guidance').value = phase.guidance || '';
  phaseBase = JSON.stringify(phase);
}
function syncCustomWork() {
  $('portal-custom-work-field').hidden = Boolean($('portal-work').value);
  syncLinkedPortalControls();
}
function syncLinkedPortalControls(){
  const current=snapshot?.state.portals.find(portal=>portal.id===$('portal-id').value);
  const linked=isTasayLinkedPortal(current)||$('portal-work').value==='she-love-me';
  $('portal-linked-note').hidden=!linked;
  for(const field of ['portal-enabled','portal-start','portal-end','portal-url'])$(field).disabled=busy||linked;
  $('portal-work').disabled=busy||isTasayLinkedPortal(current);
  if(linked){const master=getTasayPortal(snapshot?.state.portals||[]);$('portal-enabled').checked=master?.enabled===true;$('portal-start').value=toLocalInput(master?.startAt);$('portal-end').value=toLocalInput(master?.endAt);}
  document.querySelectorAll('[data-tasay-linked-control]').forEach(control=>{control.disabled=true;});
}
function element(tag, text, className = '') {
  const node = document.createElement(tag);
  if (text != null) node.textContent = String(text);
  if (className) node.className = className;
  return node;
}
function workLabel(workId) {
  return ACTIVITY_WORKS.find(work => work.id === workId)?.name || audienceData?.summary.works.find(work => work.id === workId)?.label || workId;
}
function pointLabel(pointId) {
  return snapshot?.state.portals.find(point => point.id === pointId)?.label || audienceData?.summary.points.find(point => point.id === pointId)?.label || pointId;
}
function recordStatus(status) {
  return ({ exploring:'校园探索中', visit:'已到访点位', opening:'正在加载', opened:'已打开', experiencing:'体验中', returned:'已返回校园', cancelled:'加载前返回', failed:'加载失败', open_failed:'加载失败', interrupted:'体验已中断' })[status] || status;
}
function readableTime(value) { return Number.isFinite(value) ? dateLabel(value) : '—'; }
function currentStatus(person) {
  if (person.currentExperiences?.length) return person.currentExperiences.map(attempt => `${workLabel(attempt.workId)} · ${attempt.status === 'opening' ? '正在加载' : '体验中'}`).join('；');
  return recordStatus(person.lastStatus);
}
function renderStatistics() {
  const summary = audienceData.summary;
  $('stat-participants').textContent = summary.totalParticipants;
  $('stat-online').textContent = summary.onlineParticipants;
  $('stat-experiencing').textContent = summary.currentParticipants ?? '—';
  $('audience-count').textContent = summary.totalParticipants;
  $('online-count').textContent = summary.onlineParticipants;
  for (const [key, items] of [['point', summary.points], ['work', summary.works]]) {
    const host = $(`${key}-statistics`); host.replaceChildren();
    if (!items.length) host.append(element('p', '暂无记录', 'field-note'));
    for (const item of items) {
      const row = element('div', null, 'aggregate-row');
      row.append(element('span', item.label), element('strong', key === 'point' ? `${item.visitors} 人` : `${item.openedParticipants} 人已打开 · ${item.currentParticipants} 人当前体验`));
      host.append(row);
    }
  }
}
function renderAudienceList() {
  const list = $('audience-list');
  const signature = JSON.stringify([audienceData.participants, selectedAudienceId]);
  if (list.dataset.signature === signature) return;
  list.dataset.signature = signature; list.replaceChildren();
  $('audience-empty').hidden = audienceData.participants.length > 0;
  $('audience-empty').textContent = $('audience-search').value.trim() ? '没有匹配的观众。试试昵称的一部分或完整观众 ID。' : '还没有参与记录。观众填写昵称后会出现在这里。';
  for (const person of audienceData.participants) {
    const row = element('tr'); row.dataset.selected = String(person.id === selectedAudienceId);
    const identity = element('td'); const button = element('button', person.nickname, 'audience-name');
    button.type = 'button'; button.setAttribute('aria-label', `查看 ${person.nickname}（${person.id}）的记录`); button.setAttribute('aria-pressed', String(person.id === selectedAudienceId));
    button.addEventListener('click', () => { selectedAudienceId=person.id; selectedAudience=null; detailLimit=100; renderAudienceList(); loadAudienceDetail(); });
    identity.append(button, element('small', person.id, 'audience-id'));
    const presence = element('span', person.online ? '在线' : '离线', 'presence-label'); presence.dataset.online=String(person.online);
    identity.append(presence, element('small', `最近活动 ${readableTime(person.lastSeenAt)}`, 'last-activity'));
    const activity = element('td');
    activity.append(element('p', `到访 ${person.visitedPoints.length} 处 · 打开 ${person.openedWorks.length} 个作品`, 'audience-counts'));
    activity.append(element('small', person.visitedPoints.map(point => point.label || pointLabel(point.pointId)).join('、') || '尚未到访', 'audience-places'));
    activity.append(element('small', person.openedWorks.map(work => workLabel(work.workId)).join('、') || '尚未打开作品', 'audience-places'));
    const status = element('td', currentStatus(person), 'audience-current');
    row.append(identity, activity, status); list.append(row);
  }
}
async function refreshAudience() {
  if (!loggedIn || audiencePending) return;
  audiencePending = true;
  const query = $('audience-search').value.trim();
  try {
    const result = await request(`/api/admin/audience${query ? `?q=${encodeURIComponent(query)}` : ''}`);
    if (!loggedIn || query !== $('audience-search').value.trim()) return;
    audienceData = result; renderStatistics(); renderAudienceList();
    $('audience-sync-note').textContent = `记录同步于 ${readableTime(Date.now())}`;
    if (selectedAudienceId && !$('panel-audience').hidden) await loadAudienceDetail(false);
  } catch (error) {
    if (loggedIn) $('audience-sync-note').textContent = `记录同步失败：${error.message}`;
  } finally {
    audiencePending = false;
    if (loggedIn && query !== $('audience-search').value.trim()) refreshAudience();
  }
}
async function loadAudienceDetail(showLoading = true) {
  if (!loggedIn || !selectedAudienceId) return;
  const personId = selectedAudienceId, version = ++detailRequest;
  if (showLoading) { delete $('audience-detail').dataset.signature; $('audience-detail').replaceChildren(element('p', '正在读取个人记录…', 'empty-list')); }
  try {
    const result = await request(`/api/admin/audience/${encodeURIComponent(personId)}`);
    if (!loggedIn || personId !== selectedAudienceId || version !== detailRequest) return;
    selectedAudience = result.audience; renderAudienceDetail();
  } catch (error) {
    if (loggedIn && personId === selectedAudienceId && version === detailRequest) $('audience-detail').replaceChildren(element('p', error.message, 'form-error'));
  }
}
function renderAudienceDetail() {
  if (!selectedAudience) return;
  const person=selectedAudience, host=$('audience-detail');
  const signature = JSON.stringify([person, detailLimit]);
  if (host.dataset.signature === signature) return;
  host.dataset.signature=signature; host.replaceChildren();
  host.append(element('h3', person.nickname),element('small', person.id, 'audience-id'),element('p', `${person.online ? '在线' : '离线'} · ${currentStatus(person)}`, 'detail-status'));
  host.append(element('p', `加入 ${readableTime(person.joinedAt)} · 最近活动 ${readableTime(person.lastSeenAt)}`, 'field-note'));
  const visitTitle = element('h4', `到访点位 · ${person.visitedPoints.length}`); host.append(visitTitle);
  for (const visit of person.visitedPoints) host.append(element('p', `${visit.label || pointLabel(visit.pointId)} · ${readableTime(visit.firstAt)}`, 'detail-entry'));
  if (!person.visitedPoints.length) host.append(element('p', '尚未到访', 'field-note'));
  host.append(element('h4', `已打开作品 · ${person.openedWorks.length}`));
  for (const work of person.openedWorks) host.append(element('p', `${workLabel(work.workId)} · ${work.openCount} 次打开 · ${work.readyLevel === 'runtime_ready' ? '运行画面已就绪' : '页面已打开'}`, 'detail-entry'));
  if (!person.openedWorks.length) host.append(element('p', '尚未成功打开作品', 'field-note'));
  host.append(element('h4', '体验尝试'));
  for (const attempt of [...person.attempts].reverse().slice(0, detailLimit)) {
    const block=element('div', null, 'attempt-entry');
    block.append(element('strong',`${workLabel(attempt.workId)} · ${recordStatus(attempt.status)}`),element('small',`${readableTime(attempt.startedAt)}${attempt.endedAt ? ` → ${readableTime(attempt.endedAt)}` : ''}`));
    if (attempt.readyLevel) block.append(element('small', attempt.readyLevel === 'runtime_ready' ? '运行画面已就绪' : '页面已打开（不代表全部资源就绪）'));
    host.append(block);
  }
  if (!person.attempts.length) host.append(element('p', '暂无体验尝试', 'field-note'));
  host.append(element('h4', '活动时间线'));
  const timeline=element('ol',null,'audience-timeline');
  for (const event of [...person.events].reverse().slice(0, detailLimit)) {
    const row=element('li');
    row.append(element('time',readableTime(event.at)),element('span',`${recordStatus(event.status || event.type)} · ${event.workId ? workLabel(event.workId) : pointLabel(event.pointId)}`));
    if(event.reason)row.append(element('small',event.reason));
    timeline.append(row);
  }
  host.append(timeline);
  if (!person.events.length) host.append(element('p', '已加入活动，尚无到访或体验记录。', 'field-note'));
  if (Math.max(person.events.length,person.attempts.length)>detailLimit) {
    const more=element('button',`显示更早记录（目前最多显示 ${detailLimit} 条）`,'secondary small');more.type='button';
    more.addEventListener('click',()=>{detailLimit+=100;renderAudienceDetail();});host.append(more);
  }
}
function activateTab(name, focus = false) {
  document.querySelectorAll('[role=tab][data-tab]').forEach(button => {
    const active = button.dataset.tab === name; button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1;
    if (active && focus) button.focus();
  });
  for (const type of ['announcement', 'marker', 'portal','audience']) $(`panel-${type}`).hidden = type !== name;
  document.querySelector('.workspace').classList.toggle('show-audience',name==='audience');
  document.querySelector('.map-workspace').hidden=name==='audience';
  if(name==='audience')refreshAudience();
  document.querySelector('.map-workspace').dataset.tab = name;
  $('map-instruction').textContent = name === 'announcement' ? '查看当前地图事件与体验入口。' : `点击地图，为${name === 'marker' ? '光柱' : '入口'}选择位置。`;
}
function svgElement(name, attributes = {}, text) {
  const element = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  if (text != null) element.textContent = text;
  return element;
}
function setSelection(x, z, label = '自定义地点', updateInputs = true) {
  let coordinates;
  try { coordinates = readAdminCoordinates(x, z); }
  catch (error) { showNotice(error.message, true); return; }
  selection = { ...coordinates, label };
  if (updateInputs) { $('location-x').value = selection.x; $('location-z').value = selection.z; }
  document.querySelectorAll('[data-location-readout]').forEach(el => { el.textContent = `${label} · ${selection.x}, ${selection.z}`; });
  renderSelection();
}
function renderSelection() {
  if (!mapReady) return;
  const group = $('map-selection'); group.replaceChildren();
  const scale = mapView.width / 440;
  group.append(svgElement('circle', { cx: selection.x, cy: selection.z, r: 12 * scale, fill: '#294e3815', stroke: '#294e38', 'stroke-width': 1.5 * scale }), svgElement('circle', { cx: selection.x, cy: selection.z, r: 3.5 * scale, fill: '#294e38' }));
  group.append(svgElement('text', { x: selection.x + 17 * scale, y: selection.z - 12 * scale, fill: '#294e38', 'font-size': 11 * scale, 'font-weight': 600, stroke: '#f5f8f0', 'stroke-width': 3 * scale, 'paint-order': 'stroke' }, selection.label));
}
function renderPins() {
  if (!mapReady || !snapshot) return;
  const group = $('map-pins'); group.replaceChildren(); const scale = mapView.width / 440;
  for (const [type, records] of [['marker', snapshot.state.markers], ['portal', snapshot.state.portals]]) for (const item of records) {
    const color = type === 'marker' ? item.color : '#ad854a';
    const pin = svgElement('g', { opacity: eventStatus(item).type === 'active' ? 1 : .4 });
    pin.append(svgElement('circle', { cx: item.x, cy: item.z, r: 7 * scale, fill: color, stroke: '#ffffff', 'stroke-width': 2 * scale }));
    pin.append(svgElement('text', { x: item.x + 11 * scale, y: item.z + 4 * scale, fill: '#45614e', 'font-size': 10 * scale, stroke: '#f5f8f0', 'stroke-width': 3 * scale, 'paint-order': 'stroke' }, item.label));
    group.append(pin);
  }
}
function applyMapView() {
  $('campus-picker').setAttribute('viewBox', `${mapView.x} ${mapView.z} ${mapView.width} ${mapView.height}`);
  renderSelection(); renderPins();
}
function zoomMap(factor) {
  if (!mapReady) return;
  const width = Math.min(5000, Math.max(170, mapView.width * factor)); const ratio = width / mapView.width;
  mapView = { x: mapView.x + mapView.width * (1 - ratio) / 2, z: mapView.z + mapView.height * (1 - ratio) / 2, width, height: mapView.height * ratio };
  applyMapView();
}
async function loadMap() {
  try {
    const [fc, manifest] = await Promise.all(['./data/east-campus.geojson', './data/source-manifest.json'].map(async url => {
      const response = await fetch(url); if (!response.ok) throw new Error('校园地图暂不可用'); return response.json();
    }));
    const frame = createLiveMapFrame(manifest); presets = getLiveLocationPresets(fc, frame);
    const select = $('location-preset'); select.replaceChildren(new Option('选择快捷地点', ''));
    for (const preset of presets) select.add(new Option(preset.label, preset.id));
    const project = coordinate => geoToLocal({ longitude: coordinate[0], latitude: coordinate[1], coordinateSystem: 'EPSG:4326' }, frame);
    const pathFor = coordinates => coordinates.map((coordinate, i) => { const p = project(coordinate); return `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.z.toFixed(1)}`; }).join(' ');
    const geometry = $('map-geography'); geometry.replaceChildren();
    const styles = {
      landuse: { fill: '#e6ecdf', stroke: 'none' }, green: { fill: '#d5e2cc', stroke: 'none' },
      water: { fill: '#b9d3ce', stroke: '#a5c3be', 'stroke-width': 1 }, sports: { fill: '#e2d9c7', stroke: '#c9bfa6', 'stroke-width': 1 },
      road: { fill: 'none', stroke: '#ffffff', 'stroke-width': 5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' },
      building: { fill: '#b9c6bb', stroke: '#9aada0', 'stroke-width': 1.2 },
    };
    for (const category of ['landuse', 'green', 'water', 'sports', 'road', 'building']) {
      const group = svgElement('g', styles[category]);
      for (const feature of fc.features.filter(item => item.properties?.category === category)) {
        const geo = feature.geometry;
        let path = '';
        if (geo.type === 'LineString') path = pathFor(geo.coordinates);
        else if (geo.type === 'MultiLineString') path = geo.coordinates.map(pathFor).join(' ');
        else if (geo.type === 'Polygon') path = geo.coordinates.map(ring => `${pathFor(ring)} Z`).join(' ');
        else if (geo.type === 'MultiPolygon') path = geo.coordinates.flatMap(polygon => polygon.map(ring => `${pathFor(ring)} Z`)).join(' ');
        if (path) group.append(svgElement('path', { d: path, 'fill-rule': 'evenodd' }));
      }
      geometry.append(group);
    }
    const xs = presets.map(p => p.x), zs = presets.map(p => p.z);
    const width = Math.max(...xs) - Math.min(...xs) + 420;
    defaultMapView = { x: Math.min(...xs) - 210, z: Math.min(...zs) - 230, width, height: Math.max(...zs) - Math.min(...zs) + 460 };
    mapView = { ...defaultMapView }; mapReady = true; $('map-loading').hidden = true;
    applyMapView(); if (presets[0]) setSelection(presets[0].x, presets[0].z, presets[0].label);
  } catch (error) { $('map-loading').textContent = `${error.message}；仍可手动填写坐标。`; }
}

for (const phase of ACTIVITY_PHASES) $('activity-phase').add(new Option(phase.label, phase.id));
for (const work of ACTIVITY_WORKS){const option=new Option(work.name,work.id);option.disabled=work.id==='she-love-me';$('portal-work').add(option);}
$('activity-phase').addEventListener('change', () => {
  const phase=ACTIVITY_PHASES.find(item=>item.id===$('activity-phase').value);
  if(phase)$('phase-guidance').value=phase.guidance;
  phaseDirty=true;
});
$('phase-guidance').addEventListener('input',()=>{phaseDirty=true;});
$('activity-launch-form').addEventListener('submit',event=>{
  event.preventDefault();
  if(!launchSelection.size)return showNotice('请先选择要开启的活动；如需关闭所有入口，请使用“全部关闭”。',true);
  launchActivities([...launchSelection],'所选活动已开启：对应光柱已点亮，观众靠近后可进入；未选活动已关闭。');
});
$('close-all-activities').addEventListener('click',()=>launchActivities([],'全部活动入口与召集光柱已关闭；已进入作品的观众可继续体验并自行返回。'));
$('reset-activity-selection').addEventListener('click',()=>{launchDirty=false;renderActivityChoices();});
$('phase-form').addEventListener('submit',event=>{
  event.preventDefault();
  const selected=ACTIVITY_PHASES.find(item=>item.id===$('activity-phase').value)||snapshot?.state.phase;
  if(!selected)return;
  const phase={id:selected.id,label:selected.label,guidance:$('phase-guidance').value.trim()},baseline=phaseBase;
  mutate(state=>{
    if(JSON.stringify(state.phase||ACTIVITY_PHASES[0])!==baseline&&JSON.stringify(state.phase)!==JSON.stringify(phase))throw new Error('活动阶段已被其他管理员更新。本次修改未保存，请刷新核对最新阶段后重试。');
    state.phase=phase;
  },`活动已切换为“${phase.label}”。观众位置与记录保持不变。`).then(ok=>{if(ok){phaseDirty=false;syncPhase();}});
});
$('portal-work').addEventListener('change',()=>{
  const work=ACTIVITY_WORKS.find(item=>item.id===$('portal-work').value);
  if(work){$('portal-label').value=work.name;$('portal-description').value=work.description;$('portal-url').value=work.url;}
  syncCustomWork();
});
$('load-activity-portals').addEventListener('click',()=>mutate(state=>{
  const missing=activityPortals().filter(portal=>!state.portals.some(existing=>existing.id===portal.id));
  if(state.portals.length+missing.length>12)throw new Error('入口数量将超过 12 个。请先删除不再使用的入口，再载入作品点位。');
  state.portals.push(...missing);
},'作品点位已检查并补齐；恋情分析室跟随过拟合恋人，其余新点位保持关闭。已有位置与设置保持不变。'));
$('audience-search-form').addEventListener('submit',event=>{event.preventDefault();clearTimeout(searchTimer);refreshAudience();});
$('audience-search').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(refreshAudience,250);});
$('refresh-audience').addEventListener('click',refreshAudience);
$('login-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = $('login-button'); button.disabled = true; $('login-error').textContent = '';
  try {
    const result = await request('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: $('admin-password').value }) });
    csrfToken = result.csrfToken; showDashboard();
    applySnapshot(await request('/api/live/state')); populateInitialForms();
  } catch (error) { showLogin(error.message); }
  finally { button.disabled = false; }
});
$('logout').addEventListener('click', async () => {
  try { await request('/api/admin/logout', { method: 'POST' }); showLogin(); }
  catch (error) { showNotice(error.message, true); }
});
function syncPauseMessage(force = false) {
  if (!snapshot || (pauseMessageDirty && !force)) return;
  pauseMessageBase = snapshot.state.pauseMessage ?? '';
  $('pause-message').value = pauseMessageBase || defaultPauseMessage;
  pauseMessageDirty = false;
}
function capturePauseMessageEdit() {
  const edited = pauseMessageDirty, baseline = pauseMessageBase;
  const draft = $('pause-message').value.trim() || defaultPauseMessage;
  return state => {
    // An untouched input must never replace another operator's newer message.
    if (!edited) return;
    const latest = state.pauseMessage ?? '';
    if (latest !== baseline && latest !== draft) {
      throw new Error(`暂停提示已被其他管理员更新为“${latest || defaultPauseMessage}”。本次修改未保存，草稿已保留；请刷新页面核对最新提示后重新编辑。`);
    }
    state.pauseMessage = draft;
  };
}
$('pause-message').addEventListener('input', () => {
  pauseMessageDirty = $('pause-message').value !== (pauseMessageBase || defaultPauseMessage);
});
$('toggle-pause').addEventListener('click', () => {
  const target = !snapshot?.state.paused, applyMessageEdit = capturePauseMessageEdit();
  mutate(state => { applyMessageEdit(state); state.paused = target; }, target ? '暂停指令已发布，在线玩家将进入暂停状态。' : '恢复指令已发布，玩家可以继续探索。').then(ok => { if (ok) syncPauseMessage(true); });
});
$('show-sky-qr').addEventListener('click', () => mutate(state => { state.skyQrVisible = true; }, '二维码已在校园天空显示。'));
$('hide-sky-qr').addEventListener('click', () => mutate(state => { state.skyQrVisible = false; }, '天空二维码已收起。'));
$('save-pause-message').addEventListener('click', () => {
  const applyMessageEdit = capturePauseMessageEdit();
  mutate(state => applyMessageEdit(state), '暂停提示已保存。').then(ok => { if (ok) syncPauseMessage(true); });
});
$('announcement-form').addEventListener('submit', event => {
  event.preventDefault();
  try {
    const announcement = { id: id('announcement'), title: $('announcement-title').value.trim(), body: $('announcement-body').value.trim(), tone: $('announcement-tone').value, ...schedule('announcement') };
    if (!announcement.title) throw new Error('请填写公告标题。');
    mutate(state => { state.announcement = announcement; }, announcement.startAt && announcement.startAt > now() ? '公告已排期，将在设定时间显示。' : '公告已发布到玩家界面。');
  } catch (error) { showNotice(error.message, true); }
});
$('withdraw-announcement').addEventListener('click', () => mutate(state => { state.announcement = null; }, '公告已撤回。'));
for (const suffix of ['title', 'body', 'tone']) $(`announcement-${suffix}`).addEventListener('input', previewAnnouncement);
for (const type of ['marker', 'portal']) $(`${type}-form`).addEventListener('submit', event => submitObject(type, event));
document.querySelectorAll('[data-clear-form]').forEach(button => button.addEventListener('click', () => clearObjectForm(button.dataset.clearForm)));
document.querySelectorAll('[role=tab][data-tab]').forEach(button => {
  button.addEventListener('click', () => activateTab(button.dataset.tab));
  button.addEventListener('keydown', event => {
    const names = ['announcement', 'marker', 'portal','audience']; const at = names.indexOf(button.dataset.tab);
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); const index = event.key === 'Home' ? 0 : event.key === 'End' ? names.length-1 : (at + (event.key === 'ArrowRight' ? 1 : names.length-1)) % names.length;
      activateTab(names[index], true);
    }
  });
});
$('location-preset').addEventListener('change', event => {
  const preset = presets.find(item => item.id === event.target.value); if (!preset) return;
  setSelection(preset.x, preset.z, preset.label);
  if (mapReady && (preset.x < mapView.x || preset.x > mapView.x + mapView.width || preset.z < mapView.z || preset.z > mapView.z + mapView.height)) {
    mapView.x = preset.x - mapView.width / 2; mapView.z = preset.z - mapView.height / 2; applyMapView();
  }
});
const coordinateInputs = bindAdminCoordinateInputs({
  xInput: $('location-x'), zInput: $('location-z'),
  onValid: ({ x, z }) => { setSelection(x, z, '自定义地点', false); $('location-preset').value = ''; },
  onInvalid: error => showNotice(error.message, true),
});
$('campus-picker').addEventListener('click', event => {
  if (!mapReady || busy) return;
  const point = $('campus-picker').createSVGPoint(); point.x = event.clientX; point.y = event.clientY;
  const local = point.matrixTransform($('campus-picker').getScreenCTM().inverse());
  setSelection(local.x, local.y); $('location-preset').value = '';
});
$('map-zoom-in').addEventListener('click', () => zoomMap(.7));
$('map-zoom-out').addEventListener('click', () => zoomMap(1 / .7));
$('map-reset').addEventListener('click', () => { if (defaultMapView) { mapView = { ...defaultMapView }; applyMapView(); } });
function populateInitialForms() {
  if (!snapshot) return;
  syncPauseMessage(true);
  phaseDirty=false;syncPhase();refreshAudience();
  const a = snapshot.state.announcement;
  if (a) {
    $('announcement-title').value = a.title; $('announcement-body').value = a.body; $('announcement-tone').value = a.tone;
    $('announcement-start').value = toLocalInput(a.startAt); $('announcement-end').value = toLocalInput(a.endAt);
  } else {
    $('announcement-form').reset();
  }
  previewAnnouncement();
}
activateTab('announcement'); setSelection(selection.x, selection.z, selection.label); loadMap();
try {
  const session = await request('/api/admin/session');
  if (session.authenticated) { csrfToken = session.csrfToken; showDashboard(); applySnapshot(await request('/api/live/state')); populateInitialForms(); }
} catch (error) { showLogin(error.message); }
setInterval(refresh, 5000);
setInterval(() => { if (loggedIn && snapshot) renderState(); }, 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
