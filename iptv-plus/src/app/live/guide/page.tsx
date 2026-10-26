'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/client-api';
import { cn } from '@/lib/utils';
import { canCatchupProgram } from '@/lib/catchup';
import { liveHref } from '@/lib/live-href';
import { usePlusStore } from '@/lib/plus-store';
import { useAppStore } from '@/lib/store';
import type { EpgProgram } from '@/lib/types';
import { Header } from '@/components/header';
import { Dropdown } from '@/components/dropdown';
import { EmptyState, Spinner } from '@/components/states';
import { useToast } from '@/components/toast';
import { useT } from '@/lib/i18n';
import { fmtTime } from '@/components/live-epg-panel';
import { useLiveChannels } from '@/components/use-live-channels';
import type { LiveChannelItem } from '@/components/live-channel-list';

/**
 * 节目表网格：频道 × 时间轴（6 小时视窗，可前后翻 3 小时）。
 * - 节目按 EPG 地址分批查询（/api/live/epg/batch），每页 60 个频道；
 * - 点击节目：正在播 → 直播；已播且频道支持回看 → 回看；未播 → 预约提醒；
 * - 点击台名直接进入直播页。
 */

const HALF_HOUR = 30 * 60_000;
const SPAN_MS = 6 * 60 * 60_000;
const PX_PER_MIN = 4;
const PAGE_SIZE = 60;
const ALL = '__all';
const FAV = '__fav';

export default function LiveGuidePage() {
  return (
    <Suspense>
      <GuideContent />
    </Suspense>
  );
}

interface Selected {
  channel: LiveChannelItem;
  program: EpgProgram;
}

