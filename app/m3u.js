// Minimal M3U/M3U8 playlist parser.
// Returns an array of { name, url, logo, group, id, attrs }.
export function parseM3U(text) {
  const lines = text.split(/\r?\n/)
  const channels = []
  let current = null

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue

    if (line.startsWith('#EXTINF')) {
      const commaIndex = findTitleComma(line)
      const header = commaIndex === -1 ? line : line.slice(0, commaIndex)
      const name = commaIndex === -1 ? '' : line.slice(commaIndex + 1).trim()
      const attrs = {}
      for (const match of header.matchAll(/([\w-]+)="([^"]*)"/g)) {
        attrs[match[1].toLowerCase()] = match[2]
      }
      current = {
        name: name || attrs['tvg-name'] || 'Unknown channel',
        logo: attrs['tvg-logo'] || '',
        group: attrs['group-title'] || 'Undefined',
        id: attrs['tvg-id'] || '',
        attrs,
        url: ''
      }
      continue
    }

    if (line.startsWith('#')) continue

    if (current) {
      current.url = line
      channels.push(current)
      current = null
    } else {
      channels.push({ name: line, url: line, logo: '', group: 'Undefined', id: '', attrs: {} })
    }
  }

  return channels
}

// The channel title follows the first comma that is not inside a quoted attribute.
function findTitleComma(line) {
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') inQuotes = !inQuotes
    else if (char === ',' && !inQuotes) return i
  }
  return -1
}
