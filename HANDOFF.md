# 檐 / Eave — 源码交接说明

给接手优化这份代码的模型/工程师。先读完这一页再动手，能省掉几小时排查。

## 这是什么

Windows 10/11 桌面悬浮胶囊（类似 iOS 灵动岛），Electron 打包成 NSIS 安装包。
常驻态是一条 190×34 的小胶囊，鼠标悬停展开成 402px 宽的面板
（媒体 / 系统状态 / 剪贴板 / 计时器 / 开发工具箱 / 文件暂存 / 设置）。

- 作者：520Yui940
- 栈：Electron 44.4.1 + React 19 + TypeScript + Vite 7 + electron-vite 5 + koffi 3.3（原生 FFI，预编译，无需 C++ 工具链）
- 版本 0.5.1，包名 `com.eave.app`
- 目标平台：Windows 10 (17763+) / Windows 11

## 版本增量

- 0.3.0：主题系统 / 封面取色 / 系统波形 / 胶囊玩法 / 动效升级（详见下文各段）
- 0.3.1：系统面板布局修复（高度预算方法论）
- 0.4.0：开发工具箱（八件套）+ 皮肤系统 + 游戏迷你条 + 文件暂存
- 0.5.0：岛内住客（二次元小人，双帧眨眼 + 事件心情）
- 0.5.1：进度条不确定态（播放器不向 SMTC 报进度时的兜底）

## 0.3.0 增量（2026-09-17）

**新特性**（全部走合成器动画 + 按需计算，实测内存与 0.2.0 持平）：

- **主题系统**：`theme: dark|light|auto` 真正生效（此前只是字段）。浅色主题在
  `.stage--light` 里翻转 CSS 变量；auto 用 `matchMedia('prefers-color-scheme')`。
  注意 `--island-bg` 是内联变量，浅色/深夜底色由 App.tsx 按 React 侧换值。
- **强调色跟随封面**：`accentFromCover` 开关（默认开）。`src/renderer/src/color.ts`
  在 24×24 离屏画布上做 12 桶色相直方图取主色；按封面「长度+尾指纹」缓存（不能拿
  整段 dataURL 当 key，一张封面几百 KB）。深夜档（23:00~07:00）胶囊自动转暗。
- **系统面板波形**：CPU 与上行/下行速率各 40 点历史（1Hz，SVG polyline，
  每秒只改一个 points 属性）。网速用对数归一（50MB/s 顶格）。
  （0.3.1 起 CPU 卡 hint 位取消，日期信息移至天气行。）
- **胶囊形态玩法**：播放时胶囊显示封面缩略图（`.pill__art`）；新剪贴板条目到达
  弹呼吸点（`.pill__pulse`，1.6s 一次性动画）；充电时显示绿色闪电点。
- **动效升级**：展开内容子级交错入场；封面光晕 24s 缓慢漂移；胶囊 hover 微抬升。

**重构**：

- `EMPTY_MEDIA` 收敛到 `shared/types.ts` 单一来源（main/renderer 两份手抄已删）。
- `SettingsPanel` 的 props 类型直接用 `IslandSettings`（原来手抄子集会漂移）。
- 剪贴板**图片条目独立上限 10 张**（`IMAGE_LIMIT`）：原来图片跟着 60 条文本上限走，
  6MB 截图转 base64 约 8MB，最坏几百 MB 常驻内存 —— 这是本版本最大的内存收益。
- `bridge.ts` APP_LABELS 去掉重复的 zunemusic 规则。

**冒烟测试注意**（tools/smoke.mjs）：

- dev 模式现在默认加 `--user-data-dir=.cache/dev-profile`，否则**桌面上运行着
  已安装版 Eave.exe 时，dev 实例会因 requestSingleInstanceLock 冲突静默退出
  （exit 0、无任何日志）**，表现为 CDP 连不上。这是本次排查耗时的最大坑。
- 某些自动化/沙箱环境会给派生的子进程注入 `ELECTRON_RUN_AS_NODE=1`（shell 的 env 里
  看不到），electron.exe 会被当纯 Node 跑并报 "bad option"，跑 electron 前必须 unset。

## 0.3.1 增量（2026-09-17，功能大版本）

**新功能**：

