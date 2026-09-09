// ========== Settings ==========

export interface SettingsResponse {
  heyboxCookie: string;
  openaiBaseUrl: string;
  openaiApiKey: string;
  openaiModel: string;
  openaiTemperature: number;
  hasHeyboxCookie: boolean;
  hasOpenaiKey: boolean;
}

export interface UpdateSettingsRequest {
  heyboxCookie?: string;
  openaiBaseUrl?: string;
  openaiApiKey?: string;
  openaiModel?: string;
  openaiTemperature?: number;
}

export interface TestHeyboxResponse {
  ok: boolean;
  message: string;
  sampleCount?: number;
}

export interface TestOpenaiResponse {
  ok: boolean;
  message: string;
}

// ========== Archive Items ==========

export interface ArchiveItem {
  id: string;
  linkid: string;
  title: string | null;
  summary: string | null;
  category: string | null;
  shareUrl: string | null;
  coverUrl: string | null;
  localCoverPath: string | null;
  authorName: string | null;
  authorAvatar: string | null;
  originalTags: string[];
  sourceCreateAt: string | null;
  aiTaggedAt: string | null;
  aiTagError: string | null;
  createdAt: string;
  tags: ArchiveTag[];
  commentCount?: number;
}

export interface ArchiveTag {
  id: string;
  name: string;
  color: string;
  count?: number;
}

export interface ArchiveItemDetail extends ArchiveItem {
  rawData: Record<string, any>;
}

export interface ListItemsRequest {
  page?: number;
  pageSize?: number;
  category?: string;
  tags?: string[];
  search?: string;
  sort?: 'createdAt' | 'sourceCreateAt';
  untagged?: boolean;
}

export interface ListItemsResponse {
  items: ArchiveItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface UpdateItemTagsRequest {
  tagNames: string[];
}

export interface UpdateItemCategoryRequest {
  category: string;
}

// ========== Stats ==========

export interface StatsResponse {
  totalItems: number;
  totalTags: number;
  untaggedCount: number;
  categoryCounts: { category: string; count: number }[];
}

// ========== Sync Job ==========

export interface SyncJob {
  id: string;
  jobType: string;
  status: 'pending' | 'running' | 'success' | 'failed';
  total: number;
  processed: number;
  successCount: number;
  failCount: number;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface StartSyncResponse {
  jobId: string;
}

// ========== AI Tagging ==========

export interface TagResult {
  tags: string[];
  category: string;
  summary: string;
}

// ========== Comments ==========

export interface ArchiveComment {
  id: string;
  commentid: string;
  linkid: string;
  rootCommentId: string | null;
  replyid: string | null;
  floor: number | null;
  text: string | null;
  createAt: string | null;
  up: number;
  isAuthor: boolean;
  childNum: number;
  hasMore: boolean;
  imageUrls: string[];
  localImagePaths: string[];
  userid: string | null;
  username: string | null;
  userAvatar: string | null;
  userLevel: number | null;
  replyUserid: string | null;
  replyUsername: string | null;
  crawlStatus: 'ok' | 'captcha' | 'failed';
  crawlError: string | null;
  rawData: Record<string, any>;
}

export interface ListCommentsResponse {
  rootComments: ArchiveComment[];
  total: number;
  crawlStatus?: 'done' | 'running' | 'pending' | 'captcha' | 'none';
}

export interface StartCommentCrawlResponse {
  jobId: string;
}

export interface CommentCrawlStatusResponse {
  job: SyncJob | null;
  captchaItems: number;
}

// ========== Export ==========

export interface ExportData {
  items: ArchiveItemDetail[];
  tags: ArchiveTag[];
  exportedAt: string;
}
