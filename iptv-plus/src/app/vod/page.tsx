'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Header } from '@/components/header';
import { ContinueCard, Row, SpatialNav, useContinueWatching } from '@/components/netflix';
import { RecommendRow, VodHero, useRecommendRows } from '@/components/vod-rows';
import { useT } from '@/lib/i18n';
import { DetailModal } from '@/components/detail-modal';
import { AggregatedCard, aggregateResults } from '@/components/video-card';
import { useAppStore, resolveSource, isInDisabledSubscription, isSourceDisabled } from '@/lib/store';
import { api } from '@/lib/client-api';
import type { SearchResultItem, SourceSearchOutcome } from '@/lib/types';
import { SearchHistoryDropdown, useSearchHistory } from '@/components/search-history';
import { cn, formatDisableTtl, validateSourceUrl } from '@/lib/utils';
import { useToast } from '@/components/toast';
import { EmptyState } from '@/components/states';
import { Icon } from '@/components/icon';
import { SiteFooter } from '@/components/site-footer';

/**
 * 电影剧集页（Netflix 风格）：未搜索时为大海报 + 继续观看 + 推荐榜单横向行；
 * 搜索（URL ?s= 驱动，可后退/分享）时展示聚合结果。
 * 搜索状态由 React Query 管理，失败源在结果区顶部以非阻塞方式展示。
 */
/** 搜索结果分批渲染的批大小：一次挂载上千张卡片会明显掉帧 */
const RESULT_PAGE_SIZE = 60;

export default function VodPage() {
  return (
    <Suspense>
      <VodContent />
    </Suspense>
  );
}

function VodContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { toast } = useToast();
  const t = useT();
  const rows = useRecommendRows();
  const history = useContinueWatching();
  const urlQuery = searchParams.get('s') || '';
  // 精确订阅所需字段（对齐 live 页的做法）：搜索流式期间逐源写健康度、
  // 打开设置抽屉/历史面板等无关 store 变化，都不应触发首页整树重渲染
  const customAPIs = useAppStore((s) => s.customAPIs);
  const envSources = useAppStore((s) => s.envSources);
  const selectedKeys = useAppStore((s) => s.selectedKeys);
  const yellowFilter = useAppStore((s) => s.yellowFilter);
  const sourceHealth = useAppStore((s) => s.sourceHealth);
  const subscriptions = useAppStore((s) => s.subscriptions);
  const [input, setInput] = useState(urlQuery);
  const [detailItem, setDetailItem] = useState<SearchResultItem | null>(null);
  /** 流式搜索中已结算的源（data 就绪前用于增量渲染） */
  const [streamedOutcomes, setStreamedOutcomes] = useState<SourceSearchOutcome[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // URL 驱动搜索：?s= 变化时回填输入框
  useEffect(() => {
    if (urlQuery) setInput(urlQuery);
  }, [urlQuery]);

  // 源名回显：失败/停用提示里显示友好名称而非裸 key
  const sourceName = (key: string) =>
    customAPIs.find((a) => a.key === key)?.name ??
    envSources.find((a) => a.key === key)?.name ??
    key;

  const selectedSources = useMemo(() => {
    // selectedKeys 可能含历史残留的重复 key：按 key 去重，避免同源重复搜索
    const seen = new Set<string>();
    return selectedKeys
      .map((key) => resolveSource({ customAPIs, envSources }, key))
      .filter((s): s is NonNullable<typeof s> => {
        if (!s || !validateSourceUrl(s.url) || seen.has(s.key)) return false;
        seen.add(s.key);
        return true;
      })
      // 自动停用期内的源不参与搜索（到期自动恢复）
      .filter((s) => !isSourceDisabled({ sourceHealth }, s.key))
      // 所属订阅被整体停用的源同样跳过（无损：各源勾选状态保留，重新启用即恢复）
      .filter((s) => !isInDisabledSubscription({ subscriptions }, s.key));
  }, [customAPIs, envSources, selectedKeys, sourceHealth, subscriptions]);
  const disabledSources = useMemo(
    () => selectedKeys.filter((key) => isSourceDisabled({ sourceHealth }, key)),
    [selectedKeys, sourceHealth]
  );
  // 来自已关闭订阅的源：勾选状态还在，但本次搜索用不到，必须明确告知
  const offSubscriptionSources = useMemo(
    () =>
      selectedKeys.filter(
        (key) => !isSourceDisabled({ sourceHealth }, key) && isInDisabledSubscription({ subscriptions }, key)
      ),
    [selectedKeys, sourceHealth, subscriptions]
  );

  const searchQuery = useQuery({
    queryKey: ['search', urlQuery, selectedKeys, yellowFilter],
    // 与 runSearch 的截断规则保持一致：顶栏搜索 / 手动构造长链接不会绕过上限
    queryFn: ({ signal }) => {
      setStreamedOutcomes([]);
      return api.search(urlQuery.slice(0, 100), selectedSources, yellowFilter, {
        signal,
        // 逐源结算即更新：结果边搜边渲染，同时滚动健康度
        onSource: (outcome) => {
          setStreamedOutcomes((prev) => [...prev, outcome]);
          for (const ev of useAppStore.getState().recordSourceHealth([outcome])) {
            toast(
              ev.permanent
                ? t(
                    `「${sourceName(ev.key)}」多次失败，已停止参与搜索，可在设置中恢复`,
                    `"${sourceName(ev.key)}" keeps failing and was removed from search; restore it in Settings`
                  )
                : t(
                    `「${sourceName(ev.key)}」连续超时/失败，已停用 ${formatDisableTtl(ev.ttlMs ?? 0)}`,
                    `"${sourceName(ev.key)}" timed out repeatedly and is paused for ${formatDisableTtl(ev.ttlMs ?? 0)}`
                  ),
              'warning'
            );
          }
        },
      });
    },
    enabled: Boolean(urlQuery) && selectedSources.length > 0,
    // 5 分钟内从播放页返回时直接使用缓存，不重新搜索（服务端另有 60s 结果缓存兜底）
    staleTime: 300_000,
  });

  // 最近搜索改为搜索框下拉（聚焦展开、按输入过滤），不再常驻首屏
  const searchHistory = useSearchHistory(input);

  const runSearch = (q: string) => {
    const query = q.trim().slice(0, 100);
    if (!query) {
      toast(t('请输入搜索内容', 'Type something to search'), 'info');
      inputRef.current?.focus();
      return;
    }
    if (selectedSources.length === 0) {
      toast(t('请先在设置中添加并勾选点播源', 'Add and enable a video source in Settings first'), 'warning');
      return;
    }
    router.push(`/vod?s=${encodeURIComponent(query)}`, { scroll: false });
    searchHistory.record(query);
  };

  const pickHistory = (text: string) => {
    setInput(text);
    searchHistory.close();
    runSearch(text);
  };

  const isSearching = Boolean(urlQuery) && searchQuery.isFetching && !searchQuery.data;
  // 聚合数据未就绪时，用已结算源的结果增量渲染（健康源不再等坏源超时）
  const streamedList = useMemo(
    () => streamedOutcomes.flatMap((o) => o.list),
    [streamedOutcomes]
  );
  const list = useMemo(
    () => searchQuery.data?.list ?? (isSearching ? streamedList : []),
    [searchQuery.data, isSearching, streamedList]
  );
  const failures =
    searchQuery.data?.failures ??
    streamedOutcomes
      .filter((o) => !o.ok)
      .map((o) => ({ sourceKey: o.sourceKey, error: o.error || t('请求失败', 'Request failed'), timedOut: o.timedOut }));
  // 跨源同名聚合：同名影片合并为一张卡片，展开后可选择具体来源
  const groups = useMemo(() => aggregateResults(list), [list]);

  // 分批渲染：新一次搜索（groups 变化）时重置回首批
  const [visibleCount, setVisibleCount] = useState(RESULT_PAGE_SIZE);
  const visibleGroups = useMemo(() => groups.slice(0, visibleCount), [groups, visibleCount]);
  useEffect(() => setVisibleCount(RESULT_PAGE_SIZE), [groups]);

  const pick = (title: string) => {
    setInput(title);
    runSearch(title);
  };

  return (
    <div className="min-h-screen flex flex-col pb-tabbar">
      <SpatialNav />
      <Header transparent={!urlQuery} showSearch={Boolean(urlQuery)} />

      {!urlQuery && (
        <main className="flex-1">
          <VodHero spec={rows[0]} onPick={pick} />

          {history && history.length > 0 && (
            <Row title={t('继续观看', 'Continue watching')}>
              {history.map((item) => (
                <ContinueCard key={item.id} item={item} />
              ))}
            </Row>
          )}

          {selectedSources.length === 0 && (
            <div className="px-4 md:px-8 mb-8">
              <NoSourceGuide hasSources={customAPIs.length > 0 || envSources.length > 0} />
            </div>
          )}

          {rows.map((spec) => (
            <RecommendRow key={spec.key} spec={spec} onPick={pick} />
          ))}
          {rows.length === 0 && (
            <p className="text-center text-sm text-faint py-16 px-4">
              {t('首页推荐已在设置中关闭，可直接搜索影片', 'Recommendations are turned off in Settings — use search to find titles')}
            </p>
          )}
        </main>
      )}

      {urlQuery && (
        <main className="flex-1 max-w-7xl w-full mx-auto px-4 md:px-8 py-6">
          {/* 搜索框：与输入框无缝拼接的最近搜索下拉沿用原实现 */}
          <section className="mb-6">
            <div ref={searchHistory.containerRef} className="relative w-full max-w-2xl">
              <form
                className="w-full"
                onSubmit={(e) => {
                  e.preventDefault();
                  runSearch(input);
                }}
              >
                <div
                  className={cn(
                    'flex items-stretch min-h-12 pl-4 border',
                    'transition-[background-color,border-color,border-radius] duration-200',
                    searchHistory.visible
                      ? 'rounded-t-xl rounded-b-none border-accent border-b-line bg-surface-raised'
                      : 'rounded-xl border-line bg-chip focus-within:border-accent focus-within:ring-1 focus-within:ring-accent/40'
                  )}
                >
                  <input
                    ref={inputRef}
                    className="flex-1 min-w-0 pr-2 bg-transparent text-base text-content placeholder:text-faint focus:outline-none"
                    placeholder={t('输入影片名称...', 'Movie or show title...')}
                    value={input}
                    maxLength={100}
                    onChange={(e) => {
                      setInput(e.target.value);
                      searchHistory.resetActive();
                    }}
                    onFocus={searchHistory.onFocus}
                    onKeyDown={(e) => searchHistory.onKeyDown(e, pickHistory)}
                    role="combobox"
                    aria-label={t('搜索影片', 'Search titles')}
                    aria-expanded={searchHistory.visible}
                    aria-controls="home-search-history"
                    aria-autocomplete="list"
                    aria-activedescendant={
                      searchHistory.visible && searchHistory.activeIndex >= 0
                        ? `home-search-history-${searchHistory.activeIndex}`
                        : undefined
                    }
                  />
                  {input && (
                    <button
                      type="button"
                      className="shrink-0 self-center mr-1 p-1.5 rounded-full text-faint hover:text-content hover:bg-hover transition-colors"
                      onClick={() => {
                        setInput('');
                        searchHistory.resetActive();
                        inputRef.current?.focus();
                      }}
                      aria-label={t('清空', 'Clear')}
                    >
                      <Icon name="close" className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    type="submit"
                    className={cn(
                      'btn-primary shrink-0 px-5 font-semibold transition-[background-color,filter] active:brightness-90',
                      '!rounded-l-none',
                      searchHistory.visible ? '!rounded-tr-xl !rounded-br-none' : '!rounded-r-xl'
                    )}
                  >
                    <Icon name="search" className="w-4 h-4" />
                    {t('搜索', 'Search')}
                  </button>
                </div>
              </form>
              {searchHistory.visible && (
                <SearchHistoryDropdown
                  id="home-search-history"
                  matches={searchHistory.matches}
                  activeIndex={searchHistory.activeIndex}
                  onPick={pickHistory}
                  onRemove={searchHistory.remove}
                  onClearAll={searchHistory.clearAll}
                />
              )}
            </div>
          </section>

          <section aria-label={t('搜索结果', 'Search results')} className="mb-10">
            <div className="flex items-center justify-between mb-3">
              <h1 className="text-lg md:text-2xl font-bold text-content">
                {t('搜索', 'Results for')} “{urlQuery}”
                <span className="block sm:inline sm:ml-2 text-xs md:text-sm font-normal text-faint">
                  {isSearching
                    ? t(
                        `已就绪 ${streamedOutcomes.length}/${selectedSources.length} 个源…`,
                        `${streamedOutcomes.length}/${selectedSources.length} sources ready…`
                      )
                    : searchQuery.data
                      ? t(
                          `${groups.length} 部影片 · ${list.length} 条结果${failures.length > 0 ? `，${failures.length} 个源失败` : ''}`,
                          `${groups.length} titles · ${list.length} results${failures.length > 0 ? `, ${failures.length} sources failed` : ''}`
                        )
                      : ''}
                </span>
              </h1>
            </div>

            {failures.length > 0 && (
              <div className="mb-3 text-xs bg-chip rounded-lg px-3 py-2 flex flex-wrap gap-x-3 gap-y-1">
                <span className="text-faint">
                  {isSearching ? t('以下源暂时无响应：', 'Still waiting on:') : t('部分点播源请求失败：', 'Some sources failed:')}
                </span>
                {failures.map((f) => (
                  <span key={f.sourceKey} className={f.timedOut ? 'text-warning' : 'text-faint'}>
                    {f.timedOut ? '⏱' : '✗'} {sourceName(f.sourceKey)}
                    {f.timedOut ? t(' 超时', ' timed out') : ''}
                  </span>
                ))}
              </div>
            )}

            {disabledSources.length > 0 && (
              <div className="mb-3 text-xs text-faint bg-chip rounded-lg px-3 py-2">
                {t(
                  `${disabledSources.length} 个源因连续超时/失败已暂停参与搜索（临时停用的到期自动恢复，长期停用的需在设置中手动恢复）：`,
                  `${disabledSources.length} sources are paused after repeated failures (temporary pauses end automatically; long-term ones can be restored in Settings): `
                )}
                {disabledSources.map((key) => sourceName(key)).join(t('、', ', '))}
              </div>
            )}

            {offSubscriptionSources.length > 0 && (
              <div className="mb-3 text-xs text-faint bg-chip rounded-lg px-3 py-2">
                {t(
                  `${offSubscriptionSources.length} 个源所属的订阅已停用，未参与本次搜索（在设置 → 数据源订阅中可重新启用）：`,
                  `${offSubscriptionSources.length} sources belong to a disabled subscription and were skipped (re-enable it in Settings → Subscriptions): `
                )}
                {offSubscriptionSources.map((key) => sourceName(key)).join(t('、', ', '))}
              </div>
            )}

            {selectedSources.length === 0 ? (
              <NoSourceGuide hasSources={customAPIs.length > 0 || envSources.length > 0} />
            ) : list.length > 0 ? (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 items-start">
                  {visibleGroups.map((group) => (
                    <AggregatedCard
                      key={group.key}
                      group={group}
                      sources={selectedSources}
                      onOpen={(item) => setDetailItem(item)}
                    />
                  ))}
                </div>
                {groups.length > visibleCount && (
                  <div className="flex justify-center mt-4">
                    <button
                      className="btn-ghost btn-sm tv-focus"
                      onClick={() => setVisibleCount((v) => v + RESULT_PAGE_SIZE)}
                    >
                      {t(`加载更多（还有 ${groups.length - visibleCount} 部）`, `Load more (${groups.length - visibleCount} left)`)}
                    </button>
                  </div>
                )}
              </>
            ) : isSearching ? (
              <ResultsSkeleton />
            ) : (
              <EmptyState
                icon="search"
                title={t('没有找到匹配的结果', 'No matching titles')}
                description={t('请尝试其他关键词或更换点播源', 'Try another title or add more sources')}
                className="!py-16"
              />
            )}
          </section>
        </main>
      )}

      <SiteFooter />

      <DetailModal item={detailItem} onClose={() => setDetailItem(null)} />
    </div>
  );
}

function ResultsSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {Array.from({ length: 6 }).map((_, i) => (
        // 结构对齐真实结果卡（左侧缩略图 + 右侧文字块），避免占位与真实卡片形状不符
        <div key={i} className="card flex h-28 overflow-hidden">
          <div className="w-[105px] sm:w-[120px] shrink-0 bg-chip animate-pulse" />
          <div className="flex-1 p-2.5 space-y-2">
            <div className="h-4 w-3/4 rounded bg-chip animate-pulse" />
            <div className="h-3 w-1/2 rounded bg-chip animate-pulse" />
            <div className="h-3 w-full rounded bg-chip animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** 无点播源 / 未勾选点播源时的引导（替代旧版首屏静默空白） */
function NoSourceGuide({ hasSources = false }: { hasSources?: boolean }) {
  const t = useT();
  return (
    <div className="border border-dashed border-line rounded-xl p-8 md:p-10 text-center max-w-xl mx-auto bg-surface/60">
      <h3 className="text-content font-semibold mb-2">
        {hasSources ? t('尚未勾选点播源', 'No video source is enabled') : t('先添加一个点播源', 'Add a video source to start')}
      </h3>
      <p className="text-sm text-muted leading-relaxed">
        {hasSources ? (
          t('打开「设置 → 源管理 → 点播源」，勾选要参与搜索的点播源后重新搜索。', 'Open Settings → Sources → Video sources, enable the sources to search, then search again.')
        ) : (
          <>
            {t(
              'IPTV Plus 不内置任何片源。打开「设置 → 源管理 → 点播源 → 添加 API」，填入一个 Apple CMS 采集站地址（如 ',
              'IPTV Plus has no built-in sources. Open Settings → Sources → Video sources → Add API and enter an Apple CMS source URL (e.g. '
            )}
            <code className="text-accent text-xs">https://example.com/api.php/provide/vod</code>
            {t('），勾选后即可搜索与播放。', '), then enable it to search and play.')}
          </>
        )}
      </p>
    </div>
  );
}
