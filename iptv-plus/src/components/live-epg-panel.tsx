'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/client-api';
import { cn } from '@/lib/utils';
import { canCatchupProgram } from '@/lib/catchup';
import { usePlusStore } from '@/lib/plus-store';
import type { EpgProgram, LiveCatchup } from '@/lib/types';
import { EmptyState, ErrorState, Spinner } from './states';
import { useToast } from './toast';
import { useLang } from '@/lib/i18n';

/**
 * EPG 节目单面板：当前节目（含播放进度条）+ 接下来节目（可预约提醒）+ 回看列表。
 * 频道带 tvg-id 时按 id 查询，否则按台名匹配；来源未提供 EPG 地址时优雅降级。
 * 频道支持回看时：当前节目可「从头看」，已播节目可点击回看。
 */

export function fmtTime(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** 非今天的节目在时间前加「周几」 */
function fmtDayTime(ms: number, now: number, lang: 'zh' | 'en'): string {
  const d = new Date(ms);
  if (d.toDateString() === new Date(now).toDateString()) return fmtTime(ms);
  const day = lang === 'zh' ? `周${'日一二三四五六'[d.getDay()]}` : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
  return `${day} ${fmtTime(ms)}`;
}

/** 已播节目默认展示条数（可展开） */
const PAST_PREVIEW = 6;

export interface EpgChannelRef {
  url: string;
  name: string;
  tvgId?: string;
  epg?: string;
  catchup?: LiveCatchup;
}

interface LiveEpgPanelProps {
  channel: EpgChannelRef;
  /** 点击回看节目（含「从头看」当前节目）；未传则不展示回看入口 */
  onPlayCatchup?: (program: EpgProgram) => void;
  /** 正在回看的节目开播时间（高亮用） */
  catchupStart?: number;
}

export function LiveEpgPanel({ channel, onPlayCatchup, catchupStart }: LiveEpgPanelProps) {
  const [now, setNow] = useState(() => Date.now());
  const [expandedDesc, setExpandedDesc] = useState(false);
  const [showAllPast, setShowAllPast] = useState(false);
  const reminders = usePlusStore((s) => s.reminders);
  const { toast } = useToast();
  const { lang, t } = useLang();

  // 30s 心跳刷新进度
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => setShowAllPast(false), [channel.url]);

  const { epg: epgUrl, tvgId, name } = channel;
  const enabled = Boolean(epgUrl && (tvgId || name));
  const epgQuery = useQuery({
    queryKey: ['liveEpg', epgUrl, tvgId, name],
    queryFn: ({ signal }) => api.liveEpg(epgUrl!, { tvgId, name }, false, signal),
    enabled,
    staleTime: 10 * 60_000,
  });

  if (!enabled) {
    return (
      <EmptyState
        variant="plain"
        title={t('该频道未配置节目单数据（可在设置 → 直播源中为订阅填写 EPG 地址）', 'No programme guide for this channel (add an EPG URL to the source in Settings → Live sources)')}
        className="!py-4"
      />
    );
  }

  if (epgQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Spinner size="sm" />
      </div>
    );
  }

  if (epgQuery.isError) {
    return <ErrorState message={t('节目单加载失败', 'Could not load the programme guide')} onRetry={() => epgQuery.refetch()} className="!py-4" />;
  }

  const programs = epgQuery.data?.programs ?? [];
  const current = programs.find((p) => p.start <= now && p.stop > now);
  const upcoming: EpgProgram[] = programs.filter((p) => p.start > now).slice(0, 6);
  const canCatchup = Boolean(onPlayCatchup && channel.catchup);
  const past = canCatchup
    ? programs.filter((p) => p.stop <= now && canCatchupProgram(channel.catchup, p, now)).reverse()
    : [];
  const pastShown = showAllPast ? past : past.slice(0, PAST_PREVIEW);

  const progress = current ? Math.min(100, Math.max(0, ((now - current.start) / (current.stop - current.start)) * 100)) : 0;

  const toggleReminder = (p: EpgProgram) => {
    const added = usePlusStore.getState().toggleReminder({
      channelUrl: channel.url,
      channelName: channel.name,
      title: p.title,
      start: p.start,
      stop: p.stop,
    });
    if (added && 'Notification' in window && Notification.permission === 'default') {
      void Notification.requestPermission().catch(() => {});
    }
    toast(
      added
        ? t(`已预约：${fmtTime(p.start)}「${p.title}」，开播前提醒`, `Reminder set: ${fmtTime(p.start)} "${p.title}"`)
        : t('已取消预约', 'Reminder removed'),
      added ? 'success' : 'info'
    );
  };

  return (
    <div className="space-y-3">
      {current ? (
        <div className="bg-card border border-line rounded-lg p-3">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[10px] font-semibold text-danger bg-danger/10 px-1.5 py-0.5 rounded-full">
              {t('正在播出', 'On now')}
            </span>
            <span className="text-[10px] text-faint">
              {fmtTime(current.start)} - {fmtTime(current.stop)}
            </span>
            {canCatchup && (
              <button
                className={cn(
                  'ml-auto text-[11px] px-2 py-0.5 rounded-full border transition-colors',
                  catchupStart === current.start
                    ? 'border-accent text-accent'
                    : 'border-line text-muted hover:text-accent hover:border-accent'
                )}
                title={t('从本节目开头播放（回看）', 'Play this programme from the start')}
                onClick={() => onPlayCatchup?.(current)}
              >
                ⟲ {t('从头看', 'Start over')}
              </button>
            )}
          </div>
          <button
            className="text-sm font-medium text-content w-full text-left"
            aria-expanded={expandedDesc}
            onClick={() => setExpandedDesc((v) => !v)}
          >
            {current.title}
          </button>
          {current.desc && expandedDesc && (
            <p className="text-xs text-muted mt-1.5 leading-relaxed animate-fade-in">{current.desc}</p>
          )}
          {/* 已播进度条 */}
          <div className="mt-2.5 h-1 rounded-full bg-chip overflow-hidden">
            <div
              className="h-full bg-accent rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-faint mt-1">
            <span>{fmtTime(current.start)}</span>
            <span>{Math.round(progress)}%</span>
            <span>{fmtTime(current.stop)}</span>
          </div>
        </div>
      ) : (
        <p className="text-xs text-faint text-center py-2">{t('当前时段暂无节目数据', 'No programme information right now')}</p>
      )}

      {upcoming.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-content mb-1.5">{t('接下来', 'Up next')}</h4>
          <ul className="space-y-1">
            {upcoming.map((p) => {
              const reminded = reminders.some((r) => r.channelUrl === channel.url && r.start === p.start);
              return (
                <li
                  key={`${p.start}-${p.title}`}
                  className="flex items-center gap-2 text-xs px-2 py-1.5 rounded-md text-muted hover:bg-hover transition-colors"
                  title={p.desc || p.title}
                >
                  <span className="text-faint tabular-nums shrink-0">{fmtDayTime(p.start, now, lang)}</span>
                  <span className="text-content truncate flex-1">{p.title}</span>
                  <button
                    className={cn(
                      'shrink-0 rounded px-1.5 py-0.5 transition-colors',
                      reminded ? 'text-warning' : 'text-faint hover:text-accent'
                    )}
                    aria-label={reminded ? t('取消预约提醒', 'Remove reminder') : t('预约提醒', 'Remind me')}
                    title={reminded ? t('取消预约提醒', 'Remove reminder') : t('开播前提醒我', 'Remind me when it starts')}
                    onClick={() => toggleReminder(p)}
                  >
                    {reminded ? '🔔' : '🔕'}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {past.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-content mb-1.5">
            {t('回看', 'Catch-up')} <span className="font-normal text-faint">{t('（点击节目播放，可拖动进度）', '(tap a programme to watch it)')}</span>
          </h4>
          <ul className="space-y-1">
            {pastShown.map((p) => (
              <li key={`${p.start}-${p.title}`}>
                <button
                  className={cn(
                    'w-full flex items-center gap-2 text-xs px-2 py-1.5 rounded-md text-left transition-colors',
                    catchupStart === p.start ? 'bg-accent/10 text-accent' : 'text-muted hover:bg-hover'
                  )}
                  title={p.desc || p.title}
                  onClick={() => onPlayCatchup?.(p)}
                >
                  <span className="text-faint tabular-nums shrink-0">{fmtDayTime(p.start, now, lang)}</span>
                  <span className="truncate flex-1 text-content">{p.title}</span>
                  <span className="shrink-0">▶</span>
                </button>
              </li>
            ))}
          </ul>
          {past.length > PAST_PREVIEW && (
            <button className="text-[11px] text-accent mt-1 px-2" onClick={() => setShowAllPast((v) => !v)}>
              {showAllPast ? t('收起', 'Show less') : t(`显示全部 ${past.length} 个`, `Show all ${past.length}`)}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
