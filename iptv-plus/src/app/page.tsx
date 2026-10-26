'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Header } from '@/components/header';
import { SiteFooter } from '@/components/site-footer';
import { Icon } from '@/components/icon';
import { ContinueCard, Poster, Row, SpatialNav, useContinueWatching } from '@/components/netflix';
import { useRecommendRows } from '@/components/vod-rows';
import { useT } from '@/lib/i18n';
import { liveHref } from '@/lib/live-href';
import { allLiveSources, useAppStore, type LiveRecentEntry } from '@/lib/store';

/**
 * 首页（入口）：两张大卡片——「电影剧集」与「直播」，下方为继续观看与最近频道。
 * 旧链接 /?s=关键词 自动转到 /vod?s=关键词（搜索已迁至电影剧集页）。
 */
export default function HomePage() {
  return (
    <Suspense>
      <HomeContent />
    </Suspense>
  );
}

function greeting(t: (zh: string, en: string) => string): string {
  const h = new Date().getHours();
  if (h < 5) return t('夜深了', 'Good night');
  if (h < 12) return t('早上好', 'Good morning');
  if (h < 18) return t('下午好', 'Good afternoon');
  return t('晚上好', 'Good evening');
}

function HomeContent() {
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const legacyQuery = searchParams.get('s');
  const history = useContinueWatching();
  const liveRecent = useAppStore((s) => s.liveRecent);
  const selectedKeys = useAppStore((s) => s.selectedKeys);
  const liveEnvSources = useAppStore((s) => s.liveEnvSources);
  const liveSubscriptions = useAppStore((s) => s.liveSubscriptions);
  const liveCount = allLiveSources({ liveEnvSources, liveSubscriptions }).length;
  // 问候语依赖本地时间：挂载后再算，避免与预渲染结果不一致
  const [hello, setHello] = useState('');
  useEffect(() => setHello(greeting(t)), [t]);

  useEffect(() => {
    if (legacyQuery) router.replace(`/vod?s=${encodeURIComponent(legacyQuery)}`);
  }, [legacyQuery, router]);

  // 电影卡背景：取第一条推荐榜单的前几张海报
  const rows = useRecommendRows();
  const postersQuery = useQuery({
    queryKey: ['vod-row', rows[0]?.key],
    queryFn: ({ signal }) => rows[0]!.load(signal),
    enabled: Boolean(rows[0]),
    staleTime: 30 * 60_000,
  });
  const posters = (postersQuery.data ?? []).slice(0, 6);

  return (
    <div className="min-h-screen flex flex-col pb-tabbar">
      <SpatialNav />
      <Header transparent />
      <main className="flex-1 -mt-14 md:-mt-16">
        <section className="relative overflow-hidden pt-20 md:pt-28 pb-8 md:pb-12">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                'radial-gradient(70% 55% at 15% 0%, rgba(229,9,20,0.28) 0%, transparent 70%), radial-gradient(60% 50% at 95% 10%, rgba(99,102,241,0.22) 0%, transparent 70%)',
            }}
          />
          <div className="relative px-4 md:px-8">
            <p className="text-sm md:text-base text-muted min-h-[1.5em]">{hello}</p>
            <h1 className="text-2xl md:text-4xl font-extrabold text-content mb-6 md:mb-8">
              {t('今天想看点什么？', 'What would you like to watch?')}
            </h1>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
              <EntryCard
                href="/vod"
                cta={t('进入', 'Browse')}
                title={t('电影剧集', 'Movies & Shows')}
                subtitle={t('搜索全部片源 · 热门榜单 · 继续观看', 'Search all your sources · Trending · Continue watching')}
                badge={selectedKeys.length > 0 ? t(`${selectedKeys.length} 个片源`, `${selectedKeys.length} sources`) : t('未添加片源', 'No sources yet')}
                icon="film"
                tone="from-[#e50914] via-[#8f0610] to-[#2a0204]"
                art={
                  posters.length > 0 && (
                    <div className="absolute -right-6 top-1/2 -translate-y-1/2 flex gap-2 rotate-[-8deg] opacity-90">
                      {posters.slice(0, 4).map((p, i) => (
                        <div
                          key={p.id}
                          className="w-20 md:w-28 aspect-[2/3] rounded-md overflow-hidden shadow-2xl ring-1 ring-black/40"
                          style={{ transform: `translateY(${i % 2 ? 18 : -10}px)` }}
                        >
                          <Poster url={p.cover} alt="" eager className="w-full h-full" />
                        </div>
                      ))}
                    </div>
                  )
                }
              />
              <EntryCard
                href="/live"
                cta={t('看直播', 'Watch')}
                title={t('直播', 'Live TV')}
                subtitle={t('频道 · 节目表 · 回看 · 多屏同看', 'Channels · TV guide · Catch-up · Multi-view')}
                badge={liveCount > 0 ? t(`${liveCount} 个直播源`, `${liveCount} live sources`) : t('未添加直播源', 'No live sources yet')}
                icon="tv"
                live
                tone="from-[#4f46e5] via-[#1e1b4b] to-[#0b0a1f]"
                art={
                  <div className="absolute right-4 md:right-8 top-1/2 -translate-y-1/2 grid grid-cols-3 gap-1.5 opacity-80 rotate-[-6deg]">
                    {Array.from({ length: 9 }).map((_, i) => (
                      <div
                        key={i}
                        className="w-10 md:w-14 aspect-video rounded bg-white/10 ring-1 ring-white/15"
                        style={{ background: `linear-gradient(135deg, hsla(${(i * 47) % 360},70%,55%,.55), rgba(255,255,255,.06))` }}
                      />
                    ))}
                  </div>
                }
              />
            </div>
          </div>
        </section>

        {history && history.length > 0 && (
          <Row
            title={t('继续观看', 'Continue watching')}
            action={
              <Link href="/vod" className="tv-focus text-xs md:text-sm text-muted hover:text-content rounded">
                {t('全部', 'See all')} ›
              </Link>
            }
          >
            {history.map((item) => (
              <ContinueCard key={item.id} item={item} />
            ))}
          </Row>
        )}

        {liveRecent.length > 0 && (
          <Row
            title={t('最近观看的频道', 'Recently watched channels')}
            action={
              <Link href="/live" className="tv-focus text-xs md:text-sm text-muted hover:text-content rounded">
                {t('全部频道', 'All channels')} ›
              </Link>
            }
          >
            {liveRecent.map((c) => (
              <ChannelCard key={c.url} channel={c} />
            ))}
          </Row>
        )}

        <div className="px-4 md:px-8 mb-10 grid grid-cols-2 md:grid-cols-4 gap-3">
          <QuickLink href="/live/guide" icon="clock" label={t('节目表', 'TV guide')} />
          <QuickLink href="/live/multi" icon="tv" label={t('多屏同看', 'Multi-view')} />
          <QuickLink href="/vod" icon="search" label={t('搜索影片', 'Search titles')} />
          <QuickLink href="/about" icon="info" label={t('使用说明', 'About & help')} />
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

