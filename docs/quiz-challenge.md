# W&W Wiki 样本闯关系统

## 功能与边界

入口仍为 `#/practice`，宿主页标题、页眉、页脚、顶层导航和资料库路由保留。原顺序练习由样本闯关替换，`#/questions` 本地题库管理与后端保持原样。

默认五关：历史、地理、文学、科学、终极挑战，每关四道计分题与一道知识拓展。普通题每题10分；拓展题不计分、不进入正确率分母。正确率分母是本次已答普通题数；完成全部题目后才结算并判断通过。每关 `passRate` 独立配置，历史关80%、中间三关75%、末关100%。第一关开放，按顺序解锁；已完成关卡可重玩。

本次得分与历史最佳分开保存；累计成绩是各关**历史最佳之和**，不是各次尝试之和。失败尝试的最佳分也保留；未完成便退出的尝试不入历史最佳。重玩失败不撤销既有通关或影响其他关卡成绩。

界面包含首页、动态关卡列表与圆点连线、约2秒过渡、单选/判断/拓展、提示、正确/错误反馈、结算、失败重试、下一关与最终通关。题库工坊是组件内的原生 modal dialog，提供关卡/题目增删排序、内容与答案编辑、通关率、审核标记、JSON文件/文本导入、完整JSON下载与默认恢复。

题库与进度仅在组件内存中。应用新题库或 reset 会重置进度；取消编辑不改变游戏；刷新、路由离开后重进恢复默认。不使用浏览器存储，不访问题库API，不接入AI，不写服务器数据库。样本中的 `humanReviewed:false` 明确表示来源经过开发阶段核查，但未声称真人审定。

## 文件职责

新增：

- `public/quiz-question-bank.js`：schema、25道样本题与引用、校验/规范化、JSON导入导出、可玩题审核过滤。
- `public/quiz-challenge-state.js`：纯状态机、解锁、提交、判分、过关、最佳成绩、重试和重置。
- `public/quiz-challenge.js`：组件工厂、全部视图、编辑器、Toast、Canvas、快捷键、生命周期。
- `public/quiz-challenge.css`：所有选择器限定 `.ww-quiz-challenge`，变量限定 `--ww-quiz-*`；系统字体、无CDN，包含减弱动画规则。
- `tests/quiz-question-bank.test.mjs`：有效/非法题库、ID、关联、审核与JSON往返。
- `tests/quiz-challenge-state.test.mjs`：判分、知识题排除、解锁、重玩、最终通关及特殊ID。
- `tests/quiz-build.test.mjs`：在临时目录构建，核对模块、CSS、公开标记、只读Worker及CSS作用域。
- 本文：数据协议、接入方式与实际验证记录。

修改：

- `public/player-pages.js`：保留 `renderPractice()`，动态导入组件并返回实例；由宿主处理档案跳转。
- `public/app.js`：只增加 `activePractice`，路由切换销毁，异步挂载后再次检查路由令牌。
- `public/index.html`：引入组件专属CSS。
- `build-public.mjs`：将四个组件资源加入原公开复制白名单。

没有修改 `public/styles.css`、其他页面的渲染逻辑、服务器、数据库或种子题库。

## 数据协议

采用独立的 `stages` 与扁平 `questions` 数组，通过 `stageId` 关联。这样便于按档案专题生成、合并、审核题目，不必改动渲染层。关卡与题目各用 `order` 决定顺序，不依赖数组输入顺序。ID分别全库唯一，order在关卡列表/同关题目内唯一。

最小的完整可导入示例：

