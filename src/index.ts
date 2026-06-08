// ============================================================
// Vivo Gallery API — Cloudflare Workers REST API 端点
// 暴露 REST API 供外部应用调用
// ============================================================

// ---------- 路由定义 ----------

interface CFRequest extends Request {
  cf?: { country?: string };
}

/**
 * 标准化 JSON 响应
 */
function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

/**
 * CORS 预检
 */
function corsResponse(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

// ---------- 请求解析 ----------

function parseQuery(url: URL): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [key, value] of url.searchParams.entries()) {
    params[key] = value;
  }
  return params;
}

function parseInt(str: string | undefined, defaultVal: number): number {
  const n = parseInt(str, 10);
  return isNaN(n) ? defaultVal : n;
}

// ---------- API 路由 ----------

async function handlePosts(
  method: string,
  url: URL,
  db: D1Database
): Promise<Response> {
  // GET /api/posts — 分页获取帖子列表
  if (method === "GET" && url.pathname === "/api/posts") {
    const params = parseQuery(url);
    const page = parseInt(params.page, 1);
    const pageSize = parseInt(params.pageSize, 20);
    const offset = (page - 1) * pageSize;

    try {
      // 总数
      const countResult = await db.prepare("SELECT COUNT(*) as total FROM posts").all();
      const total = (countResult.results as { total: number }[])[0].total;

      // 分页数据
      const result = await db.prepare(
        "SELECT * FROM posts ORDER BY created_at DESC LIMIT ? OFFSET ?"
      )
        .bind(pageSize, offset)
        .all<{ post_id: string; title: string; description: string; user_nick: string; signature: string; created_at: string }>();

      return jsonResponse({
        data: result.results,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      });
    } catch (err) {
      return json({ error: "查询失败", details: String(err) }, 500);
    }
  }

  // GET /api/posts/:id — 获取帖子详情
  if (method === "GET" && url.pathname.startsWith("/api/posts/")) {
    const postId = url.pathname.split("/").pop();
    if (!postId) {
      return json({ error: "缺少 post_id" }, 400);
    }

    try {
      const postResult = await db.prepare(
        "SELECT * FROM posts WHERE post_id = ?"
      )
        .bind(postId)
        .first();

      if (!postResult) {
        return json({ error: "帖子不存在" }, 404);
      }

      const imagesResult = await db.prepare(
        "SELECT url FROM images WHERE post_id = ? ORDER BY image_id"
      )
        .bind(postId)
        .all<{ url: string }>();

      return jsonResponse({
        data: {
          ...postResult,
          images: (imagesResult.results || []).map((img) => img.url),
        },
      });
    } catch (err) {
      return json({ error: "查询失败", details: String(err) }, 500);
    }
  }

  // GET /api/posts/recent — 最近 N 个帖子
  if (method === "GET" && url.pathname === "/api/posts/recent") {
    const params = parseQuery(url);
    const limit = parseInt(params.limit, 20);

    try {
      const result = await db.prepare(
        "SELECT * FROM posts ORDER BY created_at DESC LIMIT ?"
      )
        .bind(limit)
        .all();

      return jsonResponse(result.results);
    } catch (err) {
      return json({ error: "查询失败", details: String(err) }, 500);
    }
  }

  return json({ error: "未知路径" }, 404);
}

async function handleSync(
  method: string,
  url: URL,
  env: { VIVO_USER_ID: string; DB: D1Database }
): Promise<Response> {
  // POST /api/sync — 手动触发同步
  if (method === "POST" && url.pathname === "/api/sync") {
    // 后台执行同步，立即返回
    try {
      const { syncPosts } = await import("./scrape");
      await syncPosts(env);
      return json({ message: "同步完成" });
    } catch (err) {
      return json({ error: "同步失败", details: String(err) }, 500);
    }
  }

  return json({ error: "未知路径" }, 404);
}

async function handleStatus(
  method: string,
  url: URL,
  db: D1Database
): Promise<Response> {
  // GET /api/status — 服务状态
  if (method === "GET" && url.pathname === "/api/status") {
    try {
      const countResult = await db.prepare(
        "SELECT COUNT(*) as total FROM posts"
      ).all();
      const total = (countResult.results as { total: number }[])[0].total;

      const imgCountResult = await db.prepare(
        "SELECT COUNT(*) as total FROM images"
      ).all();
      const imgTotal = (imgCountResult.results as { total: number }[])[0].total;

      return jsonResponse({
        status: "ok",
        posts: total,
        images: imgTotal,
      });
    } catch (err) {
      return json({ error: "查询失败", details: String(err) }, 500);
    }
  }

  return json({ error: "未知路径" }, 404);
}

// ---------- 主入口 ----------

export default {
  async fetch(request: CFRequest, env: { VIVO_USER_ID: string; DB: D1Database }, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();

    // CORS 预检
    if (method === "OPTIONS") {
      return corsResponse();
    }

    // 路由分发
    if (url.pathname === "/" || url.pathname === "/api") {
      return jsonResponse({
        message: "Vivo Gallery API",
        endpoints: {
          "GET /api/posts": "获取帖子列表（支持 page, pageSize 参数）",
          "GET /api/posts/:id": "获取帖子详情",
          "GET /api/posts/recent": "最近帖子",
          "GET /api/status": "服务状态",
          "POST /api/sync": "手动触发同步",
        },
      });
    }

    if (url.pathname === "/api/posts" || url.pathname.startsWith("/api/posts/")) {
      return handlePosts(method, url, env.DB);
    }

    if (url.pathname === "/api/status") {
      return handleStatus(method, url, env.DB);
    }

    if (url.pathname === "/api/sync") {
      return handleSync(method, url, env);
    }

    return json({ error: "Not Found" }, 404);
  },

  // 定时触发器：每30分钟自动爬取
  async scheduled(_controller: ScheduledController, env: { VIVO_USER_ID: string; DB: D1Database }, _ctx: ExecutionContext): Promise<void> {
    const { syncPosts } = await import("./scrape");
    await syncPosts(env);
  },
};

// ---------- 工具函数 ----------

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
