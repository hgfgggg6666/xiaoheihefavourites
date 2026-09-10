import { Injectable, Inject, Logger } from '@nestjs/common';
import { FileService } from '@lark-apaas/fullstack-nestjs-core';
import { LOCAL_SQLITE_DB } from '../../database/sqlite.module';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq, desc, isNull, and } from 'drizzle-orm';
import { archiveItem, syncJob } from '@server/database/schema';
import type { SyncJob } from '@shared/api.interface';
import {
  buildHeyboxUrl,
  buildHeyboxHeaders,
} from '@server/common/utils/heybox-sign';
import { SettingsService } from '../settings/settings.service';
import Database from 'better-sqlite3';
import { join } from 'path';

interface FavResponse {
  status: string;
  msg?: string;
  result?: {
    links?: any[];
    has_next?: string;
  };
}

@Injectable()
export class HeyboxService {
  private readonly logger = new Logger(HeyboxService.name);

  constructor(
    @Inject(LOCAL_SQLITE_DB) private readonly db: BetterSQLite3Database,
    private readonly settingsService: SettingsService,
    private readonly fileService: FileService,
  ) {}

  /**
   * 抓取小黑盒收藏夹分页数据
   */
  async fetchFavPage(
    cookie: string,
    offset: number,
    limit: number,
  ): Promise<{ links: any[]; hasNext: boolean }> {
    const basePath = '/bbs/app/profile/fav/folder/v2/links';
    const url = buildHeyboxUrl(basePath, {
      enable_new_style_collect: '1',
      dw: '1200',
      offset,
      limit,
      channel: 'heybox',
    });
    const headers = buildHeyboxHeaders(cookie);

    const body = await HeyboxService.httpGet(url, headers);
    const result: FavResponse = JSON.parse(body);
    if (result.status !== 'ok') {
      throw new Error(
        `接口返回错误: ${result.status}${result.msg ? ` - ${result.msg}` : ''}`,
      );
    }
    const links = result.result?.links ?? [];
    const hasNext = result.result?.has_next === '1';
    return { links, hasNext };
  }

  /**
   * 从接口返回的 link 对象提取归档字段
   */
  extractItemData(link: any): {
    linkid: string;
    title: string;
    shareUrl: string | null;
    coverUrl: string | null;
    authorName: string | null;
    authorAvatar: string | null;
    originalTags: string[];
    sourceCreateAt: Date | null;
    isDeleted: boolean;
    rawData: Record<string, any>;
  } {
    const linkid: string = String(link.linkid);

    let title: string = '';
    if (link.title) {
      title = link.title;
    } else if (link.desc) {
      title = String(link.desc).slice(0, 100);
    }

    const shareUrl: string | null = link.share_url ?? null;

    let coverUrl: string | null = null;
    if (link.img_url) {
      coverUrl = link.img_url;
    } else if (link.image_new?.url) {
      coverUrl = link.image_new.url;
    } else if (link.image?.url) {
      coverUrl = link.image.url;
    } else if (link.images?.[0]?.url) {
      coverUrl = link.images[0].url;
    } else if (Array.isArray(link.imgs) && link.imgs.length > 0) {
      // 帖子正文第一张图片作为封面
      coverUrl = link.imgs[0];
    } else if (link.topics?.[0]?.pic_url) {
      // 兜底：专区封面图（不是帖子图片，仅在帖子无图时使用）
      coverUrl = link.topics[0].pic_url;
    }

    const authorName: string | null = link.user?.username ?? null;
    const authorAvatar: string | null = link.user?.avatar ?? null;

    let originalTags: string[] = [];
    if (Array.isArray(link.content_tags)) {
      originalTags = link.content_tags.map((t: any) =>
        typeof t === 'string' ? t : String(t?.name ?? ''),
      );
    } else if (Array.isArray(link.list_content_tags)) {
      originalTags = link.list_content_tags.map((t: any) =>
        typeof t === 'string' ? t : String(t?.name ?? ''),
      );
    }
    originalTags = originalTags.filter((t: string) => t.length > 0);

    let sourceCreateAt: Date | null = null;
    const rawTime: number | string | undefined = link.create_at ?? link.time;
    if (rawTime !== undefined && rawTime !== null) {
      const timeNum: number =
        typeof rawTime === 'number'
          ? rawTime
          : !isNaN(Number(rawTime))
            ? Number(rawTime)
            : Date.parse(String(rawTime));
      if (!isNaN(timeNum)) {
        // 秒级时间戳（10 位）转毫秒
        const ms: number = timeNum < 1e12 ? timeNum * 1000 : timeNum;
        const d = new Date(ms);
        if (!isNaN(d.getTime())) {
          sourceCreateAt = d;
        }
      }
    }

    const isDeleted: boolean = link.is_deleted === true;

    const rawData: Record<string, any> = JSON.parse(JSON.stringify(link));

    return {
      linkid,
      title,
      shareUrl,
      coverUrl,
      authorName,
      authorAvatar,
      originalTags,
      sourceCreateAt,
      isDeleted,
      rawData,
    };
  }

