import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { ArchivesService } from './archives.service';
import type {
  ArchiveItemDetail,
  ArchiveTag,
  ListItemsResponse,
  StatsResponse,
  ExportData,
  UpdateItemTagsRequest,
  UpdateItemCategoryRequest,
} from '@shared/api.interface';

@Controller('api/archives')
export class ArchivesController {
  constructor(private readonly archivesService: ArchivesService) {}
  @Get('items')
  async listItems(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('category') category?: string,
    @Query('search') search?: string,
    @Query('sort') sort?: string,
    @Query('untagged') untagged?: string,
    @Query('tags') tags?: string,
  ): Promise<ListItemsResponse> {
    const tagsArr: string[] | undefined = tags
      ? tags.split(',').filter((t) => t.trim().length > 0)
      : undefined;

    return this.archivesService.listItems({
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
      category,
      search,
      sort: (sort as 'createdAt' | 'sourceCreateAt') || undefined,
      untagged: untagged === 'true',
      tags: tagsArr,
    });
  }
  @Get('items/:id')
  async getItem(@Param('id') id: string): Promise<ArchiveItemDetail> {
    return this.archivesService.getItem(id);
  }
  @Patch('items/:id/tags')
  async updateItemTags(
    @Param('id') id: string,
    @Body() body: UpdateItemTagsRequest,
  ): Promise<{ tags: ArchiveTag[] }> {
    const tags = await this.archivesService.updateItemTags(id, body.tagNames);
    return { tags };
  }
  @Patch('items/:id/category')
  async updateItemCategory(
    @Param('id') id: string,
    @Body() body: UpdateItemCategoryRequest,
  ): Promise<{ category: string }> {
    const category = await this.archivesService.updateItemCategory(id, body.category);
    return { category };
  }
  @Delete('items/:id')
  async deleteItem(@Param('id') id: string): Promise<{ ok: true }> {
    await this.archivesService.deleteItem(id);
    return { ok: true };
  }
  @Get('tags')
  async listTags(): Promise<{ tags: ArchiveTag[] }> {
    const tags = await this.archivesService.listTags();
    return { tags };
  }
  @Patch('tags/:id')
  async renameTag(
    @Param('id') id: string,
    @Body() body: { name: string },
  ): Promise<ArchiveTag> {
    return this.archivesService.renameTag(id, body.name);
  }
  @Delete('tags/:id')
  async deleteTag(@Param('id') id: string): Promise<{ ok: true }> {
    await this.archivesService.deleteTag(id);
    return { ok: true };
  }
  @Get('stats')
  async getStats(): Promise<StatsResponse> {
    return this.archivesService.getStats();
  }
  @Get('export')
  async exportAll(): Promise<ExportData> {
    return this.archivesService.exportAll();
  }
}
