-- Vivo Gallery D1 Schema (SQLite)
-- 对应你 Python 代码中的表结构

CREATE TABLE IF NOT EXISTS posts (
    post_id TEXT PRIMARY KEY,
    title TEXT,
    description TEXT,
    user_nick TEXT,
    signature TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS images (
    image_id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id TEXT NOT NULL,
    url TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (post_id) REFERENCES posts(post_id) ON DELETE CASCADE
);

-- 索引：加速按帖子查图片
CREATE INDEX IF NOT EXISTS idx_images_post_id ON images(post_id);

-- 索引：加速分页查询帖子
CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at DESC);
