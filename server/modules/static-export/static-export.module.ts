import { Module } from '@nestjs/common';
import { StaticExportController } from './static-export.controller';
import { StaticExportService } from './static-export.service';

@Module({
  controllers: [StaticExportController],
  providers: [StaticExportService],
})
export class StaticExportModule {}