  /**
   * 将一条收藏插入或更新到数据库
   */
  async upsertItem(link: any, category?: string): Promise<string> {
    const data = this.extractItemData(link);

    const insertValues: any = {
      linkid: data.linkid,
      title: data.title,
      shareUrl: data.shareUrl,
      coverUrl: data.coverUrl,
      authorName: data.authorName,
      authorAvatar: data.authorAvatar,
      originalTags: data.originalTags,
      sourceCreateAt: data.sourceCreateAt,
      isDeleted: data.isDeleted,
      rawData: data.rawData,
    };
    if (category) insertValues.category = category;

    const updateValues: any = {
      title: data.title,
      shareUrl: data.shareUrl,
      coverUrl: data.coverUrl,
      authorName: data.authorName,
      authorAvatar: data.authorAvatar,
      originalTags: data.originalTags,
      sourceCreateAt: data.sourceCreateAt,
      isDeleted: data.isDeleted,
      rawData: data.rawData,
    };
    // 如果传入了 category，更新时也设置；否则保留原有 category
    if (category) updateValues.category = category;

    const result = await this.db
      .insert(archiveItem)
      .values(insertValues)
      .onConflictDoUpdate({
        target: archiveItem.linkid,
        set: updateValues,
      })
      .returning({ id: archiveItem.id });

    return result[0].id;
  }

  /**
   * 启动一次同步任务（后台异步执行）
   */
  async startSync(fullRebuild: boolean = false, maxItems?: number): Promise<string> {
    const now = new Date();
    const created = await this.db
      .insert(syncJob)
      .values({
        jobType: 'heybox_sync',
        status: 'running',
        startedAt: now,
        total: 0,
        processed: 0,
        successCount: 0,
        failCount: 0,
      })
      .returning({ id: syncJob.id });

    const jobId: string = created[0].id;

    // 后台异步执行，不 await
    void this.runSync(jobId, fullRebuild, maxItems);

    return jobId;
  }

