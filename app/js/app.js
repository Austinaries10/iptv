import { store, idbGet, idbSet, idbDelete, idbClear } from './storage.js'
import { parseM3U, toM3U, buildCatchupUrl } from './m3u.js'
import { XtreamClient } from './xtream.js'
import { EPG } from './epg.js'
import { Player } from './player.js'
import {
  $,
  $$,
  escapeHtml,
  fetchText,
  fetchJSON,
  toast,
  debounce,
  download,
  sha256,
  fmtClock,
  fmtDuration,
  uid,
  initials,
  setProxy
} from './utils.js'

const PLAYLIST_TTL = 6 * 36e5
const BATCH = 120
const GUIDE_ROWS = 150
const GUIDE_PX_PER_MIN = 4
const SPECIAL = { all: '__all', fav: '__fav', recent: '__recent', cont: '__continue' }
const TYPES = { live: 'Live TV', movie: 'Movies', series: 'Series' }
const ALL_LABELS = { live: 'All channels', movie: 'All movies', series: 'All series' }
const IPTV_ORG = 'https://iptv-org.github.io'

const DEFAULT_SETTINGS = {
  theme: 'dark',
  proxy: '',
  proxyStreams: false,
  retries: 3,
  autoplayLast: true,
  hideDead: false,
  pinHash: '',
  lockKeywords: 'adult, xxx, 18+',
  epgOffset: 0,
  volume: 1,
  muted: false
}

const state = {
  settings: { ...DEFAULT_SETTINGS, ...store.get('settings', {}) },
  sources: store.get('sources', []),
  activeSourceId: store.get('activeSource', null),
  favorites: store.get('favorites', []),
  recent: store.get('recent', []),
  progress: store.get('progress', {}),
  reminders: store.get('reminders', []),
  hiddenGroups: store.get('hiddenGroups', []),
  health: store.get('health', {}),
  channels: [],
  filtered: [],
  rendered: 0,
  type: 'live',
  group: SPECIAL.all,
  query: '',
  sort: store.get('sort', 'default'),
  unlocked: false,
  epg: new EPG(),
  xtream: null,
  current: [null, null, null, null],
  activeSlot: 0,
  multiview: false,
  lastItem: null,
  showStats: false,
  guideShift: 0,
  sleepTimer: null,
  checking: null,
  zapBuffer: '',
  zapTimer: null
}

const els = {
  sourceSelect: $('#sourceSelect'),
  search: $('#searchInput'),
  typeTabs: $('#typeTabs'),
  groupList: $('#groupList'),
  channelList: $('#channelList'),
  listTitle: $('#listTitle'),
  listCount: $('#listCount'),
  empty: $('#emptyState'),
  sort: $('#sortSelect'),
  players: $('#players'),
  slots: $$('.slot'),
  nowPanel: $('#nowPanel'),
  playBtn: $('#playBtn'),
  muteBtn: $('#muteBtn'),
  volume: $('#volume'),
  quality: $('#qualitySelect'),
  audio: $('#audioSelect'),
  subs: $('#subSelect'),
  sleep: $('#sleepSelect'),
  recBtn: $('#recBtn'),
  seekRow: $('#seekRow'),
  seekBar: $('#seekBar'),
  timeNow: $('#timeNow'),
  timeTotal: $('#timeTotal')
}

const players = els.slots.map((slot, i) => {
  const video = $('video', slot)
  const player = new Player(video, { getSettings: () => state.settings })
  player.addEventListener('state', e => onPlayerState(i, e.detail))
  player.addEventListener('error', e => onPlayerError(i, e.detail))
  player.addEventListener('tracks', () => i === state.activeSlot && renderTracks())
  for (const ev of ['play', 'pause', 'volumechange']) video.addEventListener(ev, () => i === state.activeSlot && syncControls())
  video.addEventListener('timeupdate', () => i === state.activeSlot && syncSeek())
  video.addEventListener('pause', () => saveProgress())
  return player
})

const activePlayer = () => players[state.activeSlot]
const activeVideo = () => activePlayer().video
const activeItem = () => state.current[state.activeSlot]
const groupOf = item => item.group || 'Uncategorized'
const activeSource = () => state.sources.find(s => s.id === state.activeSourceId)

function saveSettings() {
  store.set('settings', state.settings)
}

/* ---------- Theme ---------- */

function applyTheme() {
  const theme = state.settings.theme
  const dark = theme === 'system' ? matchMedia('(prefers-color-scheme: dark)').matches : theme !== 'light'
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
}

/* ---------- Parental control ---------- */

function lockKeywords() {
  return state.settings.lockKeywords
    .split(',')
    .map(k => k.trim().toLowerCase())
    .filter(Boolean)
}

function isLockedGroup(group) {
  if (!state.settings.pinHash) return false
  const g = (group || '').toLowerCase()
  return lockKeywords().some(k => g.includes(k))
}

const isLocked = item => isLockedGroup(groupOf(item))
const isHiddenLocked = item => !state.unlocked && isLocked(item)

function askPin() {
  if (!state.settings.pinHash || state.unlocked) return Promise.resolve(true)
  const dialog = $('#pinDialog')
  const input = $('#pinInput')
  input.value = ''
  $('#pinError').hidden = true
  dialog.showModal()
  input.focus()
  return new Promise(resolve => {
    const onClose = async () => {
      if (dialog.returnValue !== 'ok') return resolve(false)
      if ((await sha256(input.value)) === state.settings.pinHash) {
        state.unlocked = true
        renderGroups()
        renderList()
        return resolve(true)
      }
      $('#pinError').hidden = false
      dialog.returnValue = ''
      dialog.showModal()
      dialog.addEventListener('close', onClose, { once: true })
    }
    dialog.addEventListener('close', onClose, { once: true })
  })
}

/* ---------- Sources ---------- */

function saveSources() {
  store.set('sources', state.sources)
}

function renderSourceSelect() {
  const options = state.sources.map(
    s => `<option value="${s.id}" ${s.id === state.activeSourceId ? 'selected' : ''}>${escapeHtml(s.name)}</option>`
  )
  if (!state.sources.length) options.push('<option value="" selected>No playlist</option>')
  options.push('<option value="__add">＋ Add playlist…</option>')
  els.sourceSelect.innerHTML = options.join('')
}

async function loadSource(source, { force = false } = {}) {
  if (!source) {
    state.channels = []
    renderAll()
    return
  }
  state.activeSourceId = source.id
  store.set('activeSource', source.id)
  renderSourceSelect()
  state.xtream = source.type === 'xtream' ? new XtreamClient(source) : null
  showListMessage(`<div class="spinner"></div><p>Loading “${escapeHtml(source.name)}”…</p>`)

  const cacheKey = 'playlist:' + source.id
  const cached = await idbGet(cacheKey)
  let data = cached
  if (force || !cached || Date.now() - cached.fetched > PLAYLIST_TTL) {
    try {
      data = await fetchSource(source)
      data.fetched = Date.now()
      idbSet(cacheKey, data)
    } catch (err) {
      if (!cached) {
        state.channels = []
        renderAll()
        showListMessage(
          `<p class="error">Could not load this playlist.</p><p class="muted">${escapeHtml(err.message)}</p>
          <p class="muted">If the server doesn't allow cross-origin requests, set a CORS proxy in Settings → Network.</p>
          <button data-action="retry-source">Try again</button>`
        )
        return
      }
      toast('Playlist refresh failed, using cached copy', 'warn')
    }
  }

  if (source.id !== state.activeSourceId) return
  state.channels = data.channels
  const types = availableTypes()
  if (!types.includes(state.type)) state.type = types[0]
  state.group = SPECIAL.all
  renderAll()
  loadEpg(source, data.epgUrl, force)
}

async function fetchSource(source) {
  if (source.type === 'xtream') {
    const client = new XtreamClient(source)
    await client.login()
    return { channels: await client.loadAll(), epgUrl: '' }
  }
  const text = source.type === 'file' ? await idbGet('m3utext:' + source.id) : await fetchText(source.url, 120000)
  if (!text) throw new Error('Playlist is empty')
  const parsed = parseM3U(text)
  if (!parsed.channels.length) throw new Error('No channels found – is this an M3U playlist?')
  return parsed
}

