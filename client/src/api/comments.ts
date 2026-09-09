import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import type {
  ListCommentsResponse,
  StartCommentCrawlResponse,
  CommentCrawlStatusResponse,
} from '@shared/api.interface';

export async function listComments(
  linkid: string,
  sort: 'floor' | 'hot' = 'floor',
): Promise<ListCommentsResponse> {
  const res = await axiosForBackend.get<ListCommentsResponse>(`/api/comments/${linkid}`, {
    params: { sort },
  });
  return res.data;
}

export async function startCommentCrawl(
  mode: 'all' | 'uncrawled' | 'single',
  linkid?: string,
): Promise<StartCommentCrawlResponse> {
  const res = await axiosForBackend.post<StartCommentCrawlResponse>(
    '/api/comments/crawl',
    null,
    { params: { mode, linkid } },
  );
  return res.data;
}

export async function getCommentCrawlStatus(): Promise<CommentCrawlStatusResponse> {
  const res = await axiosForBackend.get<CommentCrawlStatusResponse>(
    '/api/comments/crawl/status',
  );
  return res.data;
}

export async function startCommentImageArchive(): Promise<{ jobId: string }> {
  const res = await axiosForBackend.post<{ jobId: string }>(
    '/api/comments/crawl/images',
  );
  return res.data;
}

export async function getCommentImageArchiveStatus(): Promise<{ job: any }> {
  const res = await axiosForBackend.get<{ job: any }>(
    '/api/comments/crawl/images/status',
  );
  return res.data;
}
