import { fetchJSON } from './utils.js'

const pad = n => String(n).padStart(2, '0')

export class XtreamClient {
  constructor({ server, username, password, ext = 'm3u8' }) {
    let base = (server || '').trim().replace(/\/+$/, '')
    if (!/^https?:\/\//i.test(base)) base = 'http://' + base
    this.server = base
    this.username = username || ''
    this.password = password || ''
    this.ext = ext
  }

  get creds() {
    return `${encodeURIComponent(this.username)}/${encodeURIComponent(this.password)}`
  }

  api(action, params = {}) {
    const url = new URL(this.server + '/player_api.php')
    url.searchParams.set('username', this.username)
    url.searchParams.set('password', this.password)
    if (action) url.searchParams.set('action', action)
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
    return fetchJSON(url.toString(), 90000)
  }

  async login() {
    const data = await this.api()
    if (!data?.user_info || Number(data.user_info.auth) === 0) {
      throw new Error('Xtream login failed – check server, username and password')
    }
    return data
  }

  async loadAll() {
    const safe = promise => promise.then(r => (Array.isArray(r) ? r : [])).catch(() => [])
    const [liveCats, live, vodCats, vod, seriesCats, series] = await Promise.all([
      safe(this.api('get_live_categories')),
      safe(this.api('get_live_streams')),
      safe(this.api('get_vod_categories')),
      safe(this.api('get_vod_streams')),
      safe(this.api('get_series_categories')),
      safe(this.api('get_series'))
    ])
    const names = cats => new Map(cats.map(c => [String(c.category_id), c.category_name]))
    const liveNames = names(liveCats)
    const vodNames = names(vodCats)
    const seriesNames = names(seriesCats)
    const items = []

    for (const s of live) {
      items.push({
        type: 'live',
        name: s.name || 'Channel',
        logo: s.stream_icon || '',
        group: liveNames.get(String(s.category_id)) || 'Uncategorized',
        tvgId: s.epg_channel_id || '',
        chno: s.num ? String(s.num) : '',
        url: this.liveUrl(s.stream_id),
        streamId: s.stream_id,
        catchupType: Number(s.tv_archive) ? 'xtream' : '',
        archiveDays: Number(s.tv_archive_duration) || 0
      })
    }
    for (const s of vod) {
      items.push({
        type: 'movie',
        name: s.name || 'Movie',
        logo: s.stream_icon || '',
        group: vodNames.get(String(s.category_id)) || 'Uncategorized',
        url: this.vodUrl(s.stream_id, s.container_extension || 'mp4'),
        rating: s.rating || ''
      })
    }
    for (const s of series) {
      items.push({
        type: 'series',
        name: s.name || 'Series',
        logo: s.cover || '',
        group: seriesNames.get(String(s.category_id)) || 'Uncategorized',
        url: `xtream-series:${this.server}:${s.series_id}`,
        seriesId: s.series_id,
        plot: s.plot || '',
        rating: s.rating || ''
      })
    }
    return items
  }

  async seriesInfo(seriesId, seriesName) {
    const data = await this.api('get_series_info', { series_id: seriesId })
    const seasons = {}
    for (const [key, list] of Object.entries(data?.episodes || {})) {
      for (const ep of list || []) {
        const season = String(ep.season || key)
        if (!seasons[season]) seasons[season] = []
        seasons[season].push({
          type: 'movie',
          name: `${seriesName} S${pad(season)}E${pad(ep.episode_num || seasons[season].length + 1)}${ep.title ? ' – ' + ep.title : ''}`,
          title: ep.title || `Episode ${ep.episode_num}`,
          episode: ep.episode_num,
          logo: ep.info?.movie_image || data?.info?.cover || '',
          plot: ep.info?.plot || '',
          duration: ep.info?.duration || '',
          group: seriesName,
          url: this.episodeUrl(ep.id, ep.container_extension || 'mp4')
        })
      }
    }
    return { info: data?.info || {}, seasons }
  }

  liveUrl(id) {
    return `${this.server}/live/${this.creds}/${id}.${this.ext}`
  }

  vodUrl(id, ext) {
    return `${this.server}/movie/${this.creds}/${id}.${ext}`
  }

  episodeUrl(id, ext) {
    return `${this.server}/series/${this.creds}/${id}.${ext}`
  }

  epgUrl() {
    return `${this.server}/xmltv.php?username=${encodeURIComponent(this.username)}&password=${encodeURIComponent(this.password)}`
  }

  timeshiftUrl(streamId, start, stop) {
    const d = new Date(start)
    const minutes = Math.max(1, Math.ceil((stop - start) / 60000))
    const ts = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}:${pad(d.getHours())}-${pad(d.getMinutes())}`
    return `${this.server}/timeshift/${this.creds}/${minutes}/${ts}/${streamId}.ts`
  }
}