async function loadEpg(source, playlistEpg, force) {
  state.epg.offset = Number(state.settings.epgOffset || 0) * 36e5
  let urls = (source.epgUrl || playlistEpg || '')
    .split(',')
    .map(u => u.trim())
    .filter(Boolean)
  if (!urls.length && state.xtream) urls = [state.xtream.epgUrl()]
  if (!urls.length) {
    state.epg.clear()
    return
  }
  try {
    await state.epg.load(urls, { force })
    if (source.id !== state.activeSourceId) return
    renderList(false, true)
    updateNowPanel()
  } catch (err) {
    console.warn(err)
    toast('EPG could not be loaded: ' + err.message, 'warn', 5000)
  }
}

/* ---------- Source dialog ---------- */

let editingSource = null

function openSourceDialog(source = null) {
  editingSource = source
  const form = $('#sourceForm')
  form.reset()
  $('#sourceError').hidden = true
  $('#sourceTitle').textContent = source ? 'Edit playlist' : 'Add playlist'
  const type = source?.type === 'm3u' && source.url?.startsWith(IPTV_ORG) && source.orgKind ? 'iptvorg' : source?.type || 'm3u'
  setSourceTab(type)
  if (source) {
    for (const key of ['name', 'url', 'epgUrl', 'server', 'username', 'password', 'ext']) {
      if (form.elements[key] && source[key] != null) form.elements[key].value = source[key]
    }
  }
  $('#sourceDialog').showModal()
}

function setSourceTab(type) {
  $$('#sourceTabs button').forEach(b => b.classList.toggle('on', b.dataset.type === type))
  $$('#sourceForm [data-for]').forEach(el => (el.hidden = el.dataset.for !== type))
  $$('#sourceForm [data-hide-for]').forEach(el => (el.hidden = el.dataset.hideFor === type))
  $('#sourceForm').dataset.type = type
  if (type === 'iptvorg') loadOrgOptions()
}

