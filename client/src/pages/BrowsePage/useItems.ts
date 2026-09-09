import { useState, useEffect, useCallback, useRef } from 'react';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { archivesApi } from '@client/src/api';
import type { ArchiveItem, ListItemsRequest } from '@shared/api.interface';

interface UseItemsParams extends Omit<ListItemsRequest, 'page' | 'pageSize'> {
  pageSize?: number;
}

interface UseItemsResult {
  items: ArchiveItem[];
  total: number;
  isLoading: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
  refresh: () => void;
}

export function useItems(params: UseItemsParams): UseItemsResult {
  const { category, tags, search, sort, untagged, pageSize = 24 } = params;
  const [items, setItems] = useState<ArchiveItem[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const pageRef = useRef<number>(1);
  const loadingRef = useRef<boolean>(false);

  const fetchPage = useCallback(async (page: number, append: boolean) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setIsLoading(true);
    setError(null);
    try {
      const res = await archivesApi.listItems({
        page,
        pageSize,
        category,
        tags,
        search,
        sort,
        untagged,
      });
      setTotal(res.total);
      setItems((prev: ArchiveItem[]) => (append ? [...prev, ...res.items] : res.items));
      pageRef.current = page;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '加载失败';
      setError(msg);
      logger.error(`useItems fetch failed: ${msg}`);
    } finally {
      setIsLoading(false);
      loadingRef.current = false;
    }
  }, [category, tags, search, sort, untagged, pageSize]);

  // Initial & filter change → reset
  useEffect(() => {
    fetchPage(1, false);
  }, [fetchPage]);

  const hasMore = items.length < total;

  const loadMore = useCallback(() => {
    if (!hasMore || loadingRef.current) return;
    fetchPage(pageRef.current + 1, true);
  }, [fetchPage, hasMore]);

  const refresh = useCallback(() => {
    fetchPage(1, false);
  }, [fetchPage]);

  return { items, total, isLoading, error, hasMore, loadMore, refresh };
}
