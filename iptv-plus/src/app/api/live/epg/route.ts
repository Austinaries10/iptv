import { NextResponse } from 'next/server';
import { guardRequest, jsonError } from '@/lib/api-guard';
import { checkLiveUrlAllowed } from '@/lib/ssrf';
import { loadEpgIndex } from '@/lib/epg-index';
import { currentAndNext, lookupPrograms } from '@/lib/xmltv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 拉取并解析 XMLTV 节目单（支持 gzip）。
 * GET /api/live/epg?url=<xmltv>&channel=<tvgId>&name=<台名>&force=1
 * 按 tvg-id 查找，找不到时按台名（归一化）匹配；channel 与 name 至少给一个。
 * 返回过去 3 天（回看）到未来 24 小时的节目。
 */
export async function GET(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;

  const sp = new URL(req.url).searchParams;
  const url = sp.get('url')?.trim();
  const channel = sp.get('channel')?.trim() || undefined;
  const name = sp.get('name')?.trim() || undefined;
  if (!url || (!channel && !name)) return jsonError('缺少 url 或 channel 参数', 400);
  const force = sp.get('force') === '1';

  // 直播专用校验：与 playlist/stream/probe 同一把尺子
  const verdict = await checkLiveUrlAllowed(url);
  if (!verdict.ok) return jsonError(verdict.reason, 403);

  let programs;
  try {
    programs = lookupPrograms(await loadEpgIndex(url, force), { tvgId: channel, name });
  } catch (err) {
    return jsonError(`节目单地址请求失败: ${err instanceof Error ? err.message : '未知错误'}`, 502);
  }
  const { current, next } = currentAndNext(programs);

  return NextResponse.json(
    { channelId: channel || name || '', current, next, programs },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
