import { Module, OnModuleInit, Logger, Global } from '@nestjs/common';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import { join } from 'path';
import { mkdirSync } from 'fs';

// 使用独立的注入 token，避免与飞书 DataPaaS 的 DRIZZLE_DATABASE 冲突
export const LOCAL_SQLITE_DB = 'LOCAL_SQLITE_DB';

// 建表 SQL（SQLite 方言）
const INIT_SQL = `
CREATE TABLE IF NOT EXISTS archive_item (
  id TEXT PRIMARY KEY,
  linkid TEXT NOT NULL UNIQUE,
  title TEXT,
  summary TEXT,
  category TEXT,
  share_url TEXT,
  cover_url TEXT,
  local_cover_path TEXT,
  author_name TEXT,
  author_avatar TEXT,
  original_tags TEXT NOT NULL DEFAULT '[]',
  raw_data TEXT NOT NULL DEFAULT '{}',
  source_create_at TEXT,
  ai_tagged_at TEXT,
  ai_tag_error TEXT,
  comment_crawled_at TEXT,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  _created_at TEXT NOT NULL DEFAULT (datetime('now')),
  _created_by TEXT,
  _updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  _updated_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_archive_item_category ON archive_item(category);
CREATE INDEX IF NOT EXISTS idx_archive_item_linkid ON archive_item(linkid);
CREATE INDEX IF NOT EXISTS idx_archive_item_source_create_at ON archive_item(source_create_at);
CREATE INDEX IF NOT EXISTS idx_archive_item_created_at ON archive_item(_created_at);
CREATE INDEX IF NOT EXISTS idx_archive_item_is_deleted ON archive_item(is_deleted);

CREATE TABLE IF NOT EXISTS archive_comment (
  id TEXT PRIMARY KEY,
  commentid TEXT NOT NULL UNIQUE,
  linkid TEXT NOT NULL,
  root_comment_id TEXT,
  replyid TEXT,
  floor INTEGER,
  text TEXT,
  create_at TEXT,
  up INTEGER NOT NULL DEFAULT 0,
  is_support INTEGER NOT NULL DEFAULT 0,
  is_author INTEGER NOT NULL DEFAULT 0,
  child_num INTEGER NOT NULL DEFAULT 0,
  has_more INTEGER NOT NULL DEFAULT 0,
  image_urls TEXT NOT NULL DEFAULT '[]',
  local_image_paths TEXT NOT NULL DEFAULT '[]',
  userid TEXT,
  username TEXT,
  user_avatar TEXT,
  user_level INTEGER,
  reply_userid TEXT,
  reply_username TEXT,
  raw_data TEXT NOT NULL DEFAULT '{}',
  crawl_status TEXT NOT NULL DEFAULT 'ok',
  crawl_error TEXT,
  _created_at TEXT NOT NULL DEFAULT (datetime('now')),
  _created_by TEXT,
  _updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  _updated_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_archive_comment_linkid ON archive_comment(linkid);
CREATE INDEX IF NOT EXISTS idx_archive_comment_root ON archive_comment(root_comment_id);
CREATE INDEX IF NOT EXISTS idx_archive_comment_floor ON archive_comment(linkid, floor);
CREATE INDEX IF NOT EXISTS idx_archive_comment_create_at ON archive_comment(create_at);
CREATE INDEX IF NOT EXISTS idx_archive_comment_crawl_status ON archive_comment(crawl_status);

CREATE TABLE IF NOT EXISTS archive_tag (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT '#6b7280',
  _created_at TEXT NOT NULL DEFAULT (datetime('now')),
  _created_by TEXT,
  _updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  _updated_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_archive_tag_name ON archive_tag(name);

CREATE TABLE IF NOT EXISTS archive_item_tag (
  item_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  PRIMARY KEY (item_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_archive_item_tag_item_id ON archive_item_tag(item_id);
CREATE INDEX IF NOT EXISTS idx_archive_item_tag_tag_id ON archive_item_tag(tag_id);

CREATE TABLE IF NOT EXISTS sync_job (
  id TEXT PRIMARY KEY,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  total INTEGER NOT NULL DEFAULT 0,
  processed INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  fail_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at TEXT,
  finished_at TEXT,
  _created_at TEXT NOT NULL DEFAULT (datetime('now')),
  _created_by TEXT,
  _updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  _updated_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_sync_job_type_status ON sync_job(job_type, status);

CREATE TABLE IF NOT EXISTS archive_settings (
  id TEXT PRIMARY KEY,
  heybox_cookie TEXT NOT NULL,
  openai_base_url TEXT NOT NULL DEFAULT 'https://api.openai.com/v1',
  openai_api_key TEXT NOT NULL,
  openai_model TEXT NOT NULL DEFAULT 'gpt-4o-mini',
  openai_temperature REAL NOT NULL DEFAULT 0.7,
  crawl_topic_enabled INTEGER NOT NULL DEFAULT 0,
  topic_link_id TEXT NOT NULL DEFAULT '416158',
  auto_sync_enabled INTEGER NOT NULL DEFAULT 0,
  auto_sync_interval INTEGER NOT NULL DEFAULT 30,
  last_auto_sync_at TEXT,
  auto_sync_status TEXT NOT NULL DEFAULT 'idle',
  auto_sync_error TEXT,
  _created_at TEXT NOT NULL DEFAULT (datetime('now')),
  _created_by TEXT,
  _updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  _updated_by TEXT
);
`;

