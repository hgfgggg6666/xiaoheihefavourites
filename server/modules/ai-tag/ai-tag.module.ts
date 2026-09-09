import { Module } from '@nestjs/common';
import { AiTagController } from './ai-tag.controller';
import { AiTagService } from './ai-tag.service';
import { SettingsModule } from '@server/modules/settings/settings.module';

@Module({
  imports: [SettingsModule],
  controllers: [AiTagController],
  providers: [AiTagService],
})
export class AiTagModule {}
