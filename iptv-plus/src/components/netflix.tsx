'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, upsertHistory, type HistoryEntry } from '@/lib/db';
import { useT } from '@/lib/i18n';
import { resolveSource, useAppStore } from '@/lib/store';
import { buildWatchUrl, cn } from '@/lib/utils';
import { Icon } from './icon';
import { SmartImage } from './smart-image';

/**
 * Netflix 风格的通用积木：横向海报行、海报卡、继续观看卡、遥控器方向键导航。
 * 首页与电影剧集页共用。
 */

/** 图片加载设置（直连 / 代理）随设置面板变化 */
function useImageMode() {
  const mode = useAppStore((s) => s.imageProxyMode);
  const custom = useAppStore((s) => s.customImageProxy);
  return { mode, custom };
}

export function Poster({
  url,
  alt,
  className,
  eager,
}: {
  url?: string;
  alt: string;
  className?: string;
  eager?: boolean;
}) {
  const { mode, custom } = useImageMode();
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  if (!url || failed) {
    return (
      <div className={cn('flex items-center justify-center bg-gradient-to-br from-chip to-hover p-2', className)}>
        <span className="text-xs text-muted text-center line-clamp-3">{alt}</span>
      </div>
    );
  }
  return (
    <SmartImage
      url={url}
      mode={mode}
      customProxy={custom}
      alt={alt}
      loading={eager ? 'eager' : 'lazy'}
      className={cn('object-cover', className)}
      onExhausted={() => setFailed(true)}
    />
  );
}

/** 横向滚动行：标题 + 可横滑的卡片带；桌面悬停时出现左右翻页箭头 */
export function Row({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const page = (dir: 1 | -1) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.85, behavior: 'smooth' });
  return (
    <section className="group/row relative mb-6 md:mb-9" aria-label={title}>
      <div className="flex items-end justify-between px-4 md:px-8 mb-1">
        <h2 className="text-base md:text-xl font-bold text-content">{title}</h2>
        {action}
      </div>
      <div className="relative">
        {/* 上下留足空间：遥控器焦点放大 + 外描边不会被横向滚动容器裁掉 */}
        <div ref={ref} className="row-scroll px-4 md:px-8 py-3 -my-1.5">
          {children}
        </div>
        <button
          aria-hidden
          tabIndex={-1}
          className="hidden md:flex absolute left-0 inset-y-3 w-8 items-center justify-center bg-gradient-to-r from-page to-transparent text-content opacity-0 group-hover/row:opacity-100 transition-opacity"
          onClick={() => page(-1)}
        >
          <Icon name="chevronLeft" className="w-7 h-7" />
        </button>
        <button
          aria-hidden
          tabIndex={-1}
          className="hidden md:flex absolute right-0 inset-y-3 w-8 items-center justify-center bg-gradient-to-l from-page to-transparent text-content opacity-0 group-hover/row:opacity-100 transition-opacity"
          onClick={() => page(1)}
        >
          <Icon name="chevronRight" className="w-7 h-7" />
        </button>
      </div>
    </section>
  );
}

/** 竖版海报卡（推荐榜单） */
export function PosterCard({
  title,
  cover,
  rating,
  rank,
  onClick,
}: {
  title: string;
  cover?: string;
  rating?: string;
  rank?: number;
  onClick: () => void;
}) {
  return (
    <button
      className="tv-focus shrink-0 w-[30vw] max-w-[9.5rem] sm:w-36 md:w-40 text-left rounded-md transition-transform duration-200 md:hover:scale-105"
      onClick={onClick}
      title={title}
    >
      <div className="relative aspect-[2/3] rounded-md overflow-hidden bg-chip">
        <Poster url={cover} alt={title} className="w-full h-full" />
        {rank !== undefined && rank < 10 && (
          <span className="absolute left-0 bottom-0 px-2 pt-6 pb-0.5 text-3xl font-black text-white/95 bg-gradient-to-t from-black/80 to-transparent w-full leading-none [text-shadow:0_2px_6px_rgba(0,0,0,.6)]">
            {rank + 1}
          </span>
        )}
        {rating && (
          <span className="absolute top-1.5 right-1.5 tag bg-black/70 text-rating font-semibold">★ {rating}</span>
        )}
      </div>
      <p className="mt-1.5 text-xs md:text-sm text-muted truncate">{title}</p>
    </button>
  );
}

