'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/client-api';
import { allLiveSources, useAppStore } from '@/lib/store';
import { isLockedChannel, parseLockKeywords, usePlusStore } from '@/lib/plus-store';
import { useAuth } from './auth';
import type { LiveChannelItem } from './live-channel-list';

/**
 * 聚合全部已启用直播源的频道（直播页、节目表、多屏共用）。
 * - 单源失败不影响整体；频道按流地址去重；
 * - 频道节目单：订阅配置的 EPG 优先，否则用播放列表自带的（x-tvg-url / Xtream xmltv.php）；
 * - 家长锁：设置了 PIN 且本次会话未解锁时，命中关键字的频道被过滤，并返回被隐藏数量。
 */
export function useLiveChannels() {
  const liveSelectedUrls = useAppStore((s) => s.liveSelectedUrls);
  const liveEnvSources = useAppStore((s) => s.liveEnvSources);
  const liveSubscriptions = useAppStore((s) => s.liveSubscriptions);
  const pinHash = usePlusStore((s) => s.pinHash);
  const unlocked = usePlusStore((s) => s.unlocked);
  const lockKeywords = usePlusStore((s) => s.lockKeywords);
  const { verified } = useAuth();

  // 仅聚合已启用的直播源（设置 → 直播源中的勾选状态）
  const sources = useMemo(() => {
    const selected = new Set(liveSelectedUrls);
    return allLiveSources({ liveEnvSources, liveSubscriptions }).filter((s) => selected.has(s.url));
  }, [liveSelectedUrls, liveEnvSources, liveSubscriptions]);

  const playlistsQuery = useQuery({
    queryKey: ['livePlaylists', sources.map((s) => s.url).join('|')],
    queryFn: async () => {
      const results = await Promise.allSettled(sources.map((s) => api.livePlaylist(s.url)));
      return sources.map((source, i) => ({ source, result: results[i] }));
    },
    enabled: verified && sources.length > 0,
    staleTime: 10 * 60_000,
  });

  const locking = Boolean(pinHash) && !unlocked;
  const keywords = useMemo(() => parseLockKeywords(lockKeywords), [lockKeywords]);

  const { channels, groups, failedCount, lockedCount } = useMemo(() => {
    const list: LiveChannelItem[] = [];
    const seen = new Set<string>();
    let failed = 0;
    let locked = 0;
    for (const { source, result } of playlistsQuery.data ?? []) {
      if (result.status !== 'fulfilled') {
        failed++;
        continue;
      }
      const epg = source.epg || result.value.epgUrl;
      for (const c of result.value.channels) {
        if (seen.has(c.url)) continue;
        seen.add(c.url);
        if (locking && isLockedChannel(c, keywords)) {
          locked++;
          continue;
        }
        list.push({ ...c, epg, sourceUrl: source.url });
      }
    }
    const groups = [...new Set(list.map((c) => c.group).filter((g): g is string => Boolean(g)))].sort((a, b) =>
      a.localeCompare(b, 'zh')
    );
    return { channels: list, groups, failedCount: failed, lockedCount: locked };
  }, [playlistsQuery.data, locking, keywords]);

  return {
    verified,
    sources,
    hasAnySource: liveEnvSources.length + liveSubscriptions.length > 0,
    channels,
    groups,
    failedCount,
    lockedCount,
    isLoading: playlistsQuery.isLoading,
  };
}
