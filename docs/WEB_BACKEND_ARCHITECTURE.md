# DFH Web 后端架构

DFH 沿用 Better-Endfield 已实测跑通的 Toy + CloudBase 架构，不引入数据库。

## 职责边界

| | B站 Toy | CloudBase HTTP 函数 | CloudBase 云存储 |
|---|---|---|---|
| 用户身份 | `getUserProfile()` | 不做登录，只认 `ownerToken` | — |
| owner token | `dfh_own` | 只保存 SHA-256 | — |
| 收藏/偏好 | Toy CloudStorage | — | — |
| 公开曲谱读取 | — | **不经过函数** | JSONP + CDN |
| 搜索 | — | **不经过函数** | 16 个静态 catalog shard，前端本地搜 |
| 发布/修改/删除 | 提供身份显示信息 | ✓ | 函数写对象 |
| 我的公开谱 | ownerToken 来自 Toy | ✓ 低频私有查询 | 私有 gzip 对象 |

曲谱在浏览器内编码成 DFHS1 压缩字节，CloudBase 只搬运和验证已经压缩的 payload。

## 为什么仍然使用 JSONP

CloudBase 公共对象域名没有适合 Toy 页面的 CORS 响应。和 Better-Endfield 一样，公开对象写成：

```js
__dfh("catalog/a", { r: [...] });
```

并以 `.js` 保存。浏览器使用经典 `<script>` 加载，不发送 `Origin`，同时 `.js` 的 Content-Type
避免 Chrome ORB 把 JSON 当作不透明跨域响应拦掉。

## 存储布局

```text
harmonica/
├── index.js                         # 公开：总数、各 shard 条数
├── catalog/
│   ├── 0.js ... f.js               # 公开：搜索 metadata
├── score/
│   └── <shortId>.js                # 公开：metadata + DFHS payload
└── <SCORE_DATA_KEY>/
    ├── index.json                   # 私有 gzip：index 可写副本
    ├── catalog/
    │   ├── 0.json ... f.json        # 私有 gzip：完整行 + ownerHash/payloadHash
    └── own/
        └── <ownerHash>.json         # 私有 gzip：某用户公开谱列表
```

Catalog 用 16 个 shard，而不是一个无限增大的总文件。每次发布/修改只重写一个 shard；浏览器
第一次打开曲谱库时并发加载有数据的 shard，合并后在本地搜索。几千到数万条 metadata 都不需要
数据库全文检索。

## 一致性

沿用 Better-Endfield 的两个实测约束：

1. 云函数读取自己的私有对象必须附加唯一 query，强制绕 CDN 回源，否则 read-modify-write 会读到旧值。
2. 对象存储没有 CAS。每个 shard 与 index 都采用「写入 → 回源再读 → 验证自己的修改仍在」的方式，
   最多重试 3 次，把静默覆盖变成显式冲突。

发布顺序是 `score/<id>.js` → catalog → owner list。这样 catalog 不会先出现一个指向不存在对象的链接；
如果中途失败，最多留下一个不可发现的孤立 score 对象，后续可以用维护脚本清理。

## DFHS1

`src/persistence/scoreCodec.ts` 是公开谱面的唯一持久化格式。它只保存权威数据：

- PPQ
- transpose
- tempo map
- time signatures
- 可选 explicit measure starts
- `deltaStartTick + durationTick + MIDI pitch`

`start/duration(ms)`、音名、velocity、口琴键位都不保存，打开时重新派生。整个二进制流用 `fflate`
的 raw deflate 压缩，再 base64url 放进 JSONP/HTTP JSON。

服务端会 inflate DFHS 头和音符流，自行得到 BPM、音符数、时长与 payload hash，不采信客户端 body
里重复提交的统计字段。

## API

```text
POST   /scores
PATCH  /scores/:id
DELETE /scores/:id
GET    /me/scores?ownerToken=...
GET    /health
```

公开搜索和 `GET score/:id` 都没有 HTTP API，它们直接读 CDN JSONP。

## 环境变量

前端：

```text
VITE_CLOUDBASE_API=https://<gateway>/score
VITE_SCORE_STORAGE=https://<public-storage-domain>/harmonica
```

函数：

```text
SCORE_STORAGE_BASE=https://<public-storage-domain>
SCORE_BUCKET=harmonica
SCORE_DATA_KEY=<unguessable-private-prefix>
```

部署参数、环境 id、网关路由等不写死在仓库里；等 Toy/CloudBase 权限可用时再按实际环境配置。