  /**
   * 实际执行同步的后台流程
   * @param maxItems 最大同步数量，不传则同步全部
   */
  private async runSync(jobId: string, fullRebuild: boolean, maxItems?: number): Promise<void> {
    this.logger.log(`开始同步任务: ${jobId}, fullRebuild=${fullRebuild}, maxItems=${maxItems ?? '全部'}`);

    try {
      const settings = await this.settingsService.getFullSettings();
      const cookie: string = settings.heyboxCookie ?? '';

      if (!cookie) {
        await this.markJobFailed(jobId, '未配置小黑盒 Cookie');
        return;
      }

      let offset = 0;
      const limit = 30;
      let processed = 0;
      let successCount = 0;
      let failCount = 0;

      while (true) {
        this.logger.log(`拉取第 ${offset / limit + 1} 页, offset=${offset}`);

        const page = await this.fetchFavPage(cookie, offset, limit);

        for (const linkWrapper of page.links) {
          processed += 1;
          // API 返回的结构是 { link: {...} }，需要解包
          const link = linkWrapper.link ?? linkWrapper;
          try {
            await this.upsertItem(link);
            successCount += 1;
          } catch (e) {
            const err = e as Error;
            failCount += 1;
            this.logger.warn(`upsert 失败 linkid=${link.linkid}: ${err.message}`);
          }

          // 如果设置了最大同步数量，达到后停止
          if (maxItems && processed >= maxItems) {
            this.logger.log(`已达到最大同步数量 ${maxItems}，停止同步`);
            break;
          }
        }

        // 更新进度
        await this.db
          .update(syncJob)
          .set({
            processed,
            successCount,
            failCount,
          })
          .where(eq(syncJob.id, jobId));

        // 如果设置了最大同步数量，达到后停止
        if (maxItems && processed >= maxItems) {
          break;
        }

        if (!page.hasNext) {
          break;
        }

        offset += limit;

        // 随机 sleep 600~1000ms
        const sleepMs = 600 + Math.floor(Math.random() * 400);
        await HeyboxService.sleep(sleepMs);
      }

      // 如果开启了专区爬取，同步情投意合专区内容
      if (settings.crawlTopicEnabled) {
        this.logger.log('开始爬取情投意合专区内容...');
        try {
          const topicCount = await this.crawlTopicContent(cookie, settings.topicLinkId || '416158');
          this.logger.log(`情投意合专区爬取完成，共 ${topicCount} 条`);
          successCount += topicCount;
        } catch (e) {
          const err = e as Error;
          this.logger.warn(`情投意合专区爬取失败: ${err.message}`);
        }
      }

      // 标记成功
      await this.db
        .update(syncJob)
        .set({
          status: 'success',
          total: successCount,
          processed,
          successCount,
          failCount,
          finishedAt: new Date(),
        })
        .where(eq(syncJob.id, jobId));

      this.logger.log(
        `同步任务完成: ${jobId}, 成功 ${successCount}, 失败 ${failCount}`,
      );
    } catch (e) {
      const err = e as Error;
      this.logger.error(`同步任务失败: ${jobId}, ${err.message}`);
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

  /**
   * 爬取情投意合专区内容
   * 通过 /bbs/app/topic/feeds API 分页获取专区帖子列表
   */
  private async crawlTopicContent(cookie: string, topicLinkId: string): Promise<number> {
    if (!topicLinkId) return 0;

    let count = 0;
    const CATEGORY_NAME = '情投意合';
    const crawledLinkIds = new Set<string>();
    const MAX_POSTS = 100; // 最多爬取100条帖子
    const PAGE_SIZE = 20;

    try {
      this.logger.log(`开始爬取情投意合专区 (topic_id=${topicLinkId})...`);

      let offset = 0;
      let hasMore = true;

      while (hasMore && count < MAX_POSTS) {
        this.logger.log(`获取专区帖子列表 offset=${offset}, limit=${PAGE_SIZE}...`);

        const pageData = await this.fetchTopicFeeds(cookie, topicLinkId, offset, PAGE_SIZE);
        const links: any[] = pageData?.links || [];

        if (links.length === 0) {
          this.logger.log('没有更多帖子了');
          break;
        }

        this.logger.log(`本页获取到 ${links.length} 条帖子`);

        for (const link of links) {
          if (count >= MAX_POSTS) break;

          const linkid = link.linkid ? String(link.linkid) : null;
          if (!linkid || crawledLinkIds.has(linkid)) continue;

          crawledLinkIds.add(linkid);

          try {
            // 专区列表只返回摘要，需要调用 link/tree API 获取完整正文
            this.logger.log(`获取帖子完整详情: ${link.title || linkid}...`);
            let postData = link;
            try {
              const detail = await this.fetchLinkTreePageSimple(cookie, linkid, 1, 10);
              if (detail?.link) {
                postData = detail.link;
                this.logger.log(`  完整正文获取成功，text长度: ${postData.text ? JSON.stringify(postData.text).length : 0}`);
              }
            } catch (detailErr) {
              this.logger.warn(`  获取完整详情失败，使用摘要数据: ${(detailErr as Error).message}`);
            }

            // 保存帖子（包含完整正文）
            await this.upsertItem(postData, CATEGORY_NAME);
            count += 1;
            this.logger.log(`已保存专区帖子: ${postData.title || linkid} (${count})`);

            // 每个帖子之间小延迟
            await HeyboxService.sleep(300 + Math.floor(Math.random() * 300));
          } catch (e) {
            this.logger.warn(`保存帖子失败 linkid=${linkid}: ${(e as Error).message}`);
          }
        }

        // 检查是否还有下一页
        if (links.length < PAGE_SIZE) {
          hasMore = false;
        } else {
          offset += PAGE_SIZE;
        }

        // 每页之间延迟
        await HeyboxService.sleep(500 + Math.floor(Math.random() * 500));
      }

      this.logger.log(`情投意合专区爬取完成，共保存 ${count} 条`);
    } catch (e) {
      const err = e as Error;
      this.logger.warn(`专区爬取异常: ${err.message}`);
    }

    return count;
  }

  /**
   * 获取专区帖子列表（/bbs/app/topic/feeds API）
   */
  private async fetchTopicFeeds(
    cookie: string,
    topicId: string,
    offset: number,
    limit: number,
  ): Promise<any> {
    const basePath = '/bbs/app/topic/feeds';
    const url = buildHeyboxUrl(basePath, {
      topic_id: topicId,
      offset,
      limit,
      lastval: '',
      dw: 604,
      // 网页版参数
      app: 'heybox',
      os_type: 'web',
      x_app: 'heybox_website',
      x_client_type: 'web',
      x_os_type: 'Android',
      client_type: 'web',
      web_version: '3.0',
      version: '999.0.4',
    });
    const headers = buildHeyboxHeaders(cookie);
    // 添加网页版需要的额外 header
    headers['Referer'] = 'https://xiaoheihe.cn/';
    headers['Origin'] = 'https://xiaoheihe.cn';

    const body = await HeyboxService.httpGet(url, headers);
    const result = JSON.parse(body);

    if (result.status !== 'ok') {
      throw new Error(result.msg || '获取专区帖子失败');
    }

    return result.result || {};
  }

  /**
   * 简单版获取 link/tree 页面数据
   */
  private async fetchLinkTreePageSimple(
    cookie: string,
    linkId: string,
    page: number,
    limit: number,
  ): Promise<any> {
    const basePath = '/bbs/app/link/tree';
    const url = buildHeyboxUrl(basePath, {
      link_id: linkId,
      is_first: page === 1 ? 1 : 0,
      page,
      index: (page - 1) * limit + 1,
      limit,
      owner_only: 0,
    });
    const headers = buildHeyboxHeaders(cookie);
    const body = await HeyboxService.httpGet(url, headers);
    const result = JSON.parse(body);

    if (result.status !== 'ok') {
      throw new Error(result.msg || '获取失败');
    }

    return result.result || {};
  }

  /**
   * 从评论列表中提取帖子 linkid
   */
  private extractLinkIdsFromComments(comments: any[]): Set<string> {
    const linkIds = new Set<string>();
    const linkidPattern = /linkid[=:]["']?(\d+)["']?/gi;
    const urlPattern = /xiaoheihe\.cn\/(?:app\/)?(?:bbs\/)?link\/(\d+)/gi;
    const sharePattern = /share_link|sharelink|quote_link/i;

    for (const comment of comments) {
      // 1. 从评论内容中提取
      const content: string = comment.content || comment.text || '';
      if (content) {
        let match;
        while ((match = linkidPattern.exec(content)) !== null) {
          if (match[1]) linkIds.add(match[1]);
        }
        while ((match = urlPattern.exec(content)) !== null) {
          if (match[1]) linkIds.add(match[1]);
        }
      }

      // 2. 检查评论中的分享/引用字段
      for (const key of Object.keys(comment)) {
        if (sharePattern.test(key)) {
          const shareData = comment[key];
          if (shareData?.linkid) linkIds.add(String(shareData.linkid));
          if (shareData?.link_id) linkIds.add(String(shareData.link_id));
        }
      }

      // 3. 检查评论中的 link 字段
      if (comment.link?.linkid) linkIds.add(String(comment.link.linkid));
      if (comment.link_id) linkIds.add(String(comment.link_id));

      // 4. 递归检查子评论
      if (Array.isArray(comment.sub_comments)) {
        const subIds = this.extractLinkIdsFromComments(comment.sub_comments);
        subIds.forEach((id) => linkIds.add(id));
      }
      if (Array.isArray(comment.replies)) {
        const subIds = this.extractLinkIdsFromComments(comment.replies);
        subIds.forEach((id) => linkIds.add(id));
      }
    }

    return linkIds;
  }

  /**
   * 获取最新一条 heybox 同步任务
   */
  async getLatestJob(): Promise<SyncJob | null> {
    const rows = await this.db
      .select()
      .from(syncJob)
      .where(eq(syncJob.jobType, 'heybox_sync'))
      .orderBy(desc(syncJob.createdAt))
      .limit(1);

    if (rows.length === 0) return null;

    const row = (rows[0] as unknown) as typeof syncJob.$inferSelect;
    return HeyboxService.toSyncJobDto(row);
  }

  private static toSyncJobDto(
    row: typeof syncJob.$inferSelect,
  ): SyncJob {
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

  private static sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  static async httpGet(
    urlStr: string,
    headers: Record<string, string>,
    timeoutMs: number = 15000,
  ): Promise<string> {
    const https = await import('https');
    return new Promise<string>((resolve, reject) => {
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
  }

  /**
   * 下载图片并上传到应用存储（本地归档）
   */
  async downloadAndArchiveImage(imageUrl: string, linkid: string): Promise<string | null> {
    if (!imageUrl) return null;

    try {
      const https = await import('https');
      const { mkdirSync, writeFileSync, existsSync } = await import('fs');
      const { join } = await import('path');
      const urlObj = new URL(imageUrl);

      const buffer: Buffer = await new Promise<Buffer>((resolve, reject) => {
        const options = {
          hostname: urlObj.hostname,
          path: urlObj.pathname + urlObj.search,
          method: 'GET',
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            Referer: 'https://xiaoheihe.cn/',
          },
          timeout: 15000,
        };

        const req = https.request(options, (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => {
            chunks.push(chunk);
          });
          res.on('end', () => {
            resolve(Buffer.concat(chunks));
          });
        });

        req.on('error', (err: Error) => {
          reject(new Error(`图片下载失败: ${err.message}`));
        });

        req.on('timeout', () => {
          req.destroy(new Error('图片下载超时'));
        });

        req.end();
      });

      if (buffer.length === 0) return null;

      // 保存到本地 media 目录
      const mediaDir = join(process.cwd(), 'media');
      if (!existsSync(mediaDir)) {
        mkdirSync(mediaDir, { recursive: true });
      }

      const ext = imageUrl.split('.').pop()?.split('?')[0]?.toLowerCase() || 'jpg';
      const safeExt = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext) ? ext : 'jpg';
      const fileName = `cover_${linkid}.${safeExt}`;
      const filePath = join(mediaDir, fileName);

      writeFileSync(filePath, buffer);

      // 返回相对路径，供静态导出使用
      return `./media/${fileName}`;
    } catch (e) {
      const err = e as Error;
      this.logger.warn(`图片归档失败 linkid=${linkid}: ${err.message}`);
      return null;
    }
  }

  /**
   * 启动图片归档任务（后台异步）
   */
  async startImageArchive(maxItems?: number): Promise<string> {
    const now = new Date();
    const created = await this.db
      .insert(syncJob)
      .values({
        jobType: 'image_archive',
        status: 'running',
        startedAt: now,
        total: 0,
        processed: 0,
        successCount: 0,
        failCount: 0,
      })
      .returning({ id: syncJob.id });

    const jobId: string = created[0].id;
    void this.runImageArchive(jobId, maxItems);
    return jobId;
  }

  /**
   * 从帖子原始数据中提取正文图片（优先从 text 富文本字段提取）
   */
  private extractPostImages(raw: any): string[] {
    const images: string[] = [];
    const seen = new Set<string>();

    // 优先从 text 字段（富文本数组）提取图片
    if (raw.text && typeof raw.text === 'string') {
      try {
        const textArr = JSON.parse(raw.text);
        if (Array.isArray(textArr)) {
          textArr.forEach((item: any) => {
            if (item.type === 'img' && item.url && typeof item.url === 'string') {
              const cleanUrl = item.url.split('?')[0];
              if (!seen.has(cleanUrl) && !cleanUrl.includes('/live/')) {
                seen.add(cleanUrl);
                images.push(item.url);
              }
            }
          });
        }
      } catch (e) {
        // text 不是 JSON，忽略
      }
    }

    // 如果 text 字段没有图片，再从 imgs 字段提取
    if (images.length === 0 && Array.isArray(raw.imgs)) {
      raw.imgs.forEach((url: string) => {
        if (url && typeof url === 'string') {
          const cleanUrl = url.split('?')[0];
          if (!seen.has(cleanUrl) && !cleanUrl.includes('/live/')) {
            seen.add(cleanUrl);
            images.push(url);
          }
        }
      });
    }

    return images;
  }

  private async runImageArchive(jobId: string, maxItems?: number): Promise<void> {
    this.logger.log(`开始图片归档任务: ${jobId}, maxItems=${maxItems ?? '全部'}`);

    try {
      // 直接用 better-sqlite3 查询，避免 Drizzle jsonb 映射问题
      const sqlite = new Database(join(process.cwd(), 'data', 'app.db'));
      const allItems = sqlite
        .prepare('SELECT id, linkid, raw_data, local_cover_path FROM archive_item WHERE is_deleted = 0 ORDER BY _created_at DESC')
        .all() as Array<{ id: string; linkid: string; raw_data: string; local_cover_path: string | null }>;

      // 过滤出有正文图片且尚未归档的条目（优先从 text 字段提取）
      let items = allItems.filter((item) => {
        try {
          // 如果已经有本地封面路径，说明已经归档过，跳过
          if (item.local_cover_path && item.local_cover_path.trim() !== '') {
            return false;
          }
          const raw = JSON.parse(item.raw_data);
          const images = this.extractPostImages(raw);
          return images.length > 0;
        } catch {
          return false;
        }
      });

      // 如果设置了最大处理数量，只取前 maxItems 个
      if (maxItems && items.length > maxItems) {
        items = items.slice(0, maxItems);
        this.logger.log(`图片归档: 限制最大处理数量为 ${maxItems} 条`);
      }

      const total = items.length;
      let processed = 0;
      let successCount = 0;
      let failCount = 0;
      let totalImages = 0;
      let skippedCount = allItems.length - items.length;

      this.logger.log(`图片归档: 共 ${allItems.length} 条帖子，跳过已归档 ${skippedCount} 条，待归档 ${total} 条`);

      await this.db
        .update(syncJob)
        .set({ total })
        .where(eq(syncJob.id, jobId));

      for (const item of items) {
        processed += 1;
        try {
          const raw = JSON.parse(item.raw_data);
          // 优先从 text 字段提取正文图片，过滤掉直播图片
          const imageUrls: string[] = this.extractPostImages(raw);

          if (imageUrls.length === 0) {
            failCount += 1;
            continue;
          }

          this.logger.log(`帖子 linkid=${item.linkid} 找到 ${imageUrls.length} 张正文图片`);

          // 下载帖子的所有图片
          let itemSuccess = true;
          for (let i = 0; i < imageUrls.length; i++) {
            const imageUrl = imageUrls[i];
            const localPath = await this.downloadPostImage(imageUrl, item.linkid, i);
            if (!localPath) {
              itemSuccess = false;
              this.logger.warn(`图片下载失败 linkid=${item.linkid} index=${i}`);
            } else {
              totalImages += 1;
            }
            // 每张图片之间小延迟
            await HeyboxService.sleep(100 + Math.floor(Math.random() * 100));
          }

          // 第一张图片作为封面
          if (imageUrls.length > 0) {
            const firstCleanUrl = imageUrls[0].split('?')[0];
            const firstExt = firstCleanUrl.split('.').pop()?.toLowerCase() || 'jpg';
            const safeExt = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(firstExt) ? firstExt : 'jpg';
            const coverLocalPath = `./media/post_${item.linkid}_0.${safeExt}`;
            await this.db
              .update(archiveItem)
              .set({ localCoverPath: coverLocalPath, coverUrl: imageUrls[0] })
              .where(eq(archiveItem.id, item.id));
          }

          if (itemSuccess) {
            successCount += 1;
          } else {
            failCount += 1;
          }
        } catch (e) {
          const err = e as Error;
          failCount += 1;
          this.logger.warn(`图片归档失败 linkid=${item.linkid}: ${err.message}`);
        }

        if (processed % 10 === 0 || processed === total) {
          await this.db
            .update(syncJob)
            .set({ processed, successCount, failCount })
            .where(eq(syncJob.id, jobId));
          this.logger.log(`图片归档进度: ${processed}/${total}, 已下载 ${totalImages} 张正文图片`);
        }

        await HeyboxService.sleep(200 + Math.floor(Math.random() * 200));
      }

      sqlite.close();

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
        `图片归档任务完成: ${jobId}, 共 ${allItems.length} 条帖子，跳过已归档 ${skippedCount} 条，本次处理 ${total} 条，成功 ${successCount}, 失败 ${failCount}, 共下载 ${totalImages} 张图片`,
      );
    } catch (e) {
      const err = e as Error;
      this.logger.error(`图片归档任务失败: ${jobId}, ${err.message}`);
      await this.markJobFailed(jobId, err.message);
    }
  }

  /**
   * 下载帖子正文图片到本地 media 目录
   */
  async downloadPostImage(imageUrl: string, linkid: string, index: number): Promise<string | null> {
    if (!imageUrl) return null;

    try {
      const https = await import('https');
      const { mkdirSync, writeFileSync, existsSync, statSync } = await import('fs');
      const { join } = await import('path');
      // 去掉查询参数，下载原图而不是缩略图
      const cleanUrl = imageUrl.split('?')[0];

      const mediaDir = join(process.cwd(), 'media');
      if (!existsSync(mediaDir)) {
        mkdirSync(mediaDir, { recursive: true });
      }

      const ext = cleanUrl.split('.').pop()?.toLowerCase() || 'jpg';
      const safeExt = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext) ? ext : 'jpg';
      const fileName = `post_${linkid}_${index}.${safeExt}`;
      const filePath = join(mediaDir, fileName);

      // 如果本地文件已存在且大小大于 0，直接返回，不重复下载
      if (existsSync(filePath)) {
        try {
          const stats = statSync(filePath);
          if (stats.size > 0) {
            this.logger.log(`图片已存在，跳过下载: ${fileName} (${stats.size} bytes)`);
            return `./media/${fileName}`;
          }
        } catch {
          // 忽略 stat 错误，继续下载
        }
      }

      const urlObj = new URL(cleanUrl);

      const buffer: Buffer = await new Promise<Buffer>((resolve, reject) => {
        const options = {
          hostname: urlObj.hostname,
          path: urlObj.pathname,
          method: 'GET',
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            Referer: 'https://xiaoheihe.cn/',
          },
          timeout: 15000,
        };

        const req = https.request(options, (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => resolve(Buffer.concat(chunks)));
        });

        req.on('error', (err: Error) => reject(new Error(`图片下载失败: ${err.message}`)));
        req.on('timeout', () => { req.destroy(new Error('图片下载超时')); });
        req.end();
      });

      if (buffer.length === 0) return null;

      writeFileSync(filePath, buffer);
      return `./media/${fileName}`;
    } catch (e) {
      const err = e as Error;
      this.logger.warn(`帖子图片下载失败 linkid=${linkid} index=${index}: ${err.message}`);
      return null;
    }
  }

  /**
   * 获取最新一条指定类型的同步任务
   */
  async getLatestJobByType(jobType: string): Promise<SyncJob | null> {
    const rows = await this.db
      .select()
      .from(syncJob)
      .where(eq(syncJob.jobType, jobType))
      .orderBy(desc(syncJob.createdAt))
      .limit(1);

    if (rows.length === 0) return null;

    const row = rows[0] as typeof syncJob.$inferSelect;
    return HeyboxService.toSyncJobDto(row);
  }
}
