import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import type {
  SettingsResponse,
  UpdateSettingsRequest,
  TestHeyboxResponse,
  TestOpenaiResponse,
} from '@shared/api.interface';

export async function getSettings(): Promise<SettingsResponse> {
  const res = await axiosForBackend.get('/api/settings');
  return res.data;
}

export async function updateSettings(
  data: UpdateSettingsRequest,
): Promise<SettingsResponse> {
  const res = await axiosForBackend.patch('/api/settings', data);
  return res.data;
}

export async function testHeybox(): Promise<TestHeyboxResponse> {
  const res = await axiosForBackend.post('/api/settings/test-heybox');
  return res.data;
}

export async function testOpenai(): Promise<TestOpenaiResponse> {
  const res = await axiosForBackend.post('/api/settings/test-openai');
  return res.data;
}
