# CloudBase 曲谱库后端

这部分是 DFH 公共曲谱库的低频**写入**后端，结构直接参考 Better-Endfield 已上线的 Web 后端。
当前仓库不绑定固定 CloudBase 环境；环境 ID、网关与私有数据前缀都保留在本地 CLI 配置中。

> 给常用开发机/本地 Agent 的完整部署清单见 [`DEPLOY.md`](./DEPLOY.md)。部署共享环境前先做 dry-run，任何会删除或覆盖现有 `/combat`、`/fh6` 的操作都必须停止。

## 设计

```text
读  Toy 浏览器 --<script>--> 云存储公共域名/CDN     无函数、无网关、无数据库
写  Toy 浏览器 --fetch-----> HTTP 网关 -> score-api  发布/修改/删除/我的公开谱
```

公开读取必须使用 JSONP，因为 CloudBase 公共对象域名在 Toy 页面下不能依赖 CORS fetch。

## 函数

`functions/score-api`：

- `store.js`：公共 JSONP / 私有 gzip 对象读写；私有读取强制回源。
- `index.js`：DFHS 校验、ownerToken 鉴权、16-shard catalog 更新、写后验证重试。

依赖只有 `@cloudbase/node-sdk`。

## 环境变量

函数需要：

```text
SCORE_STORAGE_BASE=https://<public-storage-domain>
SCORE_BUCKET=harmonica
SCORE_DATA_KEY=<random-private-prefix>
```

`SCORE_DATA_KEY` 必须使用不可猜的随机值；私有对象中含 owner hash 与 payload hash。不要把它提交到 Git。

前端需要：

```text
VITE_SCORE_STORAGE=https://<public-storage-domain>/harmonica
VITE_CLOUDBASE_API=https://<gateway-domain>/score
```

这两个前端地址不是密钥，最终用户在浏览器网络面板里本来就能看到。

## 本地 CLI 接入

DFH 按 Better-Endfield 已实测的本地 `tcb` 工作流部署。推荐先确认 CLI 实时帮助，再操作共享环境：

```bash
tcb -v
tcb login
tcb fn deploy --help
tcb deploy --help
```

在 `cloudbase/` 下建立本地 `cloudbaserc.json`。该文件已经被 `.gitignore` 排除，因为它会携带环境 ID、网关配置和 `SCORE_DATA_KEY`。配置至少需要：

```json
{
  "version": "2.0",
  "envId": "<env-id>",
  "functionRoot": "./functions",
  "functions": [
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
  ],
  "gateway": {
    "routes": [
      {
        "path": "/score",
        "target": "function:score-api"
      }
    ]
  }
}
```

如果目标环境已有自己的网关域名/路由配置，先用现有 `cloudbaserc.json` 或 `tcb config pull` 的结果为基底，只新增 `/score -> score-api`；不要用上面的最小模板覆盖共享环境已有路由。

私有前缀可以本地生成，例如：

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

随后在 `cloudbase/` 目录执行：

```bash
tcb fn deploy score-api --force
tcb deploy --only gateway
```

这与 Better-Endfield 当前的 `combat-api + /combat` 部署方式同构，只把函数名与路径换成 `score-api + /score`。

部署后先验证函数网关，再接前端：

```text
GET https://<gateway-domain>/score/health
```

健康检查通过后，在项目根目录创建本地 `.env.local`：

```text
VITE_SCORE_STORAGE=https://<public-storage-domain>/harmonica
VITE_CLOUDBASE_API=https://<gateway-domain>/score
```

然后 `npm run dev` / `npm run build` 即可在浏览器验证。正式 GitHub Pages 或 Toy 构建再把这两个**公开地址**注入生产构建。

## Toy

根页面直接加载 B站 Toy SDK：

```html
<script src="//s1.hdslb.com/bfs/seed/toy/app/sdk/toy-sdk.js"></script>
```

因此 CloudBase 接通后，Toy 内的 `getUserProfile`、CloudStorage、分享与二维码能力不需要再接一套账号后端；普通 GitHub Pages 环境中没有可用 Toy 能力时，页面会继续按降级逻辑工作。

## 首次数据

无需手工创建数据库或 catalog。第一次成功发布曲谱时，`score-api` 会写入公开 `score/<id>.js`、对应 catalog shard，并创建/更新 `index.js` 与私有索引对象。
