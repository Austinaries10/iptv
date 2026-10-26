import type { LiveChannel, LivePlaylistResponse } from './types';

/**
 * Xtream Codes 面板支持。
 *
 * 用户把面板的 API 地址作为直播源添加即可：
 *   http://host:port/player_api.php?username=U&password=P
 * 服务端据此拉取直播分类与频道（含频道号、台标、EPG id、回看天数），
 * 频道地址为 `/live/U/P/<id>.m3u8`，节目单自动指向面板的 `xmltv.php`。
 *
 * `get.php?...&type=m3u_plus` 本身就是 M3U，走普通解析即可，这里不处理。
 */

export interface XtreamCredentials {
  /** 面板根地址（协议 + 主机 + 端口 + 可能的子路径），无结尾斜杠 */
  base: string;
  username: string;
  password: string;
}

/** 识别 player_api.php 地址并提取凭据；不是 Xtream API 地址返回 undefined */
export function parseXtreamUrl(raw: string): XtreamCredentials | undefined {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return undefined;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined;
  if (!/\/player_api\.php$/i.test(u.pathname)) return undefined;
  const username = u.searchParams.get('username');
  const password = u.searchParams.get('password');
  if (!username || !password) return undefined;
  const base = `${u.origin}${u.pathname.replace(/\/player_api\.php$/i, '')}`;
  return { base, username, password };
}

function seg(value: string): string {
  return encodeURIComponent(value);
}

export function xtreamApiUrl(c: XtreamCredentials, action?: string): string {
  const sp = new URLSearchParams({ username: c.username, password: c.password });
  if (action) sp.set('action', action);
  return `${c.base}/player_api.php?${sp.toString()}`;
}

export function xtreamEpgUrl(c: XtreamCredentials): string {
  const sp = new URLSearchParams({ username: c.username, password: c.password });
  return `${c.base}/xmltv.php?${sp.toString()}`;
}

export function xtreamLiveUrl(c: XtreamCredentials, streamId: string | number): string {
  return `${c.base}/live/${seg(c.username)}/${seg(c.password)}/${streamId}.m3u8`;
}

interface XtreamCategory {
  category_id?: string | number;
  category_name?: string;
}

interface XtreamLiveStream {
  num?: string | number;
  name?: string;
  stream_id?: string | number;
  stream_icon?: string;
  epg_channel_id?: string | null;
  category_id?: string | number;
  tv_archive?: string | number;
  tv_archive_duration?: string | number;
}

/**
 * 由面板 API 响应构建播放列表。纯函数，便于单测；网络请求由路由层负责。
 * 频道按面板 `num` 排序（面板后台设定的频道顺序）。
 */
export function buildXtreamPlaylist(
  c: XtreamCredentials,
  categories: unknown,
  streams: unknown,
  timezone?: string
): LivePlaylistResponse {
  const names = new Map<string, string>();
  for (const cat of Array.isArray(categories) ? (categories as XtreamCategory[]) : []) {
    if (cat?.category_id != null && cat.category_name) names.set(String(cat.category_id), cat.category_name);
  }
  const list = Array.isArray(streams) ? (streams as XtreamLiveStream[]) : [];
  const sorted = [...list].sort((a, b) => (Number(a.num) || Infinity) - (Number(b.num) || Infinity));
  const channels: LiveChannel[] = [];
  const seen = new Set<string>();
  for (const s of sorted) {
    if (s?.stream_id == null) continue;
    const url = xtreamLiveUrl(c, s.stream_id);
    if (seen.has(url)) continue;
    seen.add(url);
    const tvgId = s.epg_channel_id?.trim() || undefined;
    const archiveDays = Number(s.tv_archive) ? Number(s.tv_archive_duration) || 1 : 0;
    channels.push({
      id: tvgId || `xt${s.stream_id}`,
      name: s.name?.trim() || `Channel ${s.stream_id}`,
      url,
      logo: /^https?:\/\//i.test(s.stream_icon || '') ? s.stream_icon : undefined,
      group: names.get(String(s.category_id)) || undefined,
      tvgId,
      chno: s.num != null && s.num !== '' ? String(s.num) : undefined,
      catchup: archiveDays ? { type: 'xtream', days: archiveDays, ...(timezone ? { tz: timezone } : {}) } : undefined,
    });
  }
  const groups = [...new Set(channels.map((ch) => ch.group).filter((g): g is string => Boolean(g)))].sort((a, b) =>
    a.localeCompare(b, 'zh')
  );
  return { channels, groups, epgUrl: xtreamEpgUrl(c) };
}

/** 取面板时区（server_info.timezone），非法值返回 undefined */
export function xtreamTimezone(info: unknown): string | undefined {
  const tz = (info as { server_info?: { timezone?: unknown } } | null)?.server_info?.timezone;
  if (typeof tz !== 'string' || !tz) return undefined;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return undefined;
  }
}

/** 校验登录响应：auth=0 或缺少 user_info 视为凭据错误 */
export function assertXtreamAuth(info: unknown): void {
  const userInfo = (info as { user_info?: { auth?: unknown; status?: unknown } } | null)?.user_info;
  if (!userInfo || Number(userInfo.auth) === 0) throw new Error('Xtream 登录失败，请检查用户名和密码');
  const status = typeof userInfo.status === 'string' ? userInfo.status : '';
  if (status && status.toLowerCase() !== 'active') throw new Error(`Xtream 账号状态异常：${status}`);
}