function GuideContent() {
  const router = useRouter();
  const { toast } = useToast();
  const t = useT();
  const { verified, channels, groups, isLoading } = useLiveChannels();
  const liveFavorites = useAppStore((s) => s.liveFavorites);
  const reminders = usePlusStore((s) => s.reminders);
  const [group, setGroup] = useState(ALL);
  const [shift, setShift] = useState(0);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  // 视窗起点：当前半点往前 1 小时（便于看到刚播完、可回看的节目），按 3 小时翻页
  const from = useMemo(() => Math.floor(now / HALF_HOUR) * HALF_HOUR - 2 * HALF_HOUR + shift * 3 * 3600_000, [now, shift]);
  const to = from + SPAN_MS;
  const width = (SPAN_MS / 60_000) * PX_PER_MIN;
  const x = (t: number) => ((t - from) / 60_000) * PX_PER_MIN;

  const filtered = useMemo(() => {
    const favs = new Set(liveFavorites);
    const list =
      group === ALL ? channels : group === FAV ? channels.filter((c) => favs.has(c.url)) : channels.filter((c) => c.group === group);
    // 仅有节目单来源的频道才能出现在节目表中
    return list.filter((c) => c.epg);
  }, [channels, group, liveFavorites]);
  const visible = filtered.slice(0, limit);

  useEffect(() => setLimit(PAGE_SIZE), [group]);

  const programsQuery = useQuery({
    queryKey: ['liveEpgGrid', from, visible.map((c) => c.url).join('|')],
    queryFn: async ({ signal }) => {
      const byEpg = new Map<string, LiveChannelItem[]>();
      for (const c of visible) {
        const list = byEpg.get(c.epg!) ?? [];
        list.push(c);
        byEpg.set(c.epg!, list);
      }
      const merged: Record<string, EpgProgram[]> = {};
      await Promise.all(
        [...byEpg].map(async ([url, list]) => {
          try {
            const res = await api.liveEpgBatch(
              { url, from, to, channels: list.map((c) => ({ key: c.url, tvgId: c.tvgId, name: c.name })) },
              signal
            );
            Object.assign(merged, res.programs);
          } catch {
            /* 单个节目单失败不影响其它来源 */
          }
        })
      );
      return merged;
    },
    enabled: verified && visible.length > 0,
    staleTime: 5 * 60_000,
  });

  // 首次加载与回到「现在」时，横向滚到当前时间附近
  useEffect(() => {
    if (shift === 0 && scrollRef.current) scrollRef.current.scrollLeft = Math.max(0, x(now) - 120);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shift, programsQuery.dataUpdatedAt]);

  const groupOptions = [
    { value: ALL, label: t('全部分组', 'All groups') },
    { value: FAV, label: t('★ 收藏', '★ Favorites') },
    ...groups.map((g) => ({ value: g, label: g })),
  ];

  const ticks: number[] = [];
  for (let t = from; t < to; t += HALF_HOUR) ticks.push(t);
  const nowX = x(now);

  const act = (kind: 'live' | 'catchup' | 'remind') => {
    if (!selected) return;
    const { channel, program } = selected;
    if (kind === 'live') router.push(liveHref(channel));
    if (kind === 'catchup') router.push(liveHref(channel, { start: program.start, stop: program.stop, title: program.title }));
    if (kind === 'remind') {
      const added = usePlusStore.getState().toggleReminder({
        channelUrl: channel.url,
        channelName: channel.name,
        title: program.title,
        start: program.start,
        stop: program.stop,
      });
      if (added && 'Notification' in window && Notification.permission === 'default') {
        void Notification.requestPermission().catch(() => {});
      }
      toast(
        added
          ? t(`已预约：${fmtTime(program.start)}「${program.title}」`, `Reminder set: ${fmtTime(program.start)} "${program.title}"`)
          : t('已取消预约', 'Reminder removed'),
        added ? 'success' : 'info'
      );
    }
  };

  return (
    <div className="min-h-screen flex flex-col pb-tabbar">
      <Header />
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 py-4 flex flex-col min-h-0">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <Link href="/live" className="btn-ghost text-xs">
            ← {t('直播', 'Live')}
          </Link>
          <h1 className="text-base font-semibold text-content mr-2">{t('节目表', 'TV guide')}</h1>
          <Dropdown ariaLabel={t('分组', 'Group')} value={group} onChange={setGroup} options={groupOptions} className="text-xs min-w-[8rem]" />
          <span className="flex-1" />
          <button className="btn-ghost text-xs" onClick={() => setShift((s) => s - 1)}>
            ◀ {t('3 小时', '3 h')}
          </button>
          <button className="btn-ghost text-xs" onClick={() => setShift(0)}>
            {t('现在', 'Now')}
          </button>
          <button className="btn-ghost text-xs" onClick={() => setShift((s) => s + 1)}>
            {t('3 小时', '3 h')} ▶
          </button>
        </div>

        {!verified ? (
          <p className="text-faint text-sm text-center py-10">{t('等待访问验证...', 'Waiting for sign-in...')}</p>
        ) : isLoading ? (
          <div className="flex justify-center py-16">
            <Spinner size="lg" />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            title={t('没有可显示节目单的频道', 'No channels with a programme guide')}
            description={t('节目表需要直播源提供 EPG 地址（在设置 → 直播源中填写，或使用带 x-tvg-url 的 M3U / Xtream 账号）', 'The guide needs an EPG URL from your live source (set it in Settings → Live sources, or use an M3U with x-tvg-url or an Xtream account)')}
          />
        ) : (
          <div className="relative border border-line rounded-lg bg-surface-raised overflow-hidden flex flex-col min-h-0 max-h-[calc(100vh-10rem)]">
            <div ref={scrollRef} className="overflow-auto scrollbar-thin">
              <div className="relative" style={{ width: `calc(var(--guide-ch) + ${width}px)` }}>
                {/* 时间刻度 */}
                <div className="flex sticky top-0 z-20 bg-surface-raised border-b border-line h-8">
                  <div className="sticky left-0 z-10 bg-surface-raised border-r border-line shrink-0 [width:var(--guide-ch)]" />
                  <div className="relative shrink-0" style={{ width }}>
                    {ticks.map((t) => (
                      <span key={t} className="absolute top-2 pl-1 text-[11px] text-faint border-l border-line" style={{ left: x(t) }}>
                        {fmtTime(t)}
                      </span>
                    ))}
                  </div>
                </div>
                {visible.map((c) => {
                  const progs = programsQuery.data?.[c.url] ?? [];
                  return (
                    <div key={c.url} className="flex h-[52px] border-b border-line">
                      <Link
                        href={liveHref(c)}
                        className="sticky left-0 z-10 shrink-0 flex items-center gap-2 px-2 bg-surface-raised border-r border-line text-xs font-medium text-content hover:text-accent [width:var(--guide-ch)]"
                        title={c.name}
                      >
                        {c.chno && <span className="text-faint tabular-nums">{c.chno}</span>}
                        <span className="truncate">{c.name}</span>
                      </Link>
                      <div className="relative shrink-0" style={{ width }}>
                        {programsQuery.isLoading ? null : progs.length === 0 ? (
                          <span className="absolute top-4 text-[11px] text-faint" style={{ left: Math.max(8, nowX - 100) }}>
                            {t('暂无节目信息', 'No information')}
                          </span>
                        ) : (
                          progs.map((p) => {
                            const left = Math.max(0, x(p.start));
                            const right = Math.min(width, x(p.stop));
                            const live = p.start <= now && p.stop > now;
                            const past = p.stop <= now;
                            const catchup = past && canCatchupProgram(c.catchup, p, now);
                            const reminded = reminders.some((r) => r.channelUrl === c.url && r.start === p.start);
                            const isSel = selected?.channel.url === c.url && selected.program.start === p.start;
                            return (
                              <button
                                key={`${p.start}-${p.title}`}
                                className={cn(
                                  'absolute top-1 bottom-1 rounded-md border px-2 text-left text-[11px] truncate transition-colors',
                                  live
                                    ? 'bg-accent/15 border-accent text-content'
                                    : past
                                      ? cn('bg-chip border-line text-faint', catchup && 'border-dashed text-muted')
                                      : 'bg-chip border-line text-content hover:border-accent',
                                  isSel && 'ring-2 ring-accent'
                                )}
                                style={{ left, width: Math.max(0, right - left - 2) }}
                                title={`${fmtTime(p.start)}–${fmtTime(p.stop)} ${p.title}`}
                                onClick={() => setSelected({ channel: c, program: p })}
                              >
                                {reminded && '🔔 '}
                                {catchup && '⟲ '}
                                {p.title}
                              </button>
                            );
                          })
                        )}
                      </div>
                    </div>
                  );
                })}
                {nowX > 0 && nowX < width && (
                  <div
                    className="absolute top-0 bottom-0 w-0.5 bg-danger z-[5] pointer-events-none"
                    style={{ left: `calc(var(--guide-ch) + ${nowX}px)` }}
                  />
                )}
              </div>
            </div>
            {filtered.length > visible.length && (
              <button className="btn-ghost text-xs m-2 self-center" onClick={() => setLimit((n) => n + PAGE_SIZE)}>
                {t('显示更多频道', 'Show more channels')}（{visible.length}/{filtered.length}）
              </button>
            )}
            {selected && (
              <div className="border-t border-line bg-card p-3 flex flex-wrap items-start gap-3">
                <div className="flex-1 min-w-[12rem]">
                  <p className="text-sm font-semibold text-content">{selected.program.title}</p>
                  <p className="text-[11px] text-faint">
                    {selected.channel.name} · {new Date(selected.program.start).toLocaleDateString()} {fmtTime(selected.program.start)}–
                    {fmtTime(selected.program.stop)}
                  </p>
                  {selected.program.desc && <p className="text-xs text-muted mt-1 line-clamp-3">{selected.program.desc}</p>}
                </div>
                <div className="flex flex-wrap gap-2">
                  {selected.program.start <= now && selected.program.stop > now && (
                    <button className="btn-primary text-xs" onClick={() => act('live')}>
                      ▶ {t('观看直播', 'Watch live')}
                    </button>
                  )}
                  {selected.program.start <= now && canCatchupProgram(selected.channel.catchup, selected.program, now) && (
                    <button className="btn-ghost text-xs" onClick={() => act('catchup')}>
                      ⟲ {selected.program.stop <= now ? t('回看', 'Watch') : t('从头看', 'Start over')}
                    </button>
                  )}
                  {selected.program.start > now && (
                    <button className="btn-ghost text-xs" onClick={() => act('remind')}>
                      {reminders.some((r) => r.channelUrl === selected.channel.url && r.start === selected.program.start)
                        ? t('🔔 取消预约', '🔔 Remove reminder')
                        : t('🔕 预约提醒', '🔕 Remind me')}
                    </button>
                  )}
                  <button className="btn-ghost text-xs" onClick={() => setSelected(null)}>
                    {t('关闭', 'Close')}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
