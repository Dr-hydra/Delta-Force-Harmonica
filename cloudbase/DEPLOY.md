# DFH CloudBase 部署手册（给本地 Agent）

本文件用于在常用开发机上通过 `tcb` CLI 部署 Delta Force Harmonica 的公共曲谱库后端。

目标只有三项：

1. 部署云函数 `score-api`；
2. 在现有 HTTP 网关上**增量**增加 `/score -> score-api`；
3. 把公开读取地址和网关地址写入 DFH 的前端构建环境。

> **安全边界**：不要创建数据库，不要修改 Better-Endfield 的 `combat-api`、`/combat`、`/fh6`，不要覆盖共享环境的已有网关配置。不要提交 `cloudbase/cloudbaserc.json`、`.tcb/`、`SCORE_DATA_KEY`、腾讯云密钥或登录态。

---

## 0. 仓库与后端结构

仓库：`Dr-hydra/Delta-Force-Harmonica`

相关目录：

```text
cloudbase/
├─ README.md
├─ DEPLOY.md                 # 本文件
└─ functions/
   └─ score-api/
      ├─ index.js
      ├─ store.js
      └─ package.json
```

后端设计：

```text
公开读：浏览器 --<script/JSONP>--> CloudBase 公共存储/CDN
低频写：浏览器 --fetch--> HTTP 网关 /score --> score-api
```

不使用数据库。公开目录、曲谱正文和私有索引都放对象存储。

函数环境变量：

```text
SCORE_STORAGE_BASE=https://<public-storage-domain>
SCORE_BUCKET=harmonica
SCORE_DATA_KEY=<random-private-prefix>
```

注意：`SCORE_STORAGE_BASE` 是**存储公共域名根地址**，不要在这里追加 `/harmonica`；`store.js` 会自己追加 `SCORE_BUCKET`。

前端环境变量：

```text
VITE_SCORE_STORAGE=https://<public-storage-domain>/harmonica
VITE_CLOUDBASE_API=https://<gateway-domain>/score
```

---

## 1. 先同步代码，不要直接部署

```bash
git clone https://github.com/Dr-hydra/Delta-Force-Harmonica.git
cd Delta-Force-Harmonica
git checkout main
git pull --ff-only
```

确认工作区干净：

```bash
git status --short
```

如果已有未提交改动，不要覆盖；先停止并向用户报告。

---

## 2. 确认本机 TCB CLI 与登录态

```bash
tcb -v
tcb login
tcb fn deploy --help
tcb deploy --help
```

CLI 参数可能随版本变化。**以当前机器的 `--help` 和现有 Better-Endfield 本地配置为准，不要为了匹配本文而强行套一个过时 schema。**

如果本机已经有 Better-Endfield 的开发目录，优先查看：

```text
Better-Endfield/web/cloudbase/cloudbaserc.json
```

这个文件是本地配置，不应上传。它可以作为同一个共享环境的真实配置结构参考。

---

## 3. 目标环境：先确认，再复用

Better-Endfield 远端当前公开配置表明，它使用过下面这个共享环境；把它当作**候选默认值**，部署前必须用本机 CLI/控制台确认仍然正确：

```text
环境 ID: endfield-d3gdy9wg4afba9d16
区域:    ap-shanghai
```

历史公开地址：

```text
存储公共域名根：
https://656e-endfield-d3gdy9wg4afba9d16-1474357318.tcb.qcloud.la

HTTP 网关域名根：
https://endfield-d3gdy9wg4afba9d16-1474357318.ap-shanghai.app.tcloudbase.com
```

如果本机查询结果与上面不一致，**使用实时结果，不要盲用这里的历史值**。

共享环境里已经存在其他项目。部署 DFH 时必须保留已有函数、路由和环境设置。

---

## 4. 生成 DFH 独立私有前缀

`SCORE_DATA_KEY` 是 DFH 私有对象路径的一部分，必须与 Better-Endfield 的 `COMBAT_DATA_KEY` 不同。

生成一个新的：

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

记为：

```text
SCORE_DATA_KEY=<生成结果>
```

只写进本机 CloudBase 配置/函数环境变量，不要发到聊天、日志、Issue、PR 或 Git。

