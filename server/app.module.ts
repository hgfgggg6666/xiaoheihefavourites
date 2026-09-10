// 禁用平台 DataPaaS 数据库模块，使用本地 SQLite
process.env.DISABLE_DATAPASS = 'true';
// 禁用平台认证（本地运行不需要）
process.env.DEPRECATED_SKIP_INIT_DB_CONNECTION = 'true';

import { APP_FILTER } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { PlatformModule } from '@lark-apaas/fullstack-nestjs-core';

import { SqliteDatabaseModule } from './database/sqlite.module';
import { GlobalExceptionFilter } from './common/filters/exception.filter';
import { ViewModule } from './modules/view/view.module';
import { SettingsModule } from './modules/settings/settings.module';
import { HeyboxModule } from './modules/heybox/heybox.module';
import { AiTagModule } from './modules/ai-tag/ai-tag.module';
import { ArchivesModule } from './modules/archives/archives.module';
import { StaticExportModule } from './modules/static-export/static-export.module';
import { AutoSyncModule } from './modules/auto-sync/auto-sync.module';

@Module({
  imports: [
    PlatformModule.forRoot({ enableCsrf: false }),
    SqliteDatabaseModule,
    // ====== @route-section: business-modules START ======
    SettingsModule,
    HeyboxModule,
    AiTagModule,
    ArchivesModule,
    StaticExportModule,
    AutoSyncModule,
    // ====== @route-section: business-modules END ======

    ViewModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
  ],
})
export class AppModule {}