```json
{
  "schemaVersion": 1,
  "bankId": "regional-demo",
  "title": "地域服饰专题",
  "description": "基于可追溯资料的专题阅读",
  "stages": [
    {
      "id": "topic-anhui",
      "title": "安徽",
      "description": "阅读安徽专题档案；此处题目仅示范数据结构。",
      "order": 1,
      "passRate": 80
    }
  ],
  "questions": [
    {
      "id": "anhui-demo-q1",
      "stageId": "topic-anhui",
      "order": 1,
      "type": "single",
      "question": "阅读服饰档案时，哪种做法更可靠？",
      "options": [
        {"id": "A", "text": "核对原始来源和适用范围"},
        {"id": "B", "text": "只凭外观猜测民族归属"}
      ],
      "answer": "A",
      "explanation": "观察结论需要来源支持，避免把单一案例推广为全部。",
      "hint": "留意证据范围。",
      "source": {"type": "sample", "recordIds": [], "references": []},
      "generation": {"provider": "manual", "model": null, "generatedAt": null, "verified": true},
      "review": {"status": "approved", "humanReviewed": false, "reviewer": "样本来源核查（非人工审定）", "reviewedAt": "2026-11-09T00:00:00.000Z"}
    }
  ]
}
```

新增苏州、维吾尔族、壮族等关卡：加入唯一ID的stage、设置名称/介绍/order/passRate，再加入指向该stageId的题目。每关至少有一道已审定普通题；数量不固定，界面与解锁逻辑无需修改。示例中的地区名不是对题目文化归属的事实断言，正式专题必须补入相应来源。

题型：

- `single`：2–4个带唯一ID的选项，answer必须指向其中一个ID；界面快捷键按显示顺序A–D/1–4映射。
- `boolean`：两个选项ID必须为 `T`、`F`，支持T/F快捷键。
- `knowledge`：`options:[]`、`answer:null`；解析作为拓展内容，Enter/Space继续。

stage passRate须为0–100有限数，0也只有完成全部题目后才判定。无普通题、仅剩草稿普通题、重复ID/order、缺关联、非法题型或答案等均拒绝。导入先校验完整副本，成功才原子替换。JSON最多5MB、100关、2000题。所有文本用textContent，来源链接仅允许http(s)。状态映射使用无原型对象，避免特殊ID触发原型属性。

`review.status` 支持draft/approved/rejected；只有approved且verified的题目可玩。非manual提供方须有模型、生成时间、人工审核与审核人/时间才能批准。AI草稿可保留在题库中，但不进入挑战。编辑题干/选项/答案/解析/提示/档案关联会撤回为草稿并清除核查标记；编辑器中需重新核查并设为已审定。

## 外部控制

```js
import {createQuizChallenge} from './quiz-challenge.js';
const instance = createQuizChallenge({
  container,
  questionBank: validatedBank,
  onOpenRecord(recordId) {
    location.hash = '/record/' + encodeURIComponent(recordId);
  },
  onProgress(state) { /* 仅接收快照 */ },
  onComplete(state) { /* 每次完整进度仅通知一次 */ }
});
instance.getState();
instance.getQuestionBank(); // 返回副本
instance.setQuestionBank(nextBank); // 完整校验，成功后重置；失败抛错且保持原状态
instance.reset(); // 保留题库，清除成绩
instance.destroy(); // 幂等
```

组件不解析Hash、不注册路由；未来的数据加载由宿主/独立服务模块负责，加载后调用setQuestionBank即可。不伪造AI请求或预留带密钥的前端接口。

销毁会中止监听器、取消过渡和Toast定时器、取消Canvas帧、断开ResizeObserver、关闭并移除编辑器、释放下载Object URL、删除组件根节点。组件键盘监听只在根节点内部，表单输入与编辑器打开时不拦截游戏快捷键，按钮/链接保留原生Enter与Space行为。dialog使用原生焦点约束与Esc关闭，关闭后恢复触发按钮焦点。

## 未来AI接入点

由独立的服务端模块按专题获取档案及修订号，提取可公开且有来源的文本，调用模型生成上述标准JSON。生成记录须标记实际provider/model/generatedAt，默认draft、verified:false、humanReviewed:false。先结构校验，再核查答案与来源并人工审核；批准后再次校验，将正式题库传给宿主的setQuestionBank。

档案ID写入source.recordIds；未来若要跟踪来源变更，可升级schema增加修订映射及复核规则。当前不声称已具备档案修订自动复核。硅基流动/DeepSeek的Key应只存在服务端环境变量，限流、预算和重试由该模块负责，不进入UI或仓库。

## 样本来源

