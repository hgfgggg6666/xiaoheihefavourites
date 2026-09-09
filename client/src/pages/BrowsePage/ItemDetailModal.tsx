import { useState } from 'react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';
import { logger } from '@lark-apaas/client-toolkit/logger';
import {
  ExternalLink,
  Trash2,
  Tags,
  ChevronDown,
  ChevronUp,
  User,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Image } from '@/components/ui/image';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { archivesApi, aiTagApi } from '@client/src/api';
import type { ArchiveItemDetail } from '@shared/api.interface';
import CommentSection from './CommentSection';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

interface ItemDetailModalProps {
  item: ArchiveItemDetail | null;
  open: boolean;
  onClose: () => void;
  onDeleted: () => void;
  onUpdated: () => void;
}

export default function ItemDetailModal({
  item,
  open,
  onClose,
  onDeleted,
  onUpdated,
}: ItemDetailModalProps) {
  const [showRaw, setShowRaw] = useState<boolean>(false);
  const [retagLoading, setRetagLoading] = useState<boolean>(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState<boolean>(false);
  const [deleteLoading, setDeleteLoading] = useState<boolean>(false);

  const handleRetag = async () => {
    if (!item || retagLoading) return;
    setRetagLoading(true);
    try {
      await aiTagApi.retagItem(item.id);
      onUpdated();
    } catch (err: unknown) {
      logger.error(`retag failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRetagLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!item || deleteLoading) return;
    setDeleteLoading(true);
    try {
      await archivesApi.deleteItem(item.id);
      setDeleteConfirmOpen(false);
      onClose();
      onDeleted();
    } catch (err: unknown) {
      logger.error(`delete failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDeleteLoading(false);
    }
  };

  if (!item) return null;

  // 本地图片路径转换：./media/ -> /media/（应用运行在 /app/ 路径下）
  const getImageSrc = (src: string | null | undefined): string => {
    if (!src) return '';
    if (src.startsWith('./media/')) {
      return '/' + src.slice(2);
    }
    return src;
  };

  const coverSrc = getImageSrc((item as any).localCoverPath || item.coverUrl);

  return (
    <>
      <Dialog open={open} onOpenChange={(val: boolean) => !val && onClose()}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="pr-8">
              {item.title ?? '无标题'}
            </DialogTitle>
          </DialogHeader>

          {coverSrc && (
            <div className="overflow-hidden rounded-lg">
              <Image
                src={coverSrc}
                alt={item.title ?? '封面'}
                className="w-full object-cover max-h-[320px]"
                sizes="(max-width: 768px) 100vw, 640px"
              />
            </div>
          )}

          {/* 作者信息 */}
          <div className="flex items-center gap-2">
            <Avatar className="h-8 w-8">
              {item.authorAvatar ? (
                <AvatarImage src={item.authorAvatar} alt={item.authorName ?? ''} />
              ) : null}
              <AvatarFallback>
                <User className="h-4 w-4" />
              </AvatarFallback>
            </Avatar>
            <div className="flex flex-col">
              <span className="text-sm font-medium">{item.authorName ?? '未知'}</span>
              <span className="text-xs text-muted-foreground">
                {item.sourceCreateAt
                  ? dayjs(item.sourceCreateAt).format('YYYY-MM-DD')
                  : ''}
              </span>
            </div>
          </div>

          {/* 分类 */}
          {item.category && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">分类：</span>
              <Badge variant="secondary">{item.category}</Badge>
            </div>
          )}

          {/* 标签 */}
          {item.tags.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs text-muted-foreground">标签</p>
              <div className="flex flex-wrap gap-1.5">
                {item.tags.map((tag) => (
                  <Badge
                    key={tag.id}
                    variant="outline"
                    style={{ color: tag.color, borderColor: `${tag.color}50` }}
                  >
                    {tag.name}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* AI 摘要 */}
          {item.summary && (
            <div>
              <p className="mb-1.5 text-xs text-muted-foreground">AI 摘要</p>
              <p className="text-sm leading-relaxed">{item.summary}</p>
            </div>
          )}

          <Collapsible open={showRaw} onOpenChange={setShowRaw}>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center justify-between rounded-md border border-border/50 bg-muted/30 px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                <span>查看原始 JSON</span>
                {showRaw ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <pre className="max-h-[300px] overflow-auto rounded-md bg-muted/30 p-3 text-[11px] leading-relaxed">
                {JSON.stringify(item.rawData, null, 2)}
              </pre>
            </CollapsibleContent>
          </Collapsible>

          {item.linkid && (
            <CommentSection
              linkid={item.linkid}
              totalFloorNum={item.rawData?.comment_num ?? undefined}
            />
          )}

          <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            <div className="flex gap-2">
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setDeleteConfirmOpen(true)}
                disabled={deleteLoading}
              >
                <Trash2 className="h-4 w-4" />
                删除收藏
              </Button>
            </div>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={handleRetag}
                disabled={retagLoading}
              >
                <Tags className={`h-4 w-4 ${retagLoading ? 'animate-spin' : ''}`} />
                重新打标
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  if (item.shareUrl) {
                    window.open(item.shareUrl, '_blank', 'noopener,noreferrer');
                  }
                }}
                disabled={!item.shareUrl}
              >
                <ExternalLink className="h-4 w-4" />
                查看原文
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogTitle>确认删除</AlertDialogTitle>
          <AlertDialogDescription>
            确定要删除这条收藏吗？此操作不可恢复。
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteLoading}>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
              disabled={deleteLoading}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