function EntryCard({
  href,
  title,
  subtitle,
  badge,
  icon,
  tone,
  art,
  live,
  cta,
}: {
  href: string;
  title: string;
  subtitle: string;
  badge: string;
  icon: 'film' | 'tv';
  tone: string;
  art?: React.ReactNode;
  live?: boolean;
  cta: string;
}) {
  return (
    <Link
      href={href}
      className={`tv-focus group relative block overflow-hidden rounded-2xl bg-gradient-to-br ${tone} aspect-[16/8] md:aspect-[16/9] shadow-xl ring-1 ring-white/10 transition-transform duration-300 md:hover:scale-[1.02]`}
    >
      {art}
      <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/30 to-transparent" />
      <div className="relative h-full flex flex-col justify-end p-5 md:p-8">
        <div className="flex items-center gap-2 mb-2">
          <span className="w-10 h-10 md:w-12 md:h-12 rounded-xl bg-white/15 backdrop-blur flex items-center justify-center text-white">
            <Icon name={icon} className="w-6 h-6 md:w-7 md:h-7" />
          </span>
          {live && (
            <span className="flex items-center gap-1.5 bg-black/50 px-2 py-0.5 rounded-full">
              <span className="live-dot" />
              <span className="text-[10px] font-bold text-white tracking-wider">LIVE</span>
            </span>
          )}
        </div>
        <h2 className="text-2xl md:text-4xl font-extrabold text-white">{title}</h2>
        <p className="mt-1 text-xs md:text-sm text-white/80">{subtitle}</p>
        <div className="mt-3 flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-white px-4 py-1.5 text-sm font-bold text-black group-hover:bg-white/85">
            <Icon name="play" className="w-4 h-4" />
            {cta}
          </span>
          <span className="text-[11px] md:text-xs text-white/70">{badge}</span>
        </div>
      </div>
    </Link>
  );
}

function ChannelCard({ channel }: { channel: LiveRecentEntry }) {
  return (
    <Link
      href={liveHref(channel)}
      className="tv-focus shrink-0 w-36 md:w-44 rounded-md transition-transform duration-200 md:hover:scale-105"
      title={channel.name}
    >
      <div className="relative aspect-video rounded-md overflow-hidden bg-gradient-to-br from-chip to-hover flex items-center justify-center">
        {channel.logo ? (
          <Poster url={channel.logo} alt={channel.name} className="max-w-[70%] max-h-[70%] !object-contain" />
        ) : (
          <span className="text-2xl font-black text-muted">{channel.name.slice(0, 2)}</span>
        )}
        <span className="absolute top-1.5 left-1.5 flex items-center gap-1 bg-black/60 px-1.5 py-0.5 rounded">
          <span className="live-dot !w-1.5 !h-1.5" />
          <span className="text-[9px] font-bold text-white">LIVE</span>
        </span>
      </div>
      <p className="mt-1.5 text-xs md:text-sm text-muted truncate">{channel.name}</p>
    </Link>
  );
}

function QuickLink({ href, icon, label }: { href: string; icon: 'clock' | 'tv' | 'search' | 'info'; label: string }) {
  return (
    <Link
      href={href}
      className="tv-focus flex items-center gap-3 rounded-xl bg-surface border border-line px-4 py-3 text-sm font-medium text-content hover:bg-hover transition-colors"
    >
      <Icon name={icon} className="w-5 h-5 text-accent" />
      {label}
    </Link>
  );
}
