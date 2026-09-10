import { Module } from '@nestjs/common';
import { AutoSyncService } from './auto-sync.service';
import { SettingsModule } from '../settings/settings.module';
import { HeyboxModule } from '../heybox/heybox.module';

@Module({
  imports: [SettingsModule, HeyboxModule],
  providers: [AutoSyncService],
  exports: [AutoSyncService],
})
export class AutoSyncModule {}
