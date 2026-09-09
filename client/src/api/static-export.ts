import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';

export interface StaticExportStatus {
  job: {
    id: string;
    status: string;
    total: number;
    processed: number;
    successCount: number;
    failCount: number;
    errorMessage: string | null;
    finishedAt: string | null;
  } | null;
}

export async function getStaticExportStatus(): Promise<StaticExportStatus> {
  const res = await axiosForBackend.get('/api/static-export/status');
  return res.data;
}

export function downloadStaticSite(): void {
  const url = '/api/static-export/download';
  const a = document.createElement('a');
  a.href = url;
  a.download = 'xiaoheihe-archive-site.zip';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
