import { Body, Controller, Get, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { SettingsService } from './settings.service';
import type {
  SettingsResponse,
  UpdateSettingsRequest,
  TestHeyboxResponse,
  TestOpenaiResponse,
} from '@shared/api.interface';

@Controller('api/settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}
  @Get()
  async getSettings(@Req() _req: Request): Promise<SettingsResponse> {
    return this.settingsService.getSettings();
  }
  @Patch()
  async updateSettings(
    @Req() _req: Request,
    @Body() dto: UpdateSettingsRequest,
  ): Promise<SettingsResponse> {
    return this.settingsService.updateSettings(dto);
  }
  @Post('test-heybox')
  async testHeybox(@Req() _req: Request): Promise<TestHeyboxResponse> {
    return this.settingsService.testHeybox();
  }
  @Post('test-openai')
  async testOpenai(@Req() _req: Request): Promise<TestOpenaiResponse> {
    return this.settingsService.testOpenai();
  }
}
