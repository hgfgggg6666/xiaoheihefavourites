import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { LOCAL_SQLITE_DB } from '../../database/sqlite.module';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import {
  archiveItem,
  archiveTag,
  archiveItemTag,
  archiveComment,
} from '@server/database/schema';
import {
  eq,
  and,
  count,
  desc,
  sql,
  inArray,
  like,
  isNull,
  gte,
  lt,
  asc,
} from 'drizzle-orm';
import type {
  ArchiveItem,
  ArchiveTag as ArchiveTagType,
  ArchiveItemDetail,
  ListItemsRequest,
  ListItemsResponse,
  StatsResponse,
  ExportData,
} from '@shared/api.interface';

type ArchiveItemSelect = typeof archiveItem.$inferSelect;
type ArchiveTagSelect = typeof archiveTag.$inferSelect;

@Injectable()
export class ArchivesService {
  private readonly logger = new Logger(ArchivesService.name);

  constructor(@Inject(LOCAL_SQLITE_DB) private readonly db: BetterSQLite3Database) {}

  private mapItem(row: ArchiveItemSelect, tags: ArchiveTagType[], commentCount?: number): ArchiveItem {
    const item: ArchiveItem = {
      id: row.id,
      linkid: row.linkid,
      title: row.title,
      summary: row.summary,
      category: row.category,
      shareUrl: row.shareUrl,
      coverUrl: row.coverUrl,
      localCoverPath: row.localCoverPath,
      authorName: row.authorName,
      authorAvatar: row.authorAvatar,
      originalTags: row.originalTags ?? [],
      sourceCreateAt: row.sourceCreateAt ? row.sourceCreateAt.toISOString() : null,
      aiTaggedAt: row.aiTaggedAt ? row.aiTaggedAt.toISOString() : null,
      aiTagError: row.aiTagError,
      createdAt: row.createdAt.toISOString(),
      tags,
    };
    if (commentCount != null) item.commentCount = commentCount;
    return item;
  }

  private mapTag(row: ArchiveTagSelect): ArchiveTagType {
    return {
      id: row.id,
      name: row.name,
      color: row.color,
    };
  }

  private async getTagsByItemIds(itemIds: string[]): Promise<Map<string, ArchiveTagType[]>> {
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

    const map = new Map<string, ArchiveTagType[]>();
    for (const row of rows) {
      const tag: ArchiveTagType = { id: row.tagId, name: row.tagName, color: row.tagColor };
      const existing = map.get(row.itemId);
      if (existing) {
        existing.push(tag);
      } else {
        map.set(row.itemId, [tag]);
      }
    }
    return map;
  }

  async listItems(params: ListItemsRequest): Promise<ListItemsResponse> {
    const page: number = params.page ?? 1;
    const pageSize: number = params.pageSize ?? 24;
    const offset: number = (page - 1) * pageSize;

    const conditions = [eq(archiveItem.isDeleted, false)];

    if (params.category) {
      conditions.push(eq(archiveItem.category, params.category));
    }

    if (params.search) {
      const keyword = `%${params.search}%`;
      conditions.push(
        sql`(${archiveItem.title} like ${keyword} OR ${archiveItem.summary} like ${keyword} OR ${archiveItem.authorName} like ${keyword})`
      );
    }

    if (params.untagged) {
      conditions.push(isNull(archiveItem.aiTaggedAt));
    }

    let tagFilterItemIds: string[] | null = null;
    if (params.tags && params.tags.length > 0) {
      const tagRows = await this.db
        .select({ id: archiveTag.id, name: archiveTag.name })
        .from(archiveTag)
        .where(inArray(archiveTag.name, params.tags));

      if (tagRows.length < params.tags.length) {
        return { items: [], total: 0, page, pageSize };
      }

      const tagIds = tagRows.map((t) => t.id);
      const tagCount = params.tags.length;

      const itemIdRows = await this.db
        .select({ itemId: archiveItemTag.itemId })
        .from(archiveItemTag)
        .where(inArray(archiveItemTag.tagId, tagIds))
        .groupBy(archiveItemTag.itemId)
        .having(sql`count(distinct ${archiveItemTag.tagId}) = ${tagCount}`);

      tagFilterItemIds = itemIdRows.map((r) => r.itemId);
      if (tagFilterItemIds.length === 0) {
        return { items: [], total: 0, page, pageSize };
      }
      conditions.push(inArray(archiveItem.id, tagFilterItemIds));
    }

    const whereClause = and(...conditions);

    const sortField = params.sort === 'sourceCreateAt' ? archiveItem.sourceCreateAt : archiveItem.createdAt;

    const [countResult] = await this.db
      .select({ count: count() })
      .from(archiveItem)
      .where(whereClause);

    const total: number = Number(countResult.count);

    const itemRows: ArchiveItemSelect[] = await this.db
      .select()
      .from(archiveItem)
      .where(whereClause)
      .orderBy(desc(sortField))
      .limit(pageSize)
      .offset(offset);

    const itemIds = itemRows.map((row) => row.id);
    const linkids = itemRows.map((row) => row.linkid);
    const tagsByItem = await this.getTagsByItemIds(itemIds);
    const commentCountByLink = await this.getCommentCountByLinkids(linkids);

    const items: ArchiveItem[] = itemRows.map((row) =>
      this.mapItem(row, tagsByItem.get(row.id) ?? [], commentCountByLink.get(row.linkid))
    );

    return { items, total, page, pageSize };
  }

