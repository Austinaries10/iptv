import { fetchBuffer } from './utils.js'
import { idbGet, idbSet } from './storage.js'

const KEEP_PAST = 7 * 864e5
const KEEP_FUTURE = 4 * 864e5
const TTL = 12 * 36e5

export function parseXmltvDate(value) {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{4})?/.exec((value || '').trim())
  if (!m) return NaN
  const [, Y, M, D, h, mi, se = '00', tz] = m
  let time = Date.UTC(+Y, +M - 1, +D, +h, +mi, +se)
  if (tz) {
    const sign = tz[0] === '-' ? -1 : 1
    time -= sign * (Number(tz.slice(1, 3)) * 60 + Number(tz.slice(3, 5))) * 60000
  }
  return time
}

export function normalizeName(name) {
  return (name || '')
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, '')
    .replace(/\b(hd|fhd|uhd|4k|sd|hevc|h265)\b/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

async function decode(buffer) {
  const bytes = new Uint8Array(buffer)
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'))
    return new Response(stream).text()
  }
  return new TextDecoder().decode(buffer)
}

export function parseXmltv(xml) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  if (doc.getElementsByTagName('parsererror').length && !doc.getElementsByTagName('programme').length) {
    throw new Error('EPG is not valid XMLTV')
  }
  const names = {}
  for (const ch of doc.getElementsByTagName('channel')) {
    const id = ch.getAttribute('id')
    if (!id) continue
    for (const dn of ch.getElementsByTagName('display-name')) {
      const key = normalizeName(dn.textContent)
      if (key && !names[key]) names[key] = id
    }
    const idKey = normalizeName(id.split('.')[0])
    if (idKey && !names[idKey]) names[idKey] = id
  }

  const now = Date.now()
  const programmes = {}
  for (const p of doc.getElementsByTagName('programme')) {
    const start = parseXmltvDate(p.getAttribute('start'))
    let stop = parseXmltvDate(p.getAttribute('stop'))
    if (isNaN(start)) continue
    if (isNaN(stop)) stop = start + 30 * 60000
    if (stop < now - KEEP_PAST || start > now + KEEP_FUTURE) continue
    const id = p.getAttribute('channel')
    const title = p.getElementsByTagName('title')[0]?.textContent || ''
    const desc = p.getElementsByTagName('desc')[0]?.textContent || ''
    if (!programmes[id]) programmes[id] = []
    programmes[id].push([start, stop, title, desc.slice(0, 600)])
  }
  for (const id in programmes) programmes[id].sort((a, b) => a[0] - b[0])
  return { names, programmes }
}

export class EPG {
  constructor() {
    this.clear()
    this.offset = 0
  }

  clear() {
    this.programmes = new Map()
    this.names = new Map()
    this.cache = new Map()
    this.urls = []
  }

  get loaded() {
    return this.programmes.size > 0
  }

  async load(urls, { force = false } = {}) {
    this.clear()
    this.urls = urls
    const errors = []
    for (const url of urls) {
      try {
        const key = 'epg:' + url
        let data = force ? null : await idbGet(key)
        if (!data || Date.now() - data.fetched > TTL) {
          data = parseXmltv(await decode(await fetchBuffer(url, 180000)))
          data.fetched = Date.now()
          idbSet(key, data)
        }
        this.merge(data)
      } catch (err) {
        errors.push(err)
      }
    }
    if (errors.length && !this.loaded) throw errors[0]
    return this
  }

  merge(data) {
    for (const [id, list] of Object.entries(data.programmes)) {
      if (!this.programmes.has(id)) this.programmes.set(id, list)
    }
    for (const [name, id] of Object.entries(data.names)) {
      if (!this.names.has(name)) this.names.set(name, id)
    }
  }

  list(item) {
    const cacheKey = (item.tvgId || '') + '|' + item.name
    if (this.cache.has(cacheKey)) return this.cache.get(cacheKey)
    let list = item.tvgId ? this.programmes.get(item.tvgId) : null
    if (!list) {
      const id = this.names.get(normalizeName(item.tvgName || item.name)) ||
        (item.tvgId && this.names.get(normalizeName(item.tvgId.split('.')[0])))
      list = id ? this.programmes.get(id) : null
    }
    list = list || []
    this.cache.set(cacheKey, list)
    return list
  }

  wrap(p) {
    return { start: p[0] + this.offset, stop: p[1] + this.offset, title: p[2], desc: p[3] }
  }

  at(item, time = Date.now()) {
    const list = this.list(item)
    if (!list.length) return { now: null, next: null }
    const q = time - this.offset
    let lo = 0
    let hi = list.length - 1
    let idx = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (list[mid][0] <= q) {
        idx = mid
        lo = mid + 1
      } else {
        hi = mid - 1
      }
    }
    return {
      now: idx >= 0 && list[idx][1] > q ? this.wrap(list[idx]) : null,
      next: list[idx + 1] ? this.wrap(list[idx + 1]) : null
    }
  }

  range(item, from, to) {
    return this.list(item)
      .filter(p => p[1] + this.offset > from && p[0] + this.offset < to)
      .map(p => this.wrap(p))
  }
}
