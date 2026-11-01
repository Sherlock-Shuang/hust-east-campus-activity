# 过拟合恋人：诡异监控画面

根据用户补充「画风可以更诡异一些」，在第二版扇形报告厅及笔记本观众图上，通过内置 imagegen 编辑光线与监控质感。保留台上朝观众席的机位、扇形排座、观众和电脑；加深后排暗部、降低饱和度、以电脑冷光照亮脸部，加入细微扫描线与信号错位。此为虚构游戏画面。

部署素材：`integration/tasay/ui-overrides/src/assets/opto-c118-audience-v3-eerie.jpg`。JPEG 仅做格式压缩，构图和像素尺寸保持生成结果。

## 最终提示词

```text
Use case: lighting-weather / style-transfer.
Asset: a fictional psychological-horror game's CCTV image sent in a chat.
Input image: EDIT TARGET. Preserve this exact university auditorium, camera composition, occupied-seat pattern, slightly fan-shaped curved seat rows, radial stair aisles, curved wooden barriers, audience scale and dozens of open laptops. Camera stays above the stage looking outward at the audience. Most people have open laptops, backs of lids toward camera and screens toward the users. Preserve the small white overlays exactly: "CAM 03   C118" at top left and "19:42:16" at top right.

Change the visual mood to noticeably more uncanny, oppressive and unsettling: an eerie late-evening surveillance recording, as if an otherwise ordinary lecture hall has become quietly wrong. Dim the ceiling lighting significantly; let the far rear rows and corners sink into deep murky shadows, while keeping enough midtone detail to clearly read the slightly curved rows and seated people even at chat-thumbnail size. Desaturate the maroon seats and pale wood; use a restrained sickly grey-green and cold blue palette. The laptop screens cast local cold light UP onto faces, hands and collars, with realistic unnatural-looking underlighting and dark eye sockets from shadow; light comes from screens facing their users, NOT luminous backs of lids. Keep recognizable human anatomy and ordinary adult faces, no monster transformations. A few of the already-present distant audience faces can appear to be looking straight toward the camera through the dimness, without adding or removing people or changing their seated body positions.

A more degraded, authentic analog-security-camera texture: noticeable fine luminance grain, faint horizontal scan lines, subtle compression smearing, a thin slightly displaced horizontal tracking band in one part of the image, mild green/magenta edge separation and soft dark corners. Effect should be visible yet restrained enough that people, laptops, aisles and auditorium architecture remain legible. Uneven practical overhead light and isolated cold computer glow create the horror mood; retain the mundane surveillance-camera optics and perspective. No cinematic spotlight, no theatrical colored haze, no giant glowing eyes, no blood/gore, no added silhouettes or figures, no distorted bodies, no cartoon or painting. Do not add new text, logos, borders or UI. Preserve widescreen 16:9 framing.
```
