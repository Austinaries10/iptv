import { fetchUpstream } from './fetch-utils';
import { getLiveCache, setLiveCache } from './live-cache';
import { parseXmltvIndex, type XmltvIndex } from './xmltv';

/**
 * 服务端节目单索引加载（单频道查询与节目表网格共用）。
 * 解析结果整体缓存 6 小时；保留过去 3 天（回看）到未来 24 小时的节目。
 */

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
/** XMLTV 文件较大，放宽抓取超时 */
const FETCH_TIMEOUT_MS = 30_000;
export const EPG_FUTURE_MS = 24 * 60 * 60 * 1000;
export const EPG_PAST_MS = 3 * 24 * 60 * 60 * 1000;

/** 同一 EPG 地址的并发请求共享一次下载与解析 */
const inflight = new Map<string, Promise<XmltvIndex>>();

export async function loadEpgIndex(url: string, force = false): Promise<XmltvIndex> {
  const key = `live:epg2:${url}`;
  if (!force) {
    const cached = getLiveCache<XmltvIndex>(key);
    if (cached) return cached;
    const pending = inflight.get(key);
    if (pending) return pending;
  }
  const task = (async () => {
    // allowPrivate：与 playlist/stream/probe 同一把尺子，LIVE_ALLOW_PRIVATE=1 时内网节目单才能拉取
    const res = await fetchUpstream(url, { timeoutMs: FETCH_TIMEOUT_MS, retries: 0, allowPrivate: true });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    // gzip 由 parseXmltvIndex 内识别（fetch 对 .gz 不会自动解压）
    const buf = Buffer.from(await res.arrayBuffer());
    const index = parseXmltvIndex(buf, { windowMs: EPG_FUTURE_MS, pastMs: EPG_PAST_MS });
    setLiveCache(key, index, CACHE_TTL_MS, buf.byteLength * 2);
    return index;
  })();
  inflight.set(key, task);
  try {
    return await task;
  } finally {
    inflight.delete(key);
  }
}
