import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import type {
  ArchiveItem,
  ArchiveItemDetail,
  ArchiveTag,
  ListItemsResponse,
  ListItemsRequest,
  StatsResponse,
  ExportData,
} from '@shared/api.interface';

export async function listItems(
  params: Omit<ListItemsRequest, 'tags'> & { tags?: string[] },
): Promise<ListItemsResponse> {
  const searchParams = new URLSearchParams();
  if (params.page) searchParams.set('page', String(params.page));
  if (params.pageSize) searchParams.set('pageSize', String(params.pageSize));
  if (params.category) searchParams.set('category', params.category);
  if (params.search) searchParams.set('search', params.search);
  if (params.sort) searchParams.set('sort', params.sort);
  if (params.untagged) searchParams.set('untagged', 'true');
  if (params.tags && params.tags.length > 0) {
    searchParams.set('tags', params.tags.join(','));
  }
  const res = await axiosForBackend.get(`/api/archives/items?${searchParams.toString()}`);
  return res.data;
}

export async function getItem(id: string): Promise<ArchiveItemDetail> {
  const res = await axiosForBackend.get(`/api/archives/items/${id}`);
  return res.data;
}

export async function updateItemTags(id: string, tagNames: string[]): Promise<{ tags: ArchiveTag[] }> {
  const res = await axiosForBackend.patch(`/api/archives/items/${id}/tags`, { tagNames });
  return res.data;
}

export async function updateItemCategory(id: string, category: string): Promise<{ category: string }> {
  const res = await axiosForBackend.patch(`/api/archives/items/${id}/category`, { category });
  return res.data;
}

export async function deleteItem(id: string): Promise<{ ok: boolean }> {
  const res = await axiosForBackend.delete(`/api/archives/items/${id}`);
  return res.data;
}

export async function listTags(): Promise<{ tags: ArchiveTag[] }> {
  const res = await axiosForBackend.get('/api/archives/tags');
  return res.data;
}

export async function renameTag(id: string, name: string): Promise<ArchiveTag> {
  const res = await axiosForBackend.patch(`/api/archives/tags/${id}`, { name });
  return res.data;
}

export async function deleteTag(id: string): Promise<{ ok: boolean }> {
  const res = await axiosForBackend.delete(`/api/archives/tags/${id}`);
  return res.data;
}

export async function getStats(): Promise<StatsResponse> {
  const res = await axiosForBackend.get('/api/archives/stats');
  return res.data;
}

export async function exportAll(): Promise<ExportData> {
  const res = await axiosForBackend.get('/api/archives/export');
  return res.data;
}
