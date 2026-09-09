/* eslint-disable */
/**
 * SQLite 版本 schema
 * 使用 customType 自动处理 PostgreSQL 特有类型到 SQLite 的转换：
 * - uuid -> text（自动生成随机 UUID）
 * - jsonb -> text（自动 JSON.stringify/parse）
 * - timestamptz -> text（自动 Date↔ISO 字符串）
 * - array -> text（自动 JSON.stringify/parse）
 * - boolean -> integer（mode: boolean，Drizzle 自动处理）
 */
import { sql } from 'drizzle-orm';
import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
  customType,
} from 'drizzle-orm/sqlite-core';
import { randomUUID } from 'crypto';

export type FileAttachment = {
  bucket_id: string;
  file_path: string;
};

// ========== 自定义类型 ==========

// UUID 类型：存储为 text，插入时自动生成随机 UUID
const uuid = customType<{ data: string; driverData: string; config: { length?: number } }>({
  dataType() {
    return 'text';
  },
  toDriver(value: string) {
    return value;
  },
  fromDriver(value: string) {
    return value;
  },
});

// 带默认随机 UUID 的主键
const uuidPk = () =>
  uuid('id').primaryKey().$defaultFn(() => randomUUID());

// JSONB 类型：存储为 text，自动 JSON.stringify/parse
const jsonb = customType<{ data: Record<string, any>; driverData: string }>({
  dataType() {
    return 'text';
  },
  toDriver(value: Record<string, any>) {
    return JSON.stringify(value ?? {});
  },
  fromDriver(value: string): Record<string, any> {
    try {
      return typeof value === 'string' ? JSON.parse(value) : value;
    } catch {
      return {};
    }
  },
});

// 文本数组类型：存储为 text，自动 JSON.stringify/parse
const textArray = customType<{ data: string[]; driverData: string }>({
  dataType() {
    return 'text';
  },
  toDriver(value: string[]) {
    return JSON.stringify(value ?? []);
  },
  fromDriver(value: string): string[] {
    try {
      return typeof value === 'string' ? JSON.parse(value) : [];
    } catch {
      return [];
    }
  },
});

// 时间戳类型：存储为 text（ISO 字符串），自动 Date↔string 转换
const timestamptz = customType<{ data: Date | null; driverData: string | null; config: { precision?: number } }>({
  dataType() {
    return 'text';
  },
  toDriver(value: Date | string | null): string | null {
    if (value == null) return null;
    if (value instanceof Date) return value.toISOString();
    return value;
  },
  fromDriver(value: string | null): Date | null {
    if (value == null || value === '') return null;
    return new Date(value);
  },
});

// 布尔类型别名（SQLite integer mode boolean）
const bool = (name: string) => integer(name, { mode: 'boolean' });

// ========== 收藏条目 ==========
export const archiveItem = sqliteTable(
  'archive_item',
  {
    id: uuidPk(),
    linkid: text('linkid').notNull().unique(),
    title: text('title'),
    summary: text('summary'),
    category: text('category'),
    shareUrl: text('share_url'),
    coverUrl: text('cover_url'),
    localCoverPath: text('local_cover_path'),
    authorName: text('author_name'),
    authorAvatar: text('author_avatar'),
    originalTags: textArray('original_tags').notNull().default([]),
    rawData: jsonb('raw_data').notNull().default({}),
    sourceCreateAt: timestamptz('source_create_at'),
    aiTaggedAt: timestamptz('ai_tagged_at'),
    aiTagError: text('ai_tag_error'),
    isDeleted: bool('is_deleted').notNull().default(false),
    createdAt: timestamptz('_created_at').notNull().default(sql`(datetime('now'))`),
    createdBy: text('_created_by'),
    updatedAt: timestamptz('_updated_at').notNull().default(sql`(datetime('now'))`),
    updatedBy: text('_updated_by'),
  },
  (table) => [
    uniqueIndex('archive_item_linkid_key').on(table.linkid),
    index('idx_archive_item_category').on(table.category),
    index('idx_archive_item_linkid').on(table.linkid),
    index('idx_archive_item_source_create_at').on(table.sourceCreateAt),
    index('idx_archive_item_created_at').on(table.createdAt),
    index('idx_archive_item_is_deleted').on(table.isDeleted),
  ],
);

