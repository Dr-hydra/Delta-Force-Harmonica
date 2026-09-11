# CloudBase 曲谱库后端

这部分是 DFH 公共曲谱库的低频**写入**后端，结构直接参考 Better-Endfield 已上线的 Web 后端。
当前仓库只实现代码，不绑定任何 CloudBase 环境，也不执行部署。

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

```text
SCORE_STORAGE_BASE=https://<public-storage-domain>
SCORE_BUCKET=harmonica
SCORE_DATA_KEY=<random-private-prefix>
```

`SCORE_DATA_KEY` 必须使用不可猜的随机值；私有对象中含 owner hash 与 payload hash。

## 计划部署（暂不执行）

部署时参考 Better-Endfield 的增量网关做法，只新增 DFH 自己的函数与 `/score` 路由，不修改共享环境里的其他项目。
部署前还需要确认实际 CloudBase 环境、bucket 公共域名和 Toy 正式路径。
