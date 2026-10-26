import { NextResponse } from 'next/server';
import { guardRequest, jsonError } from '@/lib/api-guard';
import { checkLiveUrlAllowed } from '@/lib/ssrf';
import { loadEpgIndex } from '@/lib/epg-index';
import { lookupPrograms } from '@/lib/xmltv';
import type { EpgProgram } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 单次最多查询的频道数（节目表网格分页加载） */
const MAX_CHANNELS = 200;
/** 单次最大时间跨度：12 小时 */
const MAX_SPAN_MS = 12 * 60 * 60 * 1000;

interface BatchBody {
  url?: string;
  from?: number;
  to?: number;
  channels?: { key?: string; tvgId?: string; name?: string }[];
}

/**
 * 节目表网格：一次查询多个频道在 [from, to) 时间窗内的节目。
 * POST /api/live/epg/batch { url, from, to, channels: [{ key, tvgId?, name? }] }
 * → { programs: { [key]: EpgProgram[] } }（无节目的频道不返回）
 */
export async function POST(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;

  let body: BatchBody;
  try {
    body = (await req.json()) as BatchBody;
  } catch {
    return jsonError('请求体不是合法 JSON', 400);
  }
  const url = body.url?.trim();
  if (!url || !Array.isArray(body.channels)) return jsonError('缺少 url 或 channels', 400);
  const from = Number(body.from) || Date.now();
  const to = Math.min(Number(body.to) || from + MAX_SPAN_MS, from + MAX_SPAN_MS);

  const verdict = await checkLiveUrlAllowed(url);
  if (!verdict.ok) return jsonError(verdict.reason, 403);

  let index;
  try {
    index = await loadEpgIndex(url);
  } catch (err) {
    return jsonError(`节目单地址请求失败: ${err instanceof Error ? err.message : '未知错误'}`, 502);
  }

  const programs: Record<string, EpgProgram[]> = {};
  for (const c of body.channels.slice(0, MAX_CHANNELS)) {
    if (!c?.key || (!c.tvgId && !c.name)) continue;
    const list = lookupPrograms(index, { tvgId: c.tvgId, name: c.name }).filter((p) => p.stop > from && p.start < to);
    if (list.length) programs[c.key] = list;
  }
  return NextResponse.json({ programs }, { headers: { 'Cache-Control': 'no-store' } });
}
