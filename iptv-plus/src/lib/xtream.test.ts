import { describe, expect, it } from 'vitest';
import { assertXtreamAuth, buildXtreamPlaylist, parseXtreamUrl, xtreamTimezone } from './xtream';

const CREDS = { base: 'http://panel.example:8080', username: 'u ser', password: 'p/w' };

describe('parseXtreamUrl', () => {
  it('提取 player_api.php 地址中的凭据与根地址', () => {
    expect(parseXtreamUrl('http://panel.example:8080/player_api.php?username=a&password=b')).toEqual({
      base: 'http://panel.example:8080',
      username: 'a',
      password: 'b',
    });
    expect(parseXtreamUrl('https://x.example/sub/player_api.php?password=b&username=a')?.base).toBe(
      'https://x.example/sub'
    );
  });

  it('非 Xtream API 地址返回 undefined', () => {
    expect(parseXtreamUrl('http://x.example/get.php?username=a&password=b&type=m3u_plus')).toBeUndefined();
    expect(parseXtreamUrl('http://x.example/player_api.php?username=a')).toBeUndefined();
    expect(parseXtreamUrl('ftp://x.example/player_api.php?username=a&password=b')).toBeUndefined();
    expect(parseXtreamUrl('not a url')).toBeUndefined();
  });
});

describe('buildXtreamPlaylist', () => {
  const categories = [
    { category_id: '1', category_name: 'News' },
    { category_id: 2, category_name: 'Sports' },
  ];
  const streams = [
    { num: 2, name: 'Sport One', stream_id: 22, category_id: '2', stream_icon: 'http://logo/s.png', tv_archive: 1, tv_archive_duration: '5' },
    { num: 1, name: 'News One', stream_id: 11, category_id: 1, epg_channel_id: 'news.one', stream_icon: 'javascript:alert(1)' },
    { num: 3, name: 'Broken' },
  ];

  it('按 num 排序并映射分组、台标、EPG id、频道号与回看', () => {
    const playlist = buildXtreamPlaylist(CREDS, categories, streams, 'Europe/London');
    expect(playlist.channels.map((c) => c.name)).toEqual(['News One', 'Sport One']);
    const [news, sport] = playlist.channels;
    expect(news).toMatchObject({ id: 'news.one', tvgId: 'news.one', group: 'News', chno: '1', logo: undefined, catchup: undefined });
    expect(news.url).toBe('http://panel.example:8080/live/u%20ser/p%2Fw/11.m3u8');
    expect(sport).toMatchObject({ id: 'xt22', group: 'Sports', logo: 'http://logo/s.png', catchup: { type: 'xtream', days: 5, tz: 'Europe/London' } });
    expect(playlist.groups).toEqual(['News', 'Sports']);
    expect(playlist.epgUrl).toBe('http://panel.example:8080/xmltv.php?username=u+ser&password=p%2Fw');
  });

  it('容忍非数组响应', () => {
    expect(buildXtreamPlaylist(CREDS, null, { error: 1 }).channels).toEqual([]);
  });
});

describe('assertXtreamAuth / xtreamTimezone', () => {
  it('auth=0 或缺少 user_info 时抛错', () => {
    expect(() => assertXtreamAuth({ user_info: { auth: 0 } })).toThrow();
    expect(() => assertXtreamAuth({})).toThrow();
    expect(() => assertXtreamAuth({ user_info: { auth: 1, status: 'Expired' } })).toThrow(/Expired/);
    expect(() => assertXtreamAuth({ user_info: { auth: 1, status: 'Active' } })).not.toThrow();
  });

  it('只接受合法 IANA 时区', () => {
    expect(xtreamTimezone({ server_info: { timezone: 'Asia/Shanghai' } })).toBe('Asia/Shanghai');
    expect(xtreamTimezone({ server_info: { timezone: 'Mars/Base' } })).toBeUndefined();
    expect(xtreamTimezone(null)).toBeUndefined();
  });
});