async function loadOrgOptions() {
  const form = $('#sourceForm')
  const kind = form.elements.orgKind.value
  const select = form.elements.orgValue
  if (kind === 'all') {
    select.innerHTML = '<option value="">—</option>'
    select.disabled = true
    return
  }
  select.disabled = true
  select.innerHTML = '<option>Loading…</option>'
  try {
    const list = await fetchJSON(`${IPTV_ORG}/api/${kind}.json`)
    const options = list
      .map(x => ({ value: (x.code || x.id).toLowerCase(), label: `${x.flag ? x.flag + ' ' : ''}${x.name}` }))
      .sort((a, b) => a.label.localeCompare(b.label))
    select.innerHTML = options.map(o => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`).join('')
    select.disabled = false
  } catch {
    select.innerHTML = '<option value="">Could not load list</option>'
  }
}

async function submitSource() {
  const form = $('#sourceForm')
  const f = form.elements
  const type = form.dataset.type
  const error = msg => {
    $('#sourceError').textContent = msg
    $('#sourceError').hidden = false
  }
  const source = { ...(editingSource || {}), id: editingSource?.id || uid(), epgUrl: f.epgUrl.value.trim() }
  source.name = f.name.value.trim()

  if (type === 'm3u') {
    if (!f.url.value.trim()) return error('Please enter a playlist URL')
    Object.assign(source, { type: 'm3u', url: f.url.value.trim() })
  } else if (type === 'file') {
    const file = f.file.files[0]
    if (!file && !editingSource) return error('Please choose a playlist file')
    if (file) {
      await idbSet('m3utext:' + source.id, await file.text())
      source.name = source.name || file.name.replace(/\.[^.]+$/, '')
    }
    source.type = 'file'
  } else if (type === 'xtream') {
    if (!f.server.value.trim() || !f.username.value.trim()) return error('Server and username are required')
    Object.assign(source, {
      type: 'xtream',
      server: f.server.value.trim(),
      username: f.username.value.trim(),
      password: f.password.value,
      ext: f.ext.value
    })
  } else {
    const kind = f.orgKind.value
    const value = f.orgValue.value
    if (kind !== 'all' && !value) return error('Please pick an option')
    const label = kind === 'all' ? 'All channels' : f.orgValue.selectedOptions[0].textContent
    Object.assign(source, {
      type: 'm3u',
      orgKind: kind,
      url: kind === 'all' ? `${IPTV_ORG}/iptv/index.m3u` : `${IPTV_ORG}/iptv/${kind}/${value}.m3u`,
      name: source.name || `iptv-org · ${label}`
    })
  }
  source.name = source.name || source.url || source.server || 'Playlist'

  const index = state.sources.findIndex(s => s.id === source.id)
  if (index >= 0) state.sources[index] = source
  else state.sources.push(source)
  saveSources()
  $('#sourceDialog').close()
  renderSourceManager()
  loadSource(source, { force: true })
}

function addIptvOrgDefault() {
  const source = { id: uid(), type: 'm3u', orgKind: 'all', name: 'iptv-org · All channels', url: `${IPTV_ORG}/iptv/index.m3u`, epgUrl: '' }
  state.sources.push(source)
  saveSources()
  loadSource(source)
}

async function deleteSource(id) {
  const source = state.sources.find(s => s.id === id)
  if (!source || !confirm(`Remove playlist “${source.name}”?`)) return
  state.sources = state.sources.filter(s => s.id !== id)
  saveSources()
  idbDelete('playlist:' + id)
  idbDelete('m3utext:' + id)
  renderSourceManager()
  if (state.activeSourceId === id) {
    state.activeSourceId = state.sources[0]?.id || null
    store.set('activeSource', state.activeSourceId)
    loadSource(state.sources[0])
  }
  renderSourceSelect()
}

/* ---------- Sidebar ---------- */

function availableTypes() {
  const types = Object.keys(TYPES).filter(t => state.channels.some(c => c.type === t))
  return types.length ? types : ['live']
}

function renderAll() {
  renderTabs()
  renderGroups()
  renderList()
  if (!state.sources.length) {
    showListMessage(`<h3>Welcome to IPTV Plus 👋</h3>
      <p class="muted">Add an M3U playlist, an Xtream Codes account, or start with thousands of free public channels.</p>
      <div class="btn-row center">
        <button data-action="add-source" class="primary">＋ Add playlist</button>
        <button data-action="add-iptvorg">Try free channels</button>
      </div>`)
  }
}

function renderTabs() {
  els.typeTabs.innerHTML = availableTypes()
    .map(t => `<button role="tab" data-type="${t}" class="${t === state.type ? 'on' : ''}">${TYPES[t]}</button>`)
    .join('')
}

function renderGroups() {
  const items = state.channels.filter(c => c.type === state.type)
  const counts = new Map()
  for (const c of items) counts.set(groupOf(c), (counts.get(groupOf(c)) || 0) + 1)
  const hidden = new Set(state.hiddenGroups)
  const groups = [...counts.keys()].filter(g => !hidden.has(g)).sort((a, b) => a.localeCompare(b))
  const special = [
    [SPECIAL.all, ALL_LABELS[state.type], items.filter(c => !hidden.has(groupOf(c)) && !isHiddenLocked(c)).length],
    [SPECIAL.fav, '★ Favorites', state.favorites.length],
    [SPECIAL.recent, '🕘 Recently watched', state.recent.length],
    [SPECIAL.cont, '⏯ Continue watching', Object.keys(state.progress).length]
  ]
  const li = (id, label, count, extra = '') =>
    `<li class="group ${state.group === id ? 'on' : ''}" data-group="${escapeHtml(id)}">
      <span class="label">${label}</span><span class="count">${count}</span>${extra}</li>`
  els.groupList.innerHTML =
    special.map(([id, label, count]) => li(id, label, count)).join('') +
    '<li class="divider"></li>' +
    groups
      .map(g => {
        const lock = isLockedGroup(g) && !state.unlocked ? '🔒 ' : ''
        return li(g, lock + escapeHtml(g), counts.get(g), '<button class="hide-group" title="Hide this group" data-action="hide">⊘</button>')
      })
      .join('')
}

async function selectGroup(group) {
  if (isLockedGroup(group) && !(await askPin())) return
  state.group = group
  document.body.classList.remove('drawer-open')
  renderGroups()
  renderList()
}

function hideGroup(group) {
  if (!state.hiddenGroups.includes(group)) state.hiddenGroups.push(group)
  store.set('hiddenGroups', state.hiddenGroups)
  if (state.group === group) state.group = SPECIAL.all
  renderGroups()
  renderList()
  toast(`Hidden “${group}” – restore it from Settings`, 'info', 4000, {
    label: 'Undo',
    onClick: () => unhideGroup(group)
  })
}

function unhideGroup(group) {
  state.hiddenGroups = state.hiddenGroups.filter(g => g !== group)
  store.set('hiddenGroups', state.hiddenGroups)
  renderGroups()
  renderList()
  renderHiddenGroups()
}

/* ---------- Channel list ---------- */

function computeList() {
  const { group, type } = state
  const hidden = new Set(state.hiddenGroups)
  let list
  if (group === SPECIAL.fav) list = state.favorites.slice()
  else if (group === SPECIAL.recent) list = state.recent.slice()
  else if (group === SPECIAL.cont) list = Object.values(state.progress).sort((a, b) => b.at - a.at).map(p => p.item)
  else if (group === SPECIAL.all) list = state.channels.filter(c => c.type === type && !hidden.has(groupOf(c)))
  else list = state.channels.filter(c => c.type === type && groupOf(c) === group)

  list = list.filter(c => !isHiddenLocked(c))
  const q = state.query.trim().toLowerCase()
  if (q) {
    list = list.filter(c => {
      if (c.name.toLowerCase().includes(q) || groupOf(c).toLowerCase().includes(q)) return true
      return c.type === 'live' && state.epg.at(c).now?.title.toLowerCase().includes(q)
    })
  }
  if (state.settings.hideDead) list = list.filter(c => state.health[c.url] !== 'dead')

  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })
  if (state.sort === 'name') list = list.slice().sort(byName)
  else if (state.sort === 'name-desc') list = list.slice().sort((a, b) => byName(b, a))
  else if (state.sort === 'number') {
    const num = c => parseFloat(c.chno) || Infinity
    list = list.slice().sort((a, b) => num(a) - num(b))
  }
  state.filtered = list
}

function listTitle() {
  if (state.group === SPECIAL.all) return ALL_LABELS[state.type]
  if (state.group === SPECIAL.fav) return 'Favorites'
  if (state.group === SPECIAL.recent) return 'Recently watched'
  if (state.group === SPECIAL.cont) return 'Continue watching'
  return state.group
}

function logoHtml(item) {
  const text = escapeHtml(initials(item.name))
  if (!item.logo) return `<span class="logo-fallback">${text}</span>`
  return `<img loading="lazy" src="${escapeHtml(item.logo)}" alt="" data-fallback="${text}" referrerpolicy="no-referrer" />`
}

function rowHtml(item, index) {
  const fav = isFav(item)
  const health = state.health[item.url]
  let sub = escapeHtml(groupOf(item))
  let bar = ''
  if (item.type === 'live') {
    const { now } = state.epg.at(item)
    if (now) {
      sub = `${fmtClock(now.start)} · ${escapeHtml(now.title)}`
      bar = Math.min(100, ((Date.now() - now.start) / (now.stop - now.start)) * 100)
    }
  } else if (state.progress[item.url]) {
    const p = state.progress[item.url]
    bar = Math.min(100, (p.t / p.d) * 100)
    sub = `${fmtDuration(p.t)} / ${fmtDuration(p.d)}`
  } else if (item.rating) {
    sub += ` · ★ ${escapeHtml(item.rating)}`
  }
  const catchup = canCatchup(item) ? '<span class="tag" title="Catch-up available">⟲</span>' : ''
  return `<li class="row" data-i="${index}" tabindex="-1">
    <span class="num">${escapeHtml(item.chno || index + 1)}</span>
    <span class="logo">${logoHtml(item)}</span>
    <span class="meta"><span class="name">${escapeHtml(item.name)} ${catchup}</span><span class="sub">${sub}</span>
      ${bar !== '' ? `<span class="bar"><i style="width:${bar}%"></i></span>` : ''}</span>
    ${health ? `<span class="dot ${health}" title="${health === 'ok' ? 'Reachable' : 'Unreachable'}"></span>` : ''}
    <button class="fav ${fav ? 'on' : ''}" data-action="fav" title="Favorite (S)" aria-label="Favorite">${fav ? '★' : '☆'}</button>
  </li>`
}

function showListMessage(html) {
  els.channelList.innerHTML = ''
  els.empty.innerHTML = html
  els.empty.hidden = false
}

// reset=false appends the next batch; refresh=true re-renders the rows already shown (e.g. after EPG load)
function renderList(reset = true, refresh = false) {
  const ul = els.channelList
  if (refresh) {
    const shown = state.rendered
    computeList()
    ul.innerHTML = state.filtered.slice(0, shown).map((c, i) => rowHtml(c, i)).join('')
    state.rendered = Math.min(shown, state.filtered.length)
  } else {
    if (reset) {
      computeList()
      ul.innerHTML = ''
      ul.scrollTop = 0
      state.rendered = 0
    }
    const slice = state.filtered.slice(state.rendered, state.rendered + BATCH)
    ul.insertAdjacentHTML('beforeend', slice.map((c, i) => rowHtml(c, state.rendered + i)).join(''))
    state.rendered += slice.length
  }
  els.listTitle.textContent = listTitle()
  els.listCount.textContent = state.filtered.length ? `(${state.filtered.length})` : ''
  els.empty.hidden = state.filtered.length > 0
  if (!state.filtered.length) {
    els.empty.innerHTML = state.query
      ? `<p class="muted">Nothing matches “${escapeHtml(state.query)}”.</p>`
      : state.group === SPECIAL.fav
        ? '<p class="muted">No favorites yet – tap ☆ on any channel.</p>'
        : '<p class="muted">Nothing here.</p>'
  }
  markPlaying()
}

function updateRow(index) {
  const li = $(`.row[data-i="${index}"]`, els.channelList)
  if (li) li.outerHTML = rowHtml(state.filtered[index], index)
}

function markPlaying() {
  const url = activeItem()?.url
  $$('.row', els.channelList).forEach(li => li.classList.toggle('playing', state.filtered[+li.dataset.i]?.url === url))
}

/* ---------- Favorites, history, progress ---------- */

function snapshot(item) {
  const copy = { ...item }
  delete copy.title
  return copy
}

const isFav = item => state.favorites.some(f => f.url === item.url)

function toggleFav(item) {
  if (!item) return
  if (isFav(item)) state.favorites = state.favorites.filter(f => f.url !== item.url)
  else state.favorites.push(snapshot(item))
  store.set('favorites', state.favorites)
  toast(isFav(item) ? `Added “${item.name}” to favorites` : `Removed “${item.name}” from favorites`)
  renderGroups()
  if (state.group === SPECIAL.fav) renderList()
  else renderList(false, true)
  updateNowPanel()
}

function addRecent(item) {
  state.recent = [snapshot(item), ...state.recent.filter(r => r.url !== item.url)].slice(0, 60)
  store.set('recent', state.recent)
}

function saveProgress() {
  let changed = false
  state.current.forEach((item, slot) => {
    if (!item || item.type === 'live' || item.catchupOf) return
    const v = players[slot].video
    if (!isFinite(v.duration) || v.duration < 60 || v.currentTime < 5) return
    if (v.currentTime / v.duration > 0.95) delete state.progress[item.url]
    else state.progress[item.url] = { t: v.currentTime, d: v.duration, at: Date.now(), item: snapshot(item) }
    changed = true
  })
  if (changed) store.set('progress', state.progress)
}

/* ---------- Playback ---------- */

async function playItem(item, slot = state.activeSlot) {
  if (!item) return
  if (item.type === 'series' && item.seriesId) return openSeries(item)
  if (isLocked(item) && !(await askPin())) return
  if (location.protocol === 'https:' && item.url.startsWith('http:') && !state.settings.proxyStreams) {
    toast('This is an http:// stream: browsers may block it on an https:// page. Run IPTV Plus locally or enable a stream proxy.', 'warn', 6000)
  }
  saveProgress()
  const previous = state.current[slot]
  if (slot === state.activeSlot && previous && previous.url !== item.url && !previous.catchupOf) state.lastItem = previous
  state.current[slot] = item
  const player = players[slot]
  const video = player.video
  player.play({ url: item.url, type: item.type, name: item.name })

  const saved = state.progress[item.url]
  if (item.type !== 'live' && saved && saved.t > 10) {
    video.addEventListener(
      'loadedmetadata',
      () => {
        if (state.current[slot] !== item) return
        video.currentTime = saved.t
        toast(`Resumed at ${fmtDuration(saved.t)}`, 'info', 4000, {
          label: 'Start over',
          onClick: () => (video.currentTime = 0)
        })
      },
      { once: true }
    )
  }

  if (!item.catchupOf) {
    addRecent(item)
    store.set('last', snapshot(item))
  }
  showOsd(slot)
  renderSlotLabel(slot)
  if (slot === state.activeSlot) {
    updateNowPanel()
    markPlaying()
    updateMediaSession()
    syncControls()
  }
}

function zap(direction) {
  const list = state.filtered.filter(c => c.type !== 'series')
  if (!list.length) return
  const index = list.findIndex(c => c.url === activeItem()?.url)
  const next = index === -1 ? list[0] : list[(index + direction + list.length) % list.length]
  playItem(next)
  scrollToItem(next)
}

function scrollToItem(item) {
  const index = state.filtered.indexOf(item)
  if (index < 0) return
  while (state.rendered <= index) renderList(false)
  $(`.row[data-i="${index}"]`, els.channelList)?.scrollIntoView({ block: 'nearest' })
}

function zapToNumber(digit) {
  state.zapBuffer += digit
  const osd = $('.osd', els.slots[state.activeSlot])
  osd.innerHTML = `<div class="zap">${escapeHtml(state.zapBuffer)}</div>`
  osd.classList.add('show')
  clearTimeout(state.zapTimer)
  state.zapTimer = setTimeout(() => {
    const n = state.zapBuffer
    state.zapBuffer = ''
    osd.classList.remove('show')
    const list = state.filtered
    const item = list.find(c => c.chno === n) || list[parseInt(n, 10) - 1]
    if (item) {
      playItem(item)
      scrollToItem(item)
    } else {
      toast(`No channel ${n}`, 'warn')
    }
  }, 1300)
}

function onPlayerState(slot, status) {
  const el = $('.status', els.slots[slot])
  const item = state.current[slot]
  if (status === 'loading' || status === 'buffering') {
    el.innerHTML = '<div class="spinner"></div>'
    el.className = 'status show'
  } else if (status.startsWith('reconnecting')) {
    el.innerHTML = `<div class="spinner"></div><p>Connection lost – reconnecting (${status.split(' ')[1]})…</p>`
    el.className = 'status show'
  } else if (status === 'click-to-play') {
    el.innerHTML = '<button class="big-play" data-action="resume">▶</button>'
    el.className = 'status show'
  } else if (status === 'idle' && !item) {
    el.innerHTML = slot === 0 && !state.multiview ? '' : '<p class="muted">Empty – select this tile, then pick a channel</p>'
    el.className = state.multiview ? 'status show' : 'status'
  } else if (status === 'playing' || status === 'idle') {
    el.className = 'status'
  }
  if (slot === state.activeSlot) syncControls()
}

function onPlayerError(slot, err) {
  const el = $('.status', els.slots[slot])
  const item = state.current[slot]
  el.innerHTML = `<p class="error">Can't play ${escapeHtml(item?.name || 'this stream')}</p>
    <p class="muted small">${escapeHtml(err?.message || 'Unknown error')}</p>
    <button data-action="retry">Retry</button>`
  el.className = 'status show'
  if (item) {
    state.health[item.url] = 'dead'
    store.set('health', state.health)
  }
}

function showOsd(slot) {
  const item = state.current[slot]
  if (!item) return
  const osd = $('.osd', els.slots[slot])
  const { now, next } = item.type === 'live' ? state.epg.at(item) : {}
  osd.innerHTML = `<div class="osd-card">
    <div class="osd-logo">${logoHtml(item)}</div>
    <div><div class="osd-name">${item.chno ? `<span class="muted">${escapeHtml(item.chno)}</span> ` : ''}${escapeHtml(item.name)}</div>
    ${item.catchupOf ? `<div class="muted">Catch-up · ${escapeHtml(item.catchupOf)}</div>` : ''}
    ${now ? `<div>${fmtClock(now.start)} ${escapeHtml(now.title)}</div>` : ''}
    ${next ? `<div class="muted">Next ${fmtClock(next.start)} ${escapeHtml(next.title)}</div>` : ''}</div></div>`
  osd.classList.add('show')
  clearTimeout(osd.timer)
  osd.timer = setTimeout(() => osd.classList.remove('show'), 4000)
}

function renderSlotLabel(slot) {
  els.slots[slot].dataset.label = state.current[slot]?.name || ''
}

function setActiveSlot(slot) {
  state.activeSlot = slot
  els.slots.forEach((el, i) => {
    el.classList.toggle('active', i === slot)
    players[i].video.muted = i !== slot || state.settings.muted
  })
  renderTracks()
  syncControls()
  updateNowPanel()
  markPlaying()
  updateMediaSession()
}

function toggleMultiview(force) {
  state.multiview = force ?? !state.multiview
  els.players.classList.toggle('single', !state.multiview)
  els.players.classList.toggle('multi', state.multiview)
  $('#multiBtn').classList.toggle('on', state.multiview)
  if (!state.multiview) {
    const keep = state.activeSlot
    const item = state.current[keep]
    players.forEach((p, i) => {
      if (i === 0) return
      p.stop()
      state.current[i] = null
    })
    if (keep !== 0) {
      players[0].stop()
      state.current[0] = null
      setActiveSlot(0)
      if (item) playItem(item, 0)
    } else {
      setActiveSlot(0)
    }
  } else {
    toast('Multi-view: click a tile to select it, then pick a channel for it')
    players.forEach((p, i) => !state.current[i] && onPlayerState(i, 'idle'))
  }
}

/* ---------- Controls ---------- */

function syncControls() {
  const video = activeVideo()
  els.playBtn.textContent = video.paused ? '▶' : '⏸'
  els.muteBtn.textContent = state.settings.muted || state.settings.volume === 0 ? '🔇' : '🔊'
  els.volume.value = state.settings.volume
  els.recBtn.classList.toggle('rec', activePlayer().recording)
  syncSeek()
}

function syncSeek() {
  const video = activeVideo()
  const seekable = isFinite(video.duration) && video.duration > 0
  els.seekRow.hidden = !seekable
  if (!seekable) return
  if (!els.seekBar.dragging) els.seekBar.value = (video.currentTime / video.duration) * 1000
  els.timeNow.textContent = fmtDuration(video.currentTime)
  els.timeTotal.textContent = fmtDuration(video.duration)
}

function applyVolume() {
  players.forEach((p, i) => {
    p.video.volume = state.settings.volume
    p.video.muted = state.settings.muted || i !== state.activeSlot
  })
  saveSettings()
  syncControls()
}

function changeVolume(delta) {
  state.settings.volume = Math.min(1, Math.max(0, Math.round((state.settings.volume + delta) * 100) / 100))
  state.settings.muted = false
  applyVolume()
  toast(`Volume ${Math.round(state.settings.volume * 100)}%`, 'info', 1000)
}

function renderTracks() {
  const t = activePlayer().tracks()
  const fill = (select, items, current, autoLabel) => {
    const options = autoLabel ? [{ index: -1, label: autoLabel }, ...items] : items
    select.innerHTML = options.map(o => `<option value="${o.index}">${escapeHtml(o.label)}</option>`).join('')
    select.value = String(current)
    select.hidden = items.length < (autoLabel === 'Subtitles off' ? 1 : 2)
  }
  fill(els.quality, t.levels, t.level, 'Auto quality')
  fill(els.audio, t.audio, t.audioIndex, null)
  fill(els.subs, t.subs, t.subIndex, 'Subtitles off')
}

function togglePlay() {
  const video = activeVideo()
  if (!activeItem()) return
  if (video.paused) video.play().catch(() => {})
  else video.pause()
}

function toggleFullscreen() {
  const el = state.multiview ? els.players : els.slots[state.activeSlot]
  if (document.fullscreenElement) document.exitFullscreen()
  else (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el)
}

async function togglePip() {
  const video = activeVideo()
  try {
    if (document.pictureInPictureElement) await document.exitPictureInPicture()
    else if (video.requestPictureInPicture) await video.requestPictureInPicture()
    else toast('Picture-in-picture is not supported here', 'warn')
  } catch (err) {
    toast(err.message, 'warn')
  }
}

async function takeSnapshot() {
  try {
    const blob = await activePlayer().snapshot()
    download(`${(activeItem()?.name || 'snapshot').replace(/[^\w-]+/g, '_')}-${Date.now()}.png`, blob)
  } catch (err) {
    toast(err.message, 'warn')
  }
}

function toggleRecording() {
  const player = activePlayer()
  const item = activeItem()
  if (player.recording) {
    player.stopRecording()
    syncControls()
    return
  }
  if (!item) return
  try {
    player.startRecording(blob => {
      download(`${item.name.replace(/[^\w-]+/g, '_')}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.webm`, blob)
      toast('Recording saved')
      syncControls()
    })
    toast('Recording… press ⏺ again to stop and save', 'info', 5000)
  } catch (err) {
    toast(err.name === 'SecurityError' ? 'This stream does not allow recording (CORS)' : err.message, 'warn')
  }
  syncControls()
}

function setSleepTimer(minutes) {
  clearTimeout(state.sleepTimer)
  clearInterval(state.sleepTicker)
  const option = els.sleep.querySelector('option[value="0"]')
  option.textContent = '⏾ Off'
  if (!minutes) return
  const end = Date.now() + minutes * 60000
  state.sleepTimer = setTimeout(() => {
    players.forEach(p => p.video.pause())
    els.sleep.value = '0'
    setSleepTimer(0)
    toast('Sleep timer: playback paused. Good night! 🌙', 'info', 8000)
  }, minutes * 60000)
  state.sleepTicker = setInterval(() => {
    els.sleep.selectedOptions[0].textContent = `⏾ ${Math.ceil((end - Date.now()) / 60000)} min left`
  }, 15000)
  toast(`Playback will pause in ${minutes} minutes`)
}

function updateStats() {
  els.slots.forEach((slot, i) => {
    const el = $('.stats', slot)
    el.hidden = !state.showStats || !state.current[i]
    if (el.hidden) return
    const s = players[i].stats()
    el.innerHTML = `<b>Engine</b> ${s.engine}<br><b>Resolution</b> ${s.resolution}<br><b>Bitrate</b> ${s.bitrate}<br>
      <b>Buffer</b> ${s.buffer}<br><b>Dropped</b> ${s.dropped}<br><b>Reconnects</b> ${s.retries}`
  })
}

function updateMediaSession() {
  if (!('mediaSession' in navigator)) return
  const item = activeItem()
  if (!item) return
  const now = item.type === 'live' ? state.epg.at(item).now : null
  navigator.mediaSession.metadata = new MediaMetadata({
    title: now ? now.title : item.name,
    artist: now ? item.name : groupOf(item),
    artwork: item.logo ? [{ src: item.logo }] : []
  })
}

/* ---------- Now panel ---------- */

function canCatchup(item) {
  return item.type === 'live' && ((item.catchupType === 'xtream' && item.archiveDays > 0) || !!item.catchup || !!item.catchupDays)
}

function catchupWindow(item) {
  return (item.archiveDays || Number(item.catchupDays) || 3) * 864e5
}

function playCatchup(item, prog) {
  const url =
    item.catchupType === 'xtream' && state.xtream
      ? state.xtream.timeshiftUrl(item.streamId, prog.start - state.epg.offset, prog.stop - state.epg.offset)
      : buildCatchupUrl(item, prog.start - state.epg.offset, prog.stop - state.epg.offset)
  if (!url) return toast('Catch-up is not available for this channel', 'warn')
  playItem({ ...item, url, type: 'movie', name: `${item.name} – ${prog.title}`, catchupOf: item.name })
}

function updateNowPanel() {
  const item = activeItem()
  const panel = els.nowPanel
  if (!item) {
    panel.innerHTML = '<p class="muted">Pick a channel to start watching.</p>'
    return
  }
  const fav = isFav(item)
  let body = ''
  if (item.type === 'live') {
    const nowTime = Date.now()
    const { now } = state.epg.at(item)
    const upcoming = state.epg.range(item, nowTime, nowTime + 12 * 36e5).filter(p => p.start > nowTime).slice(0, 6)
    if (now) {
      const pct = Math.min(100, ((nowTime - now.start) / (now.stop - now.start)) * 100)
      body += `<div class="now">
        <div class="now-title">${escapeHtml(now.title)}</div>
        <div class="muted small">${fmtClock(now.start)} – ${fmtClock(now.stop)} · ${Math.max(0, Math.round((now.stop - nowTime) / 60000))} min left</div>
        <div class="bar"><i style="width:${pct}%"></i></div>
        ${now.desc ? `<p class="desc">${escapeHtml(now.desc)}</p>` : ''}
        ${canCatchup(item) ? '<button class="small" data-action="restart">⟲ Watch from start</button>' : ''}
      </div>`
    } else if (!state.epg.loaded) {
      body += '<p class="muted small">No programme guide loaded. Add an EPG URL to this playlist in Settings.</p>'
    } else {
      body += '<p class="muted small">No programme information for this channel.</p>'
    }
    if (upcoming.length) {
      body += `<ul class="upcoming">${upcoming
        .map(p => {
          const reminded = state.reminders.some(r => r.url === item.url && r.start === p.start)
          return `<li><span class="time">${fmtClock(p.start)}</span><span class="t">${escapeHtml(p.title)}</span>
            <button class="small ${reminded ? 'on' : ''}" data-action="remind" data-start="${p.start}" title="Remind me">${reminded ? '🔔' : '🔕'}</button></li>`
        })
        .join('')}</ul>`
    }
  } else {
    if (item.plot) body += `<p class="desc">${escapeHtml(item.plot)}</p>`
    if (item.rating) body += `<p class="muted small">Rating ★ ${escapeHtml(item.rating)}</p>`
  }
  panel.innerHTML = `<div class="now-head">
      <div class="now-logo">${logoHtml(item)}</div>
      <div class="now-meta"><div class="now-name">${escapeHtml(item.name)}</div><div class="muted small">${escapeHtml(groupOf(item))}</div></div>
      ${item.catchupOf ? '' : `<button class="fav big ${fav ? 'on' : ''}" data-action="fav-current" title="Favorite (S)">${fav ? '★' : '☆'}</button>`}
    </div>${body}`
}

/* ---------- Reminders ---------- */

function toggleReminder(item, start) {
  const prog = state.epg.range(item, start, start + 1).find(p => p.start === start)
  const existing = state.reminders.findIndex(r => r.url === item.url && r.start === start)
  if (existing >= 0) state.reminders.splice(existing, 1)
  else if (prog) {
    state.reminders.push({ url: item.url, start, title: prog.title, item: snapshot(item) })
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission()
    toast(`Reminder set for “${prog.title}” at ${fmtClock(start)}`)
  }
  store.set('reminders', state.reminders)
  updateNowPanel()
}

function checkReminders() {
  const now = Date.now()
  const due = state.reminders.filter(r => r.start - 60000 <= now)
  if (!due.length) return
  state.reminders = state.reminders.filter(r => !due.includes(r))
  store.set('reminders', state.reminders)
  for (const r of due) {
    if (r.start + 30 * 60000 < now) continue
    const message = `“${r.title}” starts ${r.start > now ? 'at ' + fmtClock(r.start) : 'now'} on ${r.item.name}`
    toast(message, 'info', 30000, { label: 'Watch', onClick: () => playItem(r.item) })
    if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
      new Notification('IPTV Plus reminder', { body: message, icon: 'icon.svg' })
    }
  }
}

/* ---------- Stream health check ---------- */

async function checkStreams() {
  if (state.checking) {
    state.checking.cancelled = true
    return
  }
  const job = { cancelled: false }
  state.checking = job
  const btn = $('#checkBtn')
  const items = state.filtered.filter(c => c.type === 'live').slice(0, 500)
  let done = 0
  let dead = 0
  const queue = items.slice()
  const worker = async () => {
    while (queue.length && !job.cancelled) {
      const item = queue.shift()
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 8000)
      try {
        // An opaque (no-cors) response still proves the server answered
        await fetch(item.url, { mode: 'no-cors', signal: controller.signal, cache: 'no-store' })
        state.health[item.url] = 'ok'
      } catch {
        state.health[item.url] = 'dead'
        dead++
      } finally {
        clearTimeout(timer)
      }
      done++
      btn.textContent = `Stop ${done}/${items.length}`
      updateRow(state.filtered.indexOf(item))
    }
  }
  btn.textContent = `Stop 0/${items.length}`
  await Promise.all(Array.from({ length: 8 }, worker))
  store.set('health', state.health)
  state.checking = null
  btn.textContent = 'Check'
  toast(`Checked ${done} streams: ${done - dead} reachable, ${dead} unreachable`, dead ? 'warn' : 'info', 5000)
  if (state.settings.hideDead) renderList()
}

/* ---------- TV guide ---------- */

function renderGuide() {
  const body = $('#guideBody')
  $('#guideDetail').hidden = true
  if (!state.epg.loaded) {
    body.innerHTML = '<p class="muted pad">No programme guide (EPG) is loaded for this playlist. Add an XMLTV URL in Settings → Playlists.</p>'
    return
  }
  const half = 30 * 60000
  const from = Math.floor(Date.now() / half) * half - 2 * half + state.guideShift * 36e5
  const to = from + 8 * 36e5
  const width = ((to - from) / 60000) * GUIDE_PX_PER_MIN
  const x = t => ((t - from) / 60000) * GUIDE_PX_PER_MIN
  const channels = state.filtered.filter(c => c.type === 'live').slice(0, GUIDE_ROWS)
  const nowX = x(Date.now())

  let ticks = ''
  for (let t = from; t < to; t += half) ticks += `<span style="left:${x(t)}px">${fmtClock(t)}</span>`
  const rows = channels
    .map((c, row) => {
      const progs = state.epg.range(c, from, to)
      const cells = progs
        .map((p, i) => {
          const left = Math.max(0, x(p.start))
          const right = Math.min(width, x(p.stop))
          const status = p.stop < Date.now() ? 'past' : p.start <= Date.now() ? 'live' : 'future'
          const catchup = status === 'past' && canCatchup(c) && Date.now() - p.start < catchupWindow(c) ? ' catchup' : ''
          return `<button class="prog ${status}${catchup}" style="left:${left}px;width:${Math.max(0, right - left - 2)}px"
            data-row="${row}" data-p="${i}" title="${escapeHtml(p.title)}">${escapeHtml(p.title)}</button>`
        })
        .join('')
      return `<div class="g-row"><div class="g-ch" data-row="${row}">${logoHtml(c)}<span>${escapeHtml(c.name)}</span></div>
        <div class="g-track" style="width:${width}px">${cells || `<span class="muted small g-none" style="left:${Math.max(10, nowX - 190)}px">No information</span>`}</div></div>`
    })
    .join('')
  body.innerHTML = `<div class="g-grid" style="--w:${width}px">
      <div class="g-row g-times"><div class="g-ch"></div><div class="g-track" style="width:${width}px">${ticks}</div></div>
      ${rows}
      ${nowX > 0 && nowX < width ? `<div class="g-now" style="left:calc(var(--ch) + ${nowX}px)"></div>` : ''}
    </div>
    ${state.filtered.length > GUIDE_ROWS ? `<p class="muted small pad">Showing the first ${GUIDE_ROWS} channels of this list – pick a group to narrow it down.</p>` : ''}
    ${!channels.length ? '<p class="muted pad">No live channels in the current list.</p>' : ''}`
  body._guide = { channels, from, to }
  if (state.guideShift === 0) body.scrollLeft = Math.max(0, nowX - 200)
}

function onGuideClick(e) {
  const body = $('#guideBody')
  const { channels, from, to } = body._guide || {}
  const ch = e.target.closest('.g-ch[data-row]')
  if (ch) {
    playItem(channels[+ch.dataset.row])
    $('#guideDialog').close()
    return
  }
  const btn = e.target.closest('.prog')
  if (!btn) return
  const item = channels[+btn.dataset.row]
  const prog = state.epg.range(item, from, to)[+btn.dataset.p]
  const now = Date.now()
  const detail = $('#guideDetail')
  const live = prog.start <= now && prog.stop > now
  const past = prog.stop <= now
  const reminded = state.reminders.some(r => r.url === item.url && r.start === prog.start)
  detail.innerHTML = `<div><strong>${escapeHtml(prog.title)}</strong>
      <div class="muted small">${escapeHtml(item.name)} · ${new Date(prog.start).toLocaleDateString()} ${fmtClock(prog.start)} – ${fmtClock(prog.stop)}</div>
      ${prog.desc ? `<p class="desc">${escapeHtml(prog.desc)}</p>` : ''}</div>
    <div class="btn-row">
      ${live ? '<button class="primary" data-g="live">▶ Watch live</button>' : ''}
      ${btn.classList.contains('catchup') || (live && canCatchup(item)) ? '<button data-g="catchup">⟲ Watch from start</button>' : ''}
      ${!live && !past ? `<button data-g="remind">${reminded ? '🔔 Cancel reminder' : '🔕 Remind me'}</button>` : ''}
    </div>`
  detail.hidden = false
  detail.onclick = ev => {
    const action = ev.target.dataset.g
    if (!action) return
    if (action === 'live') playItem(item)
    if (action === 'catchup') playCatchup(item, prog)
    if (action === 'remind') {
      toggleReminder(item, prog.start)
      detail.hidden = true
      return
    }
    $('#guideDialog').close()
  }
}

/* ---------- Series ---------- */

async function openSeries(item) {
  if (isLocked(item) && !(await askPin())) return
  const dialog = $('#seriesDialog')
  const body = $('#seriesBody')
  $('#seriesTitle').textContent = item.name
  body.innerHTML = '<div class="spinner"></div>'
  dialog.showModal()
  const client = state.xtream
  if (!client || !item.url.startsWith(`xtream-series:${client.server}:`)) {
    body.innerHTML = '<p class="muted">Open the playlist this series belongs to first.</p>'
    return
  }
  try {
    const { info, seasons } = await client.seriesInfo(item.seriesId, item.name)
    const names = Object.keys(seasons).sort((a, b) => a - b)
    if (!names.length) {
      body.innerHTML = '<p class="muted">No episodes found.</p>'
      return
    }
    const render = season => {
      body.innerHTML = `<div class="series-head">
          ${info.cover || item.logo ? `<img src="${escapeHtml(info.cover || item.logo)}" alt="" />` : ''}
          <div><p class="desc">${escapeHtml(info.plot || item.plot || '')}</p>
          <p class="muted small">${[info.genre, info.releaseDate, info.rating && '★ ' + info.rating].filter(Boolean).map(escapeHtml).join(' · ')}</p></div>
        </div>
        <div class="seg">${names.map(s => `<button data-season="${escapeHtml(s)}" class="${s === season ? 'on' : ''}">Season ${escapeHtml(s)}</button>`).join('')}</div>
        <ul class="episodes">${seasons[season]
          .map((ep, i) => {
            const p = state.progress[ep.url]
            return `<li data-ep="${i}"><span class="ep-num">${escapeHtml(ep.episode || i + 1)}</span>
              <span class="meta"><span class="name">${escapeHtml(ep.title)}</span>
              <span class="muted small">${escapeHtml(ep.duration || '')}${p ? ` · watched ${Math.round((p.t / p.d) * 100)}%` : ''}</span></span><span>▶</span></li>`
          })
          .join('')}</ul>`
      body.onclick = e => {
        const s = e.target.closest('[data-season]')
        if (s) return render(s.dataset.season)
        const ep = e.target.closest('[data-ep]')
        if (ep) {
          dialog.close()
          playItem(seasons[season][+ep.dataset.ep])
        }
      }
    }
    render(names[0])
  } catch (err) {
    body.innerHTML = `<p class="error">${escapeHtml(err.message)}</p>`
  }
}

/* ---------- Settings ---------- */

function openSettings() {
  $$('[data-setting]').forEach(input => {
    const value = state.settings[input.dataset.setting]
    if (input.type === 'checkbox') input.checked = !!value
    else input.value = value
  })
  renderSourceManager()
  renderHiddenGroups()
  renderPinState()
  $('#settingsDialog').showModal()
}

function onSettingChange(e) {
  const input = e.target.closest('[data-setting]')
  if (!input) return
  const key = input.dataset.setting
  state.settings[key] = input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value) : input.value
  saveSettings()
  if (key === 'theme') applyTheme()
  if (key === 'proxy') setProxy(state.settings.proxy)
  if (key === 'epgOffset') {
    state.epg.offset = Number(state.settings.epgOffset || 0) * 36e5
    renderList(false, true)
    updateNowPanel()
  }
  if (key === 'hideDead' || key === 'lockKeywords') {
    renderGroups()
    renderList()
  }
}

function renderSourceManager() {
  const labels = { m3u: 'M3U URL', file: 'M3U file', xtream: 'Xtream Codes' }
  $('#sourceManager').innerHTML =
    state.sources
      .map(
        s => `<li><span><strong>${escapeHtml(s.name)}</strong> <small class="muted">${labels[s.type] || s.type}${s.epgUrl ? ' · EPG' : ''}</small></span>
        <span class="btn-row"><button type="button" data-edit="${s.id}">Edit</button><button type="button" data-delete="${s.id}" class="danger">Remove</button></span></li>`
      )
      .join('') || '<li class="muted">No playlists yet.</li>'
}

function renderHiddenGroups() {
  $('#hiddenGroups').innerHTML =
    state.hiddenGroups.map(g => `<li><span>${escapeHtml(g)}</span><button type="button" data-unhide="${escapeHtml(g)}" aria-label="Show">✕</button></li>`).join('') ||
    '<li class="muted">None – hover a group and press ⊘ to hide it.</li>'
}

function renderPinState() {
  $('#pinState').textContent = state.settings.pinHash
    ? `PIN is set. Groups containing these keywords are hidden until unlocked${state.unlocked ? ' (currently unlocked)' : ''}.`
    : 'No PIN set. Set one to lock groups matching the keywords below.'
}

async function savePin() {
  const pin = $('#newPin').value.trim()
  if (!/^\d{4,8}$/.test(pin)) return toast('PIN must be 4–8 digits', 'warn')
  if (state.settings.pinHash && !(await askPin())) return
  state.settings.pinHash = await sha256(pin)
  state.unlocked = false
  saveSettings()
  $('#newPin').value = ''
  renderPinState()
  renderGroups()
  renderList()
  toast('PIN saved – locked groups are now hidden')
}

async function removePin() {
  if (!state.settings.pinHash || !(await askPin())) return
  state.settings.pinHash = ''
  saveSettings()
  renderPinState()
  renderGroups()
  renderList()
  toast('PIN removed')
}

async function exportBackup() {
  const files = {}
  for (const s of state.sources.filter(x => x.type === 'file')) files[s.id] = await idbGet('m3utext:' + s.id)
  const backup = {
    app: 'iptv-plus',
    version: 1,
    exported: new Date().toISOString(),
    settings: state.settings,
    sources: state.sources,
    files,
    favorites: state.favorites,
    recent: state.recent,
    progress: state.progress,
    reminders: state.reminders,
    hiddenGroups: state.hiddenGroups
  }
  download(`iptv-plus-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(backup, null, 2), 'application/json')
}

async function importBackup(file) {
  try {
    const data = JSON.parse(await file.text())
    if (data.app !== 'iptv-plus') throw new Error('Not an IPTV Plus backup')
    for (const key of ['settings', 'sources', 'favorites', 'recent', 'progress', 'reminders', 'hiddenGroups']) {
      if (data[key]) store.set(key, data[key])
    }
    for (const [id, text] of Object.entries(data.files || {})) if (text) await idbSet('m3utext:' + id, text)
    store.set('activeSource', data.sources?.[0]?.id || null)
    toast('Backup restored – reloading…')
    setTimeout(() => location.reload(), 800)
  } catch (err) {
    toast('Import failed: ' + err.message, 'error')
  }
}

async function resetAll() {
  if (!confirm('Erase all playlists, favorites, history and settings from this browser?')) return
  store.clear()
  await idbClear()
  location.reload()
}

/* ---------- Events ---------- */

function bindEvents() {
  els.sourceSelect.addEventListener('change', () => {
    const value = els.sourceSelect.value
    if (value === '__add') {
      renderSourceSelect()
      return openSourceDialog()
    }
    loadSource(state.sources.find(s => s.id === value))
  })
  $('#refreshBtn').addEventListener('click', () => loadSource(activeSource(), { force: true }))
  els.search.addEventListener(
    'input',
    debounce(() => {
      state.query = els.search.value
      renderList()
    }, 200)
  )
  els.sort.value = state.sort
  els.sort.addEventListener('change', () => {
    state.sort = els.sort.value
    store.set('sort', state.sort)
    renderList()
  })
  $('#checkBtn').addEventListener('click', checkStreams)

  els.typeTabs.addEventListener('click', e => {
    const btn = e.target.closest('[data-type]')
    if (!btn) return
    state.type = btn.dataset.type
    if (![SPECIAL.fav, SPECIAL.recent, SPECIAL.cont].includes(state.group)) state.group = SPECIAL.all
    renderTabs()
    renderGroups()
    renderList()
  })
  els.groupList.addEventListener('click', e => {
    const li = e.target.closest('[data-group]')
    if (!li) return
    if (e.target.closest('[data-action="hide"]')) return hideGroup(li.dataset.group)
    selectGroup(li.dataset.group)
  })

  els.channelList.addEventListener('click', e => {
    const li = e.target.closest('.row')
    if (!li) return
    const item = state.filtered[+li.dataset.i]
    if (e.target.closest('[data-action="fav"]')) return toggleFav(item)
    playItem(item)
    if (window.matchMedia('(max-width: 760px)').matches) window.scrollTo({ top: 0, behavior: 'smooth' })
  })
  els.channelList.addEventListener('scroll', () => {
    const ul = els.channelList
    if (ul.scrollTop + ul.clientHeight > ul.scrollHeight - 600 && state.rendered < state.filtered.length) renderList(false)
  })
  els.empty.addEventListener('click', e => {
    const action = e.target.closest('[data-action]')?.dataset.action
    if (action === 'add-source') openSourceDialog()
    if (action === 'add-iptvorg') addIptvOrgDefault()
    if (action === 'retry-source') loadSource(activeSource(), { force: true })
  })

  // Replace broken logos with initials
  document.addEventListener(
    'error',
    e => {
      const img = e.target
      if (img.tagName === 'IMG' && img.dataset.fallback) {
        const span = document.createElement('span')
        span.className = 'logo-fallback'
        span.textContent = img.dataset.fallback
        img.replaceWith(span)
      }
    },
    true
  )

  // Player tiles
  els.slots.forEach((slot, i) => {
    slot.addEventListener('click', e => {
      const action = e.target.closest('[data-action]')?.dataset.action
      if (action === 'retry') return players[i].retry()
      if (action === 'resume') return players[i].video.play()
      if (state.multiview && i !== state.activeSlot) setActiveSlot(i)
    })
    slot.addEventListener('dblclick', toggleFullscreen)
  })

  $('#prevBtn').addEventListener('click', () => zap(-1))
  $('#nextBtn').addEventListener('click', () => zap(1))
  $('#lastBtn').addEventListener('click', () => state.lastItem && playItem(state.lastItem))
  els.playBtn.addEventListener('click', togglePlay)
  els.muteBtn.addEventListener('click', () => {
    state.settings.muted = !state.settings.muted
    applyVolume()
  })
  els.volume.addEventListener('input', () => {
    state.settings.volume = Number(els.volume.value)
    state.settings.muted = false
    applyVolume()
  })
  els.quality.addEventListener('change', () => activePlayer().setLevel(Number(els.quality.value)))
  els.audio.addEventListener('change', () => activePlayer().setAudio(Number(els.audio.value)))
  els.subs.addEventListener('change', () => activePlayer().setSubtitle(Number(els.subs.value)))
  els.sleep.addEventListener('change', () => setSleepTimer(Number(els.sleep.value)))
  els.seekBar.addEventListener('pointerdown', () => (els.seekBar.dragging = true))
  els.seekBar.addEventListener('change', () => {
    const video = activeVideo()
    video.currentTime = (Number(els.seekBar.value) / 1000) * video.duration
    els.seekBar.dragging = false
  })
  $('#snapBtn').addEventListener('click', takeSnapshot)
  els.recBtn.addEventListener('click', toggleRecording)
  $('#infoBtn').addEventListener('click', () => {
    state.showStats = !state.showStats
    updateStats()
  })
  $('#pipBtn').addEventListener('click', togglePip)
  $('#fsBtn').addEventListener('click', toggleFullscreen)

  els.nowPanel.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]')
    const item = activeItem()
    if (!btn || !item) return
    if (btn.dataset.action === 'fav-current') toggleFav(item)
    if (btn.dataset.action === 'remind') toggleReminder(item, Number(btn.dataset.start))
    if (btn.dataset.action === 'restart') {
      const { now } = state.epg.at(item)
      if (now) playCatchup(item, now)
    }
  })

  // Header buttons
  $('#menuBtn').addEventListener('click', () => document.body.classList.toggle('drawer-open'))
  $('#scrim').addEventListener('click', () => document.body.classList.remove('drawer-open'))
  $('#guideBtn').addEventListener('click', openGuide)
  $('#multiBtn').addEventListener('click', () => toggleMultiview())
  $('#settingsBtn').addEventListener('click', openSettings)
  $('#helpBtn').addEventListener('click', () => $('#helpDialog').showModal())

  // Source dialog
  $('#sourceTabs').addEventListener('click', e => {
    const btn = e.target.closest('[data-type]')
    if (btn) setSourceTab(btn.dataset.type)
  })
  $('#sourceForm').elements.orgKind.addEventListener('change', loadOrgOptions)
  $('#sourceSave').addEventListener('click', e => {
    e.preventDefault()
    submitSource()
  })

  // Settings dialog
  $('#settingsDialog').addEventListener('change', onSettingChange)
  $('#addSourceBtn').addEventListener('click', () => openSourceDialog())
  $('#sourceManager').addEventListener('click', e => {
    const edit = e.target.dataset.edit
    const del = e.target.dataset.delete
    if (edit) openSourceDialog(state.sources.find(s => s.id === edit))
    if (del) deleteSource(del)
  })
  $('#hiddenGroups').addEventListener('click', e => {
    const group = e.target.closest('[data-unhide]')?.dataset.unhide
    if (group) unhideGroup(group)
  })
  $('#savePinBtn').addEventListener('click', savePin)
  $('#removePinBtn').addEventListener('click', removePin)
  $('#lockBtn').addEventListener('click', () => {
    state.unlocked = false
    renderPinState()
    renderGroups()
    renderList()
    toast('Locked')
  })
  $('#exportBtn').addEventListener('click', exportBackup)
  $('#importInput').addEventListener('change', e => e.target.files[0] && importBackup(e.target.files[0]))
  $('#exportFavBtn').addEventListener('click', () => download('favorites.m3u', toM3U(state.favorites), 'audio/x-mpegurl'))
  $('#exportViewBtn').addEventListener('click', () =>
    download(`${listTitle().replace(/[^\w-]+/g, '_')}.m3u`, toM3U(state.filtered), 'audio/x-mpegurl')
  )
  $('#clearHistoryBtn').addEventListener('click', () => {
    state.recent = []
    state.progress = {}
    store.set('recent', [])
    store.set('progress', {})
    renderGroups()
    renderList()
    toast('History cleared')
  })
  $('#resetBtn').addEventListener('click', resetAll)

  // Guide
  $('#guideBody').addEventListener('click', onGuideClick)
  $('#guideClose').addEventListener('click', () => $('#guideDialog').close())
  $$('[data-shift]').forEach(btn =>
    btn.addEventListener('click', () => {
      const shift = Number(btn.dataset.shift)
      state.guideShift = shift === 0 ? 0 : state.guideShift + shift
      renderGuide()
    })
  )
  $$('[data-close]').forEach(btn => btn.addEventListener('click', () => btn.closest('dialog').close()))

  document.addEventListener('keydown', onKey)
  document.addEventListener('visibilitychange', saveProgress)
  window.addEventListener('beforeunload', saveProgress)
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme)

  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('previoustrack', () => zap(-1))
    navigator.mediaSession.setActionHandler('nexttrack', () => zap(1))
  }
}

