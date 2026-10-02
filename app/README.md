# IPTV Player

A lightweight, browser-based player for the playlists in this repository. No build step or install required.

## Features

- Load any of the published iptv-org playlists, a custom playlist URL, or a local `.m3u` file
- Search channels by name and filter by category
- Mark favorites (saved in your browser)
- HLS (`.m3u8`) playback via [hls.js](https://github.com/video-dev/hls.js), with native fallback (e.g. Safari)
- Responsive layout for desktop and mobile

## Running locally

Serve this folder with any static web server, for example:

```sh
npx serve app
# or
python3 -m http.server --directory app 8080
```

Then open http://localhost:8080 (or the address printed by `serve`).

You can preload a playlist with a query parameter:

```
http://localhost:8080/?playlist=https://iptv-org.github.io/iptv/countries/us.m3u
```

## Notes

- Many streams use plain `http://` URLs. Browsers block those on pages served over `https://` (mixed content), so running the app locally over `http://` gives the best results.
- Some streams are geo-blocked, offline, or block cross-origin requests from browsers. Those will show a playback error. That's a limitation of the stream, not the app.
