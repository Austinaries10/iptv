/**
 * 直播页深链：/live?url=&name=&group=&tvgId=&epg=（与直播页 selectChannel 同一格式），
 * 可选 cs/ce/ct（回看节目起止 epoch ms 与标题）——直播页加载后自动开始回看。
 */
export function liveHref(
  channel: { url: string; name: string; group?: string; tvgId?: string; epg?: string },
  catchup?: { start: number; stop: number; title?: string }
): string {
  const sp = new URLSearchParams({ url: channel.url, name: channel.name });
  if (channel.group) sp.set('group', channel.group);
  if (channel.tvgId) sp.set('tvgId', channel.tvgId);
  if (channel.epg) sp.set('epg', channel.epg);
  if (catchup) {
    sp.set('cs', String(catchup.start));
    sp.set('ce', String(catchup.stop));
    if (catchup.title) sp.set('ct', catchup.title);
  }
  return `/live?${sp.toString()}`;
}
