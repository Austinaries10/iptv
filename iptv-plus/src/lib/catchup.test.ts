import { describe, expect, it } from 'vitest';
import { buildCatchupUrl, canCatchupProgram } from './catchup';

// 2024-06-01T12:00:00Z
const NOW = Date.UTC(2024, 5, 1, 12, 0, 0);
const START = Date.UTC(2024, 5, 1, 10, 0, 0);
const STOP = Date.UTC(2024, 5, 1, 11, 30, 0);
const S = START / 1000;

describe('buildCatchupUrl', () => {
  it('xtream：按面板时区生成 timeshift 地址', () => {
    const url = buildCatchupUrl('http://p.example:8080/live/u/p/42.m3u8', { type: 'xtream', tz: 'Asia/Shanghai' }, START, STOP, NOW);
    expect(url).toBe('http://p.example:8080/timeshift/u/p/90/2024-06-01:18-00/42.m3u8');
    expect(buildCatchupUrl('http://p.example/other/42.m3u8', { type: 'xtream' }, START, STOP, NOW)).toBeUndefined();
  });

  it('default / append 模板替换', () => {
    expect(
      buildCatchupUrl('http://a/live.m3u8', { type: 'default', source: 'http://a/arc.m3u8?s=${start}&d={duration}&t={Y}{m}{d}{H}{M}' }, START, STOP, NOW)
    ).toBe(`http://a/arc.m3u8?s=${S}&d=5400&t=202406011000`);
    expect(buildCatchupUrl('http://a/live.m3u8', { type: 'append', source: '?utc={utc}&lutc={lutc}' }, START, STOP, NOW)).toBe(
      `http://a/live.m3u8?utc=${S}&lutc=${NOW / 1000}`
    );
  });

  it('shift 追加参数；flussonic 改写路径', () => {
    expect(buildCatchupUrl('http://a/live.m3u8?token=1', { type: 'shift' }, START, STOP, NOW)).toBe(
      `http://a/live.m3u8?token=1&utc=${S}&lutc=${NOW / 1000}`
    );
    expect(buildCatchupUrl('http://a/ch/index.m3u8?t=1', { type: 'flussonic' }, START, STOP, NOW)).toBe(
      `http://a/ch/index-${S}-5400.m3u8?t=1`
    );
    expect(buildCatchupUrl('http://a/ch/mpegts', { type: 'flussonic' }, START, STOP, NOW)).toBe(`http://a/ch/timeshift_abs-${S}.ts`);
  });

  it('未开播结束的节目以当前时间截断时长', () => {
    expect(buildCatchupUrl('http://a/ch/index.m3u8', { type: 'flussonic' }, NOW - 600_000, NOW + 600_000, NOW)).toBe(
      `http://a/ch/index-${NOW / 1000 - 600}-600.m3u8`
    );
  });

  it('无回看能力返回 undefined', () => {
    expect(buildCatchupUrl('http://a/live.m3u8', undefined, START, STOP, NOW)).toBeUndefined();
    expect(buildCatchupUrl('http://a/live.m3u8', { type: 'default' }, START, STOP, NOW)).toBeUndefined();
  });
});

describe('canCatchupProgram', () => {
  it('仅已开播且在可回看天数内', () => {
    expect(canCatchupProgram({ type: 'shift', days: 1 }, { start: START }, NOW)).toBe(true);
    expect(canCatchupProgram({ type: 'shift', days: 1 }, { start: NOW - 2 * 864e5 }, NOW)).toBe(false);
    expect(canCatchupProgram({ type: 'shift' }, { start: NOW + 1000 }, NOW)).toBe(false);
    expect(canCatchupProgram(undefined, { start: START }, NOW)).toBe(false);
  });
});