- **计时器 / 番茄钟**：`src/renderer/src/timers.ts`（单例 store + 500ms ticker +
  localStorage 按 `endAt` 绝对时间持久化）+ `timers-panel.tsx`。番茄钟 25/5/15
  自动切相。注意 `needsTicker()` 必须同时检查 `endAt` **和** `segmentStart`
  （秒表分段时间也依赖 ticker）；`tick()` 在有活动计时器时无条件 emit，事件才 persist。
  到期响铃 `playChime()` 是否发声由 App 按 `settings.soundEnabled` 决定。
- **分裂胶囊**：播放中且空闲时，胶囊左右分栏（右半优先显示计时器，其次常驻时钟）。
- **系统面板天气 + 农历**：`src/renderer/src/weather.ts`，wttr.in j1 无 key API，
  8s AbortController 超时，30 分钟 localStorage 缓存；农历用内置
  `Intl.DateTimeFormat('zh-CN-u-ca-chinese')`，零依赖。
- **媒体音量控制**：MediaPanel 音量行（−/+/静音）。走现成媒体键 IPC，**步进约 2%
  且无百分比显示**（koffi 手搓 COM vtable 太脆，已与用户声明此边界）。

**布局验收教训（系统面板两次溢出）**：

- `.island--system` 高度 346px（窗口 360 上限内）。预算：面板可用 = 岛高 − body
  padding 16 − tabs 30 − gap 10 = 290px；网格（75+8+92）+ 天气行 26 + 电池行 30 +
  panel gap 20 ≈ 251px，余量必须 **>20px** 才算安全（330px 时代余量仅 2px，
  实际渲染必爆——计算高度要算 tabs 和 body padding，别只看面板内容）。
- CPU 卡不再放日期 hint（会多出 17px 把电池行挤出去）；星期并入天气行右侧，
  完整日期任务栏已有。截图验收必须**量布局**，不能只看「渲染出来了」。

## 0.4.0 增量（2026-09-18，功能大版本）

**开发工具箱**（第 6 个 tab，`tools-panel.tsx`）：JSON / 时间戳 / 颜色 / UUID /
编码 / 正则 / 哈希 / 统计八件，全部纯前端（crypto.subtle / TextEncoder），零主进程开销。
**前置改造：钉住机制**——App.tsx 的 `pinned` 状态：钉住时 onMove/onLeave 不收面板、
interactive 跟随光标正常开关（面板保留，鼠标回岛体自动恢复交互）；Esc 解钉；
needsKeyboard 面板扩到 settings/clipboard/tools/stash。没有钉住，输入类面板没法用。

**皮肤系统**（`main/services/skins.ts` + App.tsx 内联变量引擎）：

- 皮肤 = 颜色变量（bg/raised/sunken/text×3/hairline/accent）+ 背景图（blur/dim/opacity），
  **不含布局尺寸**——346px 高度预算不动，这是 0.3.1 的教训。
- 每套皮肤含 dark/light/night 三个调色板，App 按当前主题档取用；
  内联 style 直接压过 :root 与 .stage--light 类选择器。
- 内置三套：奶油淡彩 / 通透玻璃 / 终端复古（id `builtin:cream|glass|terminal`）。
- 自定义皮肤存 `userData/skins/<id>/skin.json`，bgImage 存**文件名**（与 JSON 同目录）；
  导出把背景图一并拷走，导入按同名文件解析回绝对路径。list() 输出 file:// URL 给渲染层。
- 校验从严：三个调色板 8 个字段缺一即拒收，不静默兜底。

**游戏迷你条**（`main/services/game.ts` + `eave-gpu.ps1`）：

- 全屏检测：koffi `GetForegroundWindow` + `GetWindowRect` 对比显示器边界（2px 容差），
  挂在 1Hz tick 上，**零子进程**。exe 命中 `gameExclude`（设置可编辑，默认含四大浏览器）不触发。
- GPU 占用**按需短进程**：游戏条激活才拉 eave-gpu.ps1（1Hz 求和 GPU Engine 计数器），
  退出即杀——「不新增常驻进程」红线指 24/7，会话级短进程不碰线。
- **没有真 FPS**：Windows 没有便宜的真帧率 API，PresentMon（ETW）因内存+反作弊风险被否，
  迷你条显示的是 CPU/GPU 占用 + 已玩时长，别把标签写成 FPS。
