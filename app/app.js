import { parseM3U } from './m3u.js'

const PAGE_SIZE = 100
const STORAGE_KEYS = { favorites: 'iptv:favorites', playlist: 'iptv:playlist', last: 'iptv:last' }

const $ = selector => document.querySelector(selector)
const els = {
  form: $('#source-form'),
  preset: $('#preset'),
  customUrl: $('#custom-url'),
  fileInput: $('#file-input'),
  search: $('#search'),
  groupFilter: $('#group-filter'),
  favoritesOnly: $('#favorites-only'),
  status: $('#status'),
  list: $('#channel-list'),
  sentinel: $('#sentinel'),
  video: $('#video'),
  nowLogo: $('#now-logo'),
  nowName: $('#now-name'),
  nowMeta: $('#now-meta'),
  playerError: $('#player-error')
}

const state = {
  channels: [],
  filtered: [],
  rendered: 0,
  favorites: new Set(load(STORAGE_KEYS.favorites, [])),
  activeUrl: null,
  hls: null
}

function load(key, fallback) {
  try {
    const value = localStorage.getItem(key)
    return value === null ? fallback : JSON.parse(value)
  } catch {
    return fallback
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage may be unavailable (private mode); favorites just won't persist.
  }
}

function groupsOf(channel) {
  return channel.group
    .split(';')
    .map(group => group.trim())
    .filter(Boolean)
}

// Playlist loading

async function loadFromUrl(url) {
  setStatus(`Loading ${url}…`)
  try {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    setChannels(parseM3U(await response.text()))
    save(STORAGE_KEYS.playlist, url)
  } catch (error) {
    setStatus(`Could not load playlist: ${error.message}`)
  }
}

function loadFromFile(file) {
  const reader = new FileReader()
  reader.onload = () => setChannels(parseM3U(String(reader.result)))
  reader.onerror = () => setStatus('Could not read file.')
  reader.readAsText(file)
}

function setChannels(channels) {
  state.channels = channels
  const groups = [...new Set(channels.flatMap(groupsOf))].sort((a, b) => a.localeCompare(b))
  els.groupFilter.replaceChildren(
    new Option('All categories', ''),
    ...groups.map(group => new Option(group, group))
  )
  applyFilters()
}

// Filtering and rendering

function applyFilters() {
  const query = els.search.value.trim().toLowerCase()
  const group = els.groupFilter.value
  const favoritesOnly = els.favoritesOnly.checked

  state.filtered = state.channels.filter(channel => {
    if (favoritesOnly && !state.favorites.has(channel.url)) return false
    if (group && !groupsOf(channel).includes(group)) return false
    if (query && !channel.name.toLowerCase().includes(query)) return false
    return true
  })

  state.rendered = 0
  els.list.replaceChildren()
  renderMore()
  setStatus(
    `${state.filtered.length.toLocaleString()} of ${state.channels.length.toLocaleString()} channels`
  )
}

function renderMore() {
  const next = state.filtered.slice(state.rendered, state.rendered + PAGE_SIZE)
  els.list.append(...next.map(renderChannel))
  state.rendered += next.length
}

function renderChannel(channel) {
  const item = document.createElement('li')
  item.className = 'channel'
  item.tabIndex = 0
  item.dataset.url = channel.url
  if (channel.url === state.activeUrl) item.classList.add('active')

  let logo = placeholder(channel)
  if (channel.logo) {
    logo = document.createElement('img')
    logo.src = channel.logo
    logo.alt = ''
    logo.loading = 'lazy'
    logo.onerror = () => logo.replaceWith(placeholder(channel))
  }

  const info = document.createElement('div')
  info.className = 'info'
  const name = document.createElement('div')
  name.className = 'name'
  name.textContent = channel.name
  const group = document.createElement('div')
  group.className = 'group'
  group.textContent = groupsOf(channel).join(' · ')
  info.append(name, group)

  const fav = document.createElement('button')
  fav.type = 'button'
  fav.className = 'fav'
  updateFavButton(fav, channel)
  fav.addEventListener('click', event => {
    event.stopPropagation()
    toggleFavorite(channel)
    updateFavButton(fav, channel)
  })

  item.append(logo, info, fav)
  item.addEventListener('click', () => play(channel))
  item.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      play(channel)
    }
  })
  return item
}

