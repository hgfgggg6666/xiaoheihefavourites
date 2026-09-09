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
  async upsertItem(link: any): Promise<string> {
    const data = this.extractItemData(link);

    const result = await this.db
      .insert(archiveItem)
      .values({
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
      })
      .onConflictDoUpdate({
        target: archiveItem.linkid,
        set: {
          title: data.title,
          shareUrl: data.shareUrl,
          coverUrl: data.coverUrl,
          authorName: data.authorName,
          authorAvatar: data.authorAvatar,
          originalTags: data.originalTags,
          sourceCreateAt: data.sourceCreateAt,
          isDeleted: data.isDeleted,
          rawData: data.rawData,
        },
      })
      .returning({ id: archiveItem.id });

    return result[0].id;
  }

  /**
   * 启动一次同步任务（后台异步执行）
   */
  async startSync(fullRebuild: boolean = false): Promise<string> {
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
    void this.runSync(jobId, fullRebuild);

    return jobId;
  }

  /**
   * 实际执行同步的后台流程
   */
  private async runSync(jobId: string, fullRebuild: boolean): Promise<void> {
    this.logger.log(`开始同步任务: ${jobId}, fullRebuild=${fullRebuild}`);

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

        if (!page.hasNext) {
          break;
        }

        offset += limit;

        // 随机 sleep 600~1000ms
        const sleepMs = 600 + Math.floor(Math.random() * 400);
        await HeyboxService.sleep(sleepMs);
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
  async startImageArchive(): Promise<string> {
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
    void this.runImageArchive(jobId);
    return jobId;
  }

  private async runImageArchive(jobId: string): Promise<void> {
    this.logger.log(`开始图片归档任务: ${jobId}`);

    try {
      // 直接用 better-sqlite3 查询，避免 Drizzle jsonb 映射问题
      const sqlite = new Database(join(process.cwd(), 'data', 'app.db'));
      const allItems = sqlite
        .prepare('SELECT id, linkid, raw_data FROM archive_item WHERE is_deleted = 0')
        .all() as Array<{ id: string; linkid: string; raw_data: string }>;

      // 过滤出有图片的条目
      const items = allItems.filter((item) => {
        try {
          const raw = JSON.parse(item.raw_data);
          return Array.isArray(raw.imgs) && raw.imgs.length > 0;
        } catch {
          return false;
        }
      });

      const total = items.length;
      let processed = 0;
      let successCount = 0;
      let failCount = 0;
      let totalImages = 0;

      this.logger.log(`图片归档: 找到 ${total} 条有图片的帖子`);

      await this.db
        .update(syncJob)
        .set({ total })
        .where(eq(syncJob.id, jobId));

      for (const item of items) {
        processed += 1;
        try {
          const raw = JSON.parse(item.raw_data);
          const imageUrls: string[] = Array.isArray(raw.imgs) ? raw.imgs : [];

          if (imageUrls.length === 0) {
            failCount += 1;
            continue;
          }

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
            const firstExt = imageUrls[0].split('.').pop()?.split('?')[0]?.toLowerCase() || 'jpg';
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
          this.logger.log(`图片归档进度: ${processed}/${total}, 已下载 ${totalImages} 张图片`);
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
        `图片归档任务完成: ${jobId}, 帖子成功 ${successCount}, 失败 ${failCount}, 共下载 ${totalImages} 张图片`,
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
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => resolve(Buffer.concat(chunks)));
        });

        req.on('error', (err: Error) => reject(new Error(`图片下载失败: ${err.message}`)));
        req.on('timeout', () => { req.destroy(new Error('图片下载超时')); });
        req.end();
      });

      if (buffer.length === 0) return null;

      const mediaDir = join(process.cwd(), 'media');
      if (!existsSync(mediaDir)) {
        mkdirSync(mediaDir, { recursive: true });
      }

      const ext = imageUrl.split('.').pop()?.split('?')[0]?.toLowerCase() || 'jpg';
      const safeExt = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext) ? ext : 'jpg';
      const fileName = `post_${linkid}_${index}.${safeExt}`;
      const filePath = join(mediaDir, fileName);

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