- 激活期间悬停不展开面板（onMove 的 gameActive 分支），托盘仍可操作。

**文件暂存**（`main/services/stash.ts` + `stash-panel.tsx`）：

- **穿透窗口收不到拖放事件**（drop/dragover 都不产生）——所以拖入交互是
  「先呼出岛、再拖进岛体」，全局钩子方案（SetWindowsHookEx）因反作弊敏感+架构红线被否。
  想做「随时甩到胶囊上」得先推翻这条架构决策，别当 bug 修。
- 存储混合策略：≤8MB 文件复制进 `userData/stash/`（源删了也能拖出），更大文件/文件夹
  只引用原路径（引用失效在载入时剔除）；上限 12 条 / 复制区 200MB；退出不清空。
- 出栈四件：复制路径 / `webContents.startDrag` 拖出（icon 从 resources/icon.png 来，
  **electron-builder.yml extraResources 已加 icon.png 拷贝**）/ showItemInFolder / 删除。
- 拖放路径：Electron 32+ 没有 File.path，preload 用 `webUtils.getPathForFile`。

## 0.5.0 增量（2026-09-18，岛内住客）

**二次元小人**（`companion.tsx` + `assets/companion-{open,closed}.png`）：

- B 路实现：AI 立绘（文生图直出）+ **假透明棋盘底抠图**（部分图像模型的 transparent
  参数输出的其实是画上去的棋盘格像素，不是 alpha 通道——处理管线见
  `tools/cutout-companion.py`：棋盘色判定 + BFS flood + **最大连通域过滤**（孤岛噪点/
  水印残迹一次清场）+ 边缘羽化 + 两帧联合裁切）。换素材时直接复用该脚本：
  `python tools/cutout-companion.py <睁眼图> <闭眼图> --dst src/renderer/src/assets`。
- 双帧眨眼：睁眼图为主体，闭眼帧用 image-to-image（input_fidelity=high）生成，
  90ms crossfade，随机 2.6~5.4s 眨一次。**不要走「局部眼睛贴片」路线**，整图双帧对齐零成本。
- 事件 → 心情（`deriveMood`，优先级写死）：深夜睡觉 > 计时器到期欢呼 > 被摸头 >
  播放打拍子 > 充电打瞌睡 > 剪贴板探头 > 待机呼吸。全 CSS transform/opacity。
- **交互几何（重要）**：小人不在 `[data-eave-surface]` 内，App.onMove 里单独判定
  `[data-eave-companion]`——悬停她 = interactive 但**不**触发展开（否则她淡出 → 鼠标落空
  → 岛收起 → 她回来 → 无限抖动）。点击摸头靠 interactive 打开后的普通 click。
- 位置：胶囊态坐右侧透明区（窗口 440 宽，胶囊只占 190）；媒体胶囊拉宽时换左侧
  （`.companion--left`）；展开态淡出（岛占满窗口，她无处可站）。
- **架构预留 C 路（真 Live2D）**：mood 是唯一状态接口，`deriveMood`/App 接线不动，
  将来只重写 Companion 渲染体。C 路实测账单：内存 +32~45MB、CPU 7-8%、模型 5-20MB。
- 开关：`settings.companionEnabled`（默认开）。

## 怎么跑起来

```bash
npm install          # 走 npmmirror，见 .npmrc；Electron 二进制已配镜像
npm run dev          # 开发
npm run typecheck    # tsc --noEmit，两个 tsconfig 都要过
npm run build        # 产出 out/
npm run dist         # 打包，输出到 release-out/
```

**验证不要靠肉眼**，跑冒烟测试：

```bash
EAVE_FAKE_MEDIA=1 node tools/smoke.mjs              # 开发版
EAVE_FAKE_MEDIA=1 EAVE_EXE=<exe路径> node tools/smoke.mjs   # 打包版
node tools/check-edges.mjs .cache/packaged-idle.png # 像素级黑边检查
```

`EAVE_FAKE_MEDIA=1` 会用本地 Chrome 造一个带封面的 SMTC 媒体会话（自造 PNG/WAV，零素材），
能一次验证「媒体标题 → 封面抓取 → 渲染」整条链路。

## 目录

