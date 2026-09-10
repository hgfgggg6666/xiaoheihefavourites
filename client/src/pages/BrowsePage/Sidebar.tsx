import { useState } from 'react';
import { logger } from '@lark-apaas/client-toolkit/logger';
import {
  Inbox,
  Tag,
  RefreshCw,
  Sparkles,
  Download,
  Folder,
  ChevronDown,
  ChevronUp,
  ImageDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { heyboxApi, aiTagApi, archivesApi, commentsApi, staticExportApi } from '@client/src/api';
import type { StatsResponse, ArchiveTag, SyncJob } from '@shared/api.interface';

interface SidebarProps {
  stats: StatsResponse | null;
  tags: ArchiveTag[];
  selectedCategory: string | null;
  selectedTags: string[];
  untagged: boolean;
  onCategoryChange: (cat: string | null) => void;
  onTagToggle: (tag: string) => void;
  onUntaggedToggle: () => void;
  onAllClick: () => void;
  onStatsRefresh: () => void;
  onTagsRefresh: () => void;
}

const TAG_PREVIEW_COUNT = 30;

export default function Sidebar({
  stats,
  tags,
  selectedCategory,
  selectedTags,
  untagged,
  onCategoryChange,
  onTagToggle,
  onUntaggedToggle,
  onAllClick,
  onStatsRefresh,
  onTagsRefresh,
}: SidebarProps) {
  const [showAllTags, setShowAllTags] = useState<boolean>(false);
  const [syncProgress, setSyncProgress] = useState<SyncJob | null>(null);
  const [tagProgress, setTagProgress] = useState<SyncJob | null>(null);
  const [imgProgress, setImgProgress] = useState<SyncJob | null>(null);
  const [syncLoading, setSyncLoading] = useState<boolean>(false);
  const [tagLoading, setTagLoading] = useState<boolean>(false);
  const [imgLoading, setImgLoading] = useState<boolean>(false);
  const [commentProgress, setCommentProgress] = useState<SyncJob | null>(null);
  const [commentLoading, setCommentLoading] = useState(false);
  const [staticExportLoading, setStaticExportLoading] = useState(false);
  const [staticExportStatus, setStaticExportStatus] = useState<string | null>(null);

  const pollSync = useSyncPolling('heybox', setSyncProgress);
  const pollTag = useSyncPolling('aiTag', setTagProgress);
  const pollImg = useSyncPolling('imageArchive', setImgProgress);
  const pollComment = useSyncPolling('commentCrawl', setCommentProgress);

  const handleStaticExport = () => {
    if (staticExportLoading || staticExportStatus === 'exporting') return;
    setStaticExportLoading(true);
    setStaticExportStatus('exporting');
    try {
      staticExportApi.downloadStaticSite();
      const checkInterval = window.setInterval(() => {
        void staticExportApi.getStaticExportStatus().then((res) => {
          const job = res.job;
          if (job) {
            if (job.status === 'success') {
              setStaticExportStatus('success');
              window.clearInterval(checkInterval);
              window.setTimeout(() => setStaticExportStatus(null), 5000);
            } else if (job.status === 'failed') {
              setStaticExportStatus('failed');
              window.clearInterval(checkInterval);
              window.setTimeout(() => setStaticExportStatus(null), 5000);
            } else if (job.status === 'running') {
              setStaticExportStatus(`导出中 ${job.processed}/${job.total}`);
            }
          }
        }).catch(() => {
          // 忽略轮询错误
        });
      }, 2000);
      window.setTimeout(() => {
        window.clearInterval(checkInterval);
        if (staticExportStatus === 'exporting') setStaticExportStatus(null);
      }, 120000);
    } catch (err: unknown) {
      logger.error(`static export failed: ${err instanceof Error ? err.message : String(err)}`);
      setStaticExportStatus('failed');
    } finally {
      setStaticExportLoading(false);
    }
  };

  const handleSync = async () => {
    if (syncLoading) return;
    setSyncLoading(true);
    try {
      await heyboxApi.startSync(false);
      pollSync.start();
      onStatsRefresh();
    } catch (err: unknown) {
      logger.error(`sync failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSyncLoading(false);
    }
  };

  const handleBatchTag = async () => {
    if (tagLoading) return;
    setTagLoading(true);
    try {
      await aiTagApi.startBatchTag();
      pollTag.start();
      onTagsRefresh();
      onStatsRefresh();
    } catch (err: unknown) {
      logger.error(`batch tag failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setTagLoading(false);
    }
  };

  const handleExport = async () => {
    try {
      const data = await archivesApi.exportAll();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `heybox-archive-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      logger.error(`export failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleImageArchive = async () => {
    if (imgLoading) return;
    setImgLoading(true);
    try {
      await heyboxApi.startImageArchive();
      pollImg.start();
    } catch (err: unknown) {
      logger.error(`image archive failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setImgLoading(false);
    }
  };

  const handleCommentCrawl = async () => {
    if (commentLoading) return;
    setCommentLoading(true);
    try {
      await commentsApi.startCommentCrawl('uncrawled');
      pollComment.start();
    } catch (err: unknown) {
      logger.error(`comment crawl failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setCommentLoading(false);
    }
  };

  const sortedCategories = [...(stats?.categoryCounts ?? [])].sort(
    (a, b) => b.count - a.count,
  );
  const displayedTags = showAllTags ? tags : tags.slice(0, TAG_PREVIEW_COUNT);

  return (
    <aside className="flex h-[100dvh] w-[260px] shrink-0 flex-col border-r border-border/50 bg-sidebar">
      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col gap-1 p-3">
          {/* 快速筛选 */}
          <SidebarSectionLabel>快速筛选</SidebarSectionLabel>
          <SidebarItem
            icon={<Inbox className="h-4 w-4" />}
            label="全部收藏"
            count={stats?.totalItems ?? 0}
            active={!selectedCategory && !untagged && selectedTags.length === 0}
            onClick={onAllClick}
          />
          <SidebarItem
            icon={<Tag className="h-4 w-4" />}
            label="未分类"
            count={stats?.untaggedCount ?? 0}
            active={untagged}
            onClick={onUntaggedToggle}
          />
        </div>

        {/* 分类 */}
        <div className="flex flex-col gap-1 px-3 pb-3">
          <SidebarSectionLabel>分类</SidebarSectionLabel>
          {sortedCategories.length === 0 ? (
            <p className="px-2 py-1 text-xs text-muted-foreground">暂无分类</p>
          ) : (
            sortedCategories.map((c) => (
              <SidebarItem
                key={c.category}
                icon={<Folder className="h-4 w-4" />}
                label={c.category}
                count={c.count}
                active={selectedCategory === c.category}
                onClick={() => onCategoryChange(selectedCategory === c.category ? null : c.category)}
              />
            ))
          )}
        </div>

        {/* 标签云 */}
        <div className="flex flex-col gap-2 px-3 pb-3">
          <SidebarSectionLabel>标签</SidebarSectionLabel>
          {tags.length === 0 ? (
            <p className="px-2 py-1 text-xs text-muted-foreground">暂无标签</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5">
                {displayedTags.map((tag) => {
                  const selected = selectedTags.includes(tag.name);
                  return (
                    <Tooltip key={tag.id}>
                      <TooltipTrigger asChild>
                        <Badge
                          variant={selected ? 'default' : 'outline'}
                          className="cursor-pointer"
                          onClick={() => onTagToggle(tag.name)}
                          style={
                            selected
                              ? { backgroundColor: tag.color, borderColor: tag.color }
                              : { color: tag.color }
                          }
                        >
                          {tag.name}
                          {tag.count !== undefined && (
                            <span className="ml-1 opacity-70">{tag.count}</span>
                          )}
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent>{tag.name} · {tag.count ?? 0}</TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
              {tags.length > TAG_PREVIEW_COUNT && (
                <button
                  type="button"
                  className="flex items-center gap-1 self-start text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setShowAllTags((v) => !v)}
                >
                  {showAllTags ? (
                    <><ChevronUp className="h-3 w-3" /> 收起</>
                  ) : (
                    <><ChevronDown className="h-3 w-3" /> 查看全部</>
                  )}
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* 操作区 */}
      <div className="flex flex-col gap-2 border-t border-sidebar-border p-3">
        <Button
          variant="secondary"
          size="sm"
          className="w-full justify-start"
          onClick={handleSync}
          disabled={syncLoading || syncProgress?.status === 'running'}
        >
          <RefreshCw className={`h-4 w-4 ${syncProgress?.status === 'running' ? 'animate-spin' : ''}`} />
          {syncProgress?.status === 'running'
            ? `同步中 ${syncProgress.processed}/${syncProgress.total}`
            : '同步收藏'}
        </Button>
        {/* 同步实时进度 */}
        {syncProgress && (syncProgress.status === 'running' || syncProgress.status === 'success') && (
          <div className="rounded-md bg-muted/50 p-2 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium">
                {syncProgress.status === 'running' ? '同步进行中' : '同步完成'}
              </span>
              <span className="text-muted-foreground">
                {syncProgress.total > 0
                  ? `${Math.round((syncProgress.processed / syncProgress.total) * 100)}%`
                  : '0%'}
              </span>
            </div>
            {/* 进度条 */}
            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  syncProgress.status === 'success' ? 'bg-green-500' : 'bg-primary'
                }`}
                style={{
                  width: syncProgress.total > 0
                    ? `${Math.min(100, (syncProgress.processed / syncProgress.total) * 100)}%`
                    : '0%',
                }}
              />
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {syncProgress.processed}/{syncProgress.total} 条
              </span>
              <span className="flex items-center gap-2">
                <span className="text-green-600">✓ {syncProgress.successCount || 0}</span>
                {(syncProgress.failCount || 0) > 0 && (
                  <span className="text-red-500">✗ {syncProgress.failCount}</span>
                )}
              </span>
            </div>
          </div>
        )}
        <Button
          variant="secondary"
          size="sm"
          className="w-full justify-start"
          onClick={handleBatchTag}
          disabled={tagLoading || tagProgress?.status === 'running'}
        >
          <Sparkles className={`h-4 w-4 ${tagProgress?.status === 'running' ? 'animate-spin' : ''}`} />
          {tagProgress?.status === 'running'
            ? `打标中 ${tagProgress.processed}/${tagProgress.total}`
            : '批量打标'}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start"
          onClick={handleExport}
        >
          <Download className="h-4 w-4" />
          导出数据
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start"
          onClick={handleImageArchive}
          disabled={imgLoading || imgProgress?.status === 'running'}
        >
          <ImageDown className={`h-4 w-4 ${imgProgress?.status === 'running' ? 'animate-spin' : ''}`} />
          {imgProgress?.status === 'running'
            ? `归档图片 ${imgProgress.processed}/${imgProgress.total}`
            : '下载图片到本地'}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start"
          onClick={handleCommentCrawl}
          disabled={commentLoading || commentProgress?.status === 'running'}
        >
          <RefreshCw className={`h-4 w-4 ${commentProgress?.status === 'running' ? 'animate-spin' : ''}`} />
          {commentProgress?.status === 'running'
            ? `抓取评论 ${commentProgress.processed}/${commentProgress.total}`
            : commentProgress?.status === 'success'
              ? '评论抓取完成'
              : '抓取评论'}
        </Button>
        <Button
          variant="default"
          size="sm"
          className="w-full justify-start"
          onClick={handleStaticExport}
          disabled={staticExportLoading || staticExportStatus === 'exporting' || (!!staticExportStatus && staticExportStatus.startsWith('导出中'))}
        >
          <Download className={`h-4 w-4 ${(staticExportStatus && staticExportStatus.startsWith('导出中')) ? 'animate-spin' : ''}`} />
          {staticExportStatus === 'success'
            ? '导出成功'
            : staticExportStatus === 'failed'
              ? '导出失败'
              : staticExportStatus && staticExportStatus.startsWith('导出中')
                ? staticExportStatus
                : '导出静态站点'}
        </Button>
      </div>
    </aside>
  );
}

function SidebarSectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground">
      {children}
    </p>
  );
}

interface SidebarItemProps {
  icon: React.ReactNode;
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}

function SidebarItem({ icon, label, count, active, onClick }: SidebarItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-sidebar-accent/60 ${
        active
          ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
          : 'text-sidebar-foreground'
      }`}
    >
      <span className="shrink-0">{icon}</span>
      <span className="flex-1 truncate text-left">{label}</span>
      <span className="text-xs text-muted-foreground">{count}</span>
    </button>
  );
}

// ---- sync polling hook ----
import { useEffect, useRef, useCallback } from 'react';

type SyncApiKey = 'heybox' | 'aiTag' | 'imageArchive' | 'commentCrawl';

function useSyncPolling(
  apiKey: SyncApiKey,
  setProgress: (job: SyncJob | null) => void,
) {
  const intervalRef = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const tick = useCallback(async () => {
    try {
      let job: SyncJob | null = null;
      if (apiKey === 'heybox') {
        job = await heyboxApi.getSyncStatus();
      } else if (apiKey === 'aiTag') {
        job = await aiTagApi.getTagStatus();
      } else if (apiKey === 'imageArchive') {
        job = await heyboxApi.getImageArchiveStatus();
      } else {
        job = await commentsApi.getCommentCrawlStatus().then((r) => r.job);
      }
      setProgress(job);
      if (job && job.status !== 'running' && job.status !== 'pending') {
        stop();
      }
    } catch (err: unknown) {
      logger.error(`poll ${apiKey} failed: ${err instanceof Error ? err.message : String(err)}`);
      stop();
    }
  }, [apiKey, setProgress, stop]);

  const start = useCallback(() => {
    stop();
    void tick();
    intervalRef.current = window.setInterval(() => {
      void tick();
    }, 1000);
  }, [tick, stop]);

  useEffect(() => stop, [stop]);

  return { start, stop };
}
