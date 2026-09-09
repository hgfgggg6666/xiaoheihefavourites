import { Injectable, Inject, Logger } from '@nestjs/common';
import { FileService } from '@lark-apaas/fullstack-nestjs-core';
import { LOCAL_SQLITE_DB } from '../../database/sqlite.module';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq, desc, and, count, notInArray } from 'drizzle-orm';
import { archiveComment, archiveItem, syncJob } from '@server/database/schema';
import {
  buildHeyboxUrl,
  buildHeyboxHeaders,
  HEYBOX_UA,
} from '@server/common/utils/heybox-sign';
import { SettingsService } from '../settings/settings.service';
import type {
  ArchiveComment as ArchiveCommentDto,
  SyncJob,
} from '@shared/api.interface';

interface LinkTreeResponse {
  status: string;
  msg?: string;
  result?: {
    link?: any;
    comments?: { comment: any[] }[];
    has_more_floors?: number | string;
    total_floor_num?: number;
  };
}

interface SubCommentsResponse {
  status: string;
  msg?: string;
  result?: {
    comments?: any[];
    has_more?: number | string;
  };
}

type CommentRow = typeof archiveComment.$inferSelect;

@Injectable()
export class CommentService {
  private readonly logger = new Logger(CommentService.name);

  constructor(
    @Inject(LOCAL_SQLITE_DB) private readonly db: BetterSQLite3Database,
    private readonly settingsService: SettingsService,
    private readonly fileService: FileService,
  ) {}

