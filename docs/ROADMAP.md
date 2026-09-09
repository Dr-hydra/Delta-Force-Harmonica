# Roadmap

## M0 — Core pipeline

- [x] Vite + React + TypeScript 项目骨架
- [x] MIDI 浏览器本地解析
- [x] Track 选择
- [x] 简单主旋律提取
- [x] 三角洲口琴候选按法模型
- [x] 动态规划演奏优化
- [x] 自动移调搜索
- [x] 键位 / 数字简谱预览
- [ ] 游戏内实测并校准映射

## M1 — Score workflow

- [ ] 完整谱面分页与小节布局
- [ ] 节拍 / 拍号 / Tempo Map
- [ ] MusicXML / MXL 导入
- [ ] ABC 导入
- [ ] 自定义简谱文本导入
- [ ] 多种和弦降维策略
- [ ] 原版 / 简单 / 极简三档人工演奏优化
- [ ] MIDI / 浏览器合成试听

## M2 — Persistence

- [ ] IndexedDB 本地乐谱库
- [ ] 版本化 Song JSON schema
- [ ] 云存档接口抽象
- [ ] 云端只保存标准化谱面，不保存原 MIDI
- [ ] 分享短链与只读公开谱

## M3 — Practice

- [ ] 滚动练习模式
- [ ] 当前键位高亮
- [ ] 变速练习
- [ ] 循环区间
- [ ] 难度指标（NPS、半音切换、八度切换、键位跨度）

## Later / Separate review

- 自动化输入与宏导出需单独确认游戏规则、发布风险和产品边界，不纳入当前默认路线。
