# 檐 / Eave

Windows 10 / 11 桌面悬浮胶囊 —— 一条 190×34 的小胶囊停在屏幕顶部，鼠标悬停平滑展开成
402px 宽的功能面板。Electron + React 构建，打包为 NSIS 安装包。

## 功能

- **媒体控制**：通过系统 SMTC 接管任意播放器，显示封面 / 标题 / 进度 / 播放控制；
  强调色可跟随封面主色自动提取。
- **系统状态**：CPU / 内存波形图、实时网速、电池、天气与农历。
- **剪贴板历史**：文本与图片记录、搜索、钉住、一键清空（图片有独立容量上限，避免内存膨胀）。
- **计时器 / 番茄钟**：胶囊态直接显示倒计时，番茄钟自动切相，到期提示音。
- **开发工具箱**：JSON 格式化、时间戳转换、颜色换算、UUID、Base64 / URL 编解码、
  正则速测、SHA 哈希（支持文件）、文本统计 —— 全部纯前端计算。
- **文件暂存**：呼出岛体后把文件拖进来暂存，支持复制路径 / 拖出到资源管理器 / 打开所在目录。
- **皮肤系统**：内置奶油淡彩、通透玻璃、终端复古三套（各含深色 / 浅色 / 深夜变体），
  支持皮肤 JSON 导入导出。
- **游戏迷你条**：检测到前台全屏应用时自动缩成 CPU / GPU 占用条，排除名单可配置。
- **岛内住客**：一只会呼吸、眨眼、随音乐打拍子、充电打瞌睡、被摸头冒爱心的小人。
- **主题**：深色 / 浅色 / 跟随系统，深夜时段自动转暗；全部动效走合成器（transform / opacity），
  含省电档与 `prefers-reduced-motion` 支持。

## 技术栈

Electron 44 · React 19 · TypeScript · Vite 7 · electron-vite 5 · koffi（原生 FFI，预编译，无需 C++ 工具链）

## 开发与构建

```bash
npm install

npm run dev        # 开发模式启动
npm run typecheck  # 类型检查
npm run build      # 编译到 out/
npm run dist       # 打包 NSIS 安装包到 release-out/
```

环境要求：Windows 10 (17763+) 或 Windows 11，Node.js 20+。

辅助脚本（可选，需要 `puppeteer-core` 与本机 Chrome）：

```bash
node tools/smoke.mjs                   # 冒烟测试（无头接管、截图、状态快照）
EAVE_FAKE_MEDIA=1 node tools/check-progress.mjs   # 媒体进度链路检测（伪造媒体会话）
python tools/cutout-companion.py <睁眼图> <闭眼图> --dst src/renderer/src/assets
                                       # 立绘抠图（去棋盘底/裁切/对齐导出）
```

## 已知边界

- **SMTC 只读**：播放进度由播放器自行上报。不报进度的播放器（例如网页版哔哩哔哩）
  会显示不确定态流动进度条；系统不提供 seek 接口，进度拖动不可行。
- **音量控制**通过系统媒体键模拟（步进约 2%，无百分比回读）。
- **透明窗口不接收拖放事件**（Windows 平台行为），文件暂存采用「先呼出岛、再拖入」交互。

## 目录结构

```
src/main/          主进程：窗口、剪贴板、设置、系统信息、皮肤、暂存、游戏模式、Win32 FFI
src/preload/       contextBridge 桥
src/renderer/      React 界面：胶囊、七个面板、皮肤引擎、岛内住客
src/shared/        IPC 频道与跨进程类型（单一来源）
resources/scripts/ PowerShell 桥（媒体 SMTC / 封面抓取 / GPU 采样）
tools/             冒烟测试、媒体进度检测、皮肤截图、立绘抠图
```

## 许可

MIT © 520Yui940
