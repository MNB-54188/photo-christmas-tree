-- 图片圣诞树 · D1 初始化脚本
-- 执行：wrangler d1 execute photo-tree-db --file=./migrations/0001_init.sql

DROP TABLE IF EXISTS photos;

CREATE TABLE photos (
  id          TEXT PRIMARY KEY,          -- 前端生成的唯一 ID
  name        TEXT    NOT NULL DEFAULT '未命名',
  kv_key      TEXT    NOT NULL,          -- 对应 KV 中的键：photo:<id>
  width       INTEGER NOT NULL DEFAULT 0,
  height      INTEGER NOT NULL DEFAULT 0,
  size        INTEGER NOT NULL DEFAULT 0, -- 字节数
  created_at  INTEGER NOT NULL DEFAULT 0  -- 毫秒时间戳
);

CREATE INDEX idx_photos_created_at ON photos (created_at DESC);
