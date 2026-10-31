export const ANNOUNCEMENT_CLOSE_DELAY = 5000;
export const ANNOUNCEMENT_AUTO_DISMISS_DELAY = 6000;

// Dismissal belongs to this viewer, never to the shared host state. Content is
// part of the key so an edited announcement receives a fresh reading period.
export function mountAnnouncementNotice(element, {
  now = () => performance.now(),
  schedule = setTimeout,
  cancel = clearTimeout,
  onDismiss = () => {},
} = {}) {
  element.innerHTML = '<button class="live-announcement-close" type="button" aria-label="关闭公告" hidden disabled>×</button><span class="live-announcement-tag">codex</span><h2></h2><p></p><span class="live-announcement-time"></span>';
  const close = element.querySelector('.live-announcement-close');
  const dismissed = new Set();
  let currentKey = '', shownAt = 0, timer, disposed = false;

  function stopTimer() {
    if (timer !== undefined) cancel(timer);
    timer = undefined;
  }
  function unlock() {
    if (disposed || !currentKey || element.hidden) return;
    const elapsed = now() - shownAt;
    if (elapsed >= ANNOUNCEMENT_AUTO_DISMISS_DELAY) { dismiss(); return; }
    const remaining = ANNOUNCEMENT_CLOSE_DELAY - elapsed;
    if (remaining > 0) { timer = schedule(unlock, remaining); return; }
    close.hidden = false;
    close.disabled = false;
    timer = schedule(unlock, ANNOUNCEMENT_AUTO_DISMISS_DELAY - elapsed);
  }
  function dismiss(event) {
    event?.stopPropagation();
    const delay = event ? ANNOUNCEMENT_CLOSE_DELAY : ANNOUNCEMENT_AUTO_DISMISS_DELAY;
    if (disposed || !currentKey || element.hidden || now() - shownAt < delay) return;
    const hadFocus = !!element.contains?.(element.ownerDocument?.activeElement);
    dismissed.add(currentKey);
    stopTimer();
    element.hidden = true;
    close.hidden = true;
    close.disabled = true;
    onDismiss({automatic: !event, hadFocus});
  }
  close.addEventListener('click', dismiss);
  element.hidden = true;

  return {
    update(value) {
      if (disposed) return;
      const key = value ? JSON.stringify([value.id, value.title, value.body, value.tone, value.startAt, value.endAt]) : '';
      if (key === currentKey) return;
      stopTimer();
      currentKey = key;
      close.hidden = true;
      close.disabled = true;
      element.hidden = !value || dismissed.has(key);
      if (element.hidden) return;
      element.dataset.tone = value.tone;
      element.querySelector('h2').textContent = value.title;
      element.querySelector('p').textContent = value.body;
      element.querySelector('.live-announcement-time').textContent = value.endAt
        ? `持续至 ${new Date(value.endAt).toLocaleTimeString('zh-CN', {hour:'2-digit', minute:'2-digit'})}` : '';
      shownAt = now();
      timer = schedule(unlock, ANNOUNCEMENT_CLOSE_DELAY);
    },
    dispose() {
      disposed = true;
      stopTimer();
      close.removeEventListener('click', dismiss);
      dismissed.clear();
    },
  };
}