// ========== 评论 ==========
export const archiveComment = sqliteTable(
  'archive_comment',
  {
    id: uuidPk(),
    commentid: text('commentid').notNull().unique(),
    linkid: text('linkid').notNull(),
    rootCommentId: text('root_comment_id'),
    replyid: text('replyid'),
    floor: integer('floor'),
    text: text('text'),
    createAt: timestamptz('create_at'),
    up: integer('up').notNull().default(0),
    isSupport: bool('is_support').notNull().default(false),
    isAuthor: bool('is_author').notNull().default(false),
    childNum: integer('child_num').notNull().default(0),
    hasMore: bool('has_more').notNull().default(false),
    imageUrls: textArray('image_urls').notNull().default([]),
    localImagePaths: textArray('local_image_paths').notNull().default([]),
    userid: text('userid'),
    username: text('username'),
    userAvatar: text('user_avatar'),
    userLevel: integer('user_level'),
    replyUserid: text('reply_userid'),
    replyUsername: text('reply_username'),
    rawData: jsonb('raw_data').notNull().default({}),
    crawlStatus: text('crawl_status').notNull().default('ok'),
    crawlError: text('crawl_error'),
    createdAt: timestamptz('_created_at').notNull().default(sql`(datetime('now'))`),
    createdBy: text('_created_by'),
    updatedAt: timestamptz('_updated_at').notNull().default(sql`(datetime('now'))`),
    updatedBy: text('_updated_by'),
  },
  (table) => [
    uniqueIndex('archive_comment_commentid_key').on(table.commentid),
    index('idx_archive_comment_linkid').on(table.linkid),
    index('idx_archive_comment_root').on(table.rootCommentId),
    index('idx_archive_comment_floor').on(table.linkid, table.floor),
    index('idx_archive_comment_create_at').on(table.createAt),
    index('idx_archive_comment_crawl_status').on(table.crawlStatus),
  ],
);

// ========== 标签 ==========
export const archiveTag = sqliteTable(
  'archive_tag',
  {
    id: uuidPk(),
    name: text('name').notNull().unique(),
    color: text('color').notNull().default('#6b7280'),
    createdAt: timestamptz('_created_at').notNull().default(sql`(datetime('now'))`),
    createdBy: text('_created_by'),
    updatedAt: timestamptz('_updated_at').notNull().default(sql`(datetime('now'))`),
    updatedBy: text('_updated_by'),
  },
  (table) => [
    uniqueIndex('archive_tag_name_key').on(table.name),
    index('idx_archive_tag_name').on(table.name),
  ],
);

// ========== 条目-标签关联 ==========
export const archiveItemTag = sqliteTable(
  'archive_item_tag',
  {
    itemId: text('item_id').notNull(),
    tagId: text('tag_id').notNull(),
  },
  (table) => [
    index('idx_archive_item_tag_item_id').on(table.itemId),
    index('idx_archive_item_tag_tag_id').on(table.tagId),
    uniqueIndex('archive_item_tag_pkey').on(table.itemId, table.tagId),
  ],
);

// ========== 同步任务 ==========
export const syncJob = sqliteTable(
  'sync_job',
  {
    id: uuidPk(),
    jobType: text('job_type').notNull(),
    status: text('status').notNull().default('pending'),
    total: integer('total').notNull().default(0),
    processed: integer('processed').notNull().default(0),
    successCount: integer('success_count').notNull().default(0),
    failCount: integer('fail_count').notNull().default(0),
    errorMessage: text('error_message'),
    startedAt: timestamptz('started_at'),
    finishedAt: timestamptz('finished_at'),
    createdAt: timestamptz('_created_at').notNull().default(sql`(datetime('now'))`),
    createdBy: text('_created_by'),
    updatedAt: timestamptz('_updated_at').notNull().default(sql`(datetime('now'))`),
    updatedBy: text('_updated_by'),
  },
  (table) => [
    index('idx_sync_job_type_status').on(table.jobType, table.status),
  ],
);

// ========== 设置 ==========
export const archiveSettings = sqliteTable(
  'archive_settings',
  {
    id: uuidPk(),
    heyboxCookie: text('heybox_cookie').notNull(),
    openaiBaseUrl: text('openai_base_url').notNull().default('https://api.openai.com/v1'),
    openaiApiKey: text('openai_api_key').notNull(),
    openaiModel: text('openai_model').notNull().default('gpt-4o-mini'),
    openaiTemperature: real('openai_temperature').notNull().default(0.7),
    createdAt: timestamptz('_created_at').notNull().default(sql`(datetime('now'))`),
    createdBy: text('_created_by'),
    updatedAt: timestamptz('_updated_at').notNull().default(sql`(datetime('now'))`),
    updatedBy: text('_updated_by'),
  },
);

// table aliases (保持与原 schema 一致的导出名)
export const archiveCommentTable = archiveComment;
export const archiveItemTable = archiveItem;
export const archiveItemTagTable = archiveItemTag;
export const archiveSettingsTable = archiveSettings;
export const archiveTagTable = archiveTag;
export const syncJobTable = syncJob;
