# 桌面版自动演奏器

`desktop/` 目录是一个 WPF（.NET 9）程序：打开本站导出的 MIDI 或公开曲库里的谱面，按网页端完全相同的指法向《三角洲行动》发送口琴按键。它不是通用 MIDI 播放器，作谱、编辑、发布仍在网页端完成。

## 目录

```text
desktop/
  DeltaForceHarmonica.sln
  DFH.Core/          与网页共享的谱面管线（C# 移植）：DFHS1 解码、单音收敛、指法优化、按键序列、小节切分、曲库客户端、MIDI 读取
  DFH.Core.Tests/    一致性测试；Fixtures/ 里的黄金样本由网页端 `npm run fixtures:desktop` 生成
  DFH.Desktop/       WPF 界面、SendInput 发键、播放线程、全局热键、设置
  smoke.ps1          开发用 UI 冒烟脚本（启动、点按钮、截图）
```

## 数据流

```text
网页导出 .mid ──┐
                ├─► DFHS1 快照 ─► enforceMonophonic ─► optimizeHarmonica(transpose) ─► buildKeySequence ─► 播放线程 ─► SendInput
曲库 CDN JSONP ─┘
```

**两端只有一种内部格式。** 网页端导出 MIDI 时把 DFHS1 快照（收敛后的音符 + 移调 + tempo 表）以 base64url 写进一条 MIDI 文本 meta 事件（前缀 `DFHS1 `，见 `src/export/midi.ts`）。桌面端只认这条事件；老版本导出的文件只有 `DFH SCORE` 轨名，按纯音高路径兼容打开并标注「旧版导出」；其他 MIDI 一律拒绝。

公开曲库不需要任何后端改动：桌面端直接读 CloudBase CDN 上的 `index.js`、`catalog/{0..f}.js`、`score/{id}.js`，去掉 `__dfh("key", …)` 包裹后解析 JSON，`p` 字段里的 DFHS1 走同一条管线。Toy 私人云存档依赖 B 站页面内的 SDK，桌面端拿不到。

## 一致性保障

`src/harmonica/optimizer.ts` 等五个 TypeScript 文件是权威实现，C# 是逐行移植。`scripts/desktop-fixtures.ts` 用网页管线跑五组样本（音阶、全音域修饰键、和弦/重叠、变速 + 换拍号、400 音随机），把解码结果、单音收敛、指法、最佳移调、按键序列全部写成 JSON；`DFH.Core.Tests` 用 C# 重跑并要求逐字节一致（cost 允许浮点误差）。

改了网页端的映射、优化器权重、按键时序默认值后，必须重新生成样本并同步 C#：

```bash
npm run fixtures:desktop
cd desktop && dotnet test
```

移植时踩过的坑：JS `Math.round` 是向 +∞ 取整，C# 要用 `Math.Floor(x + 0.5)`；JS 的 `sort` 稳定，C# 用 `OrderBy/ThenBy` 而不是 `List.Sort`；候选按法枚举顺序和严格小于的平局规则决定指法结果，不能改。

## 按键注入

`InputSender` 用 `SendInput`，键盘事件只填扫描码（`wVk=0` + `KEYEVENTF_SCANCODE`），鼠标修饰键用 `MOUSEEVENTF_*`。前提条件：

1. 程序以管理员运行（`app.manifest` 声明 `requireAdministrator`）。游戏是高完整性进程，未提权发的输入会被 UIPI 拦掉，这和网页端提示「外设软件要提权」是同一个原因。
2. 游戏用窗口化或无边框，全屏独占收不到模拟输入。
3. 前台输入法切英文，中文 IME 会截走按键。

播放线程按绝对时间派发，提前 2 ms 从睡眠切到自旋；`timeBeginPeriod(1)` 提高定时精度。任何停止路径（热键、前台窗口切换、异常）都先松开全部按键。全局热键用 `WH_KEYBOARD_LL` 钩子，不吞按键，忽略自己注入的事件。

提权窗口收不到资源管理器的 OLE 拖放，`DropFiles` 用 `ChangeWindowMessageFilterEx` 放行 `WM_DROPFILES` 实现拖文件。

「打开网页版」按钮通过 `explorer.exe <url>` 打开链接：提权进程直接 ShellExecute 可能拉起一个带管理员权限的浏览器实例，交给已在运行的非提权资源管理器转发可以避免。地址常量在 `Services/Links.cs`。

## 构建与发布

```bash
cd desktop
dotnet test                                   # 核心一致性测试
dotnet build DFH.Desktop                      # 需要 UAC 的正式版
dotnet build DFH.Desktop -p:DfhNoAdmin=true   # 开发用，不提权，按键到不了提权的游戏
dotnet publish DFH.Desktop -c Release -r win-x64 --self-contained -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o publish
```

发布产物是单个 `DeltaForceHarmonica.exe`。未签名的提权程序会触发 SmartScreen 提示，正式分发建议代码签名。

设置保存在 `%LocalAppData%\DeltaForceHarmonica\settings.json`：热键、倒计时、按键时序三个毫秒参数、曲库地址。默认时序与网页宏导出相同（修饰键提前 12 ms、松键间隔 18 ms、最短按住 30 ms）。

## 风险说明

在线对局使用自动输入违反游戏协议，有封号风险。程序首页有明确提示，仅建议在练习、自定义房间等不影响他人的场景使用。
