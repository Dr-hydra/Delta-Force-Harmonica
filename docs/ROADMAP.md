# Roadmap

## 输入范围决定

MIDI / MusicXML 是主路径，音频输入只面向**纯伴奏、器乐曲与单乐器录音**。

带人声的完整混音转谱已评估后放弃。评估过 Basic Pitch 直接转完整混音、MT3 WASM、MDX + SwiftF0（人声分离后跟踪单声部）、Essentia MELODIA + RhythmExtractor2013 四条路线，精度都不足以生成可用谱面；过程和量化结果保留在 `experiment/mt3-wasm` 分支。后续如果重开这个方向，缺的两环是 beat tracking 和客观评测指标，而不是换一个更大的模型。

## M0 — Core pipeline

- [x] Vite + React + TypeScript 项目骨架
- [x] MIDI 浏览器本地解析
- [x] Track 选择
- [x] 简单主旋律提取
- [x] 单音收敛：游戏内口琴同时只能出一个音，和弦取最高音、重叠在下一个起音处截断（`src/music/monophonic.ts`）
- [x] 三角洲口琴候选按法模型
- [x] 动态规划演奏优化
- [x] 自动移调搜索
- [x] 键位 / 数字简谱预览
- [ ] 游戏内实测并校准映射

## M1 — Score workflow

- [x] 小节布局与分页
- [x] 节拍 / 拍号基础结构
- [x] MIDI Tempo Map / tick beat 数据
- [x] MusicXML / MXL 导入
- [ ] MusicXML 连音线、反复记号与更完整 Tempo 语义
- [ ] ABC 导入
- [ ] 自定义简谱文本导入
- [x] 谱面手工编辑与从空白谱搭建（`src/score/editNotes.ts`）
- [ ] 多种和弦降维策略（目前只有「取最高音」一种；转位、内声部旋律都还没做）
- [x] 针对纯伴奏素材重新标定三档音频预设（标定记录见 `docs/AUDIO_PRESETS.md`）
- [x] 音频输入的 BPM / beat tracking 与小节量化（music-tempo）
- [ ] 强拍检测，让小节线相位不再是推测（Beatroot 只给拍点）
- [x] MIDI / 浏览器合成试听

## 两个输出版本

同一份谱面最终要产出两个版本：

1. **人可演奏版** — 目前只出「原版」密度（保留全部起音）。简单 / 极简两档暂不做，先看原版在游戏里实际弹起来的手感。
2. **宏版** — 保留原始密度，导出带精确时间戳的按键序列，交给现成的开源 autoplayer 执行。

宏版的执行端**不自己实现**：浏览器无法向游戏发送系统级按键，本项目只负责编排并导出，注入交给已有工具（如 [AutoMidiPlayer](https://github.com/Jed556/AutoMidiPlayer)、AutoHotkey 系脚本）。

已落地的导出：人可演奏版 `.txt`、谱面本身的 `.mid`（移调后的音高、时值、Tempo 与拍号；不含键位与修饰键）、罗技 `.lua`、雷蛇 `.xml`。仍在候选里：AHK 脚本、带时间戳的键序 JSON——这两者才是 1:1 复现按键的宏执行格式。

自动化输入存在被反作弊判定的风险，上游项目自己的说明也是「不确定，自担风险」。开放这个功能前需要单独确认游戏规则与发布边界。

## 不自己实现的部分

优先用现成开源，避免重写算法：

| 需求 | 候选 | 备注 |
| --- | --- | --- |
| 音频 BPM + 逐拍时间戳 | **已采用** [music-tempo](https://github.com/killercrush/music-tempo)（Beatroot，纯 JS，MIT，零依赖） | 必须把 `minBeatInterval` 设到 0.333（上限 180 BPM），默认的 200 BPM 上限会在 96–100 BPM 素材上给出 2 倍速答案 |
| 音频 BPM + 首拍偏移 | [web-audio-beat-detector](https://github.com/chrisguttandin/web-audio-beat-detector) | 维护更活跃，但只给 BPM 和首拍偏移，不够做量化 |
| 强拍 / 更高精度节拍 | [Beat This!](https://github.com/CPJKU/beat_this) small ONNX（约 10 MB，MIT） | 输出 downbeat，能解决小节相位问题；music-tempo 不够用时再上 |
| 宏执行端 | [AutoMidiPlayer](https://github.com/Jed556/AutoMidiPlayer)、`virtual-piano-auto-player` 生态 | 本项目只导出，不注入 |

已排除：[aubiojs](https://github.com/qiuxiang/aubiojs)（aubio 为 GPL）、essentia.js（AGPL-3.0），授权对一个公开部署的前端工具不合适。

MIDI 侧的主旋律提取和轨道分类，成熟实现（[midi-miner](https://github.com/ruiguo-bio/midi-miner)、music21、各家 skyline）**全是 Python**，浏览器内没有对等库；现有的 `src/music/smartMelody.ts` 与 skyline baseline 继续用，不再重写。

## M2 — Persistence

- [ ] IndexedDB 本地乐谱库
- [ ] 版本化 Song JSON schema
- [x] 云存档接口抽象（`src/cloud/archive.ts` 分片写入 Toy CloudStorage）
- [x] 云端只保存标准化谱面，不保存原 MIDI（DFHS 快照，`src/persistence/scoreCodec.ts`）
- [x] 分享短链与只读公开谱（CloudBase `score-api` + `?s=<shortId>`）
- [x] 曲谱库复用转换器的编辑 / 导出 / 保存发布面板（`src/library/ScoreWorkbench.tsx`）

## M3 — Practice

- [x] 当前键位高亮
- [x] 变速试听
- [ ] 独立滚动练习模式
- [ ] 循环区间
- [ ] 难度指标（NPS、半音切换、八度切换、键位跨度）

## Deployment

- [x] CI：类型检查、测试、生产构建
- [x] GitHub Pages 部署工作流
- [ ] 仓库 Pages 设置切换为 GitHub Actions
- [ ] 主分支稳定后开启自动发布

## Later / Separate review

- 宏导出的执行端与反作弊边界需单独确认游戏规则和发布风险，见上文「两个输出版本」。
