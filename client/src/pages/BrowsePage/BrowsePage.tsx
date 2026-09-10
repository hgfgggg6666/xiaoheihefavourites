import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { logger } from '@lark-apaas/client-toolkit/logger';
import {
  Search,
  LayoutGrid,
  List,
  ArrowDownUp,
  Menu,
  FolderOpen,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { archivesApi, aiTagApi } from '@client/src/api';
import Sidebar from './Sidebar';
import ItemCard from './ItemCard';
import ItemDetailModal from './ItemDetailModal';
import { useItems } from './useItems';
import type {
  StatsResponse,
  ArchiveTag,
  ArchiveItem,
  ArchiveItemDetail,
} from '@shared/api.interface';
import { showConfirm } from '@lark-apaas/client-toolkit';

type SortKey = 'createdAt' | 'sourceCreateAt';

export default function BrowsePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const [selectedCategory, setSelectedCategory] = useState<string | null>(
    searchParams.get('category'),
  );
  const [selectedTags, setSelectedTags] = useState<string[]>(
    searchParams.get('tags')?.split(',').filter(Boolean) ?? [],
  );
  const [untagged, setUntagged] = useState<boolean>(
    searchParams.get('untagged') === 'true',
  );
  const [searchInput, setSearchInput] = useState<string>(
    searchParams.get('search') ?? '',
  );
  const [sort, setSort] = useState<SortKey>(
    (searchParams.get('sort') as SortKey) ?? 'createdAt',
  );

  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [allTags, setAllTags] = useState<ArchiveTag[]>([]);
  const [detailItem, setDetailItem] = useState<ArchiveItemDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState<boolean>(false);
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(false);

  const searchDebounceRef = useRef<number | null>(null);
  const search = searchParams.get('search') ?? undefined;

  // fetch stats
  const loadStats = useCallback(async () => {
    try {
      const s = await archivesApi.getStats();
      setStats(s);
    } catch (err: unknown) {
      logger.error(`load stats failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

  // fetch tags
  const loadTags = useCallback(async () => {
    try {
      const { tags } = await archivesApi.listTags();
      // sort by count desc
      tags.sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
      setAllTags(tags);
    } catch (err: unknown) {
      logger.error(`load tags failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

  useEffect(() => {
    void loadStats();
    void loadTags();
  }, [loadStats, loadTags]);

  // items
  const { items, total, isLoading, hasMore, loadMore, refresh } = useItems({
    category: selectedCategory ?? undefined,
    tags: selectedTags.length > 0 ? selectedTags : undefined,
    search,
    sort,
    untagged,
  });

  // handle search debounce
  const handleSearchChange = (value: string) => {
    setSearchInput(value);
    if (searchDebounceRef.current !== null) {
      window.clearTimeout(searchDebounceRef.current);
    }
    searchDebounceRef.current = window.setTimeout(() => {
      const params = new URLSearchParams(searchParams);
      if (value) {
        params.set('search', value);
      } else {
        params.delete('search');
      }
      setSearchParams(params);
    }, 300);
  };

  const handleCategoryChange = useCallback((cat: string | null) => {
    setSelectedCategory(cat);
    setUntagged(false);
    const params = new URLSearchParams(searchParams);
    if (cat) params.set('category', cat);
    else params.delete('category');
    params.delete('untagged');
    setSearchParams(params);
  }, [searchParams, setSearchParams]);

  const handleTagToggle = useCallback((tag: string) => {
    setSelectedTags((prev: string[]) => {
      const next = prev.includes(tag)
        ? prev.filter((t: string) => t !== tag)
        : [...prev, tag];
      const params = new URLSearchParams(searchParams);
      if (next.length > 0) params.set('tags', next.join(','));
      else params.delete('tags');
      setSearchParams(params);
      return next;
    });
  }, [searchParams, setSearchParams]);

  const handleUntaggedToggle = useCallback(() => {
    setUntagged((prev) => {
      const next = !prev;
      const params = new URLSearchParams(searchParams);
      if (next) params.set('untagged', 'true');
      else params.delete('untagged');
      params.delete('category');
      setSearchParams(params);
      if (next) setSelectedCategory(null);
      return next;
    });
  }, [searchParams, setSearchParams]);

  const handleAllClick = useCallback(() => {
    setSelectedCategory(null);
    setSelectedTags([]);
    setUntagged(false);
    const params = new URLSearchParams(searchParams);
    params.delete('category');
    params.delete('tags');
    params.delete('untagged');
    setSearchParams(params);
  }, [searchParams, setSearchParams]);

  const handleSortChange = useCallback((val: string) => {
    setSort(val as SortKey);
    const params = new URLSearchParams(searchParams);
    params.set('sort', val);
    setSearchParams(params);
  }, [searchParams, setSearchParams]);

  const openDetail = useCallback(async (item: ArchiveItem) => {
    try {
      const detail = await archivesApi.getItem(item.id);
      setDetailItem(detail);
      setDetailOpen(true);
    } catch (err: unknown) {
      logger.error(`get detail failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

  const handleDelete = useCallback(async (item: ArchiveItem) => {
    if (!await showConfirm('确定删除这条收藏吗？')) return;
    void archivesApi
      .deleteItem(item.id)
      .then(() => {
        refresh();
        loadStats();
        loadTags();
      })
      .catch((err: unknown) => {
        logger.error(`delete failed: ${err instanceof Error ? err.message : String(err)}`);
      });
  }, [refresh, loadStats, loadTags]);

  const handleRetag = useCallback((item: ArchiveItem) => {
    void archivesApi
      .getItem(item.id)
      .then((detail) => {
        setDetailItem(detail);
        setDetailOpen(true);
        return aiTagApi.retagItem(item.id);
      })
      .then(() => {
        refresh();
        loadStats();
        loadTags();
        // refresh detail
        return archivesApi.getItem(item.id);
      })
      .then((detail) => {
        setDetailItem(detail);
      })
      .catch((err: unknown) => {
        logger.error(`retag failed: ${err instanceof Error ? err.message : String(err)}`);
      });
  }, [refresh, loadStats, loadTags]);

  const sidebarProps = useMemo(() => ({
    stats,
    tags: allTags,
    selectedCategory,
    selectedTags,
    untagged,
    onCategoryChange: handleCategoryChange,
    onTagToggle: handleTagToggle,
    onUntaggedToggle: handleUntaggedToggle,
    onAllClick: handleAllClick,
    onStatsRefresh: loadStats,
    onTagsRefresh: loadTags,
  }), [
    stats, allTags, selectedCategory, selectedTags, untagged,
    handleCategoryChange, handleTagToggle, handleUntaggedToggle,
    handleAllClick, loadStats, loadTags,
  ]);

  const showEmpty = !isLoading && items.length === 0;

  return (
    <div className="flex h-[calc(100vh-56px)]">
      {/* Desktop sidebar */}
      <div className="hidden md:block">
        <Sidebar {...sidebarProps} />
      </div>

      {/* Mobile sidebar trigger */}
      <div className="md:hidden fixed left-4 top-3 z-50">
        <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
          <SheetTrigger asChild>
            <Button variant="secondary" size="icon" className="shadow-md">
              <Menu className="h-4 w-4" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="p-0 w-[280px] h-[100dvh] overflow-hidden">
            <Sidebar {...sidebarProps} />
          </SheetContent>
        </Sheet>
      </div>

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center gap-3 border-b border-border/50 px-5 py-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              placeholder="搜索标题、摘要、标签..."
              value={searchInput}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                handleSearchChange(e.target.value)
              }
              className="pl-8"
            />
          </div>

          <div className="ml-auto flex items-center gap-2">
            <div className="hidden items-center gap-1 rounded-md border border-border/50 p-0.5 sm:flex">
              <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="网格视图">
                <LayoutGrid className="h-4 w-4 text-primary" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7 opacity-50" aria-label="列表视图">
                <List className="h-4 w-4" />
              </Button>
            </div>

            <Select value={sort} onValueChange={handleSortChange}>
              <SelectTrigger size="sm" className="w-[130px]">
                <ArrowDownUp className="h-3.5 w-3.5 text-muted-foreground" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="createdAt">同步时间</SelectItem>
                <SelectItem value="sourceCreateAt">原文时间</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Content area */}
        <div className="flex-1 overflow-auto p-5">
          {showEmpty ? (
            <EmptyState
              hasData={(stats?.totalItems ?? 0) > 0}
              onGoSettings={() => navigate('/settings')}
            />
          ) : (
            <>
              <div
                className="masonry-columns"
                style={{
                  columnCount: 'auto',
                  columnWidth: '280px',
                  columnGap: '16px',
                }}
              >
                {items.map((item: ArchiveItem) => (
                  <ItemCard
                    key={item.id}
                    item={item}
                    onClick={() => openDetail(item)}
                    onDelete={() => handleDelete(item)}
                    onRetag={() => handleRetag(item)}
                  />
                ))}
              </div>

              {isLoading && (
                <div
                  className="masonry-columns pt-4"
                  style={{
                    columnCount: 'auto',
                    columnWidth: '280px',
                    columnGap: '16px',
                  }}
                >
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="mb-4 break-inside-avoid">
                      <Skeleton className="h-40 w-full rounded-lg" />
                      <Skeleton className="mt-3 h-4 w-3/4" />
                      <Skeleton className="mt-2 h-3 w-full" />
                      <Skeleton className="mt-2 h-3 w-2/3" />
                    </div>
                  ))}
                </div>
              )}

              {hasMore && !isLoading && (
                <div className="flex justify-center py-6">
                  <Button variant="secondary" onClick={loadMore}>
                    加载更多
                  </Button>
                </div>
              )}

              {!hasMore && items.length > 0 && (
                <p className="py-6 text-center text-xs text-muted-foreground">
                  已加载全部 {total} 条
                </p>
              )}
            </>
          )}
        </div>
      </div>

      <ItemDetailModal
        item={detailItem}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        onDeleted={() => {
          refresh();
          loadStats();
          loadTags();
        }}
        onUpdated={() => {
          refresh();
          loadStats();
          loadTags();
        }}
      />
    </div>
  );
}

interface EmptyStateProps {
  hasData: boolean;
  onGoSettings: () => void;
}

function EmptyState({ hasData, onGoSettings }: EmptyStateProps) {
  if (hasData) {
    return (
      <div className="flex h-full items-center justify-center">
        <Empty className="w-full max-w-sm">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Search className="size-6" />
            </EmptyMedia>
            <EmptyTitle>没有匹配的收藏</EmptyTitle>
            <EmptyDescription>换个关键词或清空筛选试试</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }
  return (
    <div className="flex h-full items-center justify-center">
      <Empty className="w-full max-w-sm">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FolderOpen className="size-6" />
          </EmptyMedia>
          <EmptyTitle>还没有收藏</EmptyTitle>
          <EmptyDescription>
            去设置页配置小黑盒 Cookie，然后开始同步你的收藏吧
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={onGoSettings}>前往设置</Button>
        </EmptyContent>
      </Empty>
    </div>
  );
}
