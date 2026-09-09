import { Controller, Get, Post, Param, Query, BadRequestException, Req } from '@nestjs/common';
import type { Request } from 'express';
import { CommentService } from './comment.service';
import type {
  ListCommentsResponse,
  StartCommentCrawlResponse,
  CommentCrawlStatusResponse,
} from '@shared/api.interface';

@Controller('api/comments')
export class CommentController {
  constructor(private readonly commentService: CommentService) {}

  @Get(':linkid')
  async listComments(
    @Param('linkid') linkid: string,
    @Query('sort') sort?: string,
  ): Promise<ListCommentsResponse> {
    if (!linkid) throw new BadRequestException('缺少 linkid');
    const sortMode = sort === 'hot' ? 'hot' : 'floor';
    const { rootComments, total } =
      await this.commentService.listCommentsByLinkid(linkid, sortMode);
    const crawlStatus = await this.commentService.getItemCrawlStatus(linkid);
    return { rootComments, total, crawlStatus };
  }
  @Post('crawl')
  async startCrawl(
    @Req() _req: Request,
    @Query('mode') mode?: string,
    @Query('linkid') linkid?: string,
  ): Promise<StartCommentCrawlResponse> {
    const crawlMode =
      mode === 'all'
        ? 'all'
        : mode === 'uncrawled'
          ? 'uncrawled'
          : mode === 'single' && linkid
            ? 'single'
            : 'uncrawled';
    const jobId = await this.commentService.startCommentCrawl(crawlMode as any, linkid);
    return { jobId };
  }

  @Get('crawl/status')
  async getCrawlStatus(): Promise<CommentCrawlStatusResponse> {
    const job = await this.commentService.getLatestJob();
    const captchaItems = await this.commentService.getCaptchaItemCount();
    return { job, captchaItems };
  }
  @Post('crawl/images')
  async startImageArchive(@Req() _req: Request): Promise<{ jobId: string }> {
    const jobId = await this.commentService.startCommentImageArchive();
    return { jobId };
  }

  @Get('crawl/images/status')
  async getImageArchiveStatus(): Promise<{ job: any }> {
    const job = await this.commentService.getCommentImageArchiveStatus();
    return { job };
  }
}
