# 东校区 online 动态封面

- 用户提供的 11 秒、1080p 视频作为背景。导出只包含 H.264 视频流，移除全部音轨，开启 MP4 faststart；页面再次设置 muted/defaultMuted/volume=0。
- 标题与入口采用 Liu Jian Mao Cao 手写字体，按实际文字生成约 3.5 KB WOFF2 子集；SIL OFL 许可随字体保留在 `public/fonts/entry-brush-OFL.txt`。字体来源：https://github.com/google/fonts/tree/main/ofl/liujianmaocao 。
- 标题逐字淡入、轻微浮动。没有额外叠加落叶，直接使用视频中已有的叶片、飞车与光影运动。
- 加载时隐藏且禁用「开始体验」，`campus:ready` 后显现；必须此后点击才进入，提前点击不排队。启动失败隐藏入口并保留已有恢复路径。
- 自动播放受限或视频出错时保留原封面图。减少动态效果模式不请求视频；页面隐藏暂停，进入校园后卸载视频。

验证：34 项入口、媒体生命周期、校园音乐和现场控制相关测试通过；生产构建通过；本地桌面与 390×844 手机预览、静音播放、昵称入口和视频资源释放通过。
