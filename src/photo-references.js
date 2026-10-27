import {DETAIL_PHOTO_REFERENCES} from './photo-detail-references.js';
import {CAMPUS_AERIAL_REFERENCES,CAMPUS_BUILDING_REFERENCES} from './campus-reference-atlas.js';
import {LOCAL_CAMPUS_REFERENCES} from './local-photo-references.js';
// Public source images are linked in place; no remote photographs are bundled
// as textures or represented as a surveyed/current-state campus inventory.
export const PHOTO_REFERENCES = [
  {title:'韵苑5栋 · 校方门厅实拍',category:['韵苑'],platform:'华科总务后勤处',date:'2025 年 4 月 25 日',
    image:'https://hq.hust.edu.cn/__local/3/7E/16/29629B73F08AD35E6422B928E9F_82971852_E11EA.png',source:'https://hq.hust.edu.cn/info/1015/3979.htm',
    caption:'正文明确在韵苑5栋集合。照片支持米黄墙、圆弧门厅、灰檐白竖带、圆拱和深色格栅；仅用于这栋局部，不能复制到27栋。',fresh:true},
  {title:'韵苑12栋 · 侧路与停车',category:['韵苑','人车','道路水岸'],platform:'华科总务后勤处',date:'2025 年 4 月 25 日',
    image:'https://hq.hust.edu.cn/__local/8/FC/4D/BBC58B50F401AED327AE8CA22E4_CC13A62C_2ADF9.png',source:'https://hq.hust.edu.cn/info/1015/3979.htm',
    caption:'墙牌可读12栋，能对照灰白水平带、墙灯、密集停车、井盖、绿篱与挡墙。不是27栋的外立面证据。',fresh:true},
  ...CAMPUS_AERIAL_REFERENCES,
  ...CAMPUS_BUILDING_REFERENCES,
  {
    title: '东九湖边 · 骑行车流',
    date: '华中科技大学官网 · 拍摄时间未标注',
    image: 'https://www.hust.edu.cn/__local/3/FF/51/51FF1DE2B5C1474E5782E3FF2E8_06E626A5_5F265.jpg',
    source: 'https://www.hust.edu.cn/',
    caption: '可见东九 A 区、湖边弯道、前后错位的骑行者，以及靠道路边缘的行人。拍摄时刻未标注，不提供早八流量或信号配时。',
    fresh: true,
  },
  {
    title: '韵苑公寓 · 车棚与车辆',
    date: '光电信息学院 · 2024 年 5 月 23 日',
    image: 'https://oei.hust.edu.cn/__local/E/FE/F2/1E7D9A709EB3C1374C05CF45F21_4610533F_42964.jpg',
    source: 'https://oei.hust.edu.cn/info/1010/8849.htm',
    caption: '报道记录韵苑 7、8、10、12、27 栋的车棚整理。作为车辆与停放外观参考，不能据此定位为 23 栋门口。',
    fresh: true,
  },
  {
    title: '韵苑公寓 · 停车近景',
    date: '光电信息学院 · 2024 年 5 月 23 日',
    image: 'https://oei.hust.edu.cn/__local/C/12/F2/AA93DBA6F4872C92013AA218761_8530AC04_2C28C.jpg',
    source: 'https://oei.hust.edu.cn/info/1010/8849.htm',
    caption: '近处可见蓝色车头、黑色握把、刹车线和前篮局部。车身并未完整入镜；这是下午活动中的停放场景。',
    fresh: true,
  },
  {
    title: '校园骑行 · 冬日图文',
    date: '建规学院研究生会供稿转载 · 2022 年 12 月 14 日',
    image: 'https://p9.itc.cn/q_70/images03/20221214/2510f60f22404994854245b321be3d4f.jpeg',
    source: 'https://www.sohu.com/a/617248307_121124317',
    caption: '文末署名焦孟雷的摄影图。具体路段、拍摄时刻未标注；文中的商品配图未采用为校内实拍。',
    fresh: true,
  },
  {
    title: '校园早高峰 · 骑手与前篮',
    date: '华中科技大学保卫处 · 2019 年 11 月 27 日',
    image: 'https://image.thepaper.cn/www/image/39/253/902.jpg',
    source: 'https://www.thepaper.cn/newsDetail_forward_5075801',
    caption: '已有参考：电动车前篮、防风罩与交通疏导。图中路口尚未配准到当前路线。',
  },
  ...[
    ['东九周边 · 春季街道', '6f38608f-b57f-4347-9322-fe2c2422ff07'],
    ['校内路侧 · 车辆与步道', '796755f4-9f66-4f85-a3be-42d1b2aa61b5'],
  ].map(([title, image]) => ({
    title, date: '湖北日报 · 2025 年 3 月 12 日',
    image: `https://hbrbapp.hubeidaily.net/${image}-w800_wm`,
    source: 'https://news.hubeidaily.net/pc/c_3744408.html',
    caption: title.startsWith('东九') ? '可见 A 区楼体、弯曲道路、人车交织与紫白玉兰。用于对照建筑周边、植物层次及人车尺度；不是早八流量样本。' : '报道同时介绍西十二与东九；这张路侧照片的具体路段未单独标注，用于比较车辆外观与停放方式。',
    fresh: true,
  })),
  {
    title: '校园早高峰 · 过街与疏导',
    date: '华中科技大学保卫处 · 2019 年 11 月 27 日',
    image: 'https://image.thepaper.cn/www/image/39/253/795.jpg',
    source: 'https://www.thepaper.cn/newsDetail_forward_5075801',
    caption: '已有参考：行人、骑行者与机动车共同使用道路。车辆间距和路口方向需另行核对。',
  },
  {
    title: '东九 B 区 · 密集停放',
    date: '长江日报 · 2023 年 10 月 17 日',
    image: 'https://res.app.dawuhanapp.com/c/10001/202401/94d48995f614a4cf6e9e0c4c604b218c.jpeg',
    source: 'https://www.app.dawuhanapp.com/p/29771276.html',
    caption: '已有参考：东九前场与成排车辆。报道中的拥堵观察为下午 15:35，不作为早八人数统计。',
  },
];

