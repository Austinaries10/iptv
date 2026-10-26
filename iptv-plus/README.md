# IPTV Plus

IPTV Plus is a self-hosted live TV / IPTV and video player built on [LibreTV](https://github.com/LibreSpark/LibreTV) (Next.js 15, TypeScript, Tailwind, ArtPlayer and hls.js). It keeps everything LibreTV does, including multi-source video search, M3U live TV with an EPG, a server-side stream proxy and a PWA, and adds the features below.

> The interface is in Chinese, the same as upstream LibreTV.

## What IPTV Plus adds

| Feature | Where |
| --- | --- |
| **Xtream Codes accounts**: enter the panel URL, username and password. Live categories, channel numbers and archive (catch-up) info are imported, and the panel's `xmltv.php` is used as the guide automatically | Settings → 直播源 (Live sources) → 添加直播源 (Add live source) → Xtream 账号 (Xtream account) |
| **Free channels** from [iptv-org](https://github.com/iptv-org/iptv), by country, category or language, in one click | Settings → 直播源 (Live sources) → 添加直播源 (Add live source) → 免费频道 (Free channels) |
| **Catch-up / timeshift**: watch already-aired programmes, or restart the current one, with a seek bar. Supports Xtream `tv_archive` (in the panel's time zone) and M3U `catchup="default\|append\|shift\|flussonic"` with `catchup-source` and `catchup-days` | `/live` → programme guide → 回看 (Catch-up) / 从头看 (Watch from start) |
| **TV guide grid**: a channel × time grid with a 6-hour window that pages 3 hours at a time, filterable by group or favorites. Click to watch live, catch up, or set a reminder | `/live/guide` |
| **Multi-view**: 2 or 4 channels at once. Only the selected tile plays audio, and the layout is remembered | `/live/multi` |
| **Programme reminders**: an in-app notice with a "go watch" button, plus a system notification when the tab is in the background | 🔔 next to upcoming programmes |
| **Parental lock**: a 4–8 digit PIN hides channels whose group or name matches keywords (default `adult, xxx, 18+, 成人`) until unlocked for the session | `/live` → 家长锁 (Parental lock) |
| **Sleep timer** (15 min – 2 h) | `/live` → 睡眠定时 (Sleep timer) |
| **Channel number keys**: type `0`–`9` to jump to a channel (`tvg-chno` or list position) | `/live` |
| **Auto EPG**: uses the playlist's own `x-tvg-url` when the source has no EPG configured | automatic |
| **EPG name matching**: channels without `tvg-id` are matched to the guide by normalised name | automatic |
| **Snapshots** in the live player | player control bar |
| **Credential masking**: Xtream passwords are hidden wherever a URL is displayed | automatic |

Xtream links can also be added directly as an M3U URL: `http://host:port/player_api.php?username=U&password=P`.

## Deploy

A password is required, as in LibreTV.

### Docker Compose

```bash
cd iptv-plus
echo "PASSWORD=change-me" > .env
docker compose up -d --build        # http://localhost:8080
```

### Node.js (no Docker)

```bash
cd iptv-plus
npm ci
PASSWORD=change-me npm run build
PASSWORD=change-me npm start        # http://localhost:8080
```

It runs on any host that runs Next.js (a VPS, Render, Railway, Fly.io, Zeabur and so on). Set at least `PASSWORD`. All other environment variables (`DEFAULT_LIVE_SOURCES`, `LIVE_ALLOW_PRIVATE`, `PROXY_SECRET` and so on) work as described in the [upstream README](docs/LIBRETV-README.md#环境变量).

Because streams, playlists and EPG files go through the server-side proxy, there are no CORS or http/https mixed-content problems. That's why this version needs a server, unlike the static player in [`../app`](../app).

## Development

```bash
npm install
PASSWORD=dev npm run dev     # http://localhost:8080
npm test                     # vitest unit tests
npm run typecheck
npm run lint
```

New code added by IPTV Plus:

- `src/lib/xtream.ts`: Xtream Codes API → playlist
- `src/lib/catchup.ts`: catch-up URL builder
- `src/lib/epg-index.ts` and `src/app/api/live/epg/batch`: shared EPG cache and the guide-grid endpoint
- `src/lib/plus-store.ts`: reminders and parental lock, stored separately from the main store
- `src/app/live/guide`, `src/app/live/multi`: TV guide and multi-view pages
- `src/components/{parental-lock,sleep-timer,live-reminder-watcher,use-live-channels}.tsx`

The full upstream documentation (sources, subscriptions, TVBOX compatibility, security notes and so on) is in [docs/LIBRETV-README.md](docs/LIBRETV-README.md).

## License and attribution

IPTV Plus is a modified version of [LibreTV](https://github.com/LibreSpark/LibreTV) by LibreSpark, and it's distributed under the same **GNU AGPL-3.0-or-later** license (see [LICENSE](LICENSE)). Under the AGPL, if you run a modified version as a network service, you must offer its users the corresponding source code. Keeping this repository public and linking to it satisfies that.

The project doesn't host or produce any video content. It only parses and plays third-party playlists and APIs that you add, and those sources are responsible for the legality of their content.