function placeholder(channel) {
  const div = document.createElement('div')
  div.className = 'placeholder'
  div.textContent = channel.name.charAt(0).toUpperCase()
  return div
}

function updateFavButton(button, channel) {
  const on = state.favorites.has(channel.url)
  button.classList.toggle('on', on)
  button.textContent = on ? '★' : '☆'
  button.title = on ? 'Remove from favorites' : 'Add to favorites'
  button.setAttribute('aria-label', button.title)
}

function toggleFavorite(channel) {
  if (state.favorites.has(channel.url)) state.favorites.delete(channel.url)
  else state.favorites.add(channel.url)
  save(STORAGE_KEYS.favorites, [...state.favorites])
  if (els.favoritesOnly.checked) applyFilters()
}

function setStatus(message) {
  els.status.textContent = message
}

// Playback

function play(channel) {
  state.activeUrl = channel.url
  save(STORAGE_KEYS.last, channel.url)
  for (const item of els.list.children) {
    item.classList.toggle('active', item.dataset.url === channel.url)
  }

  els.nowName.textContent = channel.name
  els.nowMeta.textContent = channel.url
  els.nowLogo.hidden = !channel.logo
  if (channel.logo) els.nowLogo.src = channel.logo
  showError('')

  if (state.hls) {
    state.hls.destroy()
    state.hls = null
  }

  const video = els.video
  if (location.protocol === 'https:' && channel.url.startsWith('http:')) {
    showError(
      'This stream uses plain HTTP and may be blocked by your browser on an HTTPS page. Try running the app locally over http://.'
    )
  }

  const isHls = /\.m3u8(\?|$)/i.test(channel.url)
  if (isHls && window.Hls?.isSupported()) {
    const hls = new window.Hls()
    hls.on(window.Hls.Events.ERROR, (_event, data) => {
      if (data.fatal)
        showError(`Playback failed (${data.details}). The stream may be offline or geo-blocked.`)
    })
    hls.loadSource(channel.url)
    hls.attachMedia(video)
    state.hls = hls
  } else {
    video.src = channel.url
  }

  video.play().catch(() => {
    // Autoplay may be blocked; the user can press play.
  })
}

function showError(message) {
  els.playerError.textContent = message
  els.playerError.hidden = !message
}

els.video.addEventListener('error', () => {
  if (!state.hls)
    showError(
      'Playback failed. The stream may be offline, geo-blocked, or in an unsupported format.'
    )
})

// Wiring

els.preset.addEventListener('change', () => {
  els.customUrl.hidden = els.preset.value !== 'custom'
  if (!els.customUrl.hidden) els.customUrl.focus()
})

els.form.addEventListener('submit', event => {
  event.preventDefault()
  const url = els.preset.value === 'custom' ? els.customUrl.value.trim() : els.preset.value
  if (url) loadFromUrl(url)
})

els.fileInput.addEventListener('change', () => {
  const [file] = els.fileInput.files
  if (file) loadFromFile(file)
})

let searchTimer
els.search.addEventListener('input', () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(applyFilters, 150)
})
els.groupFilter.addEventListener('change', applyFilters)
els.favoritesOnly.addEventListener('change', applyFilters)

new IntersectionObserver(entries => {
  if (entries.some(entry => entry.isIntersecting) && state.rendered < state.filtered.length)
    renderMore()
}).observe(els.sentinel)

// Start with ?playlist=<url>, the last used playlist, or the first preset.
const initial =
  new URLSearchParams(location.search).get('playlist') ||
  load(STORAGE_KEYS.playlist, els.preset.value)
const presetMatch = [...els.preset.options].find(option => option.value === initial)
if (presetMatch) {
  els.preset.value = initial
} else {
  els.preset.value = 'custom'
  els.customUrl.hidden = false
  els.customUrl.value = initial
}
loadFromUrl(initial)