const PHOTO_FILTERS = [
  ['all', '全部'], ['韵苑', '韵苑'], ['东九', '东九'],
  ['道路水岸', '道路水岸'], ['人车', '人车'],
];
const mountedGalleries = new WeakMap();
let gallerySerial = 0;

function photoCategories(item) {
  const explicit = Array.isArray(item.category) ? item.category : [item.category];
  const aliases = {
    韵苑: '韵苑', yunyuan: '韵苑', dorm: '韵苑', 宿舍: '韵苑',
    东九: '东九', dongjiu: '东九', 'east-nine': '东九',
    道路水岸: '道路水岸', 道路: '道路水岸', 水岸: '道路水岸',
    湖水: '道路水岸', 路面: '道路水岸', 桥面: '道路水岸', 路灯: '道路水岸',
    人行横道: '道路水岸', street: '道路水岸', water: '道路水岸',
    人车: '人车', 电动车: '人车', 交通: '人车', people: '人车',
    traffic: '人车', vehicles: '人车',
  };
  const categories = new Set(explicit.flatMap(value => String(value || '').split(/[,，、/]/))
    .map(value => aliases[value.trim()]).filter(Boolean));
  if (categories.size) return categories;
  const text = `${item.title} ${item.caption || ''}`;
  if (/韵苑|公寓|宿舍/.test(text)) categories.add('韵苑');
  if (/东九/.test(text)) categories.add('东九');
  if (/道路|路面|步道|湖|河|桥|水岸|灯|路口|过街/.test(text)) categories.add('道路水岸');
  if (/车辆|骑|车流|行人|人车|停车|停放|前篮|电动车/.test(text)) categories.add('人车');
  return categories;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function sourceLink(href, text, label) {
  const link = element('a', '', text);
  link.href = href;
  link.target = '_blank';
  link.rel = 'noreferrer';
  if (label) link.setAttribute('aria-label', label);
  return link;
}

function createPhotoViewer(container, id) {
  const viewer = element('dialog', 'photo-viewer');
  const headingId = `photo-viewer-title-${id}`;
  viewer.setAttribute('aria-labelledby', headingId);
  const heading = element('div', 'photo-viewer-heading');
  const title = element('h3');
  title.id = headingId;
  const close = element('button', 'photo-viewer-close', '×');
  close.type = 'button';
  close.setAttribute('aria-label', '关闭放大照片');
  heading.append(title, close);
  const metadata = element('small', 'photo-viewer-date');
  const frame = element('div', 'photo-viewer-frame');
  frame.tabIndex = 0;
  frame.setAttribute('role', 'region');
  frame.setAttribute('aria-label', '照片；原尺寸模式可滚动查看细节');
  const image = element('img');
  image.referrerPolicy = 'no-referrer';
  image.decoding = 'async';
  const loading = element('span', 'photo-reference-fallback', '原站图片加载中');
  loading.setAttribute('role', 'status');
  frame.append(image, loading);
  const description = element('p', 'photo-viewer-description');
  const actions = element('div', 'photo-viewer-actions');
  const zoom = element('button', 'photo-viewer-zoom', '查看原尺寸');
  zoom.type = 'button';
  zoom.setAttribute('aria-pressed', 'false');
  const size = element('span', 'photo-viewer-size');
  const original = sourceLink('', '原图 ↗');
  const source = sourceLink('', '原报道 / 来源 ↗');
  actions.append(zoom, size, original, source);
  viewer.append(heading, metadata, frame, description, actions);
  container.append(viewer);
  let opener = null;
  const resetZoom = () => {
    frame.classList.remove('is-original-size');
    zoom.setAttribute('aria-pressed', 'false');
    zoom.textContent = '查看原尺寸';
    frame.scrollTop = 0;
    frame.scrollLeft = 0;
  };
  image.addEventListener('load', () => {
    image.hidden = false;
    loading.hidden = true;
    zoom.disabled = false;
    size.textContent = `${image.naturalWidth} × ${image.naturalHeight}`;
  });
  image.addEventListener('error', () => {
    image.hidden = true;
    loading.hidden = false;
    loading.textContent = '图片暂不可用 · 可打开原图或原报道';
    zoom.disabled = true;
    size.textContent = '';
  });
  zoom.addEventListener('click', () => {
    const originalSize = frame.classList.toggle('is-original-size');
    zoom.setAttribute('aria-pressed', String(originalSize));
    zoom.textContent = originalSize ? '适应窗口' : '查看原尺寸';
    frame.scrollTop = 0;
    frame.scrollLeft = 0;
  });
  close.addEventListener('click', () => viewer.close());
  viewer.addEventListener('cancel', event => {
    // The top dialog owns Escape; closing a photo must keep the gallery open.
    event.preventDefault();
    event.stopPropagation();
    viewer.close();
  });
  viewer.addEventListener('close', () => {
    resetZoom();
    if (opener?.isConnected && !opener.closest('[hidden]')) opener.focus({ preventScroll: true });
  });
  return {
    open(item, button) {
      opener = button;
      title.textContent = item.title;
      metadata.textContent = [item.platform, item.date].filter(Boolean).join(' · ');
      description.textContent = item.caption || '';
      original.href = item.image;
      original.setAttribute('aria-label', `打开原图：${item.title}`);
      source.href = item.source;
      source.setAttribute('aria-label', `查看来源：${item.title}`);
      image.alt = item.title;
      image.hidden = true;
      loading.hidden = false;
      loading.textContent = '原站图片加载中';
      size.textContent = '';
      zoom.disabled = true;
      resetZoom();
      image.src = item.image;
      viewer.showModal();
      close.focus();
    },
    close() { if (viewer.open) viewer.close(); },
  };
}

export function mountPhotoReferences(container, extraItems = []) {
  mountedGalleries.get(container)?.();
  container.replaceChildren();
  const id = ++gallerySerial;
  const items = [...LOCAL_CAMPUS_REFERENCES, ...extraItems, ...DETAIL_PHOTO_REFERENCES.map(item => ({ ...item, fresh: false })),
    ...PHOTO_REFERENCES.map(item => ({ ...item, fresh: false }))]
    .filter((item, index, all) => all.findIndex(candidate => candidate.image === item.image) === index);
  const controls = element('div', 'photo-reference-controls');
  const filters = element('div', 'photo-reference-filters');
  filters.setAttribute('role', 'group');
  filters.setAttribute('aria-label', '按地点与对象筛选照片');
  const result = element('p', 'photo-reference-count');
  result.setAttribute('role', 'status');
  controls.append(filters, result);
  container.append(controls);
  const viewer = createPhotoViewer(container, id);
  const records = [];
  let activeFilter = 'all';
  let activated = false;
  const loadVisible = () => {
    if (!activated) return;
    for (const { card, image } of records) {
      if (!card.hidden && image.dataset.src) {
        image.src = image.dataset.src;
        image.removeAttribute('data-src');
      }
    }
  };
  for (const item of items) {
    const card = element('figure', 'photo-reference');
    const button = element('button', 'photo-reference-image');
    button.type = 'button';
    button.setAttribute('aria-label', `放大照片：${item.title}`);
    button.setAttribute('aria-haspopup', 'dialog');
    const image = element('img');
    image.dataset.src = item.image;
    image.alt = item.title;
    image.referrerPolicy = 'no-referrer';
    image.decoding = 'async';
    image.hidden = true;
    const fallback = element('span', 'photo-reference-fallback', '原站图片加载中');
    image.addEventListener('load', () => { image.hidden = false; fallback.hidden = true; });
    image.addEventListener('error', () => {
      image.hidden = true;
      fallback.hidden = false;
      fallback.textContent = '图片暂不可用 · 打开原图或原报道';
    });
    const zoomHint = element('span', 'photo-reference-zoom-hint', '放大查看');
    zoomHint.setAttribute('aria-hidden', 'true');
    button.append(image, fallback, zoomHint);
    button.addEventListener('click', () => viewer.open(item, button));
    const caption = element('figcaption');
    const title = element('strong', '', item.title);
    const date = element('small', '', `${item.fresh ? '本轮新增 · ' : ''}${[item.platform, item.date].filter(Boolean).join(' · ')}`);
    const description = element('p', '', item.caption || '');
    const links = element('div', 'photo-reference-links');
    links.append(sourceLink(item.image, '原图 ↗', `打开原图：${item.title}`),
      sourceLink(item.source, '原报道 / 来源 ↗', `查看来源：${item.title}`));
    caption.append(title, date, description, links);
    card.append(button, caption);
    container.append(card);
    records.push({ card, image, categories: photoCategories(item) });
  }
  const filterButtons = new Map();
  const applyFilter = () => {
    let count = 0;
    for (const record of records) {
      record.card.hidden = activeFilter !== 'all' && !record.categories.has(activeFilter);
      record.card.classList.toggle('photo-reference--lead', !record.card.hidden && count === 0);
      if (!record.card.hidden) count++;
    }
    for (const [key, button] of filterButtons) button.setAttribute('aria-pressed', String(key === activeFilter));
    result.textContent = `显示 ${count} / ${records.length} 张 · 点击照片放大，可查看原尺寸`;
    loadVisible();
  };
  for (const [key, label] of PHOTO_FILTERS) {
    const count = records.filter(record => key === 'all' || record.categories.has(key)).length;
    const button = element('button', '', `${label} · ${count}`);
    button.type = 'button';
    button.disabled = count === 0;
    button.addEventListener('click', () => { activeFilter = key; applyFilter(); });
    filterButtons.set(key, button);
    filters.append(button);
  }
  applyFilter();
  const parentDialog = container.closest('dialog');
  const closeViewer = () => viewer.close();
  parentDialog?.addEventListener('close', closeViewer);
  mountedGalleries.set(container, () => {
    viewer.close();
    parentDialog?.removeEventListener('close', closeViewer);
  });
  return () => { activated = true; loadVisible(); };
}
