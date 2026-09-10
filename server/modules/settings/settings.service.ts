import { Inject, Injectable, Logger } from '@nestjs/common';
import { LOCAL_SQLITE_DB } from '../../database/sqlite.module';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { archiveSettings } from '@server/database/schema';
import { eq } from 'drizzle-orm';
import type {
  SettingsResponse,
  UpdateSettingsRequest,
  TestHeyboxResponse,
  TestOpenaiResponse,
} from '@shared/api.interface';
import {
  buildHeyboxUrl,
  buildHeyboxHeaders,
} from '@server/common/utils/heybox-sign';
import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';

type FullSettings = {
  heyboxCookie: string;
  openaiBaseUrl: string;
  openaiApiKey: string;
  openaiModel: string;
  openaiTemperature: number;
  crawlTopicEnabled: boolean;
  topicLinkId: string;
  autoSyncEnabled: boolean;
  autoSyncInterval: number;
  lastAutoSyncAt: Date | null;
  autoSyncStatus: string;
  autoSyncError: string | null;
};

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    @Inject(LOCAL_SQLITE_DB) private readonly db: BetterSQLite3Database,
  ) {}

  private toResponse(row: FullSettings): SettingsResponse {
    return {
      heyboxCookie: '',
      openaiBaseUrl: row.openaiBaseUrl,
      openaiApiKey: '',
      openaiModel: row.openaiModel,
      openaiTemperature: row.openaiTemperature,
      hasHeyboxCookie: row.heyboxCookie.length > 0,
      hasOpenaiKey: row.openaiApiKey.length > 0,
      crawlTopicEnabled: row.crawlTopicEnabled,
      topicLinkId: row.topicLinkId,
      autoSyncEnabled: row.autoSyncEnabled,
      autoSyncInterval: row.autoSyncInterval,
      lastAutoSyncAt: row.lastAutoSyncAt,
      autoSyncStatus: row.autoSyncStatus,
      autoSyncError: row.autoSyncError,
    };
  }

  async getSettings(): Promise<SettingsResponse> {
    const row = await this.getFullSettings();
    return this.toResponse(row);
  }

  async getFullSettings(): Promise<FullSettings> {
    const rows = await this.db.select().from(archiveSettings).limit(1);
    if (rows.length > 0) {
      const row = rows[0] as any;
      return {
        heyboxCookie: row.heyboxCookie,
        openaiBaseUrl: row.openaiBaseUrl,
        openaiApiKey: row.openaiApiKey,
        openaiModel: row.openaiModel,
        openaiTemperature: row.openaiTemperature,
        crawlTopicEnabled: Boolean(row.crawlTopicEnabled),
        topicLinkId: row.topicLinkId || '416158',
        autoSyncEnabled: Boolean(row.autoSyncEnabled),
        autoSyncInterval: Number(row.autoSyncInterval) || 30,
        lastAutoSyncAt: row.lastAutoSyncAt ? new Date(row.lastAutoSyncAt) : null,
        autoSyncStatus: row.autoSyncStatus || 'idle',
        autoSyncError: row.autoSyncError || null,
      };
    }
    const inserted = await this.db
      .insert(archiveSettings)
      .values({
        heyboxCookie: '',
        openaiBaseUrl: 'https://api.openai.com/v1',
        openaiApiKey: '',
        openaiModel: 'gpt-4o-mini',
        openaiTemperature: 0.7,
        crawlTopicEnabled: false,
        topicLinkId: '416158',
        autoSyncEnabled: false,
        autoSyncInterval: 30,
        lastAutoSyncAt: null,
        autoSyncStatus: 'idle',
        autoSyncError: null,
      })
      .returning();
    const row = inserted[0] as any;
    return {
      heyboxCookie: row.heyboxCookie,
      openaiBaseUrl: row.openaiBaseUrl,
      openaiApiKey: row.openaiApiKey,
      openaiModel: row.openaiModel,
      openaiTemperature: row.openaiTemperature,
      crawlTopicEnabled: Boolean(row.crawlTopicEnabled),
      topicLinkId: row.topicLinkId || '416158',
      autoSyncEnabled: Boolean(row.autoSyncEnabled),
      autoSyncInterval: Number(row.autoSyncInterval) || 30,
      lastAutoSyncAt: row.lastAutoSyncAt ? new Date(row.lastAutoSyncAt) : null,
      autoSyncStatus: row.autoSyncStatus || 'idle',
      autoSyncError: row.autoSyncError || null,
    };
  }

  async updateSettings(dto: UpdateSettingsRequest): Promise<SettingsResponse> {
    const rows = await this.db.select().from(archiveSettings).limit(1);
    const existing = rows[0];
    if (!existing) {
      await this.getFullSettings();
      return this.updateSettings(dto);
    }

    const patch: Partial<typeof archiveSettings.$inferInsert> = {};
    if (dto.heyboxCookie !== undefined) patch.heyboxCookie = dto.heyboxCookie;
    if (dto.openaiBaseUrl !== undefined) patch.openaiBaseUrl = dto.openaiBaseUrl;
    if (dto.openaiApiKey !== undefined) patch.openaiApiKey = dto.openaiApiKey;
    if (dto.openaiModel !== undefined) patch.openaiModel = dto.openaiModel;
    if (dto.openaiTemperature !== undefined) patch.openaiTemperature = dto.openaiTemperature;
    if (dto.crawlTopicEnabled !== undefined) patch.crawlTopicEnabled = dto.crawlTopicEnabled;
    if (dto.topicLinkId !== undefined) patch.topicLinkId = dto.topicLinkId;
    if (dto.autoSyncEnabled !== undefined) patch.autoSyncEnabled = dto.autoSyncEnabled;
    if (dto.autoSyncInterval !== undefined) patch.autoSyncInterval = dto.autoSyncInterval;

    if (Object.keys(patch).length === 0) {
      return this.getSettings();
    }

    await this.db
      .update(archiveSettings)
      .set(patch)
      .where(eq(archiveSettings.id, existing.id));

    return this.getSettings();
  }

  /**
   * 更新自动同步状态
   */
  async updateAutoSyncStatus(status: string, error?: string): Promise<void> {
    const rows = await this.db.select().from(archiveSettings).limit(1);
    if (rows.length === 0) return;
    const patch: any = { autoSyncStatus: status };
    if (error !== undefined) patch.autoSyncError = error;
    await this.db.update(archiveSettings).set(patch).where(eq(archiveSettings.id, rows[0].id));
  }

  /**
   * 更新上次自动同步时间
   */
  async updateLastAutoSyncAt(): Promise<void> {
    const rows = await this.db.select().from(archiveSettings).limit(1);
    if (rows.length === 0) return;
    await this.db
      .update(archiveSettings)
      .set({ lastAutoSyncAt: new Date() })
      .where(eq(archiveSettings.id, rows[0].id));
  }

  private async httpGet(urlStr: string, headers: Record<string, string>): Promise<string> {
    return new Promise((resolve, reject) => {
      const url = new URL(urlStr);
      const transport = url.protocol === 'https:' ? https : http;
      const req = transport.get(
        {
          hostname: url.hostname,
          port: url.port,
          path: url.pathname + url.search,
          headers,
          timeout: 15000,
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
      req.on('error', (err: Error) => reject(err));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('请求超时'));
      });
    });
  }

  private async httpPost(
    urlStr: string,
    headers: Record<string, string>,
    body: string,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const url = new URL(urlStr);
      const transport = url.protocol === 'https:' ? https : http;
      const req = transport.request(
        {
          hostname: url.hostname,
          port: url.port,
          path: url.pathname + url.search,
          method: 'POST',
          headers: {
            ...headers,
            'Content-Length': Buffer.byteLength(body),
          },
          timeout: 15000,
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
      req.on('error', (err: Error) => reject(err));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('请求超时'));
      });
      req.write(body);
      req.end();
    });
  }

  async testHeybox(): Promise<TestHeyboxResponse> {
    try {
      const settings = await this.getFullSettings();
      if (!settings.heyboxCookie) {
        return { ok: false, message: '尚未配置小黑盒 Cookie' };
      }

      const path = '/bbs/app/profile/fav/folder/v2/links';
      const url = buildHeyboxUrl(path, {
        enable_new_style_collect: '1',
        dw: '1200',
        offset: '0',
        limit: '1',
        channel: 'heybox',
      });
      const headers = buildHeyboxHeaders(settings.heyboxCookie);

      const body = await this.httpGet(url, headers);

      let data: { status?: string; msg?: string; result?: { total?: number } } = {};
      try {
        data = JSON.parse(body);
      } catch {
        return { ok: false, message: '响应解析失败' };
      }

      if (data.status === 'ok') {
        const total = data.result?.total;
        return {
          ok: true,
          message: '连接成功',
          sampleCount: typeof total === 'number' ? total : undefined,
        };
      }
      if (data.status === 'login') {
        return { ok: false, message: data.msg || 'Cookie 已失效，请重新登录' };
      }
      return { ok: false, message: data.msg || '未知错误' };
    } catch (error) {
      this.logger.error('测试小黑盒连接失败', error instanceof Error ? error.stack : String(error));
      const msg = error instanceof Error ? error.message : String(error);
      return { ok: false, message: `连接失败：${msg}` };
    }
  }

  async testOpenai(): Promise<TestOpenaiResponse> {
    try {
      const settings = await this.getFullSettings();
      if (!settings.openaiApiKey) {
        return { ok: false, message: '尚未配置 API Key' };
      }
      if (!settings.openaiBaseUrl) {
        return { ok: false, message: '尚未配置 Base URL' };
      }

      const baseUrl = settings.openaiBaseUrl.replace(/\/+$/, '');
      const url = `${baseUrl}/chat/completions`;
      const body = JSON.stringify({
        model: settings.openaiModel,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 5,
        temperature: settings.openaiTemperature,
      });

      await this.httpPost(
        url,
        {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${settings.openaiApiKey}`,
        },
        body,
      );

      return { ok: true, message: '连通成功' };
    } catch (error) {
      this.logger.error('测试 OpenAI 连接失败', error instanceof Error ? error.stack : String(error));
      const msg = error instanceof Error ? error.message : String(error);
      return { ok: false, message: `连接失败：${msg}` };
    }
  }
}
