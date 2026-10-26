'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { cn } from '@/lib/utils';
import { liveHref } from '@/lib/live-href';
import { Header } from '@/components/header';
import { Spinner } from '@/components/states';
import { LiveChannelList, type LiveChannelItem } from '@/components/live-channel-list';
import { useLiveChannels } from '@/components/use-live-channels';

// 播放器按需加载（与直播页同一拆包策略）
const LivePlayer = dynamic(() => import('@/components/live-player').then((m) => m.LivePlayer), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-black">
      <Spinner size="lg" tone="onDark" />
    </div>
  ),
});

/**
 * 多屏同看：2 或 4 个画面同时播放。
 * 点击画面标题栏选中该画面（仅选中画面出声），右侧频道列表点选即替换选中画面，
 * 并自动跳到下一个空画面。布局与各画面频道保存在本机，下次打开自动恢复。
 */

const STORAGE_KEY = 'iptv-plus:multiview';

interface TileState {
  url: string;
  name: string;
  group?: string;
  tvgId?: string;
  epg?: string;
}

interface Saved {
  layout: 2 | 4;
  tiles: (TileState | null)[];
}

function loadSaved(): Saved {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') as Saved | null;
    if (raw && (raw.layout === 2 || raw.layout === 4) && Array.isArray(raw.tiles)) {
      return { layout: raw.layout, tiles: [0, 1, 2, 3].map((i) => raw.tiles[i] ?? null) };
    }
  } catch {
    /* 隐私模式等场景读不到存储：使用默认布局 */
  }
  return { layout: 4, tiles: [null, null, null, null] };
}

export default function MultiViewPage() {
  return (
    <Suspense>
      <MultiContent />
    </Suspense>
  );
}

function MultiContent() {
  const { verified, channels, groups, isLoading } = useLiveChannels();
  const [layout, setLayout] = useState<2 | 4>(4);
  const [tiles, setTiles] = useState<(TileState | null)[]>([null, null, null, null]);
  const [active, setActive] = useState(0);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const saved = loadSaved();
    setLayout(saved.layout);
    setTiles(saved.tiles);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ layout, tiles }));
    } catch {
      /* 存储不可用时仅本次有效 */
    }
  }, [layout, tiles, hydrated]);

  const count = layout;

  const handleSelect = useCallback(
    (c: LiveChannelItem) => {
      const next = [...tiles];
      next[active] = { url: c.url, name: c.name, group: c.group, tvgId: c.tvgId, epg: c.epg };
      setTiles(next);
      // 自动跳到下一个空画面，连续点选即可铺满
      const empty = next.findIndex((t, i) => i < count && !t);
      if (empty >= 0) setActive(empty);
    },
    [tiles, active, count]
  );

  const currentUrl = tiles[active]?.url || '';

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-4">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <Link href="/live" className="btn-ghost text-xs">
            ← 直播
          </Link>
          <h1 className="text-base font-semibold text-content mr-2">多屏同看</h1>
          <span className="text-xs text-faint hidden sm:inline">点画面标题栏选中（选中画面出声），再从右侧点选频道</span>
          <span className="flex-1" />
          {([2, 4] as const).map((n) => (
            <button
              key={n}
              className={cn('btn-ghost text-xs', layout === n && '!border-accent !text-accent')}
              onClick={() => {
                setLayout(n);
                if (active >= n) setActive(0);
              }}
            >
              {n} 画面
            </button>
          ))}
          <button className="btn-ghost text-xs" onClick={() => setTiles([null, null, null, null])}>
            清空
          </button>
        </div>

        {!verified ? (
          <p className="text-faint text-sm text-center py-10">等待访问验证...</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
            <div className={cn('grid gap-2', layout === 4 ? 'grid-cols-2' : 'grid-cols-1 md:grid-cols-2')}>
              {tiles.slice(0, count).map((tile, i) => (
                <div
                  key={i}
                  className={cn(
                    'rounded-lg overflow-hidden border-2 bg-black flex flex-col',
                    i === active ? 'border-accent' : 'border-transparent'
                  )}
                >
                  <div
                    role="button"
                    tabIndex={0}
                    className={cn(
                      'flex items-center gap-2 px-2 py-1 text-xs cursor-pointer select-none',
                      i === active ? 'bg-accent text-on-accent' : 'bg-surface-raised text-muted hover:text-content'
                    )}
                    onClick={() => setActive(i)}
                    onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setActive(i)}
                  >
                    <span aria-hidden>{i === active ? '🔊' : '🔇'}</span>
                    <span className="truncate flex-1">{tile ? tile.name : `画面 ${i + 1}（空）`}</span>
                    {tile && (
                      <>
                        <Link
                          href={liveHref(tile)}
                          className="opacity-80 hover:opacity-100"
                          title="在直播页打开"
                          onClick={(e) => e.stopPropagation()}
                        >
                          ⤢
                        </Link>
                        <button
                          className="opacity-80 hover:opacity-100"
                          aria-label="关闭画面"
                          onClick={(e) => {
                            e.stopPropagation();
                            setTiles((prev) => prev.map((t, j) => (j === i ? null : t)));
                          }}
                        >
                          ✕
                        </button>
                      </>
                    )}
                  </div>
                  <div className="aspect-video">
                    {tile ? (
                      <LivePlayer url={tile.url} title={tile.name} muted={i !== active} concurrent />
                    ) : (
                      <button
                        className="w-full h-full flex items-center justify-center text-white/50 text-sm"
                        onClick={() => setActive(i)}
                      >
                        {i === active ? '从右侧选择频道' : '点击选中此画面'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <aside className="bg-surface-raised border border-line rounded-xl flex flex-col overflow-hidden h-[60vh] lg:h-[calc(100vh-8.5rem)] lg:sticky lg:top-20">
              {isLoading && channels.length === 0 ? (
                <div className="flex-1 flex items-center justify-center">
                  <Spinner size="lg" />
                </div>
              ) : (
                <LiveChannelList channels={channels} groups={groups} currentUrl={currentUrl} onSelect={handleSelect} />
              )}
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}