// 迁移：为已有数据库添加新字段（每条语句独立执行，避免一条失败导致全部回滚）
const MIGRATION_STATEMENTS = [
  'ALTER TABLE archive_settings ADD COLUMN crawl_topic_enabled INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE archive_settings ADD COLUMN topic_link_id TEXT NOT NULL DEFAULT \'416158\'',
  'ALTER TABLE archive_settings ADD COLUMN auto_sync_enabled INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE archive_settings ADD COLUMN auto_sync_interval INTEGER NOT NULL DEFAULT 30',
  'ALTER TABLE archive_settings ADD COLUMN last_auto_sync_at TEXT',
  'ALTER TABLE archive_settings ADD COLUMN auto_sync_status TEXT NOT NULL DEFAULT \'idle\'',
  'ALTER TABLE archive_settings ADD COLUMN auto_sync_error TEXT',
  'ALTER TABLE archive_item ADD COLUMN comment_crawled_at TEXT',
];

@Global()
@Module({
  providers: [
    {
      provide: LOCAL_SQLITE_DB,
      useFactory: () => {
        const logger = new Logger('SqliteDatabase');
        const dataDir = join(process.cwd(), 'data');
        mkdirSync(dataDir, { recursive: true });
        const dbPath = join(dataDir, 'app.db');
        logger.log(`Connecting to SQLite: ${dbPath}`);

        const sqlite = new Database(dbPath);
        sqlite.pragma('journal_mode = WAL');
        sqlite.pragma('foreign_keys = ON');

        // 自动建表
        sqlite.exec(INIT_SQL);

        // 执行迁移（为已有数据库添加新字段，每条语句独立执行，忽略已存在的错误）
        MIGRATION_STATEMENTS.forEach((sql) => {
          try {
            sqlite.exec(sql);
          } catch (e) {
            // 字段已存在，忽略
          }
        });
        logger.log('Migration completed');

        logger.log('Database tables initialized');

        const db = drizzle(sqlite);
        return db;
      },
    },
  ],
  exports: [LOCAL_SQLITE_DB],
})
export class SqliteDatabaseModule implements OnModuleInit {
  onModuleInit() {
    // 数据库连接在 useFactory 中已初始化
  }
}

export { LOCAL_SQLITE_DB };
export type { BetterSQLite3Database };
