# 同源活动作品桥

本次校园、三个作品和嵌套游戏统一部署在同一 origin。`campusParentOrigin` 只能等于作品自己的 `location.origin`；它不是可信来源配置入口。跨域嵌入不能靠修改查询参数授权。每条消息同时校验 `event.source === parent`、准确 origin，以及 `attemptId`；缺失或过期的 attempt 一律忽略。

父页面在作品 URL 追加 `campusParentOrigin` 和本次进入的 `campusAttempt`。后者由子页面原样返回，刷新／重新打开时以当前 URL 为准。可选作品加载示例：

```html
<script src="/experiences/activity-bridge.js" data-work="your-configured-work-id"></script>
```

| 方向 | 消息 | 含义 |
|---|---|---|
| 父 → 子 | `{type:'campus:activity', attemptId, paused, announcement, serverTime}` | 暂停／恢复及活动引导；`paused` 必须是布尔值 |
| 父 → 子 | `{type:'campus:dispose', attemptId}` | 结束本次实例，暂停并清理资源；随后恢复消息无效 |
| 子 → 父 | `{type:'campus:ready', attemptId, workId?, level:'page_opened'}` | DOM 已构建，不代表模型已加载或通关 |
| 子 → 父 | `{type:'campus:ready', attemptId, workId?, level:'runtime_ready'}` | 作品自己的真实运行时就绪信号 |
| 子 → 父 | `{type:'campus:error', attemptId, workId?, message}` | 加载失败，父层显示重试／返回 |
| 子 → 父 | `{type:'campus:exit', attemptId, workId?}` | 请求返回校园；暂停期间父层不接受返回 |

`activity-bridge.js` 在 DOM 就绪时仅报告一次 `page_opened`。作品必须在实际模型／游戏引擎完成初始化后调用 `window.campusActivity.ready('runtime_ready')`，失败时调用 `fail(message)`；不要用进度条、iframe `load` 或退出操作伪造运行就绪或胜利。SDK 不发送任何完成游戏事件，也不接管 Esc 或其他游戏按键。

```js
const unsubscribe = window.campusActivity.subscribe(state => {
  setGamePaused(state.paused);
  if (state.disposed) {
    cancelAnimationFrame(animationFrame);
    stopAudio();
    disposeRenderer();
  }
});
// 按作品的真实运行时调用：
await loadRequiredModelsAndStartGame();
window.campusActivity.ready('runtime_ready');
returnButton.onclick = () => window.campusActivity.exit();
```

订阅者会收到包含 `disposed` 的最终状态，随后自动移除；同时分发 DOM `campus:activity` 和最终 `campus:dispose` 事件。仅暂停输入不等于释放渲染／音频，作品仍须在其生命周期中执行清理，父层随后移除 iframe。

图书馆活动副本使用 `campusWorkAdapter` 接入其现有控制器。两个 GLB 成功解析后报告运行就绪；晚言在 `createUnityInstance()` 成功后报告。图书馆内部以撒／晚言原有 `bookrealm:*` 和真实胜利消息继续使用同源父子校验，未改成活动统计事件，也不要求校园的 attempt 参数。它们与上述 `campus:*` 协议分别处理，暂停不触发胜利。
