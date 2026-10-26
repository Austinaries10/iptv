import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'IPTV Plus - 直播 / IPTV 与视频聚合播放平台',
    short_name: 'IPTV Plus',
    description: '支持 M3U、Xtream Codes、节目表、回看与多屏同看的直播 / IPTV 与视频聚合播放平台',
    start_url: '/',
    display: 'standalone',
    background_color: '#141414',
    theme_color: '#141414',
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
    ],
  };
}
