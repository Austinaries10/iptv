# IPTV Plus

A free, open-source IPTV player that runs in any modern browser, on desktop and mobile, and can be installed as an app (PWA). It needs no build step and no server: it's plain HTML, CSS and JavaScript.

## Features

**Sources**

- M3U / M3U8 playlists from a URL or a local file, with `#EXTINF` attributes (`tvg-id`, `tvg-logo`, `group-title`, `tvg-chno`, `catchup…`), `#EXTGRP` and `x-tvg-url`
- Xtream Codes accounts: Live TV, Movies (VOD) and Series with seasons and episodes
- One-click free channels from the [iptv-org](https://github.com/iptv-org/iptv) collection, by country, category or language
- Several playlists side by side, with switching from the top bar; playlists are cached for offline start

**Watching**

- HLS (hls.js), MPEG-TS/FLV (mpegts.js), DASH (Shaka) and native formats, with automatic engine fallback
- Auto-reconnect with backoff when a live stream drops
- Quality, audio track and subtitle selection
- **Multi-view**: watch up to 4 channels at once (audio follows the selected tile)
- Picture-in-picture, fullscreen, snapshot (PNG), in-browser recording (WebM)
- Sleep timer
- On-screen channel banner with now/next, channel number zapping, last-channel recall
- Resume where you left off for movies and episodes ("Continue watching")
- Media Session support (hardware media keys and lock-screen controls)

**TV guide (EPG)**

- XMLTV EPG (`.xml` or `.xml.gz`, several URLs allowed), with automatic use of the playlist's `x-tvg-url` or the Xtream `xmltv.php`
- Now/next and progress bars in the channel list, plus a full timeline guide
- **Catch-up / timeshift**: watch past programmes on Xtream channels with archive, or M3U channels with `catchup="default|append|shift|flussonic"`
- Programme reminders, with a browser notification
- EPG time-shift setting for wrong time zones
- Search matches channel names, groups *and* the current programme title

**Organising**

- Favorites, recently watched and continue-watching lists
- Sorting by playlist order, name or channel number
- Hide groups you never watch
- Parental control: a PIN locks groups that match keywords (default `adult, xxx, 18+`)
- Stream health check: marks reachable or unreachable channels, and can hide dead ones
- Export favorites or the current list as M3U
- Full backup and restore of playlists, favorites, history and settings as JSON
- Dark, light or system theme, and a responsive layout for phones and tablets

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `Space` / `K` | Play / pause |
| `↑` / `↓` | Previous / next channel |
| `←` / `→` | Seek 10 s |
| `+` / `-` | Volume |
| `0`–`9` | Jump to channel number |
| `L` | Last watched channel |
| `F` | Fullscreen |
| `M` | Mute |
| `S` | Toggle favorite |
| `G` | TV guide |
| `V` | Multi-view |
| `I` | Stream info overlay |
| `P` | Picture-in-picture |
| `/` | Search |

## Running it

Any static file server works:

```sh
cd app
python3 -m http.server 8080
# then open http://localhost:8080
```

or `npx serve app`.

### GitHub Pages

The `app` workflow (`.github/workflows/app.yml`) publishes this folder to GitHub Pages on every push to `master` that touches `app/`. To turn it on, set **Settings → Pages → Source** to **GitHub Actions**.

## Browser limitations

A web page can't do everything a native app can, so a few things are worth knowing:

- **http streams on an https page.** Browsers block `http://` streams on an `https://` site such as GitHub Pages. Many Xtream providers only offer `http://`. In that case, run IPTV Plus locally over `http://localhost`, or use a proxy that serves the streams over https.
- **CORS.** The browser can only read playlists, EPG files and API responses from servers that allow cross-origin requests. If loading fails, set a CORS proxy in **Settings → Network**. `{url}` in the proxy address is replaced with the encoded target URL; without it, the target URL is appended to the end. Tick "Also send video streams through the proxy" if the streams themselves are blocked.
- **Custom headers.** `User-Agent` and `Referer` options in a playlist (`#EXTVLCOPT`, `|User-Agent=`) can't be set by a browser and are ignored.
- **Recording and snapshots** only work when the stream server allows cross-origin access.
- **Codecs** depend on the browser. For example, HEVC/H.265 and AC-3 audio aren't supported everywhere.

All your data (playlists, favorites, history and settings) stays in your browser's local storage and IndexedDB. Nothing is sent anywhere except requests to the playlist, EPG and stream servers you add, and to the proxy if you set one.
