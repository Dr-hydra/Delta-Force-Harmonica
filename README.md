# Delta Force Harmonica

一个纯前端的《三角洲行动》口琴乐谱转换、谱面预览与练习工具。

## 当前阶段

当前可运行版本已经具备：

- Vite + React + TypeScript
- MIDI 在浏览器本地解析，不上传原文件（**推荐输入格式**）
- MusicXML / MXL 在浏览器本地解析
- 纯伴奏 / 器乐音频 MP3 / WAV / OGG / FLAC 浏览器本地轻量转谱（Basic Pitch）
- 音频三档识别预设，按保留的最短音符区分：独奏（~60 ms）/ 标准（~140 ms）/ 长音优先（~200 ms），标定记录见 `docs/AUDIO_PRESETS.md`
- 音频 BPM / 拍点估算（music-tempo）与 1/4、1/8、1/16 拍量化
- 音频弱音、碎音、同音片段与密集和弦清洗
- 单音收敛：游戏内口琴同时只能出一个音，谱面 / 试听 / 宏统一走同一道收敛（和弦取最高音，重叠在下一个起音处截断，起音位置不动）
- 谱面密度两档：原版（保留全部起音，默认）/ 精简（Smart Melody Path 只跟一条声部）
- 音频侧另有 RAW 阶段用于判断问题出在转录还是清洗
- MIDI Track / MusicXML 声部选择
- `-12 ~ +12` 半音移调与自动适配
- 基于候选按法 + 动态规划的真人演奏优化
- 三角洲口琴数字简谱 / 键位转换
- Web Audio 音高试听、进度跳转和倍速播放
- 按拍号生成小节谱，MusicXML 可保留原始小节边界
- 播放指针同步高亮当前小节与音符
- 小节谱 / 键位流两种显示方式
- 谱面手工编辑：点选音符改音高 / 位置 / 时值、插入删除、全部对齐到步长、撤销重做，也可从空白谱开始自己搭建
- 人可演奏版文本谱与罗技 / 雷蛇宏导出
- 浅色 / 深色主题

## 支持格式

| 格式 | 状态 | 说明 |
| --- | --- | --- |
| MIDI `.mid/.midi` | 已支持 · 推荐 | 读取 Track、Tempo、拍号和 tick 时间 |
| MusicXML `.musicxml/.xml` | 已支持 | 当前支持 `score-partwise` |
| MXL `.mxl` | 已支持 | 浏览器内解压并读取 MusicXML 主文件 |
| MP3 / WAV / OGG / FLAC | Beta · 仅纯伴奏 / 器乐 | Basic Pitch 本地转录 |
| ABC | 计划中 | 纯文本导入 |
| 自定义简谱文本 | 计划中 | 面向快速手工录入 |

**MIDI 是首选格式**：音高、时值、Tempo 和拍号都是确定值，不经过任何识别环节，谱面质量最高。

**带人声的完整混音不在支持范围内。** 流行歌完整混音的主旋律由人声承担，从混音中把它提取出来需要人声分离加单声部音高跟踪，实测精度不足以生成可用谱面，这个方向已经明确放弃（评估记录见 `experiment/mt3-wasm` 分支）。音频输入请使用纯伴奏、器乐曲或单乐器录音。

## 音频链路（纯伴奏 / 器乐）

```text
Audio
  ↓
Basic Pitch
  ↓
RAW note candidates
  ↓
Weak / short / duplicate / density cleanup
  ↓
CLEAN polyphonic notes
  ↓
music-tempo beat grid → 量化
  ↓
[可选] Smart Melody Path 精简
  ↓
enforceMonophonic（和弦取最高音 / 重叠截断）
  ↓
手工编辑
  ↓
Harmonica optimizer
```

音频的 BPM 与拍点由 [music-tempo](https://github.com/killercrush/music-tempo)（Beatroot 算法，纯 JS，MIT）估算，音符据此获得 `beat` / `durationBeats` 并可量化到 1/4、1/8、1/16 拍。估算失败时回退到 120 BPM，界面会说明失败原因。

两点已知限制：Beatroot 只输出拍点、不输出强拍，所以**小节线的相位是推测的**——第一小节可能实际起在听感上的第三拍；另外部分打击乐很弱的编配需要放宽参数才能估出，这种情况界面会标注可信度较低。

## 游戏映射假设

当前尚未取得口琴道具，映射先按 UI 语义实现为可替换配置：

- `Z X C V B N M ,` → `1 2 3 4 5 6 7 1̇`
- 升调 = **鼠标右键** → `+1` 八度
- 降调 = **鼠标左键** → `-1` 八度
- 半音 = **鼠标中键** → 当前音升半音（`#`）
- 暂定八度与半音修饰可以组合

三个修饰键是鼠标键而非键盘键，宏导出因此要混用按键与鼠标事件。音程语义（±1 八度、升半音）仍待实测确认。

这些规则集中在 `src/harmonica/mapping.ts`，实测后无需改转换器主体。

## 开发

```bash
npm install
npm run dev
```

类型检查与测试：

```bash
npm run check
npm test
npm run build
```

## 目录

```text
src/
  audio/       音频转谱、识别预设与候选音符清洗
  harmonica/   游戏映射与演奏优化
  import/      输入格式分发
  midi/        MIDI 解析
  musicxml/    MusicXML / MXL 解析
  music/       通用乐谱数据与主旋律提取
  score/       小节、拍号、谱面布局与手工编辑
  player/      Web Audio 试听
  components/  UI 组件
docs/          映射假设与路线图
```

## 设计方向

界面沿用 Better Endfield Web 的视觉语言：左侧功能轨、顶部状态条、浅色纸张感背景、深色导航、强对比强调色、等宽数据标签和边框型信息面板；在此基础上把强调色调整为更接近三角洲战术 UI 的黄绿色。

## GitHub Pages

`main` 分支提交会通过 `.github/workflows/pages.yml` 自动构建并部署到 GitHub Pages：

https://dr-hydra.github.io/Delta-Force-Harmonica/

## 说明

本项目为非官方社区工具，与游戏开发商及发行商无关。自动化输入/宏功能在后续阶段单独评估，不作为当前 MVP 的默认能力。
