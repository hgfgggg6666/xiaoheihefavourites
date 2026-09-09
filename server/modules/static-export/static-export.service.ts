import {
  Injectable,
  Inject,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { LOCAL_SQLITE_DB } from '../../database/sqlite.module';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import {
  archiveItem,
  archiveTag,
  archiveItemTag,
  archiveComment,
  syncJob,
} from '@server/database/schema';
import {
  eq,
  and,
  count,
  desc,
  inArray,
  isNull,
  asc,
} from 'drizzle-orm';
// archiver v7 是纯 ESM 模块，运行时动态 import
let archiverZip: (opts: any) => any | null = null;
let archiverPromise: Promise<any> | null = null;

async function getArchiverZip(): Promise<any> {
  if (archiverZip) return archiverZip;
  if (!archiverPromise) {
    archiverPromise = import('archiver').then((mod) => {
      const Archiver = mod.default || mod;
      archiverZip = (opts: any) => new Archiver.ZipArchive(opts);
      return archiverZip;
    });
  }
  return archiverPromise;
}
import * as fs from 'fs';
import * as path from 'path';
import type { Response } from 'express';
import type { ArchiveTag } from '@shared/api.interface';

type ArchiveItemSelect = typeof archiveItem.$inferSelect;

interface StaticExportItem {
  linkid: string;
  title: string | null;
  summary: string | null;
  category: string | null;
  shareUrl: string | null;
  cover: string | null;
  authorName: string | null;
  authorAvatar: string | null;
  sourceCreateAt: string | null;
  createdAt: string;
  tags: { name: string; color: string }[];
  commentCount: number;
  content: string | null;
  images: string[];
  comments: StaticExportComment[];
}

interface StaticExportComment {
  commentid: string;
  floor: number | null;
  text: string | null;
  createAt: string | null;
  up: number;
  isAuthor: boolean;
  imageUrls: string[];
  userid: string | null;
  username: string | null;
  userAvatar: string | null;
  userLevel: number | null;
  replyUsername: string | null;
  children: StaticExportComment[];
  remoteImageUrls?: string[];
}

interface StaticArchiveData {
  exportedAt: string;
  total: number;
  items: StaticExportItem[];
  categories: { name: string; count: number }[];
  allTags: { name: string; color: string; count: number }[];
}

@Injectable()
export class StaticExportService {
  private readonly logger = new Logger(StaticExportService.name);

  constructor(@Inject(LOCAL_SQLITE_DB) private readonly db: BetterSQLite3Database) {}

  async startExportJob(): Promise<string> {
    const existing = await this.db
      .select({ id: syncJob.id, status: syncJob.status })
      .from(syncJob)
      .where(eq(syncJob.jobType, 'static_export'))
      .orderBy(desc(syncJob.createdAt))
      .limit(1);

    if (existing.length > 0 && existing[0].status === 'running') {
      throw new BadRequestException('已有导出任务正在进行中');
    }

    const created = await this.db
      .insert(syncJob)
      .values({
        jobType: 'static_export',
        status: 'running',
        total: 0,
        processed: 0,
        successCount: 0,
        failCount: 0,
        startedAt: new Date(),
      })
      .returning({ id: syncJob.id });

    return created[0].id;
  }

  async getExportJob(): Promise<{
    job: {
      id: string;
      status: string;
      total: number;
      processed: number;
      successCount: number;
      failCount: number;
      errorMessage: string | null;
      finishedAt: string | null;
    } | null;
  }> {
    const rows = await this.db
      .select()
      .from(syncJob)
      .where(eq(syncJob.jobType, 'static_export'))
      .orderBy(desc(syncJob.createdAt))
      .limit(1);

    if (rows.length === 0) return { job: null };
    const row = rows[0];
    return {
      job: {
        id: row.id,
        status: row.status,
        total: row.total,
        processed: row.processed,
        successCount: row.successCount,
        failCount: row.failCount,
        errorMessage: row.errorMessage,
        finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
      },
    };
  }

  async streamExportZip(res: Response): Promise<void> {
    const job = await this.startExportJob();

    try {
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="xiaoheihe-archive-site.zip"',
      );

      const ZipArchive = await getArchiverZip();
      const archive = ZipArchive({
        zlib: { level: 9 },
      });

      archive.on('error', (err: Error) => {
        this.logger.error(`导出zip失败: ${err.message}`);
      });

      archive.pipe(res);

      const { items, categories, allTags, total } = await this.buildExportData(job);

      const archiveData: StaticArchiveData = {
        exportedAt: new Date().toISOString(),
        total,
        items,
        categories,
        allTags,
      };

      const dataJs = `window.__ARCHIVE__ = ${JSON.stringify(archiveData)};`;
      archive.append(dataJs, { name: 'data/archive.js' });

      const templatePath = this.resolveTemplatePath();
      let htmlContent: string;
      try {
        htmlContent = fs.readFileSync(templatePath, 'utf-8');
      } catch (e) {
        const err = e as Error;
        this.logger.warn(`读取模板失败 ${templatePath}: ${err.message}，回退到内嵌模板`);
        htmlContent = this.getFallbackTemplate();
      }

      const dataScriptTag = '<script src="./data/archive.js"></script>';
      if (!htmlContent.includes(dataScriptTag)) {
        htmlContent = htmlContent.replace(
          '</head>',
          `  ${dataScriptTag}\n</head>`,
        );
      }
      archive.append(htmlContent, { name: 'index.html' });

      const mediaCount = await this.copyMediaToArchive(archive, items);
      this.logger.log(`导出静态站：${total} 条收藏，${mediaCount} 张本地图片`);

      await archive.finalize();

      await this.db
        .update(syncJob)
        .set({
          status: 'success',
          total,
          processed: total,
          successCount: total,
          failCount: 0,
          finishedAt: new Date(),
        })
        .where(eq(syncJob.id, job));
    } catch (e) {
      const err = e as Error;
      this.logger.error(`静态导出失败: ${err.message}`);
      await this.db
        .update(syncJob)
        .set({
          status: 'failed',
          errorMessage: err.message,
          finishedAt: new Date(),
        })
        .where(eq(syncJob.id, job));
      if (!res.headersSent) {
        res.status(500).json({ error: err.message });
      }
    }
  }

  private async buildExportData(jobId: string): Promise<{
    items: StaticExportItem[];
    categories: { name: string; count: number }[];
    allTags: { name: string; color: string; count: number }[];
    total: number;
  }> {
    const itemRows: ArchiveItemSelect[] = await this.db
      .select()
      .from(archiveItem)
      .where(eq(archiveItem.isDeleted, false))
      .orderBy(desc(archiveItem.createdAt));

    const total = itemRows.length;
    const itemIds = itemRows.map((row) => row.id);
    const linkids = itemRows.map((row) => row.linkid);

    const tagsByItem = await this.getTagsByItemIds(itemIds);
    const commentCountByLinkid = await this.getCommentCountByLinkids(linkids);
    const commentsByLinkid = await this.getCommentsByLinkids(linkids);

    await this.db.update(syncJob).set({ total }).where(eq(syncJob.id, jobId));

    const items: StaticExportItem[] = itemRows.map((row) => {
      const tags = tagsByItem.get(row.id) ?? [];
      const commentCount = commentCountByLinkid.get(row.linkid) ?? 0;
      const comments = commentsByLinkid.get(row.linkid) ?? [];

      const rawData = row.rawData as Record<string, any>;
      const link = rawData?.link ?? rawData ?? {};

      // 正文内容：优先使用帖子详情里的完整正文
      // 小黑盒帖子的完整正文在 text 字段（富文本数组），description 是被截断的摘要
      let content: string | null = row.summary;
      const hasFullDetail = rawData?.full_detail === true;

      if (hasFullDetail) {
        // 已经抓取了完整正文，优先解析 text 字段（富文本数组）
        const fullText = this.extractTextFromRichText(link.text);
        if (fullText && fullText.length > 100) {
          content = fullText;
        } else if (link.description && typeof link.description === 'string' && link.description.length > 100) {
          content = link.description;
        } else if (link.content && typeof link.content === 'string' && link.content.length > 100) {
          content = link.content;
        } else if (link.desc && typeof link.desc === 'string' && link.desc.length > 100) {
          content = link.desc;
        }
      } else {
        // 没有完整正文，用收藏夹列表里的摘要（可能被截断）
        if (link.desc && typeof link.desc === 'string') {
          content = link.desc;
        } else if (link.content && typeof link.content === 'string') {
          content = link.content;
        } else if (link.description && typeof link.description === 'string') {
          content = link.description;
        }
      }

      // 从 raw_data.imgs 提取帖子正文所有图片
      const postImages: string[] = [];
      const postImageExts: string[] = [];
      if (Array.isArray(rawData.imgs) && rawData.imgs.length > 0) {
        for (const imgUrl of rawData.imgs) {
          if (typeof imgUrl === 'string' && imgUrl.startsWith('http')) {
            postImages.push(imgUrl);
            const ext = imgUrl.split('.').pop()?.split('?')[0]?.toLowerCase() || 'jpg';
            postImageExts.push(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext) ? ext : 'jpg');
          }
        }
      }

      // 封面图片：优先用本地下载的第一张帖子图片
      let cover: string | null = null;
      if (row.localCoverPath && postImages.length > 0) {
        cover = `./media/post_${row.linkid}_0.${postImageExts[0]}`;
      } else if (row.localCoverPath) {
        // 兼容旧格式
        cover = `./media/post_${row.linkid}_0.jpg`;
      } else if (row.coverUrl) {
        cover = row.coverUrl;
      }

      // 帖子所有图片：生成本地路径
      const images: string[] = [];
      if (postImages.length > 0) {
        for (let i = 0; i < postImages.length; i++) {
          images.push(`./media/post_${row.linkid}_${i}.${postImageExts[i]}`);
        }
      } else if (row.coverUrl) {
        images.push(row.coverUrl);
      }
      // 兼容旧字段
      if (link.images && Array.isArray(link.images)) {
        for (const img of link.images) {
          const url = typeof img === 'string' ? img : img.url || img.img_url;
          if (url && typeof url === 'string' && !images.includes(url)) images.push(url);
        }
      }
      if (link.image && Array.isArray(link.image)) {
        for (const img of link.image) {
          const url = typeof img === 'string' ? img : img.url || img.img_url;
          if (url && typeof url === 'string' && !images.includes(url)) images.push(url);
        }
      }

      return {
        linkid: row.linkid,
        title: row.title,
        summary: row.summary,
        category: row.category,
        shareUrl: row.shareUrl,
        cover,
        authorName: row.authorName,
        authorAvatar: row.authorAvatar,
        sourceCreateAt: row.sourceCreateAt ? row.sourceCreateAt.toISOString() : null,
        createdAt: row.createdAt.toISOString(),
        tags: tags.map((t) => ({ name: t.name, color: t.color })),
        commentCount,
        content,
        images: images.slice(0, 20),
        comments,
      };
    });

    const categoryMap = new Map<string, number>();
    for (const item of items) {
      if (item.category) {
        categoryMap.set(item.category, (categoryMap.get(item.category) ?? 0) + 1);
      }
    }
    const categories = Array.from(categoryMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    const tagCountMap = new Map<string, { color: string; count: number }>();
    for (const item of items) {
      for (const tag of item.tags) {
        const existing = tagCountMap.get(tag.name);
        if (existing) {
          existing.count += 1;
        } else {
          tagCountMap.set(tag.name, { color: tag.color, count: 1 });
        }
      }
    }
    const allTags = Array.from(tagCountMap.entries())
      .map(([name, v]) => ({ name, color: v.color, count: v.count }))
      .sort((a, b) => b.count - a.count);

    return { items, categories, allTags, total };
  }

  private async getTagsByItemIds(itemIds: string[]): Promise<Map<string, ArchiveTag[]>> {
    if (itemIds.length === 0) return new Map();
    const rows = await this.db
      .select({
        itemId: archiveItemTag.itemId,
        tagId: archiveTag.id,
        tagName: archiveTag.name,
        tagColor: archiveTag.color,
      })
      .from(archiveItemTag)
      .innerJoin(archiveTag, eq(archiveItemTag.tagId, archiveTag.id))
      .where(inArray(archiveItemTag.itemId, itemIds));

    const map = new Map<string, ArchiveTag[]>();
    for (const row of rows) {
      const tag: ArchiveTag = { id: row.tagId, name: row.tagName, color: row.tagColor };
      const existing = map.get(row.itemId);
      if (existing) {
        existing.push(tag);
      } else {
        map.set(row.itemId, [tag]);
      }
    }
    return map;
  }

  private async getCommentCountByLinkids(linkids: string[]): Promise<Map<string, number>> {
    if (linkids.length === 0) return new Map();
    const rows = await this.db
      .select({
        linkid: archiveComment.linkid,
        count: count(),
      })
      .from(archiveComment)
      .where(
        and(
          inArray(archiveComment.linkid, linkids),
          eq(archiveComment.crawlStatus, 'ok'),
          isNull(archiveComment.rootCommentId),
        ),
      )
      .groupBy(archiveComment.linkid);

    const map = new Map<string, number>();
    for (const row of rows) {
      map.set(row.linkid, Number(row.count));
    }
    return map;
  }

  private async getCommentsByLinkids(linkids: string[]): Promise<Map<string, StaticExportComment[]>> {
    if (linkids.length === 0) return new Map();
    const rows = await this.db
      .select()
      .from(archiveComment)
      .where(
        and(
          inArray(archiveComment.linkid, linkids),
          eq(archiveComment.crawlStatus, 'ok'),
        ),
      )
      .orderBy(archiveComment.floor, asc(archiveComment.createAt));

    const byLinkidRoot = new Map<string, Map<string, StaticExportComment>>();
    const byLinkidChildren = new Map<string, Map<string, StaticExportComment[]>>();

    for (const row of rows) {
      const hasLocal = row.localImagePaths && row.localImagePaths.length > 0;
      const localImgUrls = hasLocal
        ? row.localImagePaths.map((_p: string, i: number) => `./media/comment_${row.commentid}_${i}.jpg`)
        : [];
      const comment: StaticExportComment = {
        commentid: row.commentid,
        floor: row.floor,
        text: row.text,
        createAt: row.createAt ? row.createAt.toISOString() : null,
        up: row.up,
        isAuthor: row.isAuthor,
        imageUrls: hasLocal ? localImgUrls : row.imageUrls ?? [],
        remoteImageUrls: row.imageUrls ?? [],
        userid: row.userid,
        username: row.username,
        userAvatar: row.userAvatar,
        userLevel: row.userLevel,
        replyUsername: row.replyUsername,
        children: [],
      };

      if (!row.rootCommentId) {
        let rootMap = byLinkidRoot.get(row.linkid);
        if (!rootMap) {
          rootMap = new Map();
          byLinkidRoot.set(row.linkid, rootMap);
        }
        rootMap.set(row.commentid, comment);
      } else {
        let childMap = byLinkidChildren.get(row.linkid);
        if (!childMap) {
          childMap = new Map();
          byLinkidChildren.set(row.linkid, childMap);
        }
        const list = childMap.get(row.rootCommentId) ?? [];
        list.push(comment);
        childMap.set(row.rootCommentId, list);
      }
    }

    const result = new Map<string, StaticExportComment[]>();
    for (const [linkid, rootMap] of byLinkidRoot) {
      const childrenMap = byLinkidChildren.get(linkid) ?? new Map();
      const rootList: StaticExportComment[] = [];
      for (const [rootId, root] of rootMap) {
        root.children = childrenMap.get(rootId) ?? [];
        rootList.push(root);
      }
      rootList.sort((a, b) => (a.floor ?? 0) - (b.floor ?? 0));
      const cleanComments = (list: StaticExportComment[]): StaticExportComment[] => {
        return list.map((c) => {
          const { remoteImageUrls: _ri, ...rest } = c as StaticExportComment & { remoteImageUrls?: string[] };
          return { ...rest, children: cleanComments(c.children) };
        });
      };
      result.set(linkid, cleanComments(rootList.slice(0, 50)));
    }
    return result;
  }

  private resolveTemplatePath(): string {
    const candidates = [
      path.join(__dirname, 'static-template.html'),
      path.join(process.cwd(), 'server/modules/static-export/static-template.html'),
      path.join(process.cwd(), 'dist/server/modules/static-export/static-template.html'),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    return candidates[0];
  }

  private getFallbackTemplate(): string {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>小黑盒收藏归档</title>
<script src="./data/archive.js"></script>
<style>
body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; margin: 0; padding: 20px; background: #f8fafc; color: #0f172a; }
.header { margin-bottom: 20px; }
.grid { column-count: 3; column-gap: 16px; }
.card { break-inside: avoid; margin-bottom: 16px; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
.card img { width: 100%; display: block; }
.card-body { padding: 12px; }
.card-title { font-weight: 600; margin-bottom: 4px; }
.card-summary { font-size: 13px; color: #64748b; }
@media (max-width: 900px) { .grid { column-count: 2; } }
@media (max-width: 600px) { .grid { column-count: 1; } }
</style>
</head>
<body>
<div class="header">
  <h1>小黑盒收藏归档</h1>
  <p id="meta"></p>
</div>
<div id="grid" class="grid"></div>
<script>
(function() {
  var data = window.__ARCHIVE__ || { items: [], total: 0 };
  document.getElementById('meta').textContent =
    '导出时间: ' + new Date(data.exportedAt).toLocaleString() + ' | 收藏: ' + data.total;
  var grid = document.getElementById('grid');
  data.items.forEach(function(item) {
    var card = document.createElement('div');
    card.className = 'card';
    if (item.cover) {
      var img = document.createElement('img');
      img.src = item.cover;
      img.alt = item.title || '';
      card.appendChild(img);
    }
    var body = document.createElement('div');
    body.className = 'card-body';
    var title = document.createElement('div');
    title.className = 'card-title';
    title.textContent = item.title || '(无标题)';
    body.appendChild(title);
    if (item.summary) {
      var sum = document.createElement('div');
      sum.className = 'card-summary';
      sum.textContent = item.summary;
      body.appendChild(sum);
    }
    card.appendChild(body);
    grid.appendChild(card);
  });
})();
</script>
</body>
</html>`;
  }

  private async copyMediaToArchive(
    archive: any,
    items: StaticExportItem[],
  ): Promise<number> {
    let count = 0;
    const added = new Set<string>();
    const mediaDir = path.join(process.cwd(), 'media');

    for (const item of items) {
      // 处理帖子正文所有图片（直接从本地 media 目录读取）
      for (const imgUrl of item.images) {
        if (imgUrl && imgUrl.startsWith('./media/post_')) {
          const fileName = imgUrl.replace('./media/', '');
          if (!added.has(fileName)) {
            added.add(fileName);
            const localPath = path.join(mediaDir, fileName);
            if (fs.existsSync(localPath)) {
              try {
                const buffer = fs.readFileSync(localPath);
                if (buffer && buffer.length > 0) {
                  archive.append(buffer, { name: `media/${fileName}` });
                  count += 1;
                }
              } catch (e) {
                this.logger.warn(`读取本地图片失败 ${fileName}: ${(e as Error).message}`);
              }
            }
          }
        }
      }

      // 处理评论图片
      for (const comment of item.comments) {
        for (let i = 0; i < comment.imageUrls.length; i++) {
          const url = comment.imageUrls[i];
          if (url.startsWith('./media/comment_')) {
            const fileName = url.replace('./media/', '');
            if (!added.has(fileName)) {
              added.add(fileName);
              const localPath = path.join(mediaDir, fileName);
              if (fs.existsSync(localPath)) {
                try {
                  const buffer = fs.readFileSync(localPath);
                  if (buffer && buffer.length > 0) {
                    archive.append(buffer, { name: `media/${fileName}` });
                    count += 1;
                  }
                } catch {
                  // 跳过
                }
              } else {
                // 本地没有，尝试从远程下载
                const remoteUrl = this.getRemoteCommentImageUrl(comment, i);
                if (remoteUrl) {
                  try {
                    const buffer = await this.downloadImage(remoteUrl);
                    if (buffer && buffer.length > 0) {
                      archive.append(buffer, { name: `media/${fileName}` });
                      count += 1;
                    }
                  } catch {
                    // 跳过
                  }
                }
              }
            }
          }
        }
        for (const child of comment.children) {
          for (let i = 0; i < child.imageUrls.length; i++) {
            const url = child.imageUrls[i];
            if (url.startsWith('./media/comment_')) {
              const fileName = url.replace('./media/', '');
              if (!added.has(fileName)) {
                added.add(fileName);
                const localPath = path.join(mediaDir, fileName);
                if (fs.existsSync(localPath)) {
                  try {
                    const buffer = fs.readFileSync(localPath);
                    if (buffer && buffer.length > 0) {
                      archive.append(buffer, { name: `media/${fileName}` });
                      count += 1;
                    }
                  } catch {
                    // 跳过
                  }
                } else {
                  const remoteUrl = this.getRemoteCommentImageUrl(child, i);
                  if (remoteUrl) {
                    try {
                      const buffer = await this.downloadImage(remoteUrl);
                      if (buffer && buffer.length > 0) {
                        archive.append(buffer, { name: `media/${fileName}` });
                        count += 1;
                      }
                    } catch {
                      // 跳过
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    return count;
  }

  private getRemoteCoverUrl(item: StaticExportItem): string | null {
    for (const img of item.images) {
      if (img && img.startsWith('http')) return img;
    }
    return null;
  }

  private getRemoteCommentImageUrl(comment: StaticExportComment, idx: number): string | null {
    const remoteUrls = (comment as StaticExportComment & { remoteImageUrls?: string[] }).remoteImageUrls;
    if (!remoteUrls || remoteUrls.length === 0) return null;
    return remoteUrls[idx] ?? remoteUrls[0] ?? null;
  }

  private async downloadImage(url: string): Promise<Buffer | null> {
    if (!url) return null;
    try {
      const urlObj = new URL(url);
      const isHttps = urlObj.protocol === 'https:';
      const httpModule = await import(isHttps ? 'https' : 'http');

      const buffer: Buffer = await new Promise<Buffer>((resolve, reject) => {
        const req = httpModule.request(
          {
            hostname: urlObj.hostname,
            port: urlObj.port,
            path: urlObj.pathname + urlObj.search,
            method: 'GET',
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              Referer: 'https://xiaoheihe.cn/',
            },
            timeout: 15000,
          },
          (res) => {
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
              resolve(Buffer.alloc(0));
              return;
            }
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('end', () => resolve(Buffer.concat(chunks)));
          },
        );
        req.on('error', (err: Error) => reject(err));
        req.on('timeout', () => req.destroy(new Error('timeout')));
        req.end();
      });

      return buffer.length > 0 ? buffer : null;
    } catch {
      return null;
    }
  }

  /**
   * 从小黑盒富文本数组中提取纯文本正文
   * 小黑盒帖子的完整正文在 text 字段，是一个 JSON 数组，包含文本和图片
   * 格式：[{"text":"...","type":"text"}, {"height":"...","type":"img","url":"...","width":"..."}]
   */
  private extractTextFromRichText(textField: any): string | null {
    if (!textField) return null;

    try {
      let richTextArray: any[];
      if (typeof textField === 'string') {
        richTextArray = JSON.parse(textField);
      } else if (Array.isArray(textField)) {
        richTextArray = textField;
      } else {
        return null;
      }

      if (!Array.isArray(richTextArray) || richTextArray.length === 0) {
        return null;
      }

      const textParts: string[] = [];
      for (const item of richTextArray) {
        if (item && item.type === 'text' && typeof item.text === 'string') {
          // 清理文本，去掉多余的空格和换行
          const cleanedText = item.text
            .replace(/^[\s\n]+/, '')
            .replace(/[\s\n]+$/, '')
            .replace(/\n{3,}/g, '\n\n');
          if (cleanedText.length > 0) {
            textParts.push(cleanedText);
          }
        }
      }

      if (textParts.length === 0) return null;
      return textParts.join('\n\n');
    } catch (e) {
      this.logger.warn(`解析富文本失败: ${(e as Error).message}`);
      return null;
    }
  }
}
