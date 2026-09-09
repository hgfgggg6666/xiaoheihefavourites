import { Module } from '@nestjs/common';
import { HeyboxController } from './heybox.controller';
import { HeyboxService } from './heybox.service';
import { CommentController } from './comment.controller';
import { CommentService } from './comment.service';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [SettingsModule],
  controllers: [HeyboxController, CommentController],
  providers: [HeyboxService, CommentService],
  exports: [HeyboxService, CommentService],
})
export class HeyboxModule {}
