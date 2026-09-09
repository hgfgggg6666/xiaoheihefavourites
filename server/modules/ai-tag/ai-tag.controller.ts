import { Controller, Get, Param, Post } from '@nestjs/common';

import { AiTagService } from './ai-tag.service';
import type { StartSyncResponse, SyncJob, TagResult } from '@shared/api.interface';

@Controller('api/ai-tag')
export class AiTagController {
  constructor(private readonly aiTagService: AiTagService) {}
  @Post('batch')
  async startBatchTag(): Promise<StartSyncResponse> {
    const jobId = await this.aiTagService.startBatchTag();
    return { jobId };
  }
  @Get('status')
  async getStatus(): Promise<SyncJob | null> {
    return this.aiTagService.getLatestJob();
  }
  @Post('items/:id/retag')
  async retagItem(@Param('id') itemId: string): Promise<TagResult> {
    return this.aiTagService.retagItem(itemId);
  }
}