```
src/main/         主进程：window.ts(窗口) services/{bridge,thumbnail,clipboard,
                  settings,sysinfo,winapi,tray,icon}.ts
src/preload/      contextBridge，暴露 window.eave
src/renderer/     React UI：App.tsx(状态机+胶囊) panels.tsx(四个面板) styles.css
src/shared/       types.ts —— IPC 频道表和所有跨进程类型，改动从这里开始
resources/scripts/eave-bridge.ps1   媒体+网速合并桥（常驻子进程，JSON 行协议）
resources/scripts/eave-thumb.ps1    专辑封面抓取（按需短进程）
tools/            smoke.mjs / fake-media.mjs / check-edges.mjs / make-icons.mjs
```

## ⚠️ 动手前必读的几条硬约束

**1. 两个 `.ps1` 必须保持 UTF-8 **带 BOM**。**
Windows PowerShell 5.1 把无 BOM 的 UTF-8 当 GBK 解码，某些中文字节序列会把
紧随的换行符一起吃掉 → 两行粘成一行 → 报「表达式或语句中包含意外的标记}」，
且行号比真实少 1。**很多编辑器/格式化工具保存时会剥掉 BOM**，改完务必复检
（文件头三字节应为 `EF BB BF`）。最稳妥：`.ps1` 里只写 ASCII 注释。

**2. 透明窗口的黑边是窗口层问题，不是 CSS。**
`roundedCorners: false` 和 `backgroundMaterial: 'none'` 是**必须的**，别删
（Win11 默认 roundedCorners=true，系统会给无边框窗口描一圈圆角，透明窗口上就是黑边）。
注意：这个瑕疵在 `page.screenshot()` 里**拍不到**，它是 DWM 画在窗口层的。
CSS 层面 `box-shadow` 会按 border-radius 裁切，本身不会产生方块状黑边。

**3. `data-eave-surface` + `setIgnoreMouseEvents(true, {forward:true})` 是点击穿透的命脉。**
穿透窗口收不到 mousemove，靠的是 forward 模式 + `document.elementFromPoint()` 判断光标
是否落在岛体上，再动态开关。改 hover 逻辑时别把 `mouseleave` 兜底删了，否则快速移出
窗口会残留拦截。

**4. SMTC 会话要挑「Title 非空」的，不能用 `GetCurrentSession()`。**
Xbox Game Bar 会常驻注册一个标题为空的壳会话并霸占 current session，
导致永远读到空标题。另外**标题为空就当作没有媒体**，否则 UI 会显示没头没尾的「正在播放」。

**5. 封面抓取是纯 PowerShell，不要改回 C#/Add-Type。**
`Add-Type` 引用 winmd 会报 `0x80131047`，补 facade 也没用。
现方案用 `System.IO.WindowsRuntimeStreamExtensions.AsStream()` 把裸 `__ComObject`
转成 `System.IO.Stream`，已实测可用。诊断信息走 stderr，stdout 只留 base64。

**6. 合并桥 + 隐藏时暂停是刻意的省内存设计。**
媒体和网速共用一个 PowerShell 子进程（`eave-bridge.ps1`，JSON 行带 `type: media|net`）；
窗口隐藏时主进程 `bridge.setPaused(true)` 直接杀掉子进程。优化时别拆回去。

**7. 窗口尺寸固定为最大展开态（440×360），胶囊态靠 CSS 变尺寸。**
不要用 `setBounds` 跟随动画，会抖。

## 可以放心优化的方向

- `src/renderer/src/styles.css` —— 动效都在这，注意 `.stage--calm` 分支要同步维护
- `src/renderer/src/panels.tsx` —— 四个面板的布局与信息密度
- `eave-bridge.ps1` 的轮询节奏（当前播放中 350ms / 其余 900ms）
- `ThumbnailService` 的缓存策略（当前 Map 上限 40、连败 3 次禁用）
- 启动时序（当前 bootstrap 里 sysinfo/clipboard/bridge 串行启动）

## 别动的

- `src/shared/types.ts` 的 IPC 频道名（`eave:` 前缀，主/渲染/preload 三处必须一致）
- `koffi` 相关的 `asarUnpack` 配置（不 unpack 运行时会找不到原生模块）
- `extraResources` 的 ps1 拷贝规则
