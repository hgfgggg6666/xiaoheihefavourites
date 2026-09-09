import {
  Controller,
  Get,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { StaticExportService } from './static-export.service';

@Controller('api/static-export')
export class StaticExportController {
  constructor(private readonly staticExportService: StaticExportService) {}
  @Get('status')
  async getStatus() {
    return this.staticExportService.getExportJob();
  }
  @Get('download')
  async download(@Res() res: Response) {
    await this.staticExportService.streamExportZip(res);
  }
}
