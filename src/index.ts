// ============================================================
// Vivo Gallery API — Cloudflare Workers REST API 端点
// ============================================================

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

/**
 * HTML 响应
 */
function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
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

// 用全局 parseInt 避免同名冲突
function parseNumber(str: string | undefined, defaultVal: number): number {
  const n = globalThis.parseInt(str, 10);
  return globalThis.isNaN(n) ? defaultVal : n;
}

// ---------- API 路由 ----------

async function handlePosts(
  method: string,
  url: URL,
  db: D1Database
): Promise<Response> {
  // GET /api/posts/recent — 最近 N 个帖子（先匹配，避免被 /api/posts/ 前缀捕获）
  if (method === "GET" && url.pathname === "/api/posts/recent") {
    const params = parseQuery(url);
    const limit = parseNumber(params.limit, 20);

    try {
      const result = await db.prepare(
        "SELECT * FROM posts ORDER BY created_at DESC LIMIT ?"
      )
        .bind(limit)
        .all();
      const rows = (result.results as unknown as Record<string, unknown>[]) || [];
      return jsonResponse(rows);
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
        .all();
      const imgRows = (imagesResult.results as { url: string }[]) || [];

      return jsonResponse({
        data: {
          ...postResult,
          images: imgRows.map((img) => img.url),
        },
      });
    } catch (err) {
      return json({ error: "查询失败", details: String(err) }, 500);
    }
  }

  // GET /api/posts — 分页获取帖子列表
  if (method === "GET" && url.pathname === "/api/posts") {
    const params = parseQuery(url);
    const page = parseNumber(params.page, 1);
    const pageSize = parseNumber(params.pageSize, 20);
    const offset = (page - 1) * pageSize;

    try {
      const countResult = await db.prepare(
        "SELECT COUNT(*) as total FROM posts"
      ).all();
      const total = ((countResult.results as { total: number }[]) || [])[0]?.total ?? 0;

      const result = await db.prepare(
        "SELECT * FROM posts ORDER BY created_at DESC LIMIT ? OFFSET ?"
      )
        .bind(pageSize, offset)
        .all();
      const rows = (result.results as Record<string, unknown>[]) || [];

      return jsonResponse({
        data: rows,
        total,
        page,
        pageSize,
        totalPages: total > 0 ? globalThis.Math.ceil(total / pageSize) : 0,
      });
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
      const total = ((countResult.results as { total: number }[]) || [])[0]?.total ?? 0;

      const imgCountResult = await db.prepare(
        "SELECT COUNT(*) as total FROM images"
      ).all();
      const imgTotal = ((imgCountResult.results as { total: number }[]) || [])[0]?.total ?? 0;

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
  async fetch(
    request: CFRequest,
    env: { VIVO_USER_ID: string; DB: D1Database },
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();

    // CORS 预检
    if (method === "OPTIONS") {
      return corsResponse();
    }

    // 路由分发
    if (url.pathname === "/") {
      const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Vivo Gallery</title>
  <style>
    :root{--bg:#0f1724;--card:#0b1220;--muted:#9aa4b2;--accent:#4f46e5}
    body{margin:0;font-family:Inter,Arial,Helvetica,sans-serif;background:linear-gradient(180deg,#071025 0%,#0b1220 100%);color:#e6eef6}
    .wrap{max-width:1100px;margin:32px auto;padding:20px}
    header{display:flex;align-items:center;justify-content:space-between;gap:16px}
    h1{margin:0;font-size:1.6rem}
    p.lead{margin:6px 0 0;color:var(--muted)}
    .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px;margin-top:20px}
    .card{background:linear-gradient(180deg,rgba(255,255,255,0.02),transparent);border-radius:10px;padding:10px;box-shadow:0 6px 18px rgba(2,6,23,0.6);overflow:hidden}
    .thumb{width:100%;height:160px;object-fit:cover;border-radius:8px;background:#071026}
    .title{margin:8px 0 0;font-size:0.95rem;color:#dbeafe}
    .meta{color:var(--muted);font-size:0.85rem}
    .empty{color:var(--muted);text-align:center;padding:60px 0}
    footer{margin-top:28px;color:var(--muted);font-size:0.85rem;text-align:center}
    .controls{display:flex;gap:8px;align-items:center}
    button{background:var(--accent);border:none;color:white;padding:8px 12px;border-radius:8px;cursor:pointer}
    input{background:transparent;border:1px solid rgba(255,255,255,0.06);Padding:8px;border-radius:8px;color:inherit}
    @media (max-width:520px){.thumb{height:120px}}
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <div>
        <h1>Vivo Gallery</h1>
        <p class="lead">来自 Vivo 相册的最近帖子预览 — 自动同步至 Cloudflare D1</p>
      </div>
      <div class="controls">
        <input id="limit" type="number" min="1" max="100" value="24" style="width:80px" />
        <button id="refresh">刷新</button>
      </div>
    </header>

    <main id="main">
      <div class="empty">正在加载…</div>
    </main>

    <footer>使用 API: <a href="/api" style="color:#9ec5ff">/api</a> · 部署于 Cloudflare Workers</footer>
  </div>

  <script>
    async function load(limit=24){
      const main = document.getElementById('main');
      main.innerHTML = '<div class="empty">加载中…</div>';
      try{
        const res = await fetch('/api/posts/recent?limit='+limit);
        if(!res.ok) throw new Error('HTTP '+res.status);
        const data = await res.json();
        if(!Array.isArray(data)) { main.innerHTML='<div class="empty">无数据</div>'; return }
        if(data.length===0){ main.innerHTML='<div class="empty">没有帖子</div>'; return }
        const grid = document.createElement('div'); grid.className='grid';
        for(const item of data){
          const card = document.createElement('div'); card.className='card';
          const img = document.createElement('img'); img.className='thumb';
          const images = item.images || [];
          img.src = images[0] || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="100%" height="100%" fill="%23071026"/></svg>';
          img.alt = item.title || 'Vivo 帖子';
          const t = document.createElement('div'); t.className='title'; t.textContent = item.title || item.post_id || '无标题';
          const m = document.createElement('div'); m.className='meta'; m.textContent = (item.user_nick||'匿名') + ' · ' + (item.created_at||'')
          card.appendChild(img); card.appendChild(t); card.appendChild(m);
          grid.appendChild(card);
        }
        main.innerHTML=''; main.appendChild(grid);
      }catch(err){
        main.innerHTML = '<div class="empty">加载失败: '+(err.message||err)+'</div>';
      }
    }

    document.getElementById('refresh').addEventListener('click', ()=>{
      const limit = Number(document.getElementById('limit').value) || 24; load(limit);
    });

    // 首次加载
    load(Number(document.getElementById('limit').value)||24);
  </script>
</body>
</html>`;

      return htmlResponse(html);
    }

    if (url.pathname === "/api") {
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
  async scheduled(
    _controller: ScheduledController,
    env: { VIVO_USER_ID: string; DB: D1Database },
    _ctx: ExecutionContext
  ): Promise<void> {
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