---

## 5. 建立 DFH 的本地 CloudBase 配置

进入：

```bash
cd cloudbase
```

`cloudbase/cloudbaserc.json` 已经在 `.gitignore` 中。

### 最推荐做法：从现有共享环境配置复制后裁剪/追加

如果 Better-Endfield 本机配置存在：

1. 复制其 `cloudbaserc.json` 作为结构参考；
2. 保留环境 ID、区域、网关 host 等共享环境所需信息；
3. **不要复制其 `COMBAT_DATA_KEY` 到 DFH**；
4. 新增 `score-api` 函数声明；
5. 网关只新增 `/score -> score-api`；
6. 不删除任何已有 `/combat`、`/fh6` 或其他路由。

如果 CLI 支持从云端拉取当前配置，也可以先拉取，再做增量修改。以本机 `tcb --help` 为准。

### `score-api` 至少应包含的逻辑配置

实际 JSON 字段名以当前 CLI schema 为准，但语义应等价于：

```json
{
  "name": "score-api",
  "runtime": "Nodejs20.19",
  "handler": "index.main",
  "timeout": 15,
  "memorySize": 256,
  "installDependency": true,
  "envVariables": {
    "SCORE_STORAGE_BASE": "https://<public-storage-domain>",
    "SCORE_BUCKET": "harmonica",
    "SCORE_DATA_KEY": "<random-private-prefix>"
  }
}
```

函数源码目录：

```text
./functions/score-api
```

依赖由 `package.json` 声明，目前只有：

```text
@cloudbase/node-sdk
```

---

## 6. 在任何写操作前做检查 / dry-run

先查看当前配置与差异。若当前 CLI 支持：

```bash
tcb deploy --dry-run
```

检查输出，必须满足：

- 只新增/更新 `score-api`；
- 网关只新增 `/score`；
- 不删除 `combat-api`；
- 不删除 `/combat`；
- 不删除 `/fh6`；
- 不删除或重建共享存储；
- 不创建数据库；
- 不出现“replace all routes / 删除全部旧路由”之类操作。

如果 dry-run 显示会删除共享资源，**立即停止，不要部署**。

---

## 7. 部署函数

确认配置安全后：

```bash
tcb fn deploy score-api --force
```

如果当前 CLI 需要显式环境参数，使用已确认的目标环境 ID；具体参数名以 `tcb fn deploy --help` 为准。

部署完成后确认：

- 函数名是 `score-api`；
- handler 是 `index.main`；
- 环境变量三个值均已设置；
- Node 运行时可用；
- 依赖安装成功。

---

## 8. 增量部署网关

再次检查配置只新增 `/score`，然后：

```bash
tcb deploy --only gateway
```

如果当前版本要求 `--only=gateway`，按 CLI 帮助使用对应写法。

部署后不得影响已有：

```text
/combat
/fh6
```

---

## 9. 健康检查

最终网关应能够访问：

```text
GET https://<gateway-domain>/score/health
```

例如若仍复用上面的历史网关域名：

```text
https://endfield-d3gdy9wg4afba9d16-1474357318.ap-shanghai.app.tcloudbase.com/score/health
```

期望 HTTP 200，JSON 大致为：

```json
{
  "ok": true,
  "storage": "harmonica",
  "scores": 0,
  "shards": 0
}
```

首次部署没有曲谱时 `scores: 0` 是正常的。

如果失败，优先检查：

1. `/score` 是否真的指向 `score-api`；
2. 函数环境变量是否存在；
3. `SCORE_STORAGE_BASE` 是否是域名根，不是 `/harmonica`；
4. 函数是否能访问 CloudBase 存储；
5. CLI 是否部署到了错误环境。

不要为了“让 health 绿”而修改共享项目路由。

---

## 10. 配置 DFH 前端

健康检查成功后，在仓库根目录创建本地 `.env.local`：

```text
VITE_SCORE_STORAGE=https://<public-storage-domain>/harmonica
VITE_CLOUDBASE_API=https://<gateway-domain>/score
```

若复用历史地址，则候选值为：

