'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/client-api';
import { useT } from '@/lib/i18n';
import { useAppStore } from '@/lib/store';
import type { DoubanItem } from '@/lib/types';
import { Icon } from './icon';
import { Poster, PosterCard, Row, RowSkeleton } from './netflix';

/**
 * 电影剧集页的推荐区（Netflix 式）：顶部大海报 + 多条横向榜单行。
 * 数据源沿用设置里的「首页推荐」选项（影视热榜 / 豆瓣 / Bangumi），
 * 推荐只提供片名与海报，点击即用片名搜索你的点播源。
 */

interface RowSpec {
  key: string;
  zh: string;
  en: string;
  load: (signal?: AbortSignal) => Promise<DoubanItem[]>;
  ranked?: boolean;
}

const HOT_ROWS: RowSpec[] = [
  { key: 'douban_movie_weekly', zh: '本周热门电影', en: 'Top movies this week', ranked: true },
  { key: 'douban_tv_chinese', zh: '华语剧集周榜', en: 'Top Chinese series', ranked: true },
  { key: 'douban_tv_global', zh: '海外剧集周榜', en: 'Top international series', ranked: true },
  { key: 'baidu_teleplay', zh: '百度热播剧', en: 'Trending dramas' },
  { key: 'douban_show_chinese', zh: '国内综艺', en: 'Chinese variety shows' },
  { key: 'douban_show_global', zh: '海外综艺', en: 'International variety shows' },
].map((r) => ({ ...r, load: (signal?: AbortSignal) => api.hotList(r.key, signal).then((d) => d.items) }));

const DOUBAN_ROWS: RowSpec[] = (
  [
    ['movie', '热门', '热门电影', 'Popular movies'],
    ['tv', '热门', '热门剧集', 'Popular series'],
    ['movie', '豆瓣高分', '高分电影', 'Top rated movies'],
    ['tv', '美剧', '美剧', 'US series'],
    ['tv', '韩剧', '韩剧', 'K-dramas'],
    ['tv', '日本动画', '日本动画', 'Anime'],
    ['movie', '华语', '华语电影', 'Chinese movies'],
  ] as const
).map(([type, tag, zh, en]) => ({
  key: `${type}-${tag}`,
  zh,
  en,
  load: (signal?: AbortSignal) => api.douban(type, tag, 0, 30, signal).then((d) => d.items),
}));

const WEEKDAYS: [string, string][] = [
  ['周一', 'Monday'],
  ['周二', 'Tuesday'],
  ['周三', 'Wednesday'],
  ['周四', 'Thursday'],
  ['周五', 'Friday'],
  ['周六', 'Saturday'],
  ['周日', 'Sunday'],
];

/** Bangumi：今天开始的一周放送表，每天一行 */
function bangumiRows(): RowSpec[] {
  const today = ((new Date().getDay() + 6) % 7) + 1; // 1=周一 … 7=周日
  return Array.from({ length: 7 }, (_, i) => ((today - 1 + i) % 7) + 1).map((weekday, i) => ({
    key: `bangumi-${weekday}`,
    zh: i === 0 ? '今日新番' : `${WEEKDAYS[weekday - 1][0]}放送`,
    en: i === 0 ? 'New anime today' : `Airing ${WEEKDAYS[weekday - 1][1]}`,
    load: (signal?: AbortSignal) =>
      api.bangumiCalendar(signal).then((d) => d.days.find((x) => x.weekday === weekday)?.items ?? []),
  }));
}

export function useRecommendRows(): RowSpec[] {
  const doubanEnabled = useAppStore((s) => s.doubanEnabled);
  const recommendSource = useAppStore((s) => s.recommendSource);
  return useMemo(() => {
    if (!doubanEnabled) return [];
    if (recommendSource === 'bangumi') return bangumiRows();
    if (recommendSource === 'douban') return DOUBAN_ROWS;
    return HOT_ROWS;
  }, [doubanEnabled, recommendSource]);
}

function useRowItems(spec: RowSpec | undefined) {
  return useQuery({
    queryKey: ['vod-row', spec?.key],
    queryFn: ({ signal }) => spec!.load(signal),
    enabled: Boolean(spec),
    staleTime: 30 * 60_000,
  });
}

