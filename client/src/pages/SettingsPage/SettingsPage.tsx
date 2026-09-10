import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import {
  ArrowLeft,
  CheckCircle,
  Eye,
  EyeOff,
  Loader2,
  XCircle,
} from 'lucide-react';
import { logger } from '@lark-apaas/client-toolkit/logger';

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

import type {
  SettingsResponse,
  UpdateSettingsRequest,
} from '@shared/api.interface';
import {
  getSettings,
  testHeybox,
  testOpenai,
  updateSettings,
} from '@client/src/api/settings';
import { UniversalLink } from '@lark-apaas/client-toolkit/components/UniversalLink';

const heyboxSchema = z.object({
  heyboxCookie: z.string().min(1, 'Cookie 不能为空'),
});
type HeyboxFormData = z.infer<typeof heyboxSchema>;

const openaiSchema = z.object({
  openaiBaseUrl: z.string().url('请输入有效的 URL'),
  openaiApiKey: z.string().min(1, 'API Key 不能为空'),
  openaiModel: z.string().min(1, '模型名不能为空'),
  openaiTemperature: z.coerce
    .number()
    .min(0, '不能小于 0')
    .max(1, '不能大于 1'),
});
type OpenaiFormData = z.infer<typeof openaiSchema>;

type TestResult = { ok: boolean; message: string };

