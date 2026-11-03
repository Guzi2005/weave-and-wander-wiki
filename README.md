# W&W Wiki · 本地图像档案

以图像为入口的本地研究档案。当前仅本机运行，尚未发布到域名。

## 启动与检查

在本目录运行 `D:\NodeJS\node.exe server.mjs`，打开 <http://127.0.0.1:4318/>。服务只绑定 `127.0.0.1`，不向局域网或公网开放。

检查命令：`npm run check`；测试命令：`D:\NodeJS\node.exe --test tests/*.test.mjs`。测试使用临时数据，不覆盖个人档案。

## 已有功能

资料库以原图为中心，支持网址、类别、笔记、文化归属、地点和年代的渐进整理。缺字段不阻塞收录。详情页完整显示原图，部件聚焦保留原文件；原始证据与生成概念分列，记录与母条目、部件、题目相连。

工坊提供 GLB 三维预览、原图对照、待机呼吸、不同配速行走、转圈速度和不匀速程度控制。模型选择器覆盖全套、头饰、上衣、长裙、关联鞋垫与通用鞋履。模型是游戏适配品，未见背面、系结、精确尺寸与生成织纹不作为考证证据。

题库支持草稿、审定人、来源类型、关联档案修订号与编辑。只有已审定且来源记录未变化的题目可进入游戏导出；自动收录和本次视频阅读题均保持草稿。

## 本地参数工坊

Godot 原生参数场景为项目根的 `scenes/wiki_asset_preview.tscn`。从项目根运行：

```powershell
& 'D:\Godot\Godot_v4.7.1-stable_win64\Godot_v4.7.1-stable_win64_console.exe' --path . --rendering-method mobile scenes/wiki_asset_preview.tscn
```

原生研究台可调米珠颜色、珠径、串数、紧密度、材质及重复单元（含 3 小珍珠 + 1 大珍珠），辫冠颜色、宽度、厚度与交叉节距，头花颜色、半径、层数、瓣数、杯深、挂点高度及倾角。点击“应用并重筑”更新模型，会话中的调节不直接改写资源。

持久化资源位于 `assets/collections/mosuo_seed_beads.tres`、`mosuo_braid.tres`、`mosuo_flower.tres`。珠串与辫冠的路径使用 `Curve3D` 控制点。网页工坊用于查看已导出的版本；上述几何参数目前在原生研究台调节。

`scenes/mosuo_adornment_authoring.tscn` 提供独立的编辑器节点：选择 `ParametricFlower`、`ParametricBeadBundle` 或 `ParametricBraid` 展开 recipe；选择 `TasselRoute` / `BraidRoute` 的 Path3D 可在 3D 视图拖动控制点，生成节点会重建几何。该场景内资源是独立副本；要用于游戏，使用 Inspector 将修改后的 recipe 保存到对应 `.tres`，再运行 `tools/export_mosuo_assets.gd`。参数工坊节点属于 Godot；Blender 保存布料源几何和导入的游戏预览。

Blender 文件为 `assets/collections/mosuo_photo_001/mosuo_photo_001.blend`：`WW_Photo001_Refined` 是可编辑的服装源几何，`WW_GamePreview` 为当前导出模型的骨骼与材质回读。六份 GLB 由 `tools/export_mosuo_assets.gd` 导出；附带 idle、walk、handwork 与 sewing 动画，旋转由查看器独立控制。银线金属遮罩、法线和底布粗糙度随模型导出。

## 照片001与补充视频

种子数据有 7 条记录、4 道草稿题。`WW-MOS-001` 为照片套装母条目；核心三件为 C01 头饰（包含紫色米珠串）、C02 上衣（含宽腰带）、C03 长裙。`WW-MOS-001-P01` 是同图关联手工对象：用户识别的灰面、玫红镶边鞋垫，属于 object，不增加为第四件服装。`WW-GEN-001` 是独立通用鞋履，无文化属性。

原始照片为 `public/assets/source.png`（515×1034，SHA-256 `E64DF3D2DB963E9DE8E7868502BAFF1A42C4EFB3574E438ED2B67BBA5B6EAA1B`）。拍摄者、时间、地点、原始链接和授权待补。用户提供文化归属，不据此识别照片人物身份。

