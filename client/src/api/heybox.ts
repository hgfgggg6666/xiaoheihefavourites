import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import type { SyncJob, StartSyncResponse } from '@shared/api.interface';

export async function startSync(fullRebuild = false): Promise<StartSyncResponse> {
  const res = await axiosForBackend.post('/api/heybox/sync', { fullRebuild });
  return res.data;
}

export async function getSyncStatus(): Promise<SyncJob | null> {
  const res = await axiosForBackend.get('/api/heybox/sync-status');
  return res.data;
}

export async function startImageArchive(): Promise<StartSyncResponse> {
  const res = await axiosForBackend.post('/api/heybox/image-archive');
  return res.data;
}

export async function getImageArchiveStatus(): Promise<SyncJob | null> {
  const res = await axiosForBackend.get('/api/heybox/image-archive-status');
  return res.data;
}