const SettingsPage = () => {
  const [loading, setLoading] = useState(true);
  const [hasHeyboxCookie, setHasHeyboxCookie] = useState(false);
  const [hasOpenaiKey, setHasOpenaiKey] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);

  // 专区爬取设置
  const [crawlTopicEnabled, setCrawlTopicEnabled] = useState(false);
  const [topicLinkId, setTopicLinkId] = useState('416158');
  const [topicSaving, setTopicSaving] = useState(false);

  // 自动同步设置
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(false);
  const [autoSyncInterval, setAutoSyncInterval] = useState(30);
  const [autoSyncStatus, setAutoSyncStatus] = useState('idle');
  const [lastAutoSyncAt, setLastAutoSyncAt] = useState<Date | null>(null);
  const [autoSyncError, setAutoSyncError] = useState<string | null>(null);
  const [autoSyncSaving, setAutoSyncSaving] = useState(false);

  const [heyboxTesting, setHeyboxTesting] = useState(false);
  const [heyboxSaving, setHeyboxSaving] = useState(false);
  const [heyboxResult, setHeyboxResult] = useState<TestResult | null>(null);

  const [openaiTesting, setOpenaiTesting] = useState(false);
  const [openaiSaving, setOpenaiSaving] = useState(false);
  const [openaiResult, setOpenaiResult] = useState<TestResult | null>(null);

  const heyboxForm = useForm<HeyboxFormData>({
    resolver: zodResolver(heyboxSchema),
    defaultValues: { heyboxCookie: '' },
  });

  const openaiForm = useForm<OpenaiFormData>({
    resolver: zodResolver(openaiSchema),
    defaultValues: {
      openaiBaseUrl: 'https://api.openai.com/v1',
      openaiApiKey: '',
      openaiModel: 'gpt-4o-mini',
      openaiTemperature: 0.7,
    },
  });

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const s: SettingsResponse = await getSettings();
        if (cancelled) return;
        heyboxForm.reset({ heyboxCookie: s.heyboxCookie || '' });
        openaiForm.reset({
          openaiBaseUrl: s.openaiBaseUrl || 'https://api.openai.com/v1',
          openaiApiKey: s.openaiApiKey || '',
          openaiModel: s.openaiModel || 'gpt-4o-mini',
          openaiTemperature: s.openaiTemperature ?? 0.7,
        });
        setHasHeyboxCookie(s.hasHeyboxCookie);
        setHasOpenaiKey(s.hasOpenaiKey);
        setCrawlTopicEnabled(s.crawlTopicEnabled || false);
        setTopicLinkId(s.topicLinkId || '416158');
        setAutoSyncEnabled(s.autoSyncEnabled || false);
        setAutoSyncInterval(s.autoSyncInterval || 30);
        setAutoSyncStatus(s.autoSyncStatus || 'idle');
        setLastAutoSyncAt(s.lastAutoSyncAt || null);
        setAutoSyncError(s.autoSyncError || null);
      } catch (err) {
        logger.error('load settings failed', err as Error);
        toast.error('加载设置失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [heyboxForm, openaiForm]);

  const handleTestHeybox = async (): Promise<void> => {
    setHeyboxTesting(true);
    setHeyboxResult(null);
    try {
      const r = await testHeybox();
      setHeyboxResult({ ok: r.ok, message: r.message });
    } catch (err) {
      logger.error('heybox test failed', err as Error);
      setHeyboxResult({ ok: false, message: '测试请求失败，请检查网络' });
    } finally {
      setHeyboxTesting(false);
    }
  };

  const handleSaveHeybox = async (data: HeyboxFormData): Promise<void> => {
    setHeyboxSaving(true);
    try {
      const req: UpdateSettingsRequest = { heyboxCookie: data.heyboxCookie };
      const updated = await updateSettings(req);
      setHasHeyboxCookie(updated.hasHeyboxCookie);
      setHeyboxResult(null);
      toast.success('小黑盒 Cookie 保存成功');
    } catch (err) {
      logger.error('save heybox failed', err as Error);
      toast.error('保存失败，请稍后重试');
    } finally {
      setHeyboxSaving(false);
    }
  };

  const handleTestOpenai = async (): Promise<void> => {
    setOpenaiTesting(true);
    setOpenaiResult(null);
    try {
      const r = await testOpenai();
      setOpenaiResult({ ok: r.ok, message: r.message });
    } catch (err) {
      logger.error('openai test failed', err as Error);
      setOpenaiResult({ ok: false, message: '测试请求失败，请检查网络' });
    } finally {
      setOpenaiTesting(false);
    }
  };

  const handleSaveOpenai = async (data: OpenaiFormData): Promise<void> => {
    setOpenaiSaving(true);
    try {
      const req: UpdateSettingsRequest = {
        openaiBaseUrl: data.openaiBaseUrl,
        openaiApiKey: data.openaiApiKey,
        openaiModel: data.openaiModel,
        openaiTemperature: data.openaiTemperature,
      };
      const updated = await updateSettings(req);
      setHasOpenaiKey(updated.hasOpenaiKey);
      setOpenaiResult(null);
      toast.success('AI 打标配置保存成功');
    } catch (err) {
      logger.error('save openai failed', err as Error);
      toast.error('保存失败，请稍后重试');
    } finally {
      setOpenaiSaving(false);
    }
  };

  const handleSaveTopic = async (): Promise<void> => {
    setTopicSaving(true);
    try {
      const req: UpdateSettingsRequest = {
        crawlTopicEnabled,
        topicLinkId,
      };
      await updateSettings(req);
      toast.success(crawlTopicEnabled ? '已开启情投意合专区爬取' : '已关闭情投意合专区爬取');
    } catch (err) {
      logger.error('save topic settings failed', err as Error);
      toast.error('保存失败，请稍后重试');
    } finally {
      setTopicSaving(false);
    }
  };

  const handleSaveAutoSync = async (): Promise<void> => {
    setAutoSyncSaving(true);
    try {
      const req: UpdateSettingsRequest = {
        autoSyncEnabled,
        autoSyncInterval: Number(autoSyncInterval) || 30,
      };
      await updateSettings(req);
      toast.success(autoSyncEnabled ? `已开启自动同步（每 ${autoSyncInterval} 秒）` : '已关闭自动同步');
    } catch (err) {
      logger.error('save auto sync settings failed', err as Error);
      toast.error('保存失败，请稍后重试');
    } finally {
      setAutoSyncSaving(false);
    }
  };

  return (
    <div className="p-5">
      <div className="mb-6 flex items-center gap-3">
        <Link
          to="/"
          className="text-muted-foreground hover:text-foreground inline-flex"
          aria-label="返回浏览页"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <div>
          <h1 className="font-semibold text-base">设置</h1>
          <p className="text-xs text-muted-foreground">
            配置小黑盒账号与 AI 打标服务
          </p>
        </div>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          加载中...
        </div>
      )}

      {!loading && (
        <div className="flex flex-col gap-6">
          {/* 小黑盒 Cookie 配置 */}
          <Card className="rounded-lg shadow-sm border border-border/50">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="font-semibold text-base">
                    小黑盒 Cookie 配置
                  </CardTitle>
                  <CardDescription className="text-sm mt-1">
                    配置你的小黑盒账号 Cookie，用于爬取收藏内容
                  </CardDescription>
                </div>
                <Badge variant={hasHeyboxCookie ? 'default' : 'secondary'}>
                  {hasHeyboxCookie ? '已配置' : '未配置'}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <Form {...heyboxForm}>
                <form
                  onSubmit={heyboxForm.handleSubmit(handleSaveHeybox)}
                  className="space-y-4"
                >
                  <FormField
                    control={heyboxForm.control}
                    name="heyboxCookie"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Cookie</FormLabel>
                        <FormControl>
                          <Textarea
                            rows={6}
                            placeholder="粘贴小黑盒 Cookie 字符串..."
                            className="font-mono text-xs"
                            {...field}
                          />
                        </FormControl>
                        <FormDescription className="text-xs">
                          <div className="space-y-1 mt-2">
                            <p className="font-medium">如何获取 Cookie：</p>
                            <ol className="list-decimal list-inside space-y-1 pl-2">
                              <li>
                                在浏览器打开{' '}
                                <UniversalLink
                                  to="https://xiaoheihe.cn"
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-primary hover:underline"
                                >
                                  xiaoheihe.cn
                                </UniversalLink>{' '}
                                并登录
                              </li>
                              <li>按 F12 打开开发者工具，切换到 Network 面板</li>
                              <li>刷新页面，找到任意一个 xiaoheihe.cn 请求</li>
                              <li>复制请求头中 Cookie 字段的完整值</li>
                            </ol>
                          </div>
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {heyboxResult && (
                    <Alert variant={heyboxResult.ok ? 'success' : 'destructive'}>
                      {heyboxResult.ok ? (
                        <CheckCircle className="size-4" />
                      ) : (
                        <XCircle className="size-4" />
                      )}
                      <AlertTitle>
                        {heyboxResult.ok ? '测试成功' : '测试失败'}
                      </AlertTitle>
                      <AlertDescription>{heyboxResult.message}</AlertDescription>
                    </Alert>
                  )}

                  <div className="flex items-center gap-3 pt-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleTestHeybox}
                      disabled={heyboxTesting}
                    >
                      {heyboxTesting && <Loader2 className="size-4 animate-spin" />}
                      测试连接
                    </Button>
                    <Button type="submit" disabled={heyboxSaving}>
                      {heyboxSaving && <Loader2 className="size-4 animate-spin" />}
                      保存
                    </Button>
                  </div>
                </form>
              </Form>
            </CardContent>
          </Card>

          {/* AI 打标配置 */}
          <Card className="rounded-lg shadow-sm border border-border/50">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="font-semibold text-base">
                    AI 打标配置
                  </CardTitle>
                  <CardDescription className="text-sm mt-1">
                    配置 OpenAI 兼容 API，用于对收藏自动打标签和分类
                  </CardDescription>
                </div>
                <Badge variant={hasOpenaiKey ? 'default' : 'secondary'}>
                  {hasOpenaiKey ? '已配置' : '未配置'}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <Form {...openaiForm}>
                <form
                  onSubmit={openaiForm.handleSubmit(handleSaveOpenai)}
                  className="space-y-4"
                >
                  <FormField
                    control={openaiForm.control}
                    name="openaiBaseUrl"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Base URL</FormLabel>
                        <FormControl>
                          <Input
                            type="url"
                            placeholder="https://api.openai.com/v1"
                            {...field}
                          />
                        </FormControl>
                        <FormDescription className="text-xs">
                          OpenAI 兼容 API 的基础地址
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={openaiForm.control}
                    name="openaiApiKey"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>API Key</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Input
                              type={showApiKey ? 'text' : 'password'}
                              placeholder="sk-..."
                              {...field}
                            />
                            <button
                              type="button"
                              onClick={() => setShowApiKey((p) => !p)}
                              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1"
                              aria-label={showApiKey ? '隐藏' : '显示'}
                            >
                              {showApiKey ? (
                                <EyeOff className="size-4" />
                              ) : (
                                <Eye className="size-4" />
                              )}
                            </button>
                          </div>
                        </FormControl>
                        <FormDescription className="text-xs">
                          你的 API 密钥，仅保存在本地数据库中
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="flex flex-wrap gap-4">
                    <FormField
                      control={openaiForm.control}
                      name="openaiModel"
                      render={({ field }) => (
                        <FormItem className="flex-1 min-w-[200px]">
                          <FormLabel>模型名</FormLabel>
                          <FormControl>
                            <Input placeholder="gpt-4o-mini" {...field} />
                          </FormControl>
                          <FormDescription className="text-xs">
                            使用的模型名称
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={openaiForm.control}
                      name="openaiTemperature"
                      render={({ field }) => (
                        <FormItem className="flex-1 min-w-[200px]">
                          <FormLabel>Temperature</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              step="0.1"
                              min="0"
                              max="1"
                              {...field}
                            />
                          </FormControl>
                          <FormDescription className="text-xs">
                            采样温度，范围 0 ~ 1
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  {openaiResult && (
                    <Alert variant={openaiResult.ok ? 'success' : 'destructive'}>
                      {openaiResult.ok ? (
                        <CheckCircle className="size-4" />
                      ) : (
                        <XCircle className="size-4" />
                      )}
                      <AlertTitle>
                        {openaiResult.ok ? '测试成功' : '测试失败'}
                      </AlertTitle>
                      <AlertDescription>{openaiResult.message}</AlertDescription>
                    </Alert>
                  )}

                  <div className="flex items-center gap-3 pt-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleTestOpenai}
                      disabled={openaiTesting}
                    >
                      {openaiTesting && <Loader2 className="size-4 animate-spin" />}
                      测试连通
                    </Button>
                    <Button type="submit" disabled={openaiSaving}>
                      {openaiSaving && <Loader2 className="size-4 animate-spin" />}
                      保存
                    </Button>
                  </div>
                </form>
              </Form>
            </CardContent>
          </Card>

          {/* 情投意合专区爬取配置 */}
          <Card className="rounded-lg shadow-sm border border-border/50">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="font-semibold text-base">
                    情投意合专区爬取
                  </CardTitle>
                  <CardDescription className="text-sm mt-1">
                    开启后，同步收藏夹时会同时爬取情投意合专区的内容，单独分类存放
                  </CardDescription>
                </div>
                <Badge variant={crawlTopicEnabled ? 'default' : 'secondary'}>
                  {crawlTopicEnabled ? '已开启' : '已关闭'}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                  <div>
                    <p className="font-medium text-sm">启用专区爬取</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      同步收藏夹时自动爬取情投意合专区内容
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setCrawlTopicEnabled((p) => !p)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 ${
                      crawlTopicEnabled ? 'bg-primary' : 'bg-muted'
                    }`}
                    aria-label={crawlTopicEnabled ? '关闭' : '开启'}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        crawlTopicEnabled ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">专区 Link ID</label>
                  <Input
                    type="text"
                    value={topicLinkId}
                    onChange={(e) => setTopicLinkId(e.target.value)}
                    placeholder="416158"
                    disabled={!crawlTopicEnabled}
                  />
                  <p className="text-xs text-muted-foreground">
                    情投意合专区页面 URL 中的 link ID，默认为 416158
                  </p>
                </div>

                <div className="flex items-center gap-3 pt-2">
                  <Button
                    type="button"
                    onClick={handleSaveTopic}
                    disabled={topicSaving}
                  >
                    {topicSaving && <Loader2 className="size-4 animate-spin" />}
                    保存设置
                  </Button>
                </div>

                <Alert>
                  <AlertTitle>使用说明</AlertTitle>
                  <AlertDescription className="text-xs">
                    开启后，点击「同步收藏夹」按钮时会同时爬取情投意合专区的内容。
                    专区内容会单独标记为「情投意合」分类，可以在浏览页按分类筛选查看。
                    专区内容同样支持下载图片、抓取评论和 AI 打标签。
                  </AlertDescription>
                </Alert>
              </div>
            </CardContent>
          </Card>

          {/* 自动同步配置 */}
          <Card className="rounded-lg shadow-sm border border-border/50">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="font-semibold text-base">
                    自动同步
                  </CardTitle>
                  <CardDescription className="text-sm mt-1">
                    开启后，每隔指定时间自动执行：同步收藏 → 下载图片 → 抓取评论
                  </CardDescription>
                </div>
                <Badge variant={autoSyncEnabled ? 'default' : 'secondary'}>
                  {autoSyncEnabled ? '已开启' : '已关闭'}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                  <div>
                    <p className="font-medium text-sm">启用自动同步</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      自动执行同步收藏、下载图片、抓取评论
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAutoSyncEnabled((p) => !p)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 ${
                      autoSyncEnabled ? 'bg-primary' : 'bg-muted'
                    }`}
                    aria-label={autoSyncEnabled ? '关闭' : '开启'}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        autoSyncEnabled ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">同步间隔（秒）</label>
                  <Input
                    type="number"
                    value={autoSyncInterval}
                    onChange={(e) => setAutoSyncInterval(Number(e.target.value) || 30)}
                    min={10}
                    disabled={!autoSyncEnabled}
                  />
                  <p className="text-xs text-muted-foreground">
                    自动同步的时间间隔，最小 10 秒，默认 30 秒
                  </p>
                </div>

                {/* 自动同步状态 */}
                <div className="p-3 bg-muted/30 rounded-lg space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">当前状态</span>
                    <Badge variant={
                      autoSyncStatus === 'running' || autoSyncStatus === 'syncing' || autoSyncStatus === 'downloading' || autoSyncStatus === 'comments'
                        ? 'default'
                        : autoSyncStatus === 'error'
                          ? 'destructive'
                          : 'secondary'
                    }>
                      {autoSyncStatus === 'idle' && '空闲'}
                      {autoSyncStatus === 'running' && '运行中'}
                      {autoSyncStatus === 'syncing' && '同步收藏中...'}
                      {autoSyncStatus === 'downloading' && '下载图片中...'}
                      {autoSyncStatus === 'comments' && '抓取评论中...'}
                      {autoSyncStatus === 'error' && '出错'}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">上次同步时间</span>
                    <span className="text-xs">
                      {lastAutoSyncAt ? new Date(lastAutoSyncAt).toLocaleString('zh-CN') : '从未同步'}
                    </span>
                  </div>
                  {autoSyncError && (
                    <div className="text-xs text-red-500 mt-1">
                      错误：{autoSyncError}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-3 pt-2">
                  <Button
                    type="button"
                    onClick={handleSaveAutoSync}
                    disabled={autoSyncSaving}
                  >
                    {autoSyncSaving && <Loader2 className="size-4 animate-spin" />}
                    保存设置
                  </Button>
                </div>

                <Alert>
                  <AlertTitle>使用说明</AlertTitle>
                  <AlertDescription className="text-xs">
                    开启自动同步后，系统会每隔指定时间自动执行以下操作：
                    1. 同步小黑盒收藏夹（含情投意合专区）
                    2. 下载所有帖子的正文图片到本地
                    3. 抓取所有帖子的评论
                    自动同步在后台运行，不影响正常使用。建议保持应用运行状态。
                  </AlertDescription>
                </Alert>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};

export default SettingsPage;