```text
VITE_SCORE_STORAGE=https://656e-endfield-d3gdy9wg4afba9d16-1474357318.tcb.qcloud.la/harmonica
VITE_CLOUDBASE_API=https://endfield-d3gdy9wg4afba9d16-1474357318.ap-shanghai.app.tcloudbase.com/score
```

这两个是公开 URL，不是密钥。

本地验证：

```bash
cd ..
npm install
npm run check
npm test
npm run build
npm run dev
```

如果仓库脚本与这里不同，以 `package.json` 为准。

---

## 11. 浏览器 / Toy 验证

根 `index.html` 已加载 B站 Toy SDK：

```html
<script src="//s1.hdslb.com/bfs/seed/toy/app/sdk/toy-sdk.js"></script>
```

普通浏览器/GitHub Pages 环境下，Toy 能力不可用时应降级运行；Toy 内则可以继续使用用户资料、CloudStorage、分享/二维码等平台能力。

验证曲谱库时至少检查：

- 云曲谱库入口能打开；
- 空库时不会报错；
- `index.js` 不存在时可以正常显示空状态；
- 发布一首测试谱后能在公共目录看到；
- 刷新后仍能读取；
- “我的曲谱”能识别自己的发布；
- 删除测试谱后目录恢复正常。

首次成功发布时后端会自动创建：

```text
harmonica/index.js
harmonica/catalog/<shard>.js
harmonica/score/<id>.js
harmonica/<SCORE_DATA_KEY>/index.json
harmonica/<SCORE_DATA_KEY>/catalog/<shard>.json
harmonica/<SCORE_DATA_KEY>/own/<ownerHash>.json
```

无需提前手工建这些文件，也无需建数据库。

---

## 12. GitHub Pages / Toy 正式构建

CloudBase 本身部署成功后，生产构建还需要注入两个**公开**前端环境变量：

```text
VITE_SCORE_STORAGE=...
VITE_CLOUDBASE_API=...
```

不要把 `SCORE_DATA_KEY` 注入前端，也不要把它放进 GitHub Pages 构建产物。

如果 GitHub Pages 工作流目前没有生产环境变量，先只完成 CloudBase + 本地验证，再单独修改 Pages workflow；不要把后端部署和 Pages workflow 大改混在一个不可回滚步骤里。

Toy 打包同理：只需要公开地址，不需要 CloudBase 私有前缀。

---

## 13. 回滚原则

如果 `/score` 部署导致问题：

1. 优先撤掉或修正 `/score` 路由；
2. 不要动 `/combat`、`/fh6`；
3. `score-api` 可以单独删除/回滚，不影响对象存储已有曲谱；
4. 不要直接删除 `harmonica/` 数据前缀，除非用户明确要求清空曲谱库；
5. 不要删除整个 CloudBase 环境或共享存储。

如果只是前端地址配错，回滚前端环境变量即可，无需改 CloudBase 数据。

---

## 14. 本地 Agent 完成后需要回报的内容

部署完成后只汇报**非敏感**信息：

```text
- tcb CLI 版本
- 最终使用的环境 ID
- score-api 部署是否成功
- /score 网关是否成功
- /score/health HTTP 状态码与响应（不要带密钥）
- 最终 VITE_SCORE_STORAGE
- 最终 VITE_CLOUDBASE_API
- npm run check / npm test / npm run build 结果
- 是否完成一次“发布 -> 读取 -> 删除”测试
- 部署过程中有没有触碰现有 /combat 或 /fh6（期望：没有）
```

**不要回报：** `SCORE_DATA_KEY`、`COMBAT_DATA_KEY`、SecretId、SecretKey、Cookie、CLI 登录 token。

---

## 给 Agent 的执行原则

> 先读本文件、`cloudbase/README.md`、`cloudbase/functions/score-api/index.js`、`store.js`，再检查本机 TCB CLI 与 Better-Endfield 的现有 CloudBase 配置。优先复用共享环境，但所有变更必须是增量的。任何 dry-run 显示会删除/覆盖 Better-Endfield 资源时立即停止。成功标准是 `score-api` 与 `/score` 独立上线、`/score/health` 通过、DFH 前端能读写曲谱，而已有 `/combat` 和 `/fh6` 完全不受影响。
