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

- [x] 小节布局与分页
- [x] 节拍 / 拍号基础结构
- [x] MIDI Tempo Map / tick beat 数据
- [x] MusicXML / MXL 导入
- [ ] MusicXML 连音线、反复记号与更完整 Tempo 语义
- [ ] ABC 导入
- [ ] 自定义简谱文本导入
- [ ] 多种和弦降维策略
- [ ] 原版 / 简单 / 极简三档人工演奏优化
- [x] MIDI / 浏览器合成试听

## M2 — Persistence

- [ ] IndexedDB 本地乐谱库
- [ ] 版本化 Song JSON schema
- [ ] 云存档接口抽象
- [ ] 云端只保存标准化谱面，不保存原 MIDI
- [ ] 分享短链与只读公开谱

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

- 自动化输入与宏导出需单独确认游戏规则、发布风险和产品边界，不纳入当前默认路线。
