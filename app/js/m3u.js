// Index of the comma that separates #EXTINF attributes from the title (ignoring commas in quotes)
function titleComma(line) {
  let inQuote = false
  for (let i = 8; i < line.length; i++) {
    const c = line[i]
    if (c === '"') inQuote = !inQuote
    else if (c === ',' && !inQuote) return i
  }
  return -1
}

export function parseAttributes(text) {
  const attrs = {}
  const re = /([\w-]+)="([^"]*)"/g
  let m
  while ((m = re.exec(text))) attrs[m[1].toLowerCase()] = m[2].trim()
  return attrs
}

function guessType(url) {
  if (/\/movie\//i.test(url)) return 'movie'
  if (/\/series\//i.test(url)) return 'series'
  if (/\.(mp4|mkv|avi|mov|m4v|webm)(\?|$)/i.test(url)) return 'movie'
  return 'live'
}

export function parseM3U(text) {
  const result = { epgUrl: '', channels: [] }
  let current = null
  let options = {}

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue

    if (line.startsWith('#EXTM3U')) {
      const attrs = parseAttributes(line)
      result.epgUrl = attrs['x-tvg-url'] || attrs['url-tvg'] || attrs['tvg-url'] || ''
      continue
    }

    if (line.startsWith('#EXTINF')) {
      const comma = titleComma(line)
      const head = comma === -1 ? line : line.slice(0, comma)
      const attrs = parseAttributes(head)
      current = {
        name: (comma === -1 ? '' : line.slice(comma + 1).trim()) || attrs['tvg-name'] || 'Unknown',
        tvgId: attrs['tvg-id'] || '',
        tvgName: attrs['tvg-name'] || '',
        logo: attrs['tvg-logo'] || '',
        group: attrs['group-title'] || '',
        chno: attrs['tvg-chno'] || '',
        catchup: attrs['catchup'] || '',
        catchupDays: attrs['catchup-days'] || '',
        catchupSource: attrs['catchup-source'] || ''
      }
      options = {}
      continue
    }

    if (line.startsWith('#EXTGRP:')) {
      if (current && !current.group) current.group = line.slice(8).trim()
      continue
    }

    if (line.startsWith('#EXTVLCOPT:')) {
      const [key, ...value] = line.slice(11).split('=')
      options[key.trim().toLowerCase()] = value.join('=').trim()
      continue
    }

    if (line.startsWith('#')) continue

    // Kodi style "url|User-Agent=..." headers can't be set from a browser, so drop them
    const url = line.split('|')[0]
    const channel = current || { name: url.split('/').pop() || url, group: '' }
    channel.url = url
    channel.type = guessType(url)
    if (options['http-user-agent']) channel.userAgent = options['http-user-agent']
    if (options['http-referrer']) channel.referrer = options['http-referrer']
    result.channels.push(channel)
    current = null
    options = {}
  }

  return result
}

export function toM3U(items) {
  const lines = ['#EXTM3U']
  for (const c of items) {
    if (!c.url || c.url.startsWith('xtream-series:')) continue
    const attrs = [
      ['tvg-id', c.tvgId],
      ['tvg-name', c.tvgName],
      ['tvg-logo', c.logo],
      ['tvg-chno', c.chno],
      ['group-title', c.group]
    ]
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}="${String(v).replace(/"/g, '\'')}"`)
      .join(' ')
    lines.push(`#EXTINF:-1${attrs ? ' ' + attrs : ''},${c.name}`)
    lines.push(c.url)
  }
  return lines.join('\n') + '\n'
}

// Build a catch-up (archive) URL for M3U channels using the common catchup="" conventions
export function buildCatchupUrl(item, start, stop) {
  const s = Math.floor(start / 1000)
  const e = Math.floor(stop / 1000)
  const now = Math.floor(Date.now() / 1000)
  const d = new Date(start)
  const pad = n => String(n).padStart(2, '0')
  const tokens = {
    utc: s,
    start: s,
    utcend: e,
    end: e,
    lutc: now,
    now,
    timestamp: now,
    duration: e - s,
    offset: now - s,
    Y: d.getUTCFullYear(),
    m: pad(d.getUTCMonth() + 1),
    d: pad(d.getUTCDate()),
    H: pad(d.getUTCHours()),
    M: pad(d.getUTCMinutes()),
    S: pad(d.getUTCSeconds())
  }
  const fill = tpl => tpl.replace(/\$?\{([A-Za-z]+)(?::[^}]*)?\}/g, (m, k) => (k in tokens ? tokens[k] : m))
  const type = (item.catchup || '').toLowerCase()
  const source = item.catchupSource || ''

  if (type === 'default' && source) return fill(source)
  if (type === 'append' && source) return item.url + fill(source)
  if (type === 'flussonic' || type === 'fs') {
    if (/\/mpegts(\?|$)/.test(item.url)) return item.url.replace(/\/mpegts/, `/timeshift_abs-${s}.ts`)
    return item.url.replace(/\/(index|video|mono)\.m3u8/, `/$1-${s}-${e - s}.m3u8`)
  }
  if (type === 'shift' || type === 'timeshift' || (!type && item.catchupDays)) {
    return item.url + (item.url.includes('?') ? '&' : '?') + `utc=${s}&lutc=${now}`
  }
  return ''
}