  async getItem(id: string): Promise<ArchiveItemDetail> {
    const rows: ArchiveItemSelect[] = await this.db
      .select()
      .from(archiveItem)
      .where(and(eq(archiveItem.id, id), eq(archiveItem.isDeleted, false)));

    if (rows.length === 0) {
      throw new NotFoundException('收藏条目不存在');
    }

    const row = rows[0];
    const tagsByItem = await this.getTagsByItemIds([row.id]);
    const tags = tagsByItem.get(row.id) ?? [];

    const base = this.mapItem(row, tags);
    const rawDataVal = row.rawData as Record<string, any>;

    return {
      ...base,
      rawData: rawDataVal,
    };
  }

  async updateItemTags(id: string, tagNames: string[]): Promise<ArchiveTagType[]> {
    const existing = await this.db
      .select({ id: archiveItem.id })
      .from(archiveItem)
      .where(and(eq(archiveItem.id, id), eq(archiveItem.isDeleted, false)));

    if (existing.length === 0) {
      throw new NotFoundException('收藏条目不存在');
    }

    const uniqueNames = [...new Set(tagNames.filter((n) => n && n.trim().length > 0))];

    await this.db.delete(archiveItemTag).where(eq(archiveItemTag.itemId, id));

    const resultTags: ArchiveTagType[] = [];

    for (const name of uniqueNames) {
      let tagRows = await this.db
        .select()
        .from(archiveTag)
        .where(eq(archiveTag.name, name));

      if (tagRows.length === 0) {
        try {
          tagRows = await this.db
            .insert(archiveTag)
            .values({ name })
            .returning();
        } catch (error) {
          tagRows = await this.db
            .select()
            .from(archiveTag)
            .where(eq(archiveTag.name, name));
        }
      }

      const tag = tagRows[0];
      await this.db
        .insert(archiveItemTag)
        .values({ itemId: id, tagId: tag.id })
        .onConflictDoNothing();

      resultTags.push(this.mapTag(tag));
    }

    return resultTags;
  }

  async updateItemCategory(id: string, category: string): Promise<string> {
    const updated = await this.db
      .update(archiveItem)
      .set({ category })
      .where(and(eq(archiveItem.id, id), eq(archiveItem.isDeleted, false)))
      .returning({ id: archiveItem.id });

    if (updated.length === 0) {
      throw new NotFoundException('收藏条目不存在');
    }

    return category;
  }