/** 加载中的占位卡片（放在 Row 内） */
export function RowSkeleton({ count = 8 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="shrink-0 w-[30vw] max-w-[9.5rem] sm:w-36 md:w-40">
          <div className="aspect-[2/3] rounded-md bg-chip animate-pulse" />
          <div className="h-3 mt-2 w-3/4 rounded bg-chip animate-pulse" />
        </div>
      ))}
    </>
  );
}

/** 观看历史（按最近观看排序） */
export function useContinueWatching(limit = 20): HistoryEntry[] | undefined {
  return useLiveQuery(() => db.history.orderBy('timestamp').reverse().limit(limit).toArray(), [limit]);
}

/** 继续观看卡：横版，带进度条与集数 */
export function ContinueCard({ item }: { item: HistoryEntry }) {
  const t = useT();
  const customAPIs = useAppStore((s) => s.customAPIs);
  const envSources = useAppStore((s) => s.envSources);
  const source = resolveSource({ customAPIs, envSources }, item.sourceKey);
  const href = buildWatchUrl({
    sourceKey: item.sourceKey,
    vodId: item.vodId,
    index: item.episodeIndex,
    title: item.title,
    sourceUrl: source?.url,
    detail: source?.detail,
  });
  const percent = item.duration > 0 ? Math.min(100, Math.round((item.playbackPosition / item.duration) * 100)) : 0;
  return (
    <Link
      href={href}
      className="tv-focus shrink-0 w-[62vw] max-w-[17rem] sm:w-64 md:w-72 rounded-md transition-transform duration-200 md:hover:scale-105"
      onClick={() => upsertHistory({ ...item, timestamp: Date.now() }).catch(() => {})}
    >
      <div className="relative aspect-video rounded-md overflow-hidden bg-chip">
        <Poster url={item.pic} alt={item.title} className="w-full h-full" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-transparent" />
        <span className="absolute inset-0 m-auto w-11 h-11 rounded-full border-2 border-white/90 bg-black/40 flex items-center justify-center text-white">
          <Icon name="play" className="w-5 h-5 ml-0.5" />
        </span>
        <div className="absolute left-2 right-2 bottom-2">
          <p className="text-sm font-semibold text-white truncate">{item.title}</p>
          {item.totalEpisodes > 1 && (
            <p className="text-[11px] text-white/75">
              {t(`第 ${item.episodeIndex + 1} 集`, `Episode ${item.episodeIndex + 1}`)}
            </p>
          )}
        </div>
        <div className="absolute left-0 right-0 bottom-0 h-1 bg-white/25">
          <div className="h-full bg-accent" style={{ width: `${percent}%` }} />
        </div>
      </div>
    </Link>
  );
}

/**
 * 遥控器 / 键盘方向键空间导航：在 `.tv-focus` 元素间按方向移动焦点，
 * 电视浏览器（只有上下左右 + 确认键）即可操作首页与电影剧集页。
 * 输入框聚焦或有弹窗打开时不接管。
 */
export function SpatialNav() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const dir = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }[e.key] as
        | 'up'
        | 'down'
        | 'left'
        | 'right'
        | undefined;
      if (!dir || e.altKey || e.ctrlKey || e.metaKey) return;
      const active = document.activeElement as HTMLElement | null;
      if (active && (active.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName))) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;

      const candidates = [...document.querySelectorAll<HTMLElement>('.tv-focus')].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && el.offsetParent !== null && !el.hasAttribute('disabled');
      });
      if (candidates.length === 0) return;
      const current = active && candidates.includes(active) ? active : null;
      e.preventDefault();
      if (!current) {
        // 首次按键：聚焦主内容区的第一个可选项（跳过顶栏）
        (candidates.find((el) => !el.closest('header')) ?? candidates[0]).focus();
        return;
      }
      const from = current.getBoundingClientRect();
      const fx = from.left + from.width / 2;
      const fy = from.top + from.height / 2;
      let best: HTMLElement | null = null;
      let bestScore = Infinity;
      for (const el of candidates) {
        if (el === current) continue;
        const r = el.getBoundingClientRect();
        const x = r.left + r.width / 2;
        const y = r.top + r.height / 2;
        const dx = x - fx;
        const dy = y - fy;
        const forward = dir === 'up' ? -dy : dir === 'down' ? dy : dir === 'left' ? -dx : dx;
        if (forward <= 4) continue;
        const sideways = dir === 'up' || dir === 'down' ? Math.abs(dx) : Math.abs(dy);
        // 主方向距离 + 侧向偏移加权：优先同一行/同一列
        const score = forward + sideways * 2.5;
        if (score < bestScore) {
          bestScore = score;
          best = el;
        }
      }
      if (best) {
        best.focus({ preventScroll: true });
        best.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return null;
}