每道题解析区都有外部来源链接；默认没有假造的Wiki档案ID，因此不显示“查看相关资料”。已通过临时导入带 `WW-MOS-001` 的测试题核对宿主跳转。

- 中国农业博物馆《素纱襌衣》：https://www.agriculturalmuseum.com/detail/zh/36289.html
- 中国丝绸博物馆《锦程：中国丝绸与丝绸之路》：https://chinasilkmuseum.com/zz/info_17.aspx?itemid=26320
- 中国非物质文化遗产网《中国传统桑蚕丝织技艺》：https://www.ihchina.cn/sangcansi.html
- 中国非物质文化遗产网《传统蓝印花布的现状》：https://www.ihchina.cn/project_details/10693/
- 中国丝绸博物馆蚕丝成分科普：https://www.chinasilkmuseum.com/gwgk/info_4.aspx?itemid=26483
- 《全唐诗·游子吟》原文：https://ctext.org/text.pl?if=gb&node=179348&remap=gb
- 《诗经·秦风·无衣》原文：https://ctext.org/book-of-poetry/wu-yi1

## 验证记录（2026-11-09）

运行时：现有桌面应用提供的Node.js v24.22.1，未安装项目依赖。项目未声明engines；现有测试依赖Node内置test、fetch等能力。本文不声称已验证其他Node版本。

已执行：

1. 题库与状态测试23项全部通过；隔离公开构建测试1项通过。包括0/75/100通过率、动态一关/六关、草稿/AI审定限制、知识题排除、重复提交、重复累计、其他关成绩保留、最终通关与特殊ID。
2. 完整原项目测试在LFS指针快照中有一项既有bead-model测试失败：将模型指针按GLB解析时JSON报错。该模型文件与原提交相同，不是闯关改动。最终完整测试共97项，96项通过、1项失败；新增24项全部通过。下载真实LFS模型的尝试因网络超时未完成。
3. 临时副本中初始化seed为测试数据库并运行build-public：成功生成30条档案、1道审定题和27个模型名称映射；四个组件资源字节一致，HTML引用完整。项目自身data/records.json始终未创建。
4. 在公开产物的实际CSP下，浏览器完成进入关卡、快捷键选择、提交、正确反馈，无浏览器错误。生成Worker拒绝POST/PATCH。
5. 浏览器完整走完25题五关，最终200分；另走过错误反馈、25%失败、重试成功、解锁和知识题Space继续。
6. 工坊实际检查：关卡/题目新建、删除、上下移、改名、题型/答案修改、非法JSON拒绝、JSON导出与再导入、应用、默认恢复。编辑后撤回核查、重新核查批准再应用已验证；Enter打开和Esc关闭、关闭后焦点回触发按钮已验证。
7. 390px手机、820px平板、1440px桌面；手机选项单列、弹窗可滚动、长题干/选项/解析无页面横向溢出。临时十二关题库渲染12张卡片，进度路径内部横向滚动，页面宽度仍为390px。
8. 首页、资料库、档案详情、指南、共创、题库管理页面已核对可见内容；来源跳转采用#/record/:id。刷新和路由离开重进恢复默认。路由离开后组件根与Canvas均为0，重进Canvas为1。
9. 临时浏览器测试页的25项公开接口/生命周期断言全部通过：三次挂载/销毁、只读副本、非法set不破坏题库、有效set与reset、modal打开、幂等destroy、销毁后无待执行动画帧、回调执行。该测试页只在临时目录，不属于产品页面。

限制：没有测试所有浏览器引擎、没有部署线上。减弱动画已通过CSS/代码检查，尚未实测切换OS偏好。源码中的Git LFS模型指针影响现有三维测试和预览，正式开发环境应获取对应真实LFS资源，不应把指针误当模型。

## Git来源

从明确指定的GitHub真实仓库获取提交和目录树，再将原归档192个文件逐一与Git blob SHA核对并补齐对象，恢复真实.git；没有将快照重新初始化为无关仓库，也未覆盖工作文件。基线为 `c76cbcd6d04db41b2b7850354ba602ef50efc340`，独立分支为 `feature/quiz-challenge-prototype`。提交与远程推送的最终状态见交付报告；不向main提交或推送。
