'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ThemeToggle, useTheme } from './theme';
import { SourceManagerDrawer } from './source-manager';
import { HistoryPanel } from './history-panel';
import { requestShowDownloadManager } from './download-manager';
import { Icon, type IconName } from './icon';
import { SearchHistoryDropdown, useSearchHistory } from './search-history';
import { useLang } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * 顶部导航（Netflix 风格）：
 * - 桌面：Logo + 首页 / 电影剧集 / 直播 + 搜索、历史、下载、主题、语言、设置；
 *   `transparent` 时（首页海报区之上）顶部为渐变透明，滚动后转为实色；
 * - 手机：顶栏只保留 Logo、搜索与历史，主导航移到底部 Tab 栏（拇指可达）。
 * 所有可交互元素带 tv-focus：遥控器方向键移动时焦点清晰可见。
 */

const NAV: { href: string; zh: string; en: string; icon: IconName; match: (p: string) => boolean }[] = [
  { href: '/', zh: '首页', en: 'Home', icon: 'home', match: (p) => p === '/' },
  { href: '/vod', zh: '电影剧集', en: 'Movies & Shows', icon: 'film', match: (p) => p.startsWith('/vod') || p.startsWith('/watch') },
  { href: '/live', zh: '直播', en: 'Live TV', icon: 'tv', match: (p) => p.startsWith('/live') },
];

export function Header({ showSearch = false, transparent = false }: { showSearch?: boolean; transparent?: boolean }) {
  const router = useRouter();
  const pathname = usePathname() || '/';
  const { lang, setLang, t } = useLang();
  const { resolved } = useTheme();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'display' | undefined>(undefined);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(showSearch);
  const [query, setQuery] = useState('');
  const [scrolled, setScrolled] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // 与电影页搜索框共用同一套「最近搜索」下拉逻辑
  const searchHistory = useSearchHistory(query);

  useEffect(() => {
    if (!transparent) return;
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [transparent]);

  const submitSearch = (text: string) => {
    const q = text.trim().slice(0, 100);
    if (!q) return;
    searchHistory.close();
    router.push(`/vod?s=${encodeURIComponent(q)}`, { scroll: false });
    searchHistory.record(q);
  };

  const pickHistory = (text: string) => {
    setQuery(text);
    submitSearch(text);
  };

  const openSettings = (tab?: 'display') => {
    setSettingsTab(tab);
    setSettingsOpen(true);
  };

  // 浅色主题下不做透明顶栏（白字压在浅色背景上看不清）
  const solid = !transparent || scrolled || resolved === 'light';

  return (
    <>
      <header
        className={cn(
          'sticky top-0 z-40 transition-colors duration-300',
          solid ? 'bg-page/95 backdrop-blur border-b border-line/60' : 'bg-gradient-to-b from-black/80 to-transparent'
        )}
      >
        <div className="px-4 md:px-8 h-14 md:h-16 flex items-center gap-3 md:gap-6">
          <Link href="/" aria-label={t('IPTV Plus 首页', 'IPTV Plus home')} className="tv-focus flex items-center gap-2 shrink-0 rounded-md">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/icon-96.png" alt="" className="w-8 h-8 rounded-lg" />
            <span className={cn('text-lg font-extrabold tracking-tight', solid ? 'text-content' : 'text-white')}>
              IPTV<span className="text-accent">Plus</span>
            </span>
          </Link>

          {/* 桌面主导航 */}
          <nav className="hidden md:flex items-center gap-1" aria-label={t('主导航', 'Main navigation')}>
            {NAV.map((item) => {
              const active = item.match(pathname);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'tv-focus px-3 py-1.5 rounded-md text-sm transition-colors',
                    active
                      ? cn('font-semibold', solid ? 'text-content' : 'text-white')
                      : solid
                        ? 'text-muted hover:text-content'
                        : 'text-white/75 hover:text-white'
                  )}
                >
                  {t(item.zh, item.en)}
                </Link>
              );
            })}
          </nav>

          <div className="flex-1" />

          {/* 搜索：图标展开为输入框，提交后跳转电影剧集页 */}
          {searchOpen ? (
            <form
              className="relative w-40 sm:w-64"
              onSubmit={(e) => {
                e.preventDefault();
                submitSearch(query);
              }}
            >
              <div ref={searchHistory.containerRef} className="relative">
                <Icon name="search" className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-faint pointer-events-none" />
                <input
                  ref={inputRef}
                  className={cn(
                    'input w-full h-9 pl-8 !bg-black/40 !text-white !border-white/30 placeholder:!text-white/60',
                    solid && '!bg-chip !text-content !border-line placeholder:!text-faint',
                    searchHistory.visible && 'rounded-b-none'
                  )}
                  aria-label={t('搜索影片', 'Search titles')}
                  placeholder={t('搜索电影、剧集…', 'Movies, shows…')}
                  value={query}
                  maxLength={100}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    searchHistory.resetActive();
                  }}
                  onFocus={searchHistory.onFocus}
                  onBlur={() => !query && !showSearch && setTimeout(() => setSearchOpen(false), 150)}
                  onKeyDown={(e) => searchHistory.onKeyDown(e, pickHistory)}
                  role="combobox"
                  aria-expanded={searchHistory.visible}
                  aria-controls="header-search-history"
                  aria-autocomplete="list"
                  aria-activedescendant={
                    searchHistory.visible && searchHistory.activeIndex >= 0
                      ? `header-search-history-${searchHistory.activeIndex}`
                      : undefined
                  }
                />
                {searchHistory.visible && (
                  <SearchHistoryDropdown
                    id="header-search-history"
                    matches={searchHistory.matches}
                    activeIndex={searchHistory.activeIndex}
                    onPick={pickHistory}
                    onRemove={searchHistory.remove}
                    onClearAll={searchHistory.clearAll}
                  />
                )}
              </div>
            </form>
          ) : (
            <HeaderIcon
              label={t('搜索', 'Search')}
              light={!solid}
              onClick={() => {
                setSearchOpen(true);
                setTimeout(() => inputRef.current?.focus(), 0);
              }}
            >
              <Icon name="search" />
            </HeaderIcon>
          )}

          <div className="flex items-center gap-0.5">
            <HeaderIcon label={t('观看历史', 'Watch history')} light={!solid} onClick={() => setHistoryOpen(true)}>
              <Icon name="clock" />
            </HeaderIcon>
            <span className="hidden md:contents">
              <HeaderIcon label={t('下载管理', 'Downloads')} light={!solid} onClick={requestShowDownloadManager}>
                <Icon name="download" />
              </HeaderIcon>
              <span className={cn(!solid && 'text-white [&_button]:text-white/80')}>
                <ThemeToggle />
              </span>
              <button
                className={cn(
                  'tv-focus ml-1 px-2 py-1 rounded-md text-xs font-semibold border transition-colors',
                  solid ? 'border-line text-muted hover:text-content' : 'border-white/40 text-white/85 hover:text-white'
                )}
                title={t('切换为英文', 'Switch to Chinese')}
                aria-label={t('切换语言', 'Switch language')}
                onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
              >
                {lang === 'zh' ? 'EN' : '中'}
              </button>
              <HeaderIcon label={t('设置', 'Settings')} light={!solid} onClick={() => openSettings()}>
                <Icon name="gear" />
              </HeaderIcon>
            </span>
          </div>
        </div>
      </header>

      <BottomTabBar pathname={pathname} onOpenMe={() => openSettings('display')} />

      <SourceManagerDrawer open={settingsOpen} initialTab={settingsTab} onClose={() => setSettingsOpen(false)} />
      <HistoryPanel open={historyOpen} onClose={() => setHistoryOpen(false)} />
    </>
  );
}