补充视频为时差岛发布的《什么是真正的摩梭？》，来源页 <https://www.xiaohongshu.com/explore/682bc550000000002002a98d>。用户提供的本地视频为研究读取源，不把完整视频复制到网站。截图与抽帧单列来源 V-MOS-002；视频中的不同穿戴实例不并入照片001。种子记录 ID 为 `WW-MOS-REF-002`；已运行的个人库沿用原有 ID `WW-L-MVSWUWIH-D3AFD3`，以 `collection_id: mosuo_video_002` 查找，导入不改名也不破坏旧链接。

新增文化笔记分别标注“视频讲述”与“画面观察”：02:10 的披肩／假发材料说明、02:12–02:14 的裙身红线解释、06:28 的“阿咪”字幕转写、07:16 的建筑示意、07:20 的花楼研究线索。它们保留时间码和对应抽帧，未独立考证的解释不自动成为民族志事实。两道视频阅读题明确问“按该视频字幕”，仍需人工审题。

初次补充影像可运行 `D:\NodeJS\node.exe import-mosuo-video.mjs`。随后运行 `D:\NodeJS\node.exe import-mosuo-research.mjs`，通过本地 API 补充资料、鞋垫及草稿题；重复执行不增加副本、不覆盖无关用户笔记、不空增修订号。`--seed-only` 只更新种子。服务端代码变化后须重启服务器再导入。

## 发型节点样式对比

`#/node-styles` 页并排展示程序化发型节点（导航“发型节点”，工坊页亦有入口）。页面读取 `public/assets/node-styles/manifest.json`（schema `ww-node-styles-v1`），逐条校验 `title`、`description` 与 `entries[{id,label,image,recipe,parameters,evidence_status,note}]`；图像仅接受 `/assets/node-styles/*.png`，recipe 仅接受 `/assets/node-styles/*.tres`，校验失败在页面明示错误。预期六个条目：legacy-single、double-yak、double-loose、double-dense、single-copper、double-soft。图像与 recipe 由根级工序产出，本目录不生成替代资产。

除 double-yak 外所有变体均为游戏支持的通用程序化发型节点，不作文化归属；legacy-single 是保留的旧版单圈盘旋资产，并非真实传统发式的断言；double-yak 参考摩梭人案例照片 P1（`/assets/mosuo-braid-reference-003.png`，根级工序生成），P1 与照片001为不同穿戴者，用户识别其为超粗牦牛毛辫盘绕两圈，可见几何用于建模适配，照片001纤维未独立鉴定。参数单位为模型米，非实测历史尺寸。

`D:\NodeJS\node.exe import-mosuo-style-update.mjs` 执行本次更正导入：作者自拟标签“摩梭族／摩梭民族／摩梭服饰／摩梭套装”统一为“摩梭人…”表述（不动来源标题《什么是真正的摩梭？》、字幕原文与 source 对象），向 C01 与照片001追加用户更正与参考说明、在 C01 登记 P1 来源媒体、记录 legacy-single 保留为通用节点及穿戴资产共享平面赛璐璐着色（织物材质研究单列）的制作决定。变换为纯幂等函数，运行期仅经本地 API 以 PATCH 差异写入，不覆盖运行库 JSON，内容无变化不空增修订号。`--seed-only` 只更新种子。

## 数据与接口

运行期档案保存在 `data/records.json`，首次从 `seed/records.json` 复制；上传媒体位于 `public/media/`。两者均已 gitignore。每次保存以临时文件加原子 rename 写盘；记录更改增加修订号。页眉可下载完整备份 JSON，也可单独下载游戏题库导出。

常用接口：`GET/POST /api/records`、`GET/PATCH /api/records/:id`、`POST /api/media`、`GET/POST /api/questions`、`GET/PATCH /api/questions/:id`、`GET /api/game-export`、`GET /api/export`。创建记录可选稳定 `id`，限 `WW-` 开头的大写字母／数字连字符编码；重复 ID 会被拒绝，省略则自动生成本地 ID。

写入要求回环 Host 和同源 Origin。静态路径、文本长度、枚举值、图像魔数、上传体积和关系循环均校验；前端记录文本以 `textContent` 显示。模型的 `/assets/models/*.glb` 下载地址通过受控资产映射提供，不混入来源图片列表。
