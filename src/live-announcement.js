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
  function expire() {
    if (disposed || !currentKey || element.hidden) return;
    const remaining = ANNOUNCEMENT_AUTO_DISMISS_DELAY - (now() - shownAt);
    if (remaining > 0) { timer = schedule(expire, remaining); return; }
    dismiss();
  }
  function dismiss(event) {
    event?.stopPropagation();
    if (disposed || !currentKey || element.hidden) return;
    if (!event && now() - shownAt < ANNOUNCEMENT_AUTO_DISMISS_DELAY) return;
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
      close.hidden = false;
      close.disabled = false;
      element.dataset.tone = value.tone;
      element.querySelector('h2').textContent = value.title;
      element.querySelector('p').textContent = value.body;
      element.querySelector('.live-announcement-time').textContent = value.endAt
        ? `持续至 ${new Date(value.endAt).toLocaleTimeString('zh-CN', {hour:'2-digit', minute:'2-digit'})}` : '';
      shownAt = now();
      timer = schedule(expire, ANNOUNCEMENT_AUTO_DISMISS_DELAY);
    },
    dispose() {
      disposed = true;
      stopTimer();
      element.hidden = true;
      close.hidden = true;
      close.disabled = true;
      close.removeEventListener('click', dismiss);
      dismissed.clear();
    },
  };
}
