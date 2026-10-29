(() => {
  const main = document.getElementById('project');
  const instruction = document.getElementById('ai-instruction');
  const copyStatus = document.getElementById('copy-status');
  const activityStatus = document.getElementById('activity-status');
  const activity = window.campusActivity;
  let blocked = false;

  activity?.subscribe(state => {
    blocked = state.paused || state.disposed;
    main.inert = blocked;
    activityStatus.hidden = !blocked;
    activityStatus.textContent = state.disposed ? '此体验已结束。' : '活动暂停中，请等待主持人继续。';
  });

  document.getElementById('return-to-campus').addEventListener('click', event => {
    if (blocked) { event.preventDefault(); return; }
    if (window.parent !== window) {
      event.preventDefault();
      activity?.exit();
    }
  });

  document.getElementById('copy-instruction').addEventListener('click', async () => {
    if (blocked) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(instruction.value);
      if (!blocked) copyStatus.textContent = '已复制，可以粘贴给电脑上的 AI 编程助手。';
    } catch {
      if (blocked) return;
      instruction.focus({preventScroll: true});
      instruction.select();
      copyStatus.textContent = '已选中下方指令，请长按或使用复制快捷键复制。';
    }
  });
})();