  private static httpGet(
    urlStr: string,
    headers: Record<string, string>,
    timeoutMs: number = 15000,
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      import('https').then((https) => {
        const urlObj = new URL(urlStr);
        const req = https.request(
          {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: 'GET',
            headers,
            timeout: timeoutMs,
          },
          (res) => {
            let data = '';
            res.on('data', (chunk: Buffer) => {
              data += chunk.toString();
            });
            res.on('end', () => {
              if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                resolve(data);
              } else {
                reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
              }
            });
          },
        );
        req.on('error', (err: Error) => reject(new Error(`网络请求失败: ${err.message}`)));
        req.on('timeout', () => req.destroy(new Error('请求超时')));
        req.end();
      });
    });
  }

  private static sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private extractCommentFields(raw: any): {
    commentid: string;
    rootCommentId: string | null;
    replyid: string | null;
    floor: number | null;
    text: string | null;
    createAt: Date | null;
    up: number;
    isAuthor: boolean;
    childNum: number;
    hasMore: boolean;
    imageUrls: string[];
    userid: string | null;
    username: string | null;
    userAvatar: string | null;
    userLevel: number | null;
    replyUserid: string | null;
    replyUsername: string | null;
    rawData: Record<string, any>;
  } {
    const commentid: string = String(raw.commentid ?? raw.id ?? '');

    let rootCommentId: string | null = null;
    if (raw.root_comment_id != null) {
      rootCommentId = String(raw.root_comment_id);
    }

    const replyid: string | null = raw.replyid != null ? String(raw.replyid) : null;

    const floor: number | null =
      raw.floor != null && raw.floor !== '' ? Number(raw.floor) : null;

    const text: string | null =
      raw.text != null && raw.text !== '' ? String(raw.text) : null;

    let createAt: Date | null = null;
    const rawTime = raw.create_at ?? raw.time;
    if (rawTime != null) {
      const num = Number(rawTime);
      if (!isNaN(num) && num > 0) {
        const ms = num < 1e12 ? num * 1000 : num;
        const d = new Date(ms);
        if (!isNaN(d.getTime())) createAt = d;
      }
    }

    const up: number = Number(raw.up ?? raw.like_num ?? 0) || 0;
    const isAuthor: boolean = raw.is_author === true || raw.is_author === 1;
    const childNum: number = Number(raw.child_num ?? 0) || 0;
    const hasMore: boolean = raw.has_more === 1 || raw.has_more === '1';

    let imageUrls: string[] = [];
    if (Array.isArray(raw.image_urls)) {
      imageUrls = raw.image_urls
        .map((img: any) => (typeof img === 'string' ? img : img?.url))
        .filter((u: any) => u && typeof u === 'string');
    } else if (Array.isArray(raw.images)) {
      imageUrls = raw.images
        .map((img: any) => (typeof img === 'string' ? img : img?.url))
        .filter((u: any) => u && typeof u === 'string');
    }

    const userid: string | null = raw.user?.userid != null ? String(raw.user.userid) : null;
    const username: string | null = raw.user?.username ?? null;
    const userAvatar: string | null = raw.user?.avatar ?? null;
    const userLevel: number | null =
      raw.user?.level_info?.level != null ? Number(raw.user.level_info.level) : null;

    let replyUserid: string | null = null;
    let replyUsername: string | null = null;
    if (raw.replyuser) {
      replyUserid = raw.replyuser.userid != null ? String(raw.replyuser.userid) : null;
      replyUsername = raw.replyuser.username ?? null;
    } else if (raw.reply) {
      replyUserid = raw.reply.userid != null ? String(raw.reply.userid) : null;
      replyUsername = raw.reply.username ?? null;
    }

    return {
      commentid,
      rootCommentId,
      replyid,
      floor,
      text,
      createAt,
      up,
      isAuthor,
      childNum,
      hasMore,
      imageUrls,
      userid,
      username,
      userAvatar,
      userLevel,
      replyUserid,
      replyUsername,
      rawData: JSON.parse(JSON.stringify(raw)),
    };
  }

  async fetchLinkTreePage(
    cookie: string,
    linkid: string,
    page: number,
    limit: number = 20,
  ): Promise<{
    comments: any[];
    hasMore: boolean;
    totalFloorNum: number;
    status: string;
    msg?: string;
    link?: any; // 帖子详情（含完整正文）
  }> {
    const basePath = '/bbs/app/link/tree';
    const url = buildHeyboxUrl(basePath, {
      link_id: linkid,
      is_first: page === 1 ? 1 : 0,
      page,
      index: 1,
      limit,
      owner_only: 0,
    });
    const headers = buildHeyboxHeaders(cookie);

    const body = await CommentService.httpGet(url, headers);
    const result: LinkTreeResponse = JSON.parse(body);

    if (result.status !== 'ok') {
      return {
        comments: [],
        hasMore: false,
        totalFloorNum: 0,
        status: result.status,
        msg: result.msg,
      };
    }

    const floors = result.result?.comments ?? [];
    const flatComments: any[] = [];
    for (const floor of floors) {
      if (Array.isArray(floor.comment)) {
        flatComments.push(...floor.comment);
      }
    }

    const hasMore = result.result?.has_more_floors === 1 || result.result?.has_more_floors === '1';
    const totalFloorNum = Number(result.result?.total_floor_num ?? 0);

    return {
      comments: flatComments,
      hasMore,
      totalFloorNum,
      status: 'ok',
      link: result.result?.link, // 返回帖子详情
    };
  }

  async fetchSubComments(
    cookie: string,
    rootCommentId: string,
    lastval: string = '',
  ): Promise<{
    comments: any[];
    hasMore: boolean;
    status: string;
    msg?: string;
  }> {
    const basePath = '/bbs/app/comment/sub/comments';
    const url = buildHeyboxUrl(basePath, {
      root_comment_id: rootCommentId,
      lastval,
    });
    const headers = buildHeyboxHeaders(cookie);

    const body = await CommentService.httpGet(url, headers);
    const result: SubCommentsResponse = JSON.parse(body);

    if (result.status !== 'ok') {
      return {
        comments: [],
        hasMore: false,
        status: result.status,
        msg: result.msg,
      };
    }

    return {
      comments: result.result?.comments ?? [],
      hasMore:
        result.result?.has_more === 1 || result.result?.has_more === '1',
      status: 'ok',
    };
  }

  async upsertComment(
    linkid: string,
    rawComment: any,
    rootCommentIdOverride: string | null = null,
  ): Promise<string> {
    const f = this.extractCommentFields(rawComment);
    const rootCommentId = rootCommentIdOverride ?? f.rootCommentId;

    const values = {
      commentid: f.commentid,
      linkid,
      rootCommentId,
      replyid: f.replyid,
      floor: f.floor,
      text: f.text,
      createAt: f.createAt,
      up: f.up,
      isAuthor: f.isAuthor,
      childNum: f.childNum,
      hasMore: f.hasMore,
      imageUrls: f.imageUrls,
      userid: f.userid,
      username: f.username,
      userAvatar: f.userAvatar,
      userLevel: f.userLevel,
      replyUserid: f.replyUserid,
      replyUsername: f.replyUsername,
      rawData: f.rawData,
      crawlStatus: 'ok',
      crawlError: null as string | null,
    };

    const result = await this.db
      .insert(archiveComment)
      .values(values)
      .onConflictDoUpdate({
        target: archiveComment.commentid,
        set: {
          floor: f.floor,
          text: f.text,
          createAt: f.createAt,
          up: f.up,
          isAuthor: f.isAuthor,
          childNum: f.childNum,
          hasMore: f.hasMore,
          imageUrls: f.imageUrls,
          userid: f.userid,
          username: f.username,
          userAvatar: f.userAvatar,
          userLevel: f.userLevel,
          replyUserid: f.replyUserid,
          replyUsername: f.replyUsername,
          rawData: f.rawData,
          crawlStatus: 'ok',
          crawlError: null,
        },
      })
      .returning({ id: archiveComment.id });

    return result[0].id;
  }

  async markCommentCaptcha(linkid: string, commentid: string, errorMsg: string): Promise<void> {
    const existing = await this.db
      .select({ id: archiveComment.id })
      .from(archiveComment)
      .where(eq(archiveComment.commentid, commentid));

    if (existing.length > 0) {
      await this.db
        .update(archiveComment)
        .set({ crawlStatus: 'captcha', crawlError: errorMsg })
        .where(eq(archiveComment.commentid, commentid));
    } else {
      await this.db.insert(archiveComment).values({
        commentid,
        linkid,
        crawlStatus: 'captcha',
        crawlError: errorMsg,
      });
    }
  }

  async markItemCommentCaptcha(linkid: string, errorMsg: string): Promise<void> {
    const sentinelId = `captcha_${linkid}`;
    const existing = await this.db
      .select({ id: archiveComment.id })
      .from(archiveComment)
      .where(eq(archiveComment.commentid, sentinelId));

    if (existing.length > 0) {
      await this.db
        .update(archiveComment)
        .set({ crawlStatus: 'captcha', crawlError: errorMsg })
        .where(eq(archiveComment.commentid, sentinelId));
    } else {
      await this.db.insert(archiveComment).values({
        commentid: sentinelId,
        linkid,
        crawlStatus: 'captcha',
        crawlError: errorMsg,
      });
    }
  }

  async getItemCrawlStatus(linkid: string): Promise<'done' | 'running' | 'pending' | 'captcha' | 'none'> {
    const [countRow] = await this.db
      .select({ count: count() })
      .from(archiveComment)
      .where(eq(archiveComment.linkid, linkid));

    const total = Number(countRow.count);
    if (total === 0) return 'none';

    const [captchaRow] = await this.db
      .select({ count: count() })
      .from(archiveComment)
      .where(
        and(
          eq(archiveComment.linkid, linkid),
          eq(archiveComment.crawlStatus, 'captcha'),
        ),
      );

    if (Number(captchaRow.count) > 0) return 'captcha';
    return 'done';
  }

  async crawlSingleItem(
    cookie: string,
    linkid: string,
  ): Promise<{ successCount: number; failCount: number; captcha: boolean }> {
    let successCount = 0;
    let failCount = 0;
    let captcha = false;

    const rootCommentIds: string[] = [];
    let page = 1;
    const limit = 20;
    let retries = 0;
    const maxRetries = 3;

    while (true) {
      await CommentService.sleep(200 + Math.floor(Math.random() * 200));

      try {
        const result = await this.fetchLinkTreePage(cookie, linkid, page, limit);

        if (result.status === 'login') {
          throw new Error(`Cookie 已失效: ${result.msg ?? '请重新登录'}`);
        }

        if (result.status === 'show_captcha') {
          retries += 1;
          if (retries <= maxRetries) {
            const backoff = 2000 * Math.pow(2, retries - 1);
            this.logger.warn(
              `评论抓取触发验证码 linkid=${linkid} page=${page}, 第 ${retries} 次退避 ${backoff}ms`,
            );
            await CommentService.sleep(backoff);
            continue;
          }
          captcha = true;
          await this.markItemCommentCaptcha(linkid, result.msg ?? '触发风控验证码');
          failCount += 1;
          break;
        }

        if (result.status !== 'ok') {
          retries += 1;
          if (retries <= maxRetries) {
            await CommentService.sleep(2000 * retries);
            continue;
          }
          failCount += 1;
          break;
        }

        retries = 0;

        // 第一次请求时，保存帖子详情（含完整正文）到数据库
        if (page === 1 && result.link) {
          try {
            await this.savePostDetail(linkid, result.link);
          } catch (e) {
            const err = e as Error;
            this.logger.warn(`保存帖子详情失败 linkid=${linkid}: ${err.message}`);
          }
        }

        const { comments } = result;
        if (comments.length === 0 && !result.hasMore) break;

        for (const raw of comments) {
          try {
            await this.upsertComment(linkid, raw);
            successCount += 1;

            if (!raw.root_comment_id && raw.commentid) {
              rootCommentIds.push(String(raw.commentid));
            }
          } catch (e) {
            const err = e as Error;
            this.logger.warn(`评论 upsert 失败: ${err.message}`);
            failCount += 1;
          }
        }

        if (!result.hasMore) break;
        page += 1;
      } catch (e) {
        const err = e as Error;
        if (err.message.includes('Cookie 已失效')) throw err;
        retries += 1;
        if (retries <= maxRetries) {
          this.logger.warn(
            `评论抓取异常 linkid=${linkid} page=${page}: ${err.message}, 重试 ${retries}/${maxRetries}`,
          );
          await CommentService.sleep(2000 * retries);
        } else {
          failCount += 1;
          break;
        }
      }
    }

    // 楼中楼并发抓取（并发数 3）
    const SUB_CONCURRENCY = 3;
    for (let i = 0; i < rootCommentIds.length; i += SUB_CONCURRENCY) {
      const batch = rootCommentIds.slice(i, i + SUB_CONCURRENCY);
      const batchResults = await Promise.allSettled(
        batch.map((rootId: string) => this.crawlSubComments(cookie, linkid, rootId)),
      );
      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          successCount += result.value.successCount;
          failCount += result.value.failCount;
          if (result.value.captcha) captcha = true;
        } else {
          const err = result.reason as Error;
          if (err.message.includes('Cookie 已失效')) throw err;
          this.logger.warn(`楼中楼抓取失败: ${err.message}`);
          failCount += 1;
        }
      }
    }

    return { successCount, failCount, captcha };
  }

  /**
   * 保存帖子详情（含完整正文）到数据库
   * 把 link/tree API 返回的完整帖子信息合并到 raw_data 里
   */
  private async savePostDetail(linkid: string, linkDetail: any): Promise<void> {
    if (!linkDetail) return;

    // 从数据库读取当前的 raw_data
    const item = await this.db
      .select({ id: archiveItem.id, rawData: archiveItem.rawData })
      .from(archiveItem)
      .where(eq(archiveItem.linkid, linkid))
      .limit(1);

    if (item.length === 0) return;

    try {
      const currentRaw = JSON.parse(item[0].rawData as string || '{}');
      // 合并帖子详情，完整正文会覆盖被截断的 description
      const mergedRaw = { ...currentRaw, ...linkDetail, full_detail: true };

      await this.db
        .update(archiveItem)
        .set({ rawData: JSON.stringify(mergedRaw) })
        .where(eq(archiveItem.id, item[0].id));

      this.logger.log(`帖子详情已保存 linkid=${linkid}`);
    } catch (e) {
      const err = e as Error;
      this.logger.warn(`保存帖子详情失败 linkid=${linkid}: ${err.message}`);
    }
  }

  private async crawlSubComments(
    cookie: string,
    linkid: string,
    rootCommentId: string,
  ): Promise<{ successCount: number; failCount: number; captcha: boolean }> {
    let successCount = 0;
    let failCount = 0;
    let captcha = false;
    let lastval = '';
    let retries = 0;
    const maxRetries = 2;

    while (true) {
      await CommentService.sleep(150 + Math.floor(Math.random() * 150));

      try {
        const result = await this.fetchSubComments(cookie, rootCommentId, lastval);

        if (result.status === 'login') {
          throw new Error(`Cookie 已失效: ${result.msg ?? '请重新登录'}`);
        }

        if (result.status === 'show_captcha') {
          retries += 1;
          if (retries <= maxRetries) {
            await CommentService.sleep(2000 * retries);
            continue;
          }
          captcha = true;
          failCount += 1;
          break;
        }

        if (result.status !== 'ok') {
          retries += 1;
          if (retries <= maxRetries) {
            await CommentService.sleep(1500 * retries);
            continue;
          }
          failCount += 1;
          break;
        }

        retries = 0;
        const subs = result.comments;
        if (subs.length === 0) break;

        for (const raw of subs) {
          try {
            await this.upsertComment(linkid, raw, rootCommentId);
            successCount += 1;
            if (raw.commentid) {
              lastval = String(raw.commentid);
            }
          } catch (e) {
            failCount += 1;
          }
        }

        if (!result.hasMore) break;
      } catch (e) {
        const err = e as Error;
        if (err.message.includes('Cookie 已失效')) throw err;
        retries += 1;
        if (retries <= maxRetries) {
          await CommentService.sleep(1500 * retries);
        } else {
          failCount += 1;
          break;
        }
      }
    }

    return { successCount, failCount, captcha };
  }

  async startCommentCrawl(
    mode: 'all' | 'uncrawled' | 'single',
    linkid?: string,
  ): Promise<string> {
    const now = new Date();
    const created = await this.db
      .insert(syncJob)
      .values({
        jobType: 'comment_crawl',
        status: 'running',
        startedAt: now,
        total: 0,
        processed: 0,
        successCount: 0,
        failCount: 0,
      })
      .returning({ id: syncJob.id });

    const jobId: string = created[0].id;
    void this.runCommentCrawl(jobId, mode, linkid);
    return jobId;
  }

  private async runCommentCrawl(
    jobId: string,
    mode: 'all' | 'uncrawled' | 'single',
    linkid?: string,
  ): Promise<void> {
    this.logger.log(`开始评论抓取任务: ${jobId}, mode=${mode}`);

    try {
      const settings = await this.settingsService.getFullSettings();
      const cookie: string = settings.heyboxCookie ?? '';

      if (!cookie) {
        await this.markJobFailed(jobId, '未配置小黑盒 Cookie');
        return;
      }

      let targetItems: { id: string; linkid: string }[] = [];

      if (mode === 'single' && linkid) {
        targetItems = await this.db
          .select({ id: archiveItem.id, linkid: archiveItem.linkid })
          .from(archiveItem)
          .where(eq(archiveItem.linkid, linkid));
      } else if (mode === 'uncrawled') {
        const crawled = this.db
          .select({ linkid: archiveComment.linkid })
          .from(archiveComment)
          .where(eq(archiveComment.crawlStatus, 'ok'))
          .groupBy(archiveComment.linkid);

        const crawledLinkids = (await crawled).map((r: { linkid: string }) => r.linkid);

        const whereConditions = [eq(archiveItem.isDeleted, false)];
        if (crawledLinkids.length > 0) {
          whereConditions.push(notInArray(archiveItem.linkid, crawledLinkids));
        }

        targetItems = await this.db
          .select({ id: archiveItem.id, linkid: archiveItem.linkid })
          .from(archiveItem)
          .where(and(...whereConditions))
          .orderBy(desc(archiveItem.createdAt));
      } else {
        targetItems = await this.db
          .select({ id: archiveItem.id, linkid: archiveItem.linkid })
          .from(archiveItem)
          .where(eq(archiveItem.isDeleted, false))
          .orderBy(desc(archiveItem.createdAt));
      }

      const total = targetItems.length;
      let processed = 0;
      let successCount = 0;
      let failCount = 0;

      await this.db
        .update(syncJob)
        .set({ total })
        .where(eq(syncJob.id, jobId));

      // 帖子级并发抓取（并发数 2，避免触发风控）
      const ITEM_CONCURRENCY = 2;
      for (let i = 0; i < targetItems.length; i += ITEM_CONCURRENCY) {
        const batch = targetItems.slice(i, i + ITEM_CONCURRENCY);
        const batchResults = await Promise.allSettled(
          batch.map((item: { id: string; linkid: string }) =>
            this.crawlSingleItem(cookie, item.linkid),
          ),
        );

        for (const result of batchResults) {
          processed += 1;
          if (result.status === 'fulfilled') {
            successCount += result.value.successCount;
            failCount += result.value.failCount;
            if (result.value.captcha) {
              this.logger.warn(`评论抓取触发验证码，已标记`);
            }
          } else {
            const err = result.reason as Error;
            if (err.message.includes('Cookie 已失效')) {
              await this.markJobFailed(jobId, err.message);
              return;
            }
            failCount += 1;
            this.logger.error(`评论抓取异常: ${err.message}`);
          }
        }

        if (processed % 5 === 0 || processed === total) {
          await this.db
            .update(syncJob)
            .set({ processed, successCount, failCount })
            .where(eq(syncJob.id, jobId));
        }
      }

      await this.db
        .update(syncJob)
        .set({
          status: 'success',
          total,
          processed,
          successCount,
          failCount,
          finishedAt: new Date(),
        })
        .where(eq(syncJob.id, jobId));

      this.logger.log(
        `评论抓取完成: ${jobId}, 已处理 ${processed}/${total}, 评论成功 ${successCount}, 失败 ${failCount}`,
      );
    } catch (e) {
      const err = e as Error;
      this.logger.error(`评论抓取任务失败: ${jobId}, ${err.message}`);
      await this.markJobFailed(jobId, err.message);
    }
  }

  private async markJobFailed(jobId: string, message: string): Promise<void> {
    await this.db
      .update(syncJob)
      .set({
        status: 'failed',
        errorMessage: message,
        finishedAt: new Date(),
      })
      .where(eq(syncJob.id, jobId));
  }

  async getLatestJob(): Promise<SyncJob | null> {
    const rows = await this.db
      .select()
      .from(syncJob)
      .where(eq(syncJob.jobType, 'comment_crawl'))
      .orderBy(desc(syncJob.createdAt))
      .limit(1);

    if (rows.length === 0) return null;
    return CommentService.toSyncJobDto(rows[0]);
  }

  private static toSyncJobDto(row: CommentRow['id'] extends string ? any : any): SyncJob {
    return {
      id: row.id,
      jobType: row.jobType,
      status: row.status as SyncJob['status'],
      total: row.total,
      processed: row.processed,
      successCount: row.successCount,
      failCount: row.failCount,
      errorMessage: row.errorMessage,
      startedAt: row.startedAt ? row.startedAt.toISOString() : null,
      finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async getCaptchaItemCount(): Promise<number> {
    const [row] = await this.db
      .select({ count: count() })
      .from(
        this.db
          .select({ linkid: archiveComment.linkid })
          .from(archiveComment)
          .where(eq(archiveComment.crawlStatus, 'captcha'))
          .groupBy(archiveComment.linkid)
          .as('captcha_items'),
      );
    return Number(row?.count ?? 0);
  }

  private async downloadImageToLocal(
    imageUrl: string,
    commentid: string,
    idx: number,
  ): Promise<string | null> {
    if (!imageUrl) return null;
    try {
      const https = await import('https');
      const urlObj = new URL(imageUrl);

      const buffer: Buffer = await new Promise<Buffer>((resolve, reject) => {
        const req = https.request(
          {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: 'GET',
            headers: {
              'User-Agent': HEYBOX_UA,
              Referer: 'https://xiaoheihe.cn/',
            },
            timeout: 15000,
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('end', () => resolve(Buffer.concat(chunks)));
          },
        );
        req.on('error', (err: Error) => reject(new Error(`图片下载失败: ${err.message}`)));
        req.on('timeout', () => req.destroy(new Error('图片下载超时')));
        req.end();
      });

      if (buffer.length === 0) return null;

      const ext = imageUrl.split('.').pop()?.split('?')[0]?.toLowerCase() || 'jpg';
      const safeExt = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext) ? ext : 'jpg';
      const fileName = `heybox-comments/${commentid}_${idx}.${safeExt}`;
      const contentType = `image/${safeExt === 'jpg' ? 'jpeg' : safeExt}`;

      const result = await this.fileService.upload(buffer, {
        fileName,
        contentType,
        upsert: true,
      });
      return result.downloadURL;
    } catch (e) {
      const err = e as Error;
      this.logger.warn(`评论图片归档失败 commentid=${commentid}: ${err.message}`);
      return null;
    }
  }

  async startCommentImageArchive(): Promise<string> {
    const now = new Date();
    const created = await this.db
      .insert(syncJob)
      .values({
        jobType: 'comment_image_archive',
        status: 'running',
        startedAt: now,
        total: 0,
        processed: 0,
        successCount: 0,
        failCount: 0,
      })
      .returning({ id: syncJob.id });

    const jobId: string = created[0].id;
    void this.runCommentImageArchive(jobId);
    return jobId;
  }

  private async runCommentImageArchive(jobId: string): Promise<void> {
    try {
      const items = await this.db
        .select({
          id: archiveComment.id,
          commentid: archiveComment.commentid,
          imageUrls: archiveComment.imageUrls,
          localImagePaths: archiveComment.localImagePaths,
        })
        .from(archiveComment)
        .where(
          and(
            eq(archiveComment.crawlStatus, 'ok'),
          ),
        );

      const needArchive = items.filter(
        (it) =>
          it.imageUrls &&
          it.imageUrls.length > 0 &&
          (!it.localImagePaths || it.localImagePaths.length === 0),
      );

      const total = needArchive.length;
      let processed = 0;
      let successCount = 0;
      let failCount = 0;

      await this.db.update(syncJob).set({ total }).where(eq(syncJob.id, jobId));

      for (const item of needArchive) {
        processed += 1;
        const localPaths: string[] = [];
        let allOk = true;

        for (let i = 0; i < item.imageUrls.length; i++) {
          const url = item.imageUrls[i];
          const local = await this.downloadImageToLocal(url, item.commentid, i);
          if (local) {
            localPaths.push(local);
          } else {
            allOk = false;
          }
        }

        if (localPaths.length > 0) {
          await this.db
            .update(archiveComment)
            .set({ localImagePaths: localPaths })
            .where(eq(archiveComment.id, item.id));
        }

        if (allOk && localPaths.length > 0) {
          successCount += 1;
        } else {
          failCount += 1;
        }

        if (processed % 20 === 0 || processed === total) {
          await this.db
            .update(syncJob)
            .set({ processed, successCount, failCount })
            .where(eq(syncJob.id, jobId));
        }

        await CommentService.sleep(200 + Math.floor(Math.random() * 200));
      }

      await this.db
        .update(syncJob)
        .set({
          status: 'success',
          total,
          processed,
          successCount,
          failCount,
          finishedAt: new Date(),
        })
        .where(eq(syncJob.id, jobId));
    } catch (e) {
      const err = e as Error;
      await this.markJobFailed(jobId, err.message);
    }
  }

  async getCommentImageArchiveStatus(): Promise<SyncJob | null> {
    const rows = await this.db
      .select()
      .from(syncJob)
      .where(eq(syncJob.jobType, 'comment_image_archive'))
      .orderBy(desc(syncJob.createdAt))
      .limit(1);

    if (rows.length === 0) return null;
    return CommentService.toSyncJobDto(rows[0]);
  }

  async listCommentsByLinkid(
    linkid: string,
    sort: 'floor' | 'hot' = 'floor',
  ): Promise<{ rootComments: ArchiveCommentDto[]; total: number }> {
    const rows = await this.db
      .select()
      .from(archiveComment)
      .where(
        and(
          eq(archiveComment.linkid, linkid),
          eq(archiveComment.crawlStatus, 'ok'),
        ),
      )
      .orderBy(sort === 'hot' ? desc(archiveComment.up) : archiveComment.floor);

    const rootMap = new Map<string, ArchiveCommentDto>();
    const childMap = new Map<string, ArchiveCommentDto[]>();

    for (const row of rows) {
      const dto = this.mapComment(row);
      if (!dto.rootCommentId) {
        rootMap.set(dto.commentid, dto);
      } else {
        const list = childMap.get(dto.rootCommentId) ?? [];
        list.push(dto);
        childMap.set(dto.rootCommentId, list);
      }
    }

    const rootComments: ArchiveCommentDto[] = [];
    for (const [rootId, root] of rootMap) {
      const children = childMap.get(rootId) ?? [];
      children.sort((a, b) => {
        const ta = a.createAt ? new Date(a.createAt).getTime() : 0;
        const tb = b.createAt ? new Date(b.createAt).getTime() : 0;
        return ta - tb;
      });
      (root as any).children = children;
      rootComments.push(root);
    }

    if (sort === 'floor') {
      rootComments.sort((a, b) => (a.floor ?? 0) - (b.floor ?? 0));
    }

    const total = rows.length;
    return { rootComments, total };
  }

  private mapComment(row: CommentRow): ArchiveCommentDto {
    const rawDataVal = (row as any).rawData ?? (row as any).raw_data ?? {};
    return {
      id: row.id,
      commentid: row.commentid,
      linkid: row.linkid,
      rootCommentId: (row as any).rootCommentId ?? (row as any).root_comment_id ?? null,
      replyid: (row as any).replyid ?? null,
      floor: (row as any).floor ?? null,
      text: (row as any).text ?? null,
      createAt: (row as any).createAt
        ? (row as any).createAt.toISOString()
        : (row as any).create_at
          ? new Date((row as any).create_at).toISOString()
          : null,
      up: (row as any).up ?? 0,
      isAuthor: (row as any).isAuthor ?? (row as any).is_author ?? false,
      childNum: (row as any).childNum ?? (row as any).child_num ?? 0,
      hasMore: (row as any).hasMore ?? (row as any).has_more ?? false,
      imageUrls: (row as any).imageUrls ?? (row as any).image_urls ?? [],
      localImagePaths:
        (row as any).localImagePaths ?? (row as any).local_image_paths ?? [],
      userid: (row as any).userid ?? null,
      username: (row as any).username ?? null,
      userAvatar: (row as any).userAvatar ?? (row as any).user_avatar ?? null,
      userLevel: (row as any).userLevel ?? (row as any).user_level ?? null,
      replyUserid: (row as any).replyUserid ?? (row as any).reply_userid ?? null,
      replyUsername: (row as any).replyUsername ?? (row as any).reply_username ?? null,
      crawlStatus:
        ((row as any).crawlStatus ?? (row as any).crawl_status ?? 'ok') as any,
      crawlError: (row as any).crawlError ?? (row as any).crawl_error ?? null,
      rawData: rawDataVal,
    };
  }
}
