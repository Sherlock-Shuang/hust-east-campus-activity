# 过拟合恋人：光电大楼剧情素材

定位名称统一为「华科光电大楼」，详情为「华中科技大学 · 光电信息大楼 C118 报告厅」。定位图使用已有 `public/data/opto-southeast.geojson` 中的 OpenStreetMap 道路、河流和建筑轮廓（© OpenStreetMap contributors, ODbL）；页面保留署名链接。剧情距离沿用 0.00 公里，不调用设备定位。

监控画面使用内置 imagegen 生成，属于虚构剧情素材，不是真实监控录像。参考原有 C118 报告厅照片的建筑材质，从台上摄像头朝观众席拍摄，增加就座观众。部署版 JPEG 保留原尺寸，仅做格式压缩。新消息与旧存档均解析当前素材，剧情进度和触发时机不变。

## 最终生成提示词

```text
Create a photorealistic fictional security-camera still for a psychological horror game, widescreen 16:9. Use the attached auditorium photo ONLY as an architectural/material reference, not for its camera direction or its real people/event text. CRITICAL NEW VIEWPOINT: the camera is mounted high at the FRONT OF THE HALL, above the stage at its left edge, aiming AWAY FROM THE STAGE, out toward the audience seats. We see the seated audience from the FRONT, with the tiers of seats rising toward the far rear wall. The stage and projection screen are BEHIND the camera and MUST NOT be visible. A tiny sliver of pale wooden stage floor at the bottom is okay. This must be the reverse view of the reference photo.

Architecture: a realistic large Chinese university lecture auditorium inspired by HUST Optoelectronics building C118. Approximately twenty rows of dark burgundy/red upholstered lecture seats with pale wood armrests, wide middle block and narrower side blocks separated by two stair aisles, a cross aisle halfway up with a low pale-wood barrier, grey acoustic sidewalls with tall dark vertical joints, dark grey ceiling beams with strips of pale wood edging, ordinary recessed overhead lights, rear double exit doors. A full-hall wide angle, fixed security-camera framing, slightly off-center from stage-left and angled slightly down over the front rows, eye-level far rear wall.

Populate with about 60 adult university attendees (considerably more people than a sparse 12-person scene), naturally scattered in clusters across front, middle and back rows, around one third of the seats occupied and plenty of empty seats remaining. All are seated, mostly looking toward the stage/camera direction, a few looking at notebooks or phones; realistic small body scales, casual autumn clothing. People are distant and faces are not individually recognizable. No person looming or posing, no duplicates, no visible horror creature or blood.

Visual treatment: mundane authentic low-resolution CCTV aesthetic, muted cool grey/green color cast, restrained exposure, faint sensor grain, compression, slight barrel lens distortion, very subtle horizontal scanlines. Enough clarity to see the auditorium and seated audience. NO cinematic spotlights, NO polished architectural render, NO surrealism. Small simple white monospaced camera overlay top left "CAM 03   C118", top right "19:42:16". No other text, logos, border, branding, actual institutional seal, or watermark.
```
