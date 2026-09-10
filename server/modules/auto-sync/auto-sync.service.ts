import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import { HeyboxService } from '../heybox/heybox.service';
import { CommentService } from '../heybox/comment.service';

@Injectable()
export class AutoSyncService implements OnModuleInit {
  private readonly logger = new Logger(AutoSyncService.name);
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(
    private readonly settingsService: SettingsService,
    private readonly heyboxService: HeyboxService,
    private readonly commentService: CommentService,
  ) {}

  onModuleInit() {
    this.logger.log('AutoSyncService initialized');
    this.startTimer();
  }

  /**
   * 启动定时器，每隔设置的间隔检查一次
   */
  private startTimer() {
    if (this.timer) {
      clearInterval(this.timer);
    }
    // 每 5 秒检查一次设置，根据设置的间隔决定是否执行
    this.timer = setInterval(() => {
      void this.checkAndRun();
    }, 5000);
    this.logger.log('Auto sync timer started (check every 5s)');
  }

  /**
   * 检查是否需要执行自动同步
   */
  private async checkAndRun(): Promise<void> {
    if (this.isRunning) return;

    try {
      const settings = await this.settingsService.getFullSettings();
      if (!settings.autoSyncEnabled) return;

      const interval = settings.autoSyncInterval || 30;
      const now = Date.now();
      const lastSync = settings.lastAutoSyncAt ? new Date(settings.lastAutoSyncAt).getTime() : 0;
      const elapsed = (now - lastSync) / 1000;

      if (elapsed < interval) return;

      this.logger.log(`Auto sync triggered (interval: ${interval}s, elapsed: ${Math.round(elapsed)}s)`);
      await this.runAutoSync();
    } catch (e) {
      const err = e as Error;
      this.logger.error(`Auto sync check failed: ${err.message}`);
    }
  }

  /**
   * 执行自动同步：同步收藏 → 下载图片 → 抓取评论
   */
  private async runAutoSync(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      await this.settingsService.updateAutoSyncStatus('running');

      // 1. 同步收藏夹（每次最多 15 条，超时 10 分钟）
      this.logger.log('Auto sync: starting heybox sync (max 15 items)...');
      await this.settingsService.updateAutoSyncStatus('syncing');
      const syncJobId = await this.heyboxService.startSync(false, 15);
      try {
        await this.waitForJobComplete(() => this.heyboxService.getLatestJob(), syncJobId, 600000);
        this.logger.log('Auto sync: heybox sync completed');
      } catch (e) {
        this.logger.warn(`Auto sync: heybox sync timeout or error, continuing...`);
      }

      // 2. 下载图片（每次最多 15 条，超时 20 分钟）
      this.logger.log('Auto sync: starting image archive (max 15 items)...');
      await this.settingsService.updateAutoSyncStatus('downloading');
      const imgJobId = await this.heyboxService.startImageArchive(15);
      try {
        await this.waitForJobComplete(() => this.heyboxService.getLatestJobByType('image_archive'), imgJobId, 1200000);
        this.logger.log('Auto sync: image archive completed');
      } catch (e) {
        this.logger.warn(`Auto sync: image archive timeout or error, continuing...`);
      }

      // 3. 抓取评论（每次最多 15 条，超时 30 分钟）
      this.logger.log('Auto sync: starting comment crawl (max 15 items)...');
      await this.settingsService.updateAutoSyncStatus('comments');
      const commentJobId = await this.commentService.startCommentCrawl('uncrawled', undefined, 15);
      try {
        await this.waitForJobComplete(() => this.commentService.getLatestJob(), commentJobId, 1800000);
        this.logger.log('Auto sync: comment crawl completed');
      } catch (e) {
        this.logger.warn(`Auto sync: comment crawl timeout or error, continuing...`);
      }

      // 更新上次同步时间
      await this.settingsService.updateLastAutoSyncAt();
      await this.settingsService.updateAutoSyncStatus('idle');
      this.logger.log('Auto sync: all tasks completed successfully');
    } catch (e) {
      const err = e as Error;
      this.logger.error(`Auto sync failed: ${err.message}`);
      await this.settingsService.updateAutoSyncStatus('error', err.message);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * 等待任务完成
   */
  private async waitForJobComplete(
    getStatus: () => Promise<any>,
    jobId: string,
    timeout: number,
  ): Promise<void> {
    const startTime = Date.now();
    let lastStatus = '';
    while (Date.now() - startTime < timeout) {
      try {
        const job = await getStatus();
        if (!job) {
          // 任务还没创建，等待一下
          await this.sleep(2000);
          continue;
        }

        // 如果返回的不是我们等待的任务，说明可能已经完成并被新任务覆盖
        if (job.id !== jobId) {
          // 已经等待了至少 10 秒，说明任务可能已经完成
          if (Date.now() - startTime > 10000) {
            this.logger.log(`Job ${jobId} not found (likely completed), assuming success`);
            return;
          }
          // 刚开始等待，任务可能还没创建，继续等待
          await this.sleep(2000);
          continue;
        }

        if (job.status === 'success' || job.status === 'failed') {
          if (job.status === 'failed') {
            this.logger.warn(`Job ${jobId} failed: ${job.errorMessage || 'unknown error'}`);
          }
          return;
        }

        if (job.status === 'running' || job.status === 'pending') {
          const progress = job.total > 0 ? `${job.processed}/${job.total}` : '?';
          if (lastStatus !== `${job.status}-${progress}`) {
            this.logger.log(`Job ${jobId} status: ${job.status}, progress: ${progress}`);
            lastStatus = `${job.status}-${progress}`;
          }
          await this.sleep(3000);
          continue;
        }
      } catch (e) {
        // 忽略查询错误，继续等待
        await this.sleep(3000);
      }
    }
    throw new Error(`Job ${jobId} timeout after ${timeout / 1000}s`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
