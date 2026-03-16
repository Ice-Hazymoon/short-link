# Short Link

一个专业的短链接管理服务，基于 Cloudflare 全套技术栈构建。

## 技术栈

| 组件 | 技术 |
|------|------|
| 运行时 | Cloudflare Workers |
| 框架 | Hono |
| 数据库 | Cloudflare D1 (SQLite) |
| ORM | Drizzle ORM |
| 缓存 | Cloudflare KV |
| 分析 | Analytics Engine (已配置) + D1 点击记录 |
| 测试 | Vitest + @cloudflare/vitest-pool-workers |
| 包管理 | bun |

## 功能

- **短链接管理** — 创建、编辑、删除短链接，支持自定义 slug 或自动生成
- **多域名支持** — 管理多个域名，按域名创建和隔离链接
- **密码保护** — 为链接设置访问密码，使用 PBKDF2 加密存储
- **链接过期** — 设置到期时间，过期后返回 410
- **点击次数限制** — 设置最大点击次数
- **启用/禁用** — 随时切换链接状态
- **访问统计** — 按国家、设备、浏览器、操作系统、来源、时间维度分析
- **全局概览** — 总链接数、总点击数、热门链接排行
- **KV 缓存** — 重定向走缓存，5 分钟 TTL，毫秒级响应
- **API Key 认证** — 管理接口使用密钥保护

## 快速开始

### 安装依赖

```bash
bun install
```

### 本地开发

```bash
bun run dev
```

### 运行测试

```bash
bun run test
```

### 部署

```bash
bun run deploy
```

## 命令一览

| 命令 | 说明 |
|------|------|
| `bun run dev` | 启动本地开发服务器 (localhost:8787) |
| `bun run test` | 运行全部测试 |
| `bun run test:watch` | 监听模式运行测试 |
| `bun run deploy` | 部署到 Cloudflare Workers |
| `bun run db:generate` | 修改 schema 后生成迁移文件 |
| `bun run db:migrate` | 将迁移应用到远程 D1 |
| `bun run db:migrate:local` | 将迁移应用到本地 D1 |
| `bun run types` | 从 wrangler 配置生成 TypeScript 类型 |

## API 文档

所有 `/api/*` 端点需要 `x-api-key` 请求头认证。

### 域名管理

#### 获取域名列表

```
GET /api/domains
```

#### 添加域名

```
POST /api/domains
Content-Type: application/json

{ "domain": "example.com" }
```

#### 删除域名

```
DELETE /api/domains/:id
```

> 域名下有链接时无法删除，需先删除关联链接。

---

### 链接管理

#### 获取链接列表

```
GET /api/links?domain_id=1&page=1&limit=50
```

返回字段包含 `clickCount`、`shortUrl`、`hasPassword` 等聚合信息。

#### 创建链接

```
POST /api/links
Content-Type: application/json

{
  "url": "https://github.com",
  "domainId": 1,
  "slug": "gh",           // 可选，不传则自动生成 7 位短码
  "password": "secret",   // 可选，密码保护
  "expiresAt": "2025-12-31T23:59:59Z",  // 可选，过期时间
  "maxClicks": 1000       // 可选，最大点击次数
}
```

#### 获取单个链接

```
GET /api/links/:id
```

#### 更新链接

```
PATCH /api/links/:id
Content-Type: application/json

{
  "url": "https://new-url.com",   // 可选
  "slug": "new-slug",             // 可选
  "password": "new-pass",         // 可选，传 null 移除密码
  "expiresAt": null,              // 可选，传 null 移除过期
  "maxClicks": null,              // 可选
  "enabled": false                // 可选
}
```

#### 删除链接

```
DELETE /api/links/:id
```

---

### 访问统计

#### 单链接统计

```
GET /api/links/:id/stats?days=30
```

返回：

```json
{
  "totalClicks": 142,
  "days": 30,
  "byCountry": [{ "country": "US", "count": 80 }, { "country": "JP", "count": 42 }],
  "byDevice": [{ "device": "mobile", "count": 90 }, { "device": "desktop", "count": 52 }],
  "byBrowser": [{ "browser": "Chrome", "count": 100 }],
  "byOS": [{ "os": "iOS", "count": 60 }],
  "byReferer": [{ "referer": "https://twitter.com", "count": 30 }],
  "clicksOverTime": [{ "date": "2025-03-15", "count": 12 }]
}
```

#### 全局统计

```
GET /api/stats
```

返回总链接数、总点击数、总域名数、热门链接 Top 10。

---

### 重定向

```
GET /:slug
```

- 正常链接：302 重定向到目标 URL
- 密码保护：302 到 `/:slug/password` 密码页面
- 已过期：410 Gone
- 已禁用：404 Not Found
- 超出点击限制：410 Gone

密码验证：

```
POST /:slug/password
Content-Type: application/x-www-form-urlencoded

password=your-password
```

---

### 健康检查

```
GET /health
```

## 首次部署指南

### 1. 创建 Cloudflare 资源

```bash
# 创建 D1 数据库
wrangler d1 create short-link-db

# 创建 KV 命名空间
wrangler kv namespace create CACHE
```

将返回的 `database_id` 和 KV `id` 填入 `wrangler.jsonc`。

### 2. 应用数据库迁移

```bash
wrangler d1 migrations apply short-link-db --remote
```

### 3. 设置 API 密钥

```bash
echo "your-secret-api-key" | wrangler secret put API_KEY
```

### 4. 部署

```bash
bun run deploy
```

### 5. 绑定自定义域名

在 `wrangler.jsonc` 中取消 `routes` 注释并配置你的域名，确保该域名的 DNS 通过 Cloudflare 代理。

## 项目结构

```
src/
├── index.ts              # 入口，路由挂载
├── types.ts              # 类型定义 (Bindings, AppEnv)
├── db/
│   ├── schema.ts         # Drizzle 数据库 schema (domains, links, clicks)
│   └── index.ts          # 数据库初始化
├── lib/
│   ├── slug.ts           # nanoid 短码生成
│   ├── password.ts       # PBKDF2 密码哈希/验证
│   └── ua.ts             # User-Agent 解析 (设备/浏览器/OS)
├── middleware/
│   └── auth.ts           # API Key 认证中间件
└── routes/
    ├── api.ts            # API 路由 (域名/链接/统计 CRUD)
    └── redirect.ts       # 重定向 + 密码验证页面
test/
├── api.test.ts           # API + 重定向测试 (22 cases)
├── password.test.ts      # 密码保护 + 过期 + 禁用测试 (6 cases)
└── setup.ts              # 测试数据库初始化
drizzle/
└── 0000_*.sql            # D1 迁移文件
```

## License

MIT