/** 大海报：取第一条榜单的第一名 */
export function VodHero({ spec, onPick }: { spec?: RowSpec; onPick: (title: string) => void }) {
  const t = useT();
  const query = useRowItems(spec);
  const item = query.data?.[0];
  if (!spec) return <div className="h-24" />;
  return (
    <section className="relative -mt-14 md:-mt-16 mb-4 md:mb-8">
      <div className="relative h-[68vh] min-h-[420px] max-h-[720px] overflow-hidden bg-[#141414]">
        {item ? (
          <>
            {/* 背景：海报放大虚化铺满，右侧叠清晰海报（竖版海报做横版大图的常用手法） */}
            <Poster url={item.cover} alt="" eager className="absolute inset-0 w-full h-full scale-110 blur-2xl opacity-60" />
            {/* 海报区始终是深色（白字），两个主题一致；底部再淡入页面底色 */}
            <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/55 to-transparent" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/40" />
            <div className="hidden sm:block absolute right-[8%] top-1/2 -translate-y-1/2 w-[26%] max-w-[300px] aspect-[2/3] rounded-lg overflow-hidden shadow-2xl ring-1 ring-white/10">
              <Poster url={item.cover} alt={item.title} eager className="w-full h-full" />
            </div>
          </>
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-accent/40 via-[#1a1a1a] to-[#141414]" />
        )}
        <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-page to-transparent" />
        <div className="absolute inset-x-0 bottom-[12%] px-4 md:px-8 max-w-2xl">
          {/* 手机：居中小海报 */}
          {item && (
            <div className="sm:hidden mx-auto mb-4 w-40 aspect-[2/3] rounded-lg overflow-hidden shadow-2xl ring-1 ring-white/10">
              <Poster url={item.cover} alt={item.title} eager className="w-full h-full" />
            </div>
          )}
          <div className="flex items-center gap-2 mb-2 justify-center sm:justify-start">
            <span className="bg-accent text-on-accent text-[11px] font-bold px-1.5 py-0.5 rounded">TOP 1</span>
            <span className="text-sm text-white/85">{t(spec.zh, spec.en)}</span>
          </div>
          <h1 className="text-3xl md:text-6xl font-extrabold text-white leading-tight text-center sm:text-left [text-shadow:0_2px_12px_rgba(0,0,0,.6)]">
            {item?.title ?? (query.isLoading ? '…' : t('发现好片', 'Discover something great'))}
          </h1>
          {item?.rating && (
            <p className="mt-2 text-sm text-white/80 text-center sm:text-left">
              <span className="text-rating font-semibold">★ {item.rating}</span> · {t('豆瓣评分', 'Douban rating')}
            </p>
          )}
          {item && (
            <div className="mt-5 flex gap-3 justify-center sm:justify-start">
              <button
                className="tv-focus inline-flex items-center gap-2 rounded-md bg-white px-6 py-2.5 text-base font-bold text-black hover:bg-white/80"
                onClick={() => onPick(item.title)}
              >
                <Icon name="play" className="w-5 h-5" /> {t('播放', 'Play')}
              </button>
              <button
                className="tv-focus inline-flex items-center gap-2 rounded-md bg-white/25 px-5 py-2.5 text-base font-semibold text-white backdrop-blur hover:bg-white/35"
                onClick={() => onPick(item.title)}
              >
                <Icon name="info" className="w-5 h-5" /> {t('选择片源', 'Find sources')}
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export function RecommendRow({ spec, onPick }: { spec: RowSpec; onPick: (title: string) => void }) {
  const t = useT();
  const query = useRowItems(spec);
  const items = query.data ?? [];
  if (query.isError || (!query.isLoading && items.length === 0)) return null;
  return (
    <Row title={t(spec.zh, spec.en)}>
      {query.isLoading ? (
        <RowSkeleton />
      ) : (
        items.map((item, i) => (
          <PosterCard
            key={item.id}
            title={item.title}
            cover={item.cover}
            rating={item.rating}
            rank={spec.ranked ? i : undefined}
            onClick={() => onPick(item.title)}
          />
        ))
      )}
    </Row>
  );
}
