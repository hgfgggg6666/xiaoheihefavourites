import { useState, useEffect, useMemo } from 'react';
import dayjs from 'dayjs';
import { logger } from '@lark-apaas/client-toolkit/logger';
import {
  MessageSquare,
  ThumbsUp,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Filter,
  AlertTriangle,
  User,
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Image } from '@/components/ui/image';
import { commentsApi } from '@client/src/api';
import type { ArchiveComment, ListCommentsResponse } from '@shared/api.interface';

interface CommentSectionProps {
  linkid: string;
  totalFloorNum?: number;
}

interface RootCommentWithChildren extends ArchiveComment {
  children: ArchiveComment[];
}

export default function CommentSection({ linkid, totalFloorNum }: CommentSectionProps) {
  const [loading, setLoading] = useState<boolean>(false);
  const [comments, setComments] = useState<RootCommentWithChildren[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [crawlStatus, setCrawlStatus] = useState<string>('none');
  const [sort, setSort] = useState<'floor' | 'hot'>('floor');
  const [authorOnly, setAuthorOnly] = useState<boolean>(false);
  const [refetching, setRefetching] = useState<boolean>(false);
  const [crawlLoading, setCrawlLoading] = useState<boolean>(false);

  const fetchComments = async (silent: boolean = false) => {
    if (!silent) setLoading(true);
    try {
      const data: ListCommentsResponse = await commentsApi.listComments(linkid, sort);
      setComments(data.rootComments as RootCommentWithChildren[]);
      setTotal(data.total);
      setCrawlStatus(data.crawlStatus ?? 'none');
    } catch (err: unknown) {
      logger.error(`load comments failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    if (linkid) {
      fetchComments();
    }
  }, [linkid, sort]);

  const handleRefetchComments = async () => {
    setRefetching(true);
    try {
      await fetchComments(true);
    } finally {
      setRefetching(false);
    }
  };

  const handleReCrawl = async () => {
    setCrawlLoading(true);
    try {
      await commentsApi.startCommentCrawl('single', linkid);
      let retries = 0;
      const maxRetries = 30;
      const interval = 1500;
      while (retries < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, interval));
        const status = await commentsApi.getCommentCrawlStatus();
        if (status.job && status.job.status === 'running') {
          retries += 1;
          continue;
        }
        break;
      }
      await fetchComments(true);
    } catch (err: unknown) {
      logger.error(`re-crawl comments failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setCrawlLoading(false);
    }
  };

  const filteredComments = useMemo(() => {
    let result = comments;
    if (authorOnly) {
      result = result.filter((c) => c.isAuthor);
    }
    if (sort === 'hot') {
      return [...result].sort((a, b) => b.up - a.up);
    }
    return result;
  }, [comments, authorOnly, sort]);

  const displayedTotal = totalFloorNum != null ? totalFloorNum : total;

  return (
    <div className="border-t pt-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-muted-foreground" />
          <span className="font-semibold text-sm">
            评论区
            <span className="ml-1 text-xs text-muted-foreground">
              ({displayedTotal ?? 0})
            </span>
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs gap-1 px-2"
            onClick={() => setSort(sort === 'floor' ? 'hot' : 'floor')}
          >
            <Filter className="h-3.5 w-3.5" />
            {sort === 'floor' ? '按楼层' : '按热度'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={`h-7 text-xs gap-1 px-2 ${authorOnly ? 'bg-primary/10 text-primary' : ''}`}
            onClick={() => setAuthorOnly(!authorOnly)}
          >
            只看作者
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs gap-1 px-2"
            onClick={handleRefetchComments}
            disabled={refetching}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refetching ? 'animate-spin' : ''}`} />
            刷新
          </Button>
        </div>
      </div>

      {crawlStatus === 'captcha' && (
        <div className="mb-3 flex items-center justify-between rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
          <div className="flex items-center gap-2 text-amber-700 text-xs">
            <AlertTriangle className="h-4 w-4" />
            <span>评论抓取受限（触发风控验证码），可点击重试</span>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs border-amber-300 text-amber-700 hover:bg-amber-100"
            onClick={handleReCrawl}
            disabled={crawlLoading}
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1 ${crawlLoading ? 'animate-spin' : ''}`} />
            重新抓取
          </Button>
        </div>
      )}

      {crawlStatus === 'none' && (
        <div className="mb-3 flex items-center justify-between rounded-md border border-muted bg-muted/20 px-3 py-2">
          <span className="text-xs text-muted-foreground">暂无评论，点击抓取</span>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={handleReCrawl}
            disabled={crawlLoading}
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1 ${crawlLoading ? 'animate-spin' : ''}`} />
            抓取评论
          </Button>
        </div>
      )}

      {loading && total === 0 ? (
        <div className="py-6 text-center text-xs text-muted-foreground">加载中...</div>
      ) : filteredComments.length === 0 ? (
        <div className="py-8 text-center text-xs text-muted-foreground">
          {authorOnly ? '楼主暂无评论' : '还没有评论'}
        </div>
      ) : (
        <div className="space-y-3">
          {filteredComments.map((comment) => (
            <CommentItem
              key={comment.commentid}
              comment={comment}
              children={comment.children ?? []}
              authorOnly={authorOnly}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface CommentItemProps {
  comment: ArchiveComment;
  children: ArchiveComment[];
  authorOnly: boolean;
}

function CommentItem({ comment, children, authorOnly }: CommentItemProps) {
  const [expanded, setExpanded] = useState<boolean>(false);
  const displayChildren = authorOnly
    ? children.filter((c) => c.isAuthor)
    : children;
  const initialShow = 3;
  const hasMoreChildren = displayChildren.length > initialShow;
  const visibleChildren = expanded ? displayChildren : displayChildren.slice(0, initialShow);

  return (
    <div className="flex gap-2.5">
      <Avatar className="h-9 w-9 flex-shrink-0">
        {comment.userAvatar ? (
          <AvatarImage src={comment.userAvatar} alt={comment.username ?? ''} />
        ) : null}
        <AvatarFallback>
          <User className="h-4 w-4" />
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-foreground">
            {comment.username ?? '匿名用户'}
          </span>
          {comment.userLevel != null && (
            <span className="inline-flex items-center rounded-full bg-orange-100 px-1.5 h-4 text-[10px] font-medium text-orange-600">
              Lv.{comment.userLevel}
            </span>
          )}
          {comment.isAuthor && (
            <span className="inline-flex items-center rounded-full bg-primary/10 px-1.5 h-4 text-[10px] font-medium text-primary">
              楼主
            </span>
          )}
        </div>

        {comment.text && (
          <p className="mt-1 text-sm leading-relaxed text-foreground whitespace-pre-wrap break-words">
            {comment.text}
          </p>
        )}

        {comment.imageUrls && comment.imageUrls.length > 0 && (
          <div className="mt-2 grid grid-cols-3 gap-1.5 max-w-[320px]">
            {comment.imageUrls.map((img: string, idx: number) => {
              const src =
                comment.localImagePaths && comment.localImagePaths[idx]
                  ? comment.localImagePaths[idx]
                  : img;
              return (
                <div
                  key={idx}
                  className="aspect-square overflow-hidden rounded-sm bg-muted"
                >
                  <Image
                    src={src}
                    alt={`评论配图 ${idx + 1}`}
                    className="w-full h-full object-cover"
                    sizes="100px"
                  />
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-1.5 flex items-center gap-3 text-xs text-muted-foreground">
          {comment.floor != null && (
            <span>#{comment.floor}</span>
          )}
          {comment.createAt && (
            <span>{dayjs(comment.createAt).format('YYYY-MM-DD HH:mm')}</span>
          )}
          <span className="flex items-center gap-1">
            <ThumbsUp className="h-3 w-3" />
            {comment.up}
          </span>
        </div>

        {displayChildren.length > 0 && (
          <div className="mt-2 rounded-md bg-muted/30 p-2.5 space-y-2">
            {visibleChildren.map((child: ArchiveComment) => (
              <div key={child.commentid} className="text-sm leading-relaxed">
                <span className="font-medium text-foreground">
                  {child.username ?? '匿名用户'}
                </span>
                {child.replyUsername && (
                  <span className="text-muted-foreground">
                    {' '}回复 @{child.replyUsername}
                  </span>
                )}
                <span className="text-foreground">：{child.text}</span>
              </div>
            ))}
            {hasMoreChildren && (
              <button
                type="button"
                onClick={() => setExpanded(!expanded)}
                className="flex items-center gap-1 text-xs text-primary hover:underline"
              >
                {expanded ? (
                  <>
                    <ChevronUp className="h-3 w-3" />
                    收起回复
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-3 w-3" />
                    展开更多 {displayChildren.length - initialShow} 条回复
                  </>
                )}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