  async deleteItem(id: string): Promise<void> {
    const updated = await this.db
      .update(archiveItem)
      .set({ isDeleted: true })
      .where(and(eq(archiveItem.id, id), eq(archiveItem.isDeleted, false)))
      .returning({ id: archiveItem.id });

    if (updated.length === 0) {
      throw new NotFoundException('收藏条目不存在');
    }
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
        ),
      )
      .groupBy(archiveComment.linkid);

    const map = new Map<string, number>();
    for (const row of rows) {
      map.set(row.linkid, Number(row.count));
    }
    return map;
  }

  async listTags(): Promise<ArchiveTagType[]> {
    const rows = await this.db
      .select({
        id: archiveTag.id,
        name: archiveTag.name,
        color: archiveTag.color,
        _count: count(archiveItemTag.itemId),
      })
      .from(archiveTag)
      .leftJoin(
        archiveItemTag,
        and(
          eq(archiveItemTag.tagId, archiveTag.id),
          sql`${archiveItemTag.itemId} IN (SELECT ${archiveItem.id} FROM ${archiveItem} WHERE ${archiveItem.isDeleted} = false)`
        )
      )
      .groupBy(archiveTag.id)
      .orderBy(desc(count(archiveItemTag.itemId)));

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      color: row.color,
      count: Number(row._count),
    }));
  }

  async renameTag(tagId: string, newName: string): Promise<ArchiveTagType> {
    if (!newName || newName.trim().length === 0) {
      throw new BadRequestException('标签名称不能为空');
    }

    const existing = await this.db
      .select({ id: archiveTag.id })
      .from(archiveTag)
      .where(eq(archiveTag.name, newName));

    if (existing.length > 0 && existing[0].id !== tagId) {
      throw new ConflictException('标签名称已存在');
    }

    const updated = await this.db
      .update(archiveTag)
      .set({ name: newName })
      .where(eq(archiveTag.id, tagId))
      .returning();

    if (updated.length === 0) {
      throw new NotFoundException('标签不存在');
    }

    return this.mapTag(updated[0]);
  }

  async deleteTag(tagId: string): Promise<void> {
    const deleted = await this.db
      .delete(archiveTag)
      .where(eq(archiveTag.id, tagId))
      .returning({ id: archiveTag.id });

    if (deleted.length === 0) {
      throw new NotFoundException('标签不存在');
    }
  }

  async getStats(): Promise<StatsResponse> {
    const [totalResult] = await this.db
      .select({ count: count() })
      .from(archiveItem)
      .where(eq(archiveItem.isDeleted, false));

    const [tagsResult] = await this.db
      .select({ count: count() })
      .from(archiveTag);

    const [untaggedResult] = await this.db
      .select({ count: count() })
      .from(archiveItem)
      .where(and(eq(archiveItem.isDeleted, false), isNull(archiveItem.aiTaggedAt)));

    const categoryRows = await this.db
      .select({
        category: archiveItem.category,
        _count: count(),
      })
      .from(archiveItem)
      .where(
        and(
          eq(archiveItem.isDeleted, false),
          sql`${archiveItem.category} IS NOT NULL AND ${archiveItem.category} <> ''`
        )
      )
      .groupBy(archiveItem.category)
      .orderBy(desc(count()));

    return {
      totalItems: Number(totalResult.count),
      totalTags: Number(tagsResult.count),
      untaggedCount: Number(untaggedResult.count),
      categoryCounts: categoryRows.map((row) => ({
        category: row.category as string,
        count: Number(row._count),
      })),
    };
  }

  async exportAll(): Promise<ExportData> {
    const itemRows: ArchiveItemSelect[] = await this.db
      .select()
      .from(archiveItem)
      .where(eq(archiveItem.isDeleted, false))
      .orderBy(desc(archiveItem.createdAt));

    const itemIds = itemRows.map((row) => row.id);
    const tagsByItem = await this.getTagsByItemIds(itemIds);

    const allTagSet = new Set<string>();
    for (const tags of tagsByItem.values()) {
      for (const tag of tags) {
        allTagSet.add(tag.id);
      }
    }

    const items: ArchiveItemDetail[] = itemRows.map((row) => {
      const base = this.mapItem(row, tagsByItem.get(row.id) ?? []);
      return {
        ...base,
        rawData: row.rawData as Record<string, any>,
      };
    });

    const tagRows: ArchiveTagSelect[] = await this.db
      .select()
      .from(archiveTag)
      .orderBy(asc(archiveTag.name));

    const tags: ArchiveTagType[] = tagRows.map((row) => this.mapTag(row));

    return {
      items,
      tags,
      exportedAt: new Date().toISOString(),
    };
  }
}
