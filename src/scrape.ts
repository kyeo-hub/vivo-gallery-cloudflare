// ============================================================
// Vivo Gallery Scraper — Cloudflare Workers 定时爬虫
// 对应原 Python 代码的 fetch_posts + save_albums 逻辑
// ============================================================

interface PostItem {
  postId: string;
  [key: string]: unknown;
}

interface PostDetail {
  postId: string;
  postTitle?: string;
  postDesc?: string;
  userNick?: string;
  signature?: string;
  images?: string[];
  [key: string]: unknown;
}

interface ListResponse {
  data?: { posts?: PostItem[] };
}

interface DetailResponse {
  data?: { post?: PostDetail };
}

/**
 * 从 Vivo 相册 API 拉取帖子列表（分页）
 */
async function fetchPostList(userId: string): Promise<PostItem[]> {
  const allPosts: PostItem[] = [];
  let pageNo = 1;

  while (true) {
    const now = Date.now();
    const url = new URL(
      `https://gallery.vivo.com.cn/gallery/wap/share/user/post/list/${userId}.do`
    );
    url.searchParams.set("dataFrom", "1");
    url.searchParams.set("pageNo", String(pageNo));
    url.searchParams.set("requestTime", String(now));
    url.searchParams.set("searchType", "4");
    url.searchParams.set("t", String(now));

    try {
      const resp = await fetch(url.toString());
      if (!resp.ok) {
        console.warn(`⚠️ 第 ${pageNo} 页 HTTP ${resp.status}`);
        break;
      }
      const json: ListResponse = await resp.json();
      const posts = json.data?.posts;
      if (!posts || posts.length === 0) {
        break;
      }
      allPosts.push(...posts);
      console.log(`📄 第 ${pageNo} 页: ${posts.length} 个帖子`);
      pageNo++;
    } catch (err) {
      console.error(`❌ 第 ${pageNo} 页请求失败:`, err);
      break;
    }
  }

  console.log(`📊 共找到 ${allPosts.length} 个帖子`);
  return allPosts;
}

/**
 * 获取单个帖子详情
 */
async function fetchPostDetail(postId: string): Promise<PostDetail | null> {
  const url = new URL(
    "https://gallery.vivo.com.cn/gallery/wap/H5/post/getPostDetailById.do"
  );
  url.searchParams.set("postId", postId);

  try {
    const resp = await fetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    if (!resp.ok) return null;
    const json: DetailResponse = await resp.json();
    return json.data?.post || null;
  } catch {
    return null;
  }
}

/**
 * 增量同步：拉取新帖子并存入 D1
 */
export async function syncPosts(env: {
  VIVO_USER_ID: string;
  DB: D1Database;
}): Promise<void> {
  const { VIVO_USER_ID: userId, DB } = env;

  if (!userId) {
    console.error("❌ VIVO_USER_ID 未配置");
    return;
  }

  console.log("🔄 开始同步 Vivo 相册...");

  // 1. 拉取帖子列表
  const posts = await fetchPostList(userId);
  if (posts.length === 0) {
    console.log("⏭️ 没有新帖子需要处理");
    return;
  }

  // 2. 批量查询已存在的 post_id
  const existing = await DB.prepare(
    "SELECT post_id FROM posts WHERE post_id IN (?)"
  )
    .bind(posts.map((p) => p.postId).join(","))
    .all<{ post_id: string }>();

  const existingIds = new Set((existing.results as { post_id: string }[]).map((r) => r.post_id));

  // 3. 处理新帖子
  let newCount = 0;
  let skipCount = 0;

  for (const post of posts) {
    const pid = String(post.postId);
    if (existingIds.has(pid)) {
      skipCount++;
      continue;
    }

    const detail = await fetchPostDetail(pid);
    if (!detail) {
      console.warn(`⚠️ 无法获取帖子 ${pid} 详情`);
      continue;
    }

    // 插入帖子
    await DB.prepare(
      `INSERT INTO posts (post_id, title, description, user_nick, signature)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind(
        pid,
        detail.postTitle || "",
        detail.postDesc || "",
        detail.userNick || "",
        detail.signature || ""
      )
      .run();

    // 插入图片
    const images = detail.images || [];
    if (images.length > 0) {
      // D1 不支持批量 IN 插入，逐条插入
      for (const img of images) {
        await DB.prepare(
          `INSERT INTO images (post_id, url) VALUES (?, ?)`
        )
          .bind(pid, img)
          .run();
      }
    }

    newCount++;
    console.log(`✅ 新增: ${pid} (${detail.postTitle || "无标题"}) 📷 ${images.length}张`);
  }

  console.log(`✅ 同步完成: 新增 ${newCount} 个帖子, 跳过 ${skipCount} 个`);
}
