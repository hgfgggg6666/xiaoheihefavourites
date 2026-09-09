import { Controller, Get, Post, Body } from '@nestjs/common';
import type { StartSyncResponse, SyncJob } from '@shared/api.interface';
import { HeyboxService } from './heybox.service';

interface StartSyncBody {
  fullRebuild?: boolean;
}

@Controller('api/heybox')
export class HeyboxController {
  constructor(private readonly heyboxService: HeyboxService) {}
  @Post('sync')
  async startSync(@Body() body: StartSyncBody): Promise<StartSyncResponse> {
    const jobId: string = await this.heyboxService.startSync(
      body.fullRebuild ?? false,
    );
    return { jobId };
  }
  @Get('sync-status')
  async getSyncStatus(): Promise<SyncJob | null> {
    return this.heyboxService.getLatestJob();
  }
  @Post('image-archive')
  async startImageArchive(): Promise<StartSyncResponse> {
    const jobId: string = await this.heyboxService.startImageArchive();
    return { jobId };
  }
  @Get('image-archive-status')
  async getImageArchiveStatus(): Promise<SyncJob | null> {
    return this.heyboxService.getLatestJobByType('image_archive');
  }
}
