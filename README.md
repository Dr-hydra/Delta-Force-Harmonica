# Delta Force Harmonica

一个纯前端的《三角洲行动》口琴乐谱转换、谱面预览与练习工具。

## 当前阶段

当前可运行版本已经具备：

- Vite + React + TypeScript
- MIDI 在浏览器本地解析，不上传原文件
- MusicXML / MXL 在浏览器本地解析
- MIDI Track / MusicXML 声部选择
- 同时音符的主旋律提取（当前策略：最高音优先）
- `-12 ~ +12` 半音移调与自动适配
- 基于候选按法 + 动态规划的真人演奏优化
- 三角洲口琴数字简谱 / 键位转换
- Web Audio 音高试听、进度跳转和倍速播放
- 按拍号生成小节谱，MusicXML 可保留原始小节边界
- 播放指针同步高亮当前小节与音符
- 小节谱 / 键位流两种显示方式
- 浅色 / 深色主题

## 支持格式

| 格式 | 状态 | 说明 |
| --- | --- | --- |
| MIDI `.mid/.midi` | 已支持 | 读取 Track、Tempo、拍号和 tick 时间 |
| MusicXML `.musicxml/.xml` | 已支持 | 当前支持 `score-partwise` |
| MXL `.mxl` | 已支持 | 浏览器内解压并读取 MusicXML 主文件 |
| ABC | 计划中 | 纯文本导入 |
| 自定义简谱文本 | 计划中 | 面向快速手工录入 |

## 游戏映射假设

当前尚未取得口琴道具，映射先按 UI 语义实现为可替换配置：

- `Z X C V B N M ,` → `1 2 3 4 5 6 7 1̇`
- 升调 → `+1` 八度
- 降调 → `-1` 八度
- 半音 → 当前音升半音（`#`）
- 暂定八度与半音修饰可以组合

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
  harmonica/   游戏映射与演奏优化
  import/      输入格式分发
  midi/        MIDI 解析
  musicxml/    MusicXML / MXL 解析
  music/       通用乐谱数据与主旋律提取
  score/       小节、拍号与谱面布局
  player/      Web Audio 试听
  components/  UI 组件
docs/          映射假设与路线图
```

## 设计方向

界面沿用 Better Endfield Web 的视觉语言：左侧功能轨、顶部状态条、浅色纸张感背景、深色导航、强对比强调色、等宽数据标签和边框型信息面板；在此基础上把强调色调整为更接近三角洲战术 UI 的黄绿色。

## GitHub Pages

仓库包含 `.github/workflows/pages.yml`。Pages 在仓库设置中切换为 **GitHub Actions** 后即可部署静态站点；当前工作流保持手动发布，待功能进入可预览阶段后再改为主分支自动部署。

## 说明

本项目为非官方社区工具，与游戏开发商及发行商无关。自动化输入/宏功能在后续阶段单独评估，不作为当前 MVP 的默认能力。
