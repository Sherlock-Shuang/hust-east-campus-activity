# 操作偏好与首次步行优化

本轮调整保留镜头相对步行、原腿部步态、浮动左摇杆、手动松丝换锚点与场景载具规则。

## 输入

- 触屏视角按当前 canvas 的 CSS 宽高归一化。844×390 下保持原先触屏相对鼠标的1.5倍增益；其他尺寸相同屏幕比例的滑动得到相同角度。鼠标/锁定鼠标仍使用原像素增益。
- 右上角原提示区域新增小型“操作”入口，点击才显示偏好。包含灵敏度、摇杆大小、反转上下视角、减少镜头晃动；保存于本机 `dongjiu.controls.v1`。存储受限或数据损坏时安全使用默认值。
- 设置弹层打开时清理摇杆、动作、视角触点及鼠标锁；“继续探索”或Esc关闭恢复canvas焦点，不自动锁鼠标。旋转、失焦、暂停也会释放视角pointer capture，旧手指不能恢复陈旧输入。
- 摇杆大小通过CSS变量和实际可见圆尺寸共同决定运动半径，仍按每次手指落点建立中心。

## 蜘蛛侠准备

`createPlayerModels` 初次只创建空Spider容器；步行、骑车和场景中的折叠战衣不创建蒙皮角色。世界里的折叠战衣一直是单独的轻量模型。

`player-experience` 复用已有Spider Worker准备promise。玩家过早按F时显示准备提示，不重复排队；等待期间仍能步行。完成时再次核对同一件战衣仍可达，才穿上。暂停、旋转、失焦、退出或销毁会取消待处理请求；走远后不会传送回来穿衣。

没有Worker或Worker失败的环境，仅第一次实际穿战衣时执行原同步回退。已经建立的Spider模型在换模式时复用，销毁时释放一次。预备尚未完成时同步恢复一个Spider快照会返回false且不修改位置/库存；正常同页作品返回已使用过的Spider模型不受影响。

主入口应移除“创建步行前await Spider准备”的阻塞，并保留其后台准备启动。`player-experience` 的可选 `spiderPreparation` 参数主要用于受控异步验证；正常入口自行复用现有loader。

## 验证

```sh
node --test tests/control-preferences.test.mjs tests/mobile-controls.test.mjs tests/player-models.test.mjs tests/player-experience.test.mjs
node --test tests/world-transport.test.mjs tests/transport-interaction.test.mjs tests/spider-geometry-preload.test.mjs
node scripts/benchmark-player-startup.mjs
PERF_PREPARE=1 node scripts/benchmark-player-startup.mjs
```

控制/模型回归124项通过；另载具/上下车/Worker回归33项通过。测试运行真实输入处理、Three.js角色、运动和相机模块，仅DOM表面使用夹具，不冒称手机实测。

`benchmark-player-startup.mjs` 使用3次独立进程，在构造结束及首个步行更新后计时。旧版源文件与冻结提交f296205核对一致。无预计算的Worker失败/不支持路径中位945.6→147.2ms；预先装入Worker同样几何的路径231.4→235.9ms，后者在并行任务负载中没有可据以承诺的构造加速。以上都不是网络首屏耗时或浏览器帧率。

初次步行挂载模型的属性/索引缓冲计数从14,606,446降为9,088,966字节，Spider部分延后至穿衣时构建。这不包含Worker保留数组、纹理、Three内部和GPU驱动，不能称为实际显存节省量。首次步行不等待Worker的收益由入口阶段计时另行验收。

原始日志与JSON在 `artifacts/optimization-2026-10-30/`。真实Android/iPhone长时手感与热降频尚未由本子任务验收。
