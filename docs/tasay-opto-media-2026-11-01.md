# 过拟合恋人：光电大楼剧情素材

定位名称统一为「华科光电大楼」，详情为「华中科技大学 · 光电信息大楼 C118 报告厅」。定位图使用已有 `public/data/opto-southeast.geojson` 中的 OpenStreetMap 道路、河流和建筑轮廓（© OpenStreetMap contributors, ODbL）；页面保留署名链接。剧情距离沿用 0.00 公里，不调用设备定位。

监控画面使用内置 imagegen 生成，属于虚构剧情素材，不是真实监控录像。参考原有 C118 报告厅照片的建筑材质，从台上摄像头朝观众席拍摄，增加就座观众。部署版 JPEG 保留原尺寸，仅做格式压缩。新消息与旧存档均解析当前素材，剧情进度和触发时机不变。

## 初版生成提示词

```text
Create a photorealistic fictional security-camera still for a psychological horror game, widescreen 16:9. Use the attached auditorium photo ONLY as an architectural/material reference, not for its camera direction or its real people/event text. CRITICAL NEW VIEWPOINT: the camera is mounted high at the FRONT OF THE HALL, above the stage at its left edge, aiming AWAY FROM THE STAGE, out toward the audience seats. We see the seated audience from the FRONT, with the tiers of seats rising toward the far rear wall. The stage and projection screen are BEHIND the camera and MUST NOT be visible. A tiny sliver of pale wooden stage floor at the bottom is okay. This must be the reverse view of the reference photo.

Architecture: a realistic large Chinese university lecture auditorium inspired by HUST Optoelectronics building C118. Approximately twenty rows of dark burgundy/red upholstered lecture seats with pale wood armrests, wide middle block and narrower side blocks separated by two stair aisles, a cross aisle halfway up with a low pale-wood barrier, grey acoustic sidewalls with tall dark vertical joints, dark grey ceiling beams with strips of pale wood edging, ordinary recessed overhead lights, rear double exit doors. A full-hall wide angle, fixed security-camera framing, slightly off-center from stage-left and angled slightly down over the front rows, eye-level far rear wall.

Populate with about 60 adult university attendees (considerably more people than a sparse 12-person scene), naturally scattered in clusters across front, middle and back rows, around one third of the seats occupied and plenty of empty seats remaining. All are seated, mostly looking toward the stage/camera direction, a few looking at notebooks or phones; realistic small body scales, casual autumn clothing. People are distant and faces are not individually recognizable. No person looming or posing, no duplicates, no visible horror creature or blood.

Visual treatment: mundane authentic low-resolution CCTV aesthetic, muted cool grey/green color cast, restrained exposure, faint sensor grain, compression, slight barrel lens distortion, very subtle horizontal scanlines. Enough clarity to see the auditorium and seated audience. NO cinematic spotlights, NO polished architectural render, NO surrealism. Small simple white monospaced camera overlay top left "CAM 03   C118", top right "19:42:16". No other text, logos, border, branding, actual institutional seal, or watermark.
```

## 根据用户补充修订

报告厅改为略呈扇形、座椅排成自然弧线；大多数观众使用打开的笔记本电脑。镜头在台上朝向观众，因此主要看到电脑盖背面，屏幕朝向使用者。部署素材为 `integration/tasay/ui-overrides/src/assets/opto-c118-audience-v2.jpg`，使用内置 imagegen 编辑初版画面。

```text
Edit this fictional CCTV game image while preserving the stage-mounted camera looking OUT AT THE AUDIENCE, the red upholstered seats, pale wood details, grey acoustic walls, ordinary university auditorium lighting, muted cool surveillance colors, the occupied-seat density, the 16:9 composition and the small overlays "CAM 03   C118" / "19:42:16".

Two essential corrections:
1. The auditorium has a SLIGHT FAN-SHAPED floor plan, not a rectangular grid. Rebuild the seating layout so rows form natural, visibly gentle concentric arcs around the stage. The two stair aisles radiate outward toward the rear of the room, dividing a broad central wedge and two narrower side wedges. The room widens modestly toward the rear. Use gently curved middle cross-aisle barriers following the curved rows. This is still a realistic enclosed university lecture hall with tiered seating, not a huge semicircular outdoor amphitheater. Keep geometry and perspective coherent from the front/stage viewpoint.
2. MOST attendees, about 75–85%, are using OPEN LAPTOP COMPUTERS on their seat's small fold-out writing desk or a modest lap desk. Show dozens of distinct but ordinary 13–15 inch silver/grey/black laptops distributed naturally across the FRONT, MIDDLE and BACK rows, scaled smaller with distance. Some people type, others watch the speaker. Very important physical orientation: because the camera is on stage looking toward the audience's faces, we mostly see the BACKS of the open laptop lids, while the screens face their users; do not put screens facing backward toward the stage. Laptop screen glow should only faintly illuminate nearby faces/hands, not make the room neon. Leave a minority with notebooks or no device. Devices must rest on desks, not float, and should not appear on every empty seat.

Retain a natural mix of seated adult students with subtle posture variation and many empty seats. No clearly identifiable real individuals. Slight soft sensor detail, restrained grain/compression/scan lines, no cinematic light beams, no dramatic staging, no new text or logos, no extra UI/border. No stage backdrop or projection screen visible because these remain behind the camera. A narrow strip of pale wood stage floor can remain at the bottom. Make the fan-shaped rows and abundance of correctly oriented open laptops unmistakably readable.
```
