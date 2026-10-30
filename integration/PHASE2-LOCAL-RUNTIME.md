# 性能第二阶段：本地运行副本边界

本地主目录继续使用现有 Node 服务与 `work-assets/`。这一轮同步了作品加载/缓存处理、活动副本构建与相关回归；没有在主目录创建 `asset-source/` 或 `deploy-assets/` 半套部署工具。

- `library/handler.mjs` 从原 `work-assets/library-manifest.json` 白名单提供版本化模型、角色、decoder和晚言；保留 Range、ETag，并给内容hash路径正确的immutable缓存。
- `library/build.mjs` 从只读原礼物生成活动版，第一人称不再等待人物；新版辅助模块与数据映射随构建写出。原GLB仍保留。
- `tasay/build.mjs` 在活动副本中注入退出时React卸载、音频/定时器清理及BFCache恢复，不改原恋人源码和叙事/存档。
- 图书馆 `?assets=original` 仍能对照保留模型。晚言ASTC为显式 `?quality=mobile` 候选；常规入口保持PC包，避免默认增加下载。

**资产制作、Unity Mobile构建、pack更新/物化及浏览器批量验收命令在部署工作区或对应Git部署仓库执行**：当前本机工作区为主项目下的 `deployment/performance-phase2-20261030/`。`prepare-*`、`optimize-*`、`measure-*`、`verify-*` 新制作工具没有额外复制进本地主目录。参见该工作区 `docs/WORK-ASSET-PERFORMANCE-PHASE2-2026-10-30.md`。本地主目录既有基础Unity构建脚本保留原样。

相关轻型本地检查：

```sh
node --test integration/library/library-performance.test.mjs integration/library/wanyan-quality.test.mjs integration/library/activity-door.test.mjs integration/library/touch-controls.test.mjs
TASAY_SOURCE=/absolute/path/to/ta-say node --test integration/tasay/activity-lifecycle.test.mjs integration/tasay/chat-viewport.test.mjs integration/tasay/linked-portal-admin.test.mjs
```

来源回归中，独立运行hash基线 `library/fixtures/runtime-baseline.json` 只在pack物化不携带原构建来源字段时使用；仍对照真实SWF/Unity文件字节验证，不包含私人源目录或配置。
