import type { LiveCatchup } from './types';

/**
 * 回看（catch-up）地址构建：纯函数，客户端点击节目单中已播节目时调用。
 * 时间参数均为 epoch ms；返回 undefined 表示该频道无法构建回看地址。
 */

/** 未声明天数时的默认可回看时长 */
const DEFAULT_DAYS = 3;

export function catchupWindowMs(catchup: LiveCatchup | undefined): number {
  if (!catchup) return 0;
  return (catchup.days || DEFAULT_DAYS) * 24 * 60 * 60 * 1000;
}

/** 节目是否在回看窗口内（已开播且开播时间未超出可回看天数） */
export function canCatchupProgram(
  catchup: LiveCatchup | undefined,
  program: { start: number },
  now: number = Date.now()
): boolean {
  if (!catchup) return false;
  return program.start < now && now - program.start <= catchupWindowMs(catchup);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 指定时区的年月日时分（Xtream 面板按其本地时间解析回看起点） */
function zonedParts(ms: number, timeZone?: string) {
  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }).formatToParts(new Date(ms));
      const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
      return { y: get('year'), mo: get('month'), d: get('day'), h: get('hour'), mi: get('minute') };
    } catch {
      /* 非法时区：回落到浏览器本地时间 */
    }
  }
  const d = new Date(ms);
  return { y: d.getFullYear(), mo: d.getMonth() + 1, d: d.getDate(), h: d.getHours(), mi: d.getMinutes() };
}

/** Xtream：/live/U/P/ID.ext → /timeshift/U/P/<分钟>/<YYYY-MM-DD:HH-mm>/ID.m3u8 */
function xtreamCatchup(liveUrl: string, catchup: LiveCatchup, start: number, stop: number): string | undefined {
  const m = liveUrl.match(/^(.*)\/live\/([^/]+)\/([^/]+)\/([^/.?#]+)(?:\.[a-z0-9]+)?(?:[?#].*)?$/i);
  if (!m) return undefined;
  const [, base, user, pass, id] = m;
  const minutes = Math.max(1, Math.ceil((stop - start) / 60000));
  const p = zonedParts(start, catchup.tz);
  const startText = `${p.y}-${pad(p.mo)}-${pad(p.d)}:${pad(p.h)}-${pad(p.mi)}`;
  return `${base}/timeshift/${user}/${pass}/${minutes}/${startText}/${id}.m3u8`;
}

/** catchup-source 模板占位符：{utc} ${start} {duration} {Y}{m}{d}{H}{M}{S} 等 */
function fillTemplate(template: string, start: number, stop: number, now: number): string {
  const s = Math.floor(start / 1000);
  const e = Math.floor(stop / 1000);
  const n = Math.floor(now / 1000);
  const d = new Date(start);
  const tokens: Record<string, string | number> = {
    utc: s,
    start: s,
    utcend: e,
    end: e,
    lutc: n,
    now: n,
    timestamp: n,
    duration: e - s,
    offset: n - s,
    Y: d.getUTCFullYear(),
    m: pad(d.getUTCMonth() + 1),
    d: pad(d.getUTCDate()),
    H: pad(d.getUTCHours()),
    M: pad(d.getUTCMinutes()),
    S: pad(d.getUTCSeconds()),
  };
  return template.replace(/\$?\{([A-Za-z]+)(?::[^}]*)?\}/g, (whole, key: string) =>
    key in tokens ? String(tokens[key]) : whole
  );
}

export function buildCatchupUrl(
  liveUrl: string,
  catchup: LiveCatchup | undefined,
  start: number,
  stop: number,
  now: number = Date.now()
): string | undefined {
  if (!catchup) return undefined;
  const end = Math.min(stop, now);
  switch (catchup.type) {
    case 'xtream':
      return xtreamCatchup(liveUrl, catchup, start, stop);
    case 'default':
      return catchup.source ? fillTemplate(catchup.source, start, end, now) : undefined;
    case 'append':
      return catchup.source ? liveUrl + fillTemplate(catchup.source, start, end, now) : undefined;
    case 'shift':
      return `${liveUrl}${liveUrl.includes('?') ? '&' : '?'}utc=${Math.floor(start / 1000)}&lutc=${Math.floor(now / 1000)}`;
    case 'flussonic': {
      const s = Math.floor(start / 1000);
      const dur = Math.max(60, Math.floor((end - start) / 1000));
      if (/\/mpegts(\?|$)/.test(liveUrl)) return liveUrl.replace(/\/mpegts/, `/timeshift_abs-${s}.ts`);
      const replaced = liveUrl.replace(/\/(index|video|mono)\.m3u8/, `/$1-${s}-${dur}.m3u8`);
      return replaced === liveUrl ? undefined : replaced;
    }
    default:
      return undefined;
  }
}
