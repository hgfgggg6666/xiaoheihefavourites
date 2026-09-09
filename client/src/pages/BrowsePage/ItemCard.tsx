import { useState } from 'react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';
import { Trash2, Tags, User, MessageSquare } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Image } from '@/components/ui/image';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import type { ArchiveItem } from '@shared/api.interface';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

interface ItemCardProps {
  item: ArchiveItem;
  onClick: () => void;
  onDelete: () => void;
  onRetag: () => void;
}

const CATEGORY_COLORS: Record<string, string> = {
  游戏: '#ef4444',
  科技: '#3b82f6',
  生活: '#10b981',
  影视: '#8b5cf6',
  音乐: '#f59e0b',
  读书: '#ec4899',
  其他: '#6b7280',
};

function getCategoryColor(category: string | null): string {
  if (!category) return '#9ca3af';
  return CATEGORY_COLORS[category] ?? '#6b7280';
}

export default function ItemCard({ item, onClick, onDelete, onRetag }: ItemCardProps) {
  const [hovered, setHovered] = useState<boolean>(false);

  // 本地图片路径转换：./media/ -> /media/（应用运行在 /app/ 路径下）
  const getImageSrc = (src: string | null | undefined): string => {
    if (!src) return '';
    if (src.startsWith('./media/')) {
      return '/' + src.slice(2); // 去掉开头的 ./
    }
    return src;
  };

  const coverSrc = getImageSrc(item.localCoverPath || item.coverUrl);

  const handleTitleClick = (e: React.MouseEvent<HTMLHeadingElement>) => {
    e.stopPropagation();
    if (item.shareUrl) {
      window.open(item.shareUrl, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <article
      className="relative mb-4 break-inside-avoid rounded-lg border border-border/50 bg-card text-card-foreground shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 cursor-pointer"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {coverSrc && (
        <div className="relative w-full overflow-hidden rounded-t-lg">
          <Image
            src={coverSrc}
            alt={item.title ?? '封面'}
            className="w-full object-cover"
            sizes="(max-width: 768px) 50vw, 280px"
          />
          {item.commentCount != null && item.commentCount > 0 && (
            <div className="absolute bottom-1.5 right-1.5 flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] text-white backdrop-blur-sm">
              <MessageSquare className="h-3 w-3" />
              {item.commentCount}
            </div>
          )}
        </div>
      )}

      <div className="p-3">
        {item.category && (
          <div className="mb-2 flex items-center gap-1.5">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: getCategoryColor(item.category) }}
            />
            <span className="text-xs text-muted-foreground">{item.category}</span>
          </div>
        )}

        <h3
          className={`text-sm font-medium line-clamp-2 ${
            item.shareUrl ? 'hover:text-primary hover:underline cursor-pointer' : ''
          }`}
          onClick={handleTitleClick}
        >
          {item.title ?? '无标题'}
        </h3>

        {item.summary && (
          <p className="mt-1.5 text-xs text-muted-foreground line-clamp-2">
            {item.summary}
          </p>
        )}

        {item.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {item.tags.slice(0, 3).map((tag) => (
              <Badge
                key={tag.id}
                variant="outline"
                className="text-[10px] px-1.5 py-0"
                style={{ color: tag.color, borderColor: `${tag.color}50` }}
              >
                {tag.name}
              </Badge>
            ))}
            {item.tags.length > 3 && (
              <span className="text-[10px] text-muted-foreground self-center">
                +{item.tags.length - 3}
              </span>
            )}
          </div>
        )}

        <div className="mt-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <Avatar className="h-5 w-5">
              {item.authorAvatar ? (
                <AvatarImage src={item.authorAvatar} alt={item.authorName ?? ''} />
              ) : null}
              <AvatarFallback className="text-[10px]">
                <User className="h-3 w-3" />
              </AvatarFallback>
            </Avatar>
            <span className="truncate text-xs text-muted-foreground">
              {item.authorName ?? '未知'}
            </span>
          </div>
          {item.sourceCreateAt && (
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {dayjs(item.sourceCreateAt).fromNow()}
            </span>
          )}
        </div>
      </div>

      {hovered && (
        <div className="absolute right-2 top-2 z-10 flex gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-md bg-background/90 shadow-sm hover:bg-background"
                onClick={(e) => {
                  e.stopPropagation();
                  onRetag();
                }}
                aria-label="重新打标"
              >
                <Tags className="h-4 w-4 text-foreground" />
              </button>
            </TooltipTrigger>
            <TooltipContent>重新打标</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-md bg-background/90 shadow-sm hover:bg-destructive hover:text-destructive-foreground"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
                aria-label="删除"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>删除收藏</TooltipContent>
          </Tooltip>
        </div>
      )}
    </article>
  );
}
