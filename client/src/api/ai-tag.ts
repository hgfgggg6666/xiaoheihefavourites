import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import type { SyncJob, StartSyncResponse, TagResult } from '@shared/api.interface';

export async function startBatchTag(): Promise<StartSyncResponse> {
  const res = await axiosForBackend.post('/api/ai-tag/batch');
  return res.data;
}

export async function getTagStatus(): Promise<SyncJob | null> {
  const res = await axiosForBackend.get('/api/ai-tag/status');
  return res.data;
}

export async function retagItem(id: string): Promise<TagResult> {
  const res = await axiosForBackend.post(`/api/ai-tag/items/${id}/retag`);
  return res.data;
}
