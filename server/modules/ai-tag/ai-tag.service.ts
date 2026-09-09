import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { LOCAL_SQLITE_DB } from '../../database/sqlite.module';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq, isNull, and, desc, inArray } from 'drizzle-orm';
import * as https from 'node:https';
import { URL } from 'node:url';

import {
  archiveItem,
  archiveTag,
  archiveItemTag,
  syncJob,
} from '@server/database/schema';
import { SettingsService } from '@server/modules/settings/settings.service';
import type { TagResult, SyncJob } from '@shared/api.interface';

const CATEGORIES = [
  '游戏攻略',
  '硬件评测',
  '游戏资讯',
  '社区讨论',
  '游戏分享',
  '二次元',
  '影视娱乐',
  '数码科技',
  '生活日常',
  '其他',
];

const CONCURRENCY = 3;

@Injectable()
export class AiTagService {
  private readonly logger = new Logger(AiTagService.name);

  constructor(
    @Inject(LOCAL_SQLITE_DB) private readonly db: BetterSQLite3Database,
    private readonly settingsService: SettingsService,
  ) {}

  /**
   * Call OpenAI-compatible chat/completions endpoint with native https module.
   */
  async callOpenAI(prompt: string): Promise<string> {
    const settings = await this.settingsService.getFullSettings();
    const baseUrl = settings.openaiBaseUrl.replace(/\/+$/, '');
    const fullUrl = `${baseUrl}/chat/completions`;
    const url = new URL(fullUrl);

    const body = JSON.stringify({
      model: settings.openaiModel,
      messages: [
        { role: 'system', content: '你是一个内容分类助手。' },
        { role: 'user', content: prompt },
      ],
      temperature: settings.openaiTemperature,
      response_format: { type: 'json_object' },
    });

    const options: https.RequestOptions = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.openaiApiKey}`,
        'Content-Length': Buffer.byteLength(body),
      },
    };

    return new Promise<string>((resolve, reject) => {
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => {
          data += chunk.toString();
        });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const parsed = JSON.parse(data);
              const content: string =
                parsed?.choices?.[0]?.message?.content ?? '';
              resolve(content);
            } catch (err) {
              reject(
                new Error(
                  `Failed to parse OpenAI response: ${(err as Error).message}`,
                ),
              );
            }
          } else {
            reject(
              new Error(
                `OpenAI request failed: ${res.statusCode} ${res.statusMessage} - ${data}`,
              ),
            );
          }
        });
      });

      req.on('error', (err: Error) => {
        reject(new Error(`OpenAI network error: ${err.message}`));
      });

      req.write(body);
      req.end();
    });
  }

  /**
   * Parse AI response JSON robustly, handling markdown code blocks.
   */
  private parseAiResponse(text: string): TagResult {
    const trimmed = text.trim();

    // 1. Direct parse
    try {
      const parsed = JSON.parse(trimmed);
      return this.normalizeTagResult(parsed);
    } catch {
      // fall through
    }

    // 2. Extract ```json ... ``` code block
    const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (codeBlockMatch) {
      try {
        const parsed = JSON.parse(codeBlockMatch[1].trim());
        return this.normalizeTagResult(parsed);
      } catch {
        // fall through
      }
    }

    // 3. Extract first { ... } block
    const braceMatch = trimmed.match(/\{[\s\S]*\}/);
    if (braceMatch) {
      try {
        const parsed = JSON.parse(braceMatch[0]);
        return this.normalizeTagResult(parsed);
      } catch {
        // fall through
      }
    }

    throw new Error(`Failed to parse AI response as JSON: ${text.slice(0, 200)}`);
  }

  private normalizeTagResult(obj: any): TagResult {
    const tags = Array.isArray(obj.tags)
      ? obj.tags
          .filter((t: any) => typeof t === 'string' && t.trim().length > 0)
          .slice(0, 6)
      : [];

    let category: string =
      typeof obj.category === 'string' ? obj.category.trim() : '';
    if (!CATEGORIES.includes(category)) {
      category = '其他';
    }

    let summary: string =
      typeof obj.summary === 'string' ? obj.summary.trim() : '';
    if (summary.length > 100) {
      summary = summary.slice(0, 100);
    }

    return { tags, category, summary };
  }

  /**
   * Tag a single archive item with AI.
   */
  async tagItem(itemId: string): Promise<TagResult> {
    // 1. Read item from DB
    const items = await this.db
      .select({
        id: archiveItem.id,
        title: archiveItem.title,
        summary: archiveItem.summary,
        authorName: archiveItem.authorName,
        originalTags: archiveItem.originalTags,
        rawData: archiveItem.rawData,
      })
      .from(archiveItem)
      .where(and(eq(archiveItem.id, itemId), eq(archiveItem.isDeleted, false)));

    if (items.length === 0) {
      throw new NotFoundException('Archive item not found');
    }

    const item = items[0];
    const title = item.title ?? '';
    const authorName = item.authorName ?? '';
    const originalTags = item.originalTags ?? [];
    const rawData = item.rawData as Record<string, any>;

    const descText =
      rawData?.desc ??
      rawData?.content ??
      rawData?.description ??
      rawData?.text ??
      rawData?.body ??
      '';

    const descStr =
      typeof descText === 'string'
        ? descText
        : descText
          ? JSON.stringify(descText)
          : '';

    const prompt = `请为以下收藏内容生成中文标签和分类，只返回 JSON，不要额外文本。
JSON 格式：{ "tags": ["标签1", "标签2", ...], "category": "主分类名", "summary": "一句话中文摘要" }
要求：
- tags: 2~6 个简短中文标签
- category: 一个最贴切的主分类（从以下分类中选最接近的：${CATEGORIES.join('、')}）
- summary: 一句话中文摘要（不超过50字）

标题：${title}
作者：${authorName}
描述/正文：${descStr.slice(0, 2000)}
站内标签：${originalTags.join(', ')}`;

    // 2. Call OpenAI
    const responseText = await this.callOpenAI(prompt);

    // 3. Parse response
    const result = this.parseAiResponse(responseText);

    // 4. Update item and tags in transaction
    await this.db.transaction(async (tx) => {
      // Update archive_item
      await tx
        .update(archiveItem)
        .set({
          category: result.category,
          summary: result.summary,
          aiTaggedAt: new Date(),
          aiTagError: null,
        })
        .where(eq(archiveItem.id, itemId));

      // Remove old tag associations
      await tx
        .delete(archiveItemTag)
        .where(eq(archiveItemTag.itemId, itemId));

      // Upsert tags and create associations
      if (result.tags.length > 0) {
        // Select existing tags by name
        const existingTags = await tx
          .select({ id: archiveTag.id, name: archiveTag.name })
          .from(archiveTag)
          .where(inArray(archiveTag.name, result.tags));

        const existingNames = new Set(existingTags.map((t) => t.name));
        const newNames = result.tags.filter(
          (name: string) => !existingNames.has(name),
        );

        let allTagIds = existingTags.map((t) => t.id);

        // Insert new tags
        if (newNames.length > 0) {
          const inserted = await tx
            .insert(archiveTag)
            .values(
              newNames.map((name: string) => ({
                name,
                color: this.generateColor(name),
              })),
            )
            .onConflictDoNothing({ target: archiveTag.name })
            .returning({ id: archiveTag.id, name: archiveTag.name });
          allTagIds = [...allTagIds, ...inserted.map((t) => t.id)];

          // Some may have been inserted by race condition, re-select all names
          if (inserted.length < newNames.length) {
            const allMatched = await tx
              .select({ id: archiveTag.id })
              .from(archiveTag)
              .where(inArray(archiveTag.name, result.tags));
            allTagIds = allMatched.map((t) => t.id);
          }
        }

        // Create item-tag associations
        if (allTagIds.length > 0) {
          await tx.insert(archiveItemTag).values(
            allTagIds.map((tagId) => ({
              itemId,
              tagId,
            })),
          );
        }
      }
    });

    return result;
  }

  /**
   * Generate a deterministic color for a tag name.
   */
  private generateColor(name: string): string {
    const colors = [
      '#ef4444', // red
      '#f97316', // orange
      '#f59e0b', // amber
      '#eab308', // yellow
      '#84cc16', // lime
      '#22c55e', // green
      '#10b981', // emerald
      '#14b8a6', // teal
      '#06b6d4', // cyan
      '#0ea5e9', // sky
      '#3b82f6', // blue
      '#6366f1', // indigo
      '#8b5cf6', // violet
      '#a855f7', // purple
      '#d946ef', // fuchsia
      '#ec4899', // pink
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
    }
    return colors[hash % colors.length];
  }

  /**
   * Start a batch AI tagging job for all untagged items.
   * Returns immediately with jobId; processing runs in background.
   */
  async startBatchTag(): Promise<string> {
    const now = new Date();

    const inserted = await this.db
      .insert(syncJob)
      .values({
        jobType: 'ai_tagging',
        status: 'running',
        total: 0,
        processed: 0,
        successCount: 0,
        failCount: 0,
        startedAt: now,
      })
      .returning({ id: syncJob.id });

    const jobId = inserted[0].id;

    // Kick off async background processing
    void this.runBatchTag(jobId).catch((err: Error) => {
      this.logger.error(
        `Batch AI tagging job ${jobId} failed: ${err.message}`,
        err.stack,
      );
      this.db
        .update(syncJob)
        .set({
          status: 'failed',
          errorMessage: err.message,
          finishedAt: new Date(),
        })
        .where(eq(syncJob.id, jobId))
        .catch((dbErr: Error) => {
          this.logger.error(
            `Failed to update failed job status ${jobId}: ${dbErr.message}`,
          );
        });
    });

    return jobId;
  }

  private async runBatchTag(jobId: string): Promise<void> {
    // Query all untagged item ids
    const items = await this.db
      .select({ id: archiveItem.id })
      .from(archiveItem)
      .where(
        and(eq(archiveItem.isDeleted, false), isNull(archiveItem.aiTaggedAt)),
      );

    const itemIds = items.map((item) => item.id);
    const total = itemIds.length;

    await this.db
      .update(syncJob)
      .set({ total })
      .where(eq(syncJob.id, jobId));

    if (total === 0) {
      await this.db
        .update(syncJob)
        .set({
          status: 'success',
          processed: 0,
          successCount: 0,
          failCount: 0,
          finishedAt: new Date(),
        })
        .where(eq(syncJob.id, jobId));
      return;
    }

    let processed = 0;
    let successCount = 0;
    let failCount = 0;

    // Process in batches of CONCURRENCY
    for (let i = 0; i < itemIds.length; i += CONCURRENCY) {
      const batch = itemIds.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.allSettled(
        batch.map((id: string) => this.tagItem(id)),
      );

      for (const result of batchResults) {
        processed += 1;
        if (result.status === 'fulfilled') {
          successCount += 1;
        } else {
          failCount += 1;
          this.logger.warn(
            `AI tag item failed: ${(result.reason as Error).message}`,
          );
        }
      }

      // Update job progress after each batch
      await this.db
        .update(syncJob)
        .set({
          processed,
          successCount,
          failCount,
        })
        .where(eq(syncJob.id, jobId));
    }

    // Mark job as completed
    await this.db
      .update(syncJob)
      .set({
        status: 'success',
        processed,
        successCount,
        failCount,
        finishedAt: new Date(),
      })
      .where(eq(syncJob.id, jobId));
  }

  /**
   * Get the latest ai_tagging sync job.
   */
  async getLatestJob(): Promise<SyncJob | null> {
    const jobs = await this.db
      .select()
      .from(syncJob)
      .where(eq(syncJob.jobType, 'ai_tagging'))
      .orderBy(desc(syncJob.createdAt))
      .limit(1);

    if (jobs.length === 0) return null;

    return this.mapSyncJob(jobs[0]);
  }

  /**
   * Retag a single item.
   */
  async retagItem(itemId: string): Promise<TagResult> {
    // Verify item exists
    const items = await this.db
      .select({ id: archiveItem.id })
      .from(archiveItem)
      .where(and(eq(archiveItem.id, itemId), eq(archiveItem.isDeleted, false)));

    if (items.length === 0) {
      throw new NotFoundException('Archive item not found');
    }

    // Clear ai_tagged_at
    await this.db
      .update(archiveItem)
      .set({
        aiTaggedAt: null,
        aiTagError: null,
      })
      .where(eq(archiveItem.id, itemId));

    // Run tagItem
    return this.tagItem(itemId);
  }

  private mapSyncJob(row: typeof syncJob.$inferSelect): SyncJob {
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
}