/** 手机底部导航：首页 / 电影剧集 / 直播 / 设置（≥768px 隐藏，由顶栏导航替代） */
function BottomTabBar({ pathname, onOpenMe }: { pathname: string; onOpenMe: () => void }) {
  const t = useLang().t;
  const tabClass = (active: boolean) =>
    cn(
      'tv-focus flex-1 flex flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] rounded-md transition-colors',
      active ? 'text-content font-semibold' : 'text-faint'
    );
  return (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-page/95 backdrop-blur border-t border-line flex px-2 pb-[env(safe-area-inset-bottom)]"
      aria-label={t('底部导航', 'Tab bar')}
    >
      {NAV.map((item) => {
        const active = item.match(pathname);
        return (
          <Link key={item.href} href={item.href} className={tabClass(active)} aria-current={active ? 'page' : undefined}>
            <Icon name={item.icon} className={cn('w-6 h-6', active && 'text-accent')} />
            {t(item.zh, item.en)}
          </Link>
        );
      })}
      <button className={tabClass(false)} onClick={onOpenMe}>
        <Icon name="user" className="w-6 h-6" />
        {t('我的', 'Me')}
      </button>
    </nav>
  );
}

function HeaderIcon({
  label,
  onClick,
  light,
  children,
}: {
  label: string;
  onClick: () => void;
  light?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      className={cn(
        'tv-focus p-2 rounded-md transition-colors',
        light ? 'text-white/85 hover:text-white hover:bg-white/10' : 'text-muted hover:text-content hover:bg-hover'
      )}
      title={label}
      aria-label={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
