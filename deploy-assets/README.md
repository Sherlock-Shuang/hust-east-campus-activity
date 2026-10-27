# Vercel 静态作品资源

本目录只准备和还原静态文件，不调用托管平台，不启动或代理模型下载函数。提交 `asset-source/manifest.json` 和 `asset-source/chunks/*.bin`（每个都是 gzip 成员）。压缩块均小于 50 MiB，原始大模型只在 Vercel 构建机上还原，因此不将 127 MB 模型直接提交 Git。

## 在完整本地工程准备

先完成校园的 `npm run build` 与真实 `work-assets` 构建，再运行：

```sh
node deployment/vercel-assets/prepare.mjs
node deployment/vercel-assets/materialize.mjs --assets deployment/vercel-assets/asset-source --output deployment/vercel-assets/dist --config deployment/vercel-assets/routes.generated.json --include-campus
node deployment/vercel-assets/verify.mjs
```

准备脚本仅复用 `deployment/prepare-assets.mjs` 的文件白名单及 gzip 块算法；它把临时目录写在本目录中，并在结束时移除，不修改之前的平台部署目录。

## 清洁 Git 应用的构建

把本目录中的 `.mjs` 脚本复制到清洁应用的 `deploy-assets/`，把 `asset-source/` 放在应用根目录。Vercel 使用 **Git integration** 拉取私有 GitHub 仓库，框架设为 Other，静态输出目录为 `dist`。构建命令：

```sh
npm run build
node deploy-assets/materialize.mjs --assets asset-source --output dist --config deploy-assets/routes.generated.json
```

常规构建默认只还原 `/works/` 和 games JSON。它不会覆盖 Vite 刚构建的校园 HTML、脚本、食堂出生点等最新源码结果。`--include-campus` 仅用于独立资源包验收／完整快照复现。

`routes.generated.json` 是交给应用根 `vercel.json` 的 **routes 片段**，主整合流程应在部署前合并，而不是假设构建完成后平台会重新读取源配置。它包括 Content-Type、作品目录重定向、`/admin`、静态 GET／HEAD `/api/games`、受限的过拟合恋人 SPA 回退，以及通向单函数 `/api/activity` 的其余 `/api/*`。其中过拟合恋人的实际模型路径为 `/api/works/tasay/(default|fast)/chat/completions`。API 路由先于 SPA；缺失作品文件不回退成校园页面。主整合流程按后端约定保留原始请求路径。采用 `routes` 时，不与 Vercel 的 `headers/rewrites/redirects` 混用。游戏模型直接由静态输出服务。

## 已核对的限制和未确认项

- 官方 [Limits](https://vercel.com/docs/limits#static-file-uploads) 把 Hobby 100 MB / Pro 1 GB 描述为 **CLI 上传的源码总量**。这里准备的是 Git 连接构建流程，不能用 Hobby CLI 上传整个约 218 MB 压缩源包。该页讨论输出文件数量的“无上限”文字不能解释成单文件字节无限。
- 官方 [静态构建输出](https://vercel.com/docs/build-output-api/primitives#static-files) 由 CDN 直接服务，可配置 Content-Type；它不是 [Function 的 4.5 MB 响应](https://vercel.com/docs/functions/limitations#request-body-size)。原始模型不会经过 `/api/activity`。
- 在当前官方限制页与静态构建输出说明中，没有查到构建生成的 **单个静态文件明确字节上限**。本构建保留图书馆 127,924,180-byte GLB 和 Unity data 的完整原字节，不声称 Git 部署已接受这些大文件。主流程仍需真实 Git 部署、HEAD、Range 和游戏画面验收。如果平台实际拒绝，应记录明确的限制并改用允许该体积的静态对象存储／账户条件，不通过函数转发或伪装文件绕过硬限。

只提交运行资源及构建源码，不提交原图书馆制作工程、私人剧情与头像、`dist/`、node_modules、旧平台部署目录或凭据。全部存档／剧情／胜利条件沿用之前已校验的活动副本。
