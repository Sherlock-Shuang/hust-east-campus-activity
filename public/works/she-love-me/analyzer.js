export const MAX_BYTES = 2 * 1024 * 1024;
export const MAX_MESSAGES = 20000;
const shortWords = new Set(['嗯','哦','好','行','哦哦','嗯嗯','好的','ok','好吧','随便','可以','知道了','知道','哈','哈哈','em','em...','emmm']);
const aliases = {me:'我',self:'我',mine:'我',them:'对方',other:'对方',ta:'对方'};
export function timestamp(value) {
  if (value == null || value === '') return null;
  let n = Number(value);
  if (Number.isFinite(n)) {
    while (n > 1e14) n /= 1000;
    if (n < 1e11) n *= 1000;
  } else {
    const s = String(value).trim().replace(/\//g, '-');
    // Exported Chinese chat logs without a zone use China standard time.
    n = Date.parse(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(s) ? s.replace(' ', 'T') + '+08:00' : s);
  }
  return Number.isFinite(n) && n >= Date.UTC(2000,0,1) && n <= Date.UTC(2100,0,1) ? n : null;
}
export function parseChat(text) {
  if (new TextEncoder().encode(text).length > MAX_BYTES) throw new Error('文件或文本超过 2 MB，请先截取一段双人聊天。');
  if (!text.trim()) throw new Error('先选择示例，或粘贴一段聊天记录。');
  let rows;
  if (/^[\[{]/.test(text.trim()) && !/^\[\d{4}[-/]/.test(text.trim())) {
    let json;
    try { json = JSON.parse(text.trim()); } catch { throw new Error('JSON 格式不完整，请检查括号和引号，或切换为“姓名: 内容”的纯文本。'); }
    rows = Array.isArray(json) ? json : json.messages || json.data?.messages;
    if (!Array.isArray(rows)) throw new Error('JSON 需要 messages 数组，包含 sender、content 和可选的 timestamp。');
  } else {
    rows = [];
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const dated = line.match(/^\s*\[?(\d{4}[-/]\d{2}[-/]\d{2}[ T]\d{2}:\d{2}(?::\d{2})?)\]?\s+([^:：\n]{1,40})[:：]\s*(.*)$/);
      const plain = line.match(/^\s*([^:：\n]{1,40})[:：]\s*(.*)$/);
      if (dated) rows.push({sender:dated[2], content:dated[3], timestamp:dated[1]});
      else if (plain) rows.push({sender:plain[1], content:plain[2]});
      else if (rows.length) rows.at(-1).content += '\n' + line;
      else throw new Error('无法识别开头。每条消息请使用“姓名: 内容”，时间可写为“2026-10-01 19:30 姓名: 内容”。');
    }
  }
  if (rows.length > MAX_MESSAGES) throw new Error('消息超过 20,000 条，请缩小导出范围。');
  let skipped = 0;
  const messages = rows.flatMap((r,index) => {
    if (!r || typeof r !== 'object') { skipped++; return []; }
    const sent = r.isSend ?? r.is_send ?? r.isSender;
    const name = r.sender ?? r.senderName ?? r.sender_name ?? (sent != null ? (sent === true || sent === 1 || sent === '1' ? '我' : '对方') : null);
    const content = r.transcript || r.content || r.text || r.message;
    if (typeof name !== 'string' || !name.trim() || typeof content !== 'string' || !content.trim() || (r.type && !['text','1',1].includes(r.type) && !r.transcript)) { skipped++; return []; }
    const sender = aliases[name.toLowerCase().trim()] || name.trim();
    return [{sender:sender.slice(0,60), content:content.trim(), time:timestamp(r.timestamp ?? r.createTime ?? r.create_time ?? r.time ?? r.sendTime ?? r.msgTime), index}];
  });
  if (messages.length < 4) throw new Error('至少需要 4 条可识别的文字消息，图片、语音占位符不参与分析。');
  const authors = [...new Set(messages.map(m => m.sender))];
  if (authors.length !== 2) throw new Error(`识别到 ${authors.length} 位发送者。这里只支持双人聊天，请检查姓名写法是否一致，或先筛选出两个人。`);
  const completeTime = messages.every(m => m.time !== null);
  if (completeTime) messages.sort((a,b) => a.time - b.time || a.index - b.index);
  return {messages, authors, skipped, completeTime};
}
export function analyzeChat(parsed, self = parsed.authors[0], days = 0) {
  if (!parsed.authors.includes(self)) throw new Error('请选择聊天中代表你的发送者。');
  const other = parsed.authors.find(a => a !== self);
  const timed = parsed.completeTime;
  const last = timed ? parsed.messages.at(-1).time : null;
  const messages = timed && days ? parsed.messages.filter(m => m.time >= last - days * 86400000) : parsed.messages;
  if (messages.length < 4 || new Set(messages.map(m=>m.sender)).size !== 2) throw new Error('这个时间范围内的双人消息不足，请扩大时间范围。');
  const make = name => ({name,count:0,characters:0,starts:0,replies:[],maxRun:0,short:0,greetings:0});
  const people = {[self]:make(self),[other]:make(other)};
  const daily = new Map();
  let run = 0, sessions = timed ? 1 : null;
  messages.forEach((m,i) => {
    const p = people[m.sender], prev = messages[i-1];
    const chars = [...m.content.replace(/\s/g,'')].length;
    p.count++; p.characters += chars;
    if (chars <= 2 || shortWords.has(m.content.toLowerCase().replace(/[。！!？?\s]/g,''))) p.short++;
    if (/早安|晚安|good\s*(morning|night)/i.test(m.content)) p.greetings++;
    run = prev?.sender === m.sender ? run + 1 : 1;
    p.maxRun = Math.max(p.maxRun,run);
    if (timed) {
      const gap = prev ? (m.time-prev.time)/1000 : 0;
      if (!prev || gap > 10800) { p.starts++; if(prev) sessions++; }
      if (prev && prev.sender !== m.sender && gap >= 10 && gap <= 86400) p.replies.push(gap);
      const date = new Date(m.time+8*3600000).toISOString().slice(0,10);
      if (!daily.has(date)) daily.set(date,{date,me:0,them:0});
      daily.get(date)[m.sender === self ? 'me' : 'them']++;
    }
  });
  for (const p of Object.values(people)) {
    p.averageLength = Math.round(p.characters/p.count);
    p.replySeconds = p.replies.length ? Math.round(p.replies.reduce((a,b)=>a+b,0)/p.replies.length) : null;
    p.replySamples = p.replies.length; delete p.replies;
    p.share = Math.round(p.count/messages.length*100);
  }
  return {messages,self,other,me:people[self],them:people[other],total:messages.length,skipped:parsed.skipped,timed,sessions,start:timed?messages[0].time:null,end:last,daily:[...daily.values()],days};
}
export function duration(seconds) {
  if (seconds == null) return '数据不足';
  if (seconds < 60) return `${seconds} 秒`;
  if (seconds < 3600) return `${Math.round(seconds/60)} 分钟`;
  return `${(seconds/3600).toFixed(1)} 小时`;
}
export function sampleReport(report) {
  const length = report.messages.length;
  const indexes = new Set();
  if (length <= 48) for(let i=0;i<length;i++) indexes.add(i);
  else for (let window=0;window<6;window++) {
    const start = Math.round((length-8)*window/5);
    for (let i=start;i<start+8;i++) indexes.add(i);
  }
  let trimmed = 0, redacted = 0;
  const messages = [...indexes].sort((a,b)=>a-b).map(i => {
    const m = report.messages[i];
    const clean = m.content.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,'[邮箱已隐藏]').replace(/(?:\+?86[ -]?)?\b1[3-9]\d{9}\b/g,'[手机号已隐藏]');
    if(clean!==m.content) redacted++;
    const chars=[...clean]; if(chars.length>320) trimmed++;
    return {id:i+1,sender:m.sender===report.self?'me':'them',content:chars.slice(0,320).join('')+(chars.length>320?'…':'')};
  });
  const metric = p => ({count:p.count,averageLength:p.averageLength,starts:report.timed?p.starts:null,replySeconds:p.replySeconds,replySamples:p.replySamples,short:p.short,greetings:p.greetings,maxRun:p.maxRun});
  return {total:report.total,timed:report.timed,sessions:report.sessions,me:metric(report.me),them:metric(report.them),messages,trimmed,redacted};
}
export function observations(r) {
  const delta = Math.abs(r.me.share-r.them.share);
  return [delta<=20 ? '双方发送的消息量比较接近。数量相近说明这段记录里双方都有参与，不能单独判断情感。' : `${r.me.share>r.them.share?'你':'对方'}发送的消息更多；工作安排、表达习惯和消息拆分方式都可能影响这个差异。`,
    r.timed ? `按间隔超过 3 小时划分，这段记录有 ${r.sessions} 段对话；你开启 ${r.me.starts} 段，对方开启 ${r.them.starts} 段。记录开头也计入一次，截取范围会影响结果。` : '这份记录缺少完整时间，暂不计算回复用时、每日趋势或谁先开启对话。',
    '短回复、连续发消息和回复速度只是可观察的行为。关系需要结合当时情境与线下沟通理解。'];
}
export function markdownReport(r,analysis) {
  return ['# 她不一样 · 聊天观察报告','','这是一份交流记录的观察，不是情感测评或诊断。',`分析消息：${r.total} 条；${r.timed?'时间按 UTC+8 统计':'时间数据不足'}。`,'', '| 指标 | 我 | 对方 |','| --- | --- | --- |',`| 消息数 | ${r.me.count} | ${r.them.count} |`,`| 平均字数 | ${r.me.averageLength} | ${r.them.averageLength} |`,`| 平均回复用时 | ${duration(r.me.replySeconds)} | ${duration(r.them.replySeconds)} |`,'','## 数据观察',...observations(r).map(x=>'- '+x),...(analysis?['','## AI 解读（仅基于抽样）',analysis.summary,...analysis.observations.map(x=>`- ${x.title}：${x.detail}（消息 ${x.evidence.join('、')}）`),'','## 可以试试',...analysis.suggestions.map(x=>'- '+x),'',analysis.limitations]:[]),'','原始聊天未写入本报告。','开源灵感：https://github.com/863401402/she-love-me · MIT License'].join('\n');
}