function openGuide() {
  state.guideShift = 0
  $('#guideDialog').showModal()
  renderGuide()
}

function onKey(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return
  const target = e.target
  if (target.matches('input, select, textarea') || document.querySelector('dialog[open]')) {
    if (e.key === 'Escape' && target === els.search) els.search.blur()
    return
  }
  const video = activeVideo()
  const key = e.key
  if (key === ' ' || key === 'k') togglePlay()
  else if (key === 'ArrowUp') zap(-1)
  else if (key === 'ArrowDown') zap(1)
  else if (key === 'ArrowLeft' && isFinite(video.duration)) video.currentTime -= 10
  else if (key === 'ArrowRight' && isFinite(video.duration)) video.currentTime += 10
  else if (key === '+' || key === '=') changeVolume(0.05)
  else if (key === '-') changeVolume(-0.05)
  else if (/^[0-9]$/.test(key)) zapToNumber(key)
  else if (key === 'f') toggleFullscreen()
  else if (key === 'm') els.muteBtn.click()
  else if (key === 's') toggleFav(activeItem())
  else if (key === 'g') openGuide()
  else if (key === 'v') toggleMultiview()
  else if (key === 'i') $('#infoBtn').click()
  else if (key === 'p') togglePip()
  else if (key === 'l') state.lastItem && playItem(state.lastItem)
  else if (key === '/') els.search.focus()
  else if (key === '?') $('#helpDialog').showModal()
  else return
  e.preventDefault()
}

/* ---------- Start ---------- */

function init() {
  applyTheme()
  setProxy(state.settings.proxy)
  state.epg.offset = Number(state.settings.epgOffset || 0) * 36e5
  bindEvents()
  applyVolume()
  renderSourceSelect()
  updateNowPanel()

  const source = activeSource() || state.sources[0]
  if (source) {
    loadSource(source).then(() => {
      const last = store.get('last', null)
      if (last && state.settings.autoplayLast && !isLocked(last)) playItem(last)
    })
  } else {
    renderAll()
  }

  setInterval(saveProgress, 5000)
  setInterval(updateStats, 1000)
  setInterval(checkReminders, 20000)
  setInterval(() => {
    if (state.epg.loaded) {
      renderList(false, true)
      updateNowPanel()
    }
  }, 60000)

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {})
  }
}

init()
