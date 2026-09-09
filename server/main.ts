import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { join } from 'path';
import { __express as hbsExpressEngine } from 'hbs';
import express from 'express';
import cookieParser from 'cookie-parser';

import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  logger.log('开始初始化应用...');

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    abortOnError: process.env.NODE_ENV !== 'development',
  });

  logger.log('NestFactory 创建成功，开始配置中间件...');

  const host = process.env.SERVER_HOST || 'localhost';
  const port = Number(process.env.SERVER_PORT || process.env.PORT || '3000');

  // 基础中间件（替代飞书 configureApp，绕过平台认证/CSRF）
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));
  app.use(cookieParser());

  // 启用 CORS（本地开发用）
  app.enableCors();

  // 全局 ValidationPipe
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));

  logger.log('中间件配置完成，开始配置静态资源...');

  // 静态资源：必须在路由之前注册，否则会被 view.controller 的 * 通配符拦截
  const clientDir = join(process.cwd(), 'dist/client');
  app.use('/assets', express.static(join(clientDir, 'assets')));
  app.use('/favicon.svg', express.static(join(clientDir, 'favicon.svg')));

  // 本地归档图片（帖子正文图片、评论图片）
  const mediaDir = join(process.cwd(), 'media');
  app.use('/media', express.static(mediaDir));

  // 注册视图引擎, 渲染 client 目录下的 html 文件
  app.setBaseViewsDir(clientDir);
  app.setViewEngine('html');
  app.engine('html', hbsExpressEngine);

  logger.log('静态资源配置完成，开始启动服务器...');

  await app.listen(port, host);
  logger.log(`Server running on http://${host}:${port}`);
  logger.log(`API endpoints ready at http://${host}:${port}/api`);
  logger.log(`Open http://${host}:${port}/app/ in your browser`);
  logger.log('应用启动完成！');
}

bootstrap().catch((err) => {
  console.error('应用启动失败:', err);
  process.exit(1);
});
