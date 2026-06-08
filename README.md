# Vivo Gallery Cloudflare Workers

将 Vivo 相册数据爬取并暴露为 REST API，部署在 Cloudflare Workers + D1 上。
完全免费，无服务器，全球 CDN。

## 架构

```
Cloudflare Cron (每30分钟)
    ↓
Workers 爬虫 → D1 (SQLite)
    ↓
REST API → 外部应用调用
```

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置 wrangler.toml

编辑 `wrangler.toml`，填入你的值：

```toml
name = "vivo-gallery-api"

[d1_databases]
binding = "DB"
database_name = "vivo-gallery-db"
database_id = "填入你的 D1 DB ID"

[vars]
VIVO_USER_ID = "你的VIVO_USER_ID"
```

### 3. 登录 Cloudflare

```bash
npx wrangler login
```

### 4. 创建 D1 数据库

```bash
# 首次创建（会自动创建数据库并返回 ID）
npx wrangler d1 create vivo-gallery-db

# 复制输出的 database_id，填入 wrangler.toml 的 database_id 字段
```

### 5. 初始化数据库表

```bash
npx wrangler d1 execute vivo-gallery-db --file src/schema.sql
```

### 6. 本地测试

```bash
# 本地模拟运行（需要先用 wrangler d1 execution sql create-db 创建本地数据库）
npx wrangler d1 execute vivo-gallery-db --local --file src/schema.sql
npx wrangler dev
```

### 7. 部署

```bash
npx wrangler deploy
```

部署后，你的 API 将可用：
- `https://vivo-gallery-api.<your-account>.workers.dev/`
- `https://vivo-gallery-api.<your-account>.workers.dev/api/posts?page=1&pageSize=20`

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/` | API 信息 |
| GET | `/api/posts?page=1&pageSize=20` | 分页获取帖子列表 |
| GET | `/api/posts/:id` | 获取帖子详情（含图片） |
| GET | `/api/posts/recent?limit=10` | 最近 N 个帖子 |
| GET | `/api/status` | 服务状态（帖子/图片总数） |
| POST | `/api/sync` | 手动触发同步 |

## 定时任务

`wrangler.toml` 中配置 `*/30 * * * *`，每30分钟自动执行增量同步。

## 与原 Python 代码对比

| 功能 | Python (MySQL) | Cloudflare Workers + D1 |
|------|---------------|------------------------|
| 爬取逻辑 | fetch_posts + save_albums | scrape.ts 中的 fetchPostList + syncPosts |
| 数据库 | MySQL | D1 (SQLite) |
| 定时任务 | cron / systemd | Workers Cron Trigger |
| API | 需另外写 | 内置 index.ts |
| 部署 | 本地 Docker | wrangler deploy |
| 费用 | 服务器资源 | 免费额度内 |

## 注意事项

1. **VIVO_USER_ID**：从环境变量或 wrangler.toml 的 `[vars]` 中获取
2. **D1 免费额度**：每天 500 万次读取，完全够用
3. **图片 URL**：只存储 URL，不下载图片，节省存储
4. **增量同步**：只插入新帖子，已存在的跳过

