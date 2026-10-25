import { proxied } from './utils.js'

const LIBS = {
  hls: 'https://cdn.jsdelivr.net/npm/hls.js@1.5.20/dist/hls.min.js',
  mpegts: 'https://cdn.jsdelivr.net/npm/mpegts.js@1.8.0/dist/mpegts.js',
  shaka: 'https://cdn.jsdelivr.net/npm/shaka-player@4.12.6/dist/shaka-player.compiled.js'
}

const scripts = {}

function loadScript(src) {
  if (!scripts[src]) {
    scripts[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = src
      s.async = true
      s.onload = resolve
      s.onerror = () => {
        delete scripts[src]
        reject(new Error('Could not load player library ' + src))
      }
      document.head.appendChild(s)
    })
  }
  return scripts[src]
}

export function detectKind(url) {
  const path = url.split(/[?#|]/)[0].toLowerCase()
  if (path.endsWith('.m3u8') || path.endsWith('.m3u')) return 'hls'
  if (path.endsWith('.mpd')) return 'dash'
  if (path.endsWith('.ts') || path.endsWith('.flv')) return 'mpegts'
  if (/\.(mp4|m4v|webm|mkv|mov|mp3|aac|ogg|opus)$/.test(path)) return 'native'
  return 'auto'
}

// Engines to try in order for each kind of stream
const ENGINE_ORDER = {
  auto: ['hls', 'mpegts', 'native'],
  hls: ['hls', 'native'],
  mpegts: ['mpegts', 'native'],
  dash: ['dash', 'native'],
  native: ['native', 'hls']
}

const MEDIA_ERRORS = {
  1: 'Playback aborted',
  2: 'Network error',
  3: 'Decoding error (unsupported codec?)',
  4: 'Stream format not supported or unreachable (CORS / offline)'
}

export class Player extends EventTarget {
  constructor(video, options = {}) {
    super()
    this.video = video
    this.options = options
    this.engine = null
    this.token = 0
    this.retries = 0
    this.source = null

    video.addEventListener('playing', () => {
      this.everPlayed = true
      this.retries = 0
      this.emit('state', 'playing')
    })
    video.addEventListener('waiting', () => this.source && this.emit('state', 'buffering'))
    video.addEventListener('pause', () => this.source && this.emit('state', 'paused'))
    video.addEventListener('error', () => {
      if (this.engine === 'native' && this.source) {
        this.handleFatal(new Error(MEDIA_ERRORS[video.error?.code] || 'Playback error'))
      }
    })
    video.addEventListener('loadedmetadata', () => this.emitTracks())
  }

  get settings() {
    return this.options.getSettings ? this.options.getSettings() : {}
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }))
  }

  emitTracks() {
    this.emit('tracks', this.tracks())
  }

  async play(source) {
    this.stop()
    this.source = source
    this.retries = 0
    this.everPlayed = false
    this.lastError = null
    this.queue = ENGINE_ORDER[detectKind(source.url)].slice()
    this.emit('state', 'loading')
    return this.next()
  }

  retry() {
    if (this.source) return this.play(this.source)
  }

  async next() {
    const kind = this.queue.shift()
    if (!kind) {
      this.emit('error', this.lastError || new Error('Stream could not be played'))
      return
    }
    this.teardown()
    this.kind = kind
    const token = ++this.token
    const raw = this.source.url
    const url = this.settings.proxyStreams ? proxied(raw) : raw
    try {
      if (kind === 'hls') await this.startHls(raw, token)
      else if (kind === 'mpegts') await this.startMpegts(url, token)
      else if (kind === 'dash') await this.startDash(url, token)
      else this.startNative(url)
    } catch (err) {
      if (token === this.token) {
        this.lastError = err
        this.next()
      }
    }
  }

  handleFatal(err) {
    this.lastError = err
    const max = Number(this.settings.retries ?? 3)
    if (this.everPlayed && this.retries < max) {
      // The stream was working and dropped: reconnect with backoff
      this.retries++
      this.emit('state', `reconnecting ${this.retries}/${max}`)
      this.queue.unshift(this.kind)
      this.teardown()
      clearTimeout(this.retryTimer)
      this.retryTimer = setTimeout(() => this.next(), 1000 * 2 ** this.retries)
      return
    }
    if (!this.everPlayed) return this.next()
    this.teardown()
    this.emit('error', err)
  }

  autoplay() {
    this.video.play().catch(err => {
      if (err.name === 'NotAllowedError') this.emit('state', 'click-to-play')
    })
  }

  async startHls(url, token) {
    const video = this.video
    if (!window.Hls) await loadScript(LIBS.hls).catch(() => {})
    const Hls = window.Hls
    if (!Hls || !Hls.isSupported()) {
      if (video.canPlayType('application/vnd.apple.mpegurl')) return this.startNative(url)
      throw new Error('HLS is not supported in this browser')
    }
    const config = { enableWorker: true, lowLatencyMode: true, backBufferLength: 60 }
    if (this.settings.proxyStreams) {
      config.xhrSetup = (xhr, requestUrl) => xhr.open('GET', proxied(requestUrl), true)
    }
    const hls = new Hls(config)
    this.hls = hls
    this.engine = 'hls.js'
    this.mediaRecovered = false
    const refresh = () => this.emitTracks()
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      refresh()
      this.autoplay()
    })
    hls.on(Hls.Events.LEVEL_SWITCHED, refresh)
    hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, refresh)
    hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, refresh)
    hls.on(Hls.Events.ERROR, (event, data) => {
      if (!data.fatal || token !== this.token) return
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !this.mediaRecovered) {
        this.mediaRecovered = true
        hls.recoverMediaError()
        return
      }
      const status = data.response?.code ? ` (HTTP ${data.response.code})` : ''
      this.handleFatal(new Error(`HLS ${data.details}${status}`))
    })
    hls.loadSource(url)
    hls.attachMedia(video)
  }

  async startMpegts(url, token) {
    if (!window.mpegts) await loadScript(LIBS.mpegts)
    const mpegts = window.mpegts
    if (!mpegts.getFeatureList().mseLivePlayback) throw new Error('MPEG-TS playback is not supported')
    const isLive = this.source.type === 'live'
    const player = mpegts.createPlayer(
      { type: /\.flv/i.test(url) ? 'flv' : 'mpegts', isLive, url },
      { enableWorker: true, liveBufferLatencyChasing: isLive, lazyLoad: !isLive }
    )
    this.mpegts = player
    this.engine = 'mpegts.js'
    player.on(mpegts.Events.ERROR, (type, detail) => {
      if (token === this.token) this.handleFatal(new Error(`MPEG-TS ${type}: ${detail}`))
    })
    player.on(mpegts.Events.MEDIA_INFO, () => this.emitTracks())
    player.attachMediaElement(this.video)
    player.load()
    this.autoplay()
  }

  async startDash(url, token) {
    if (!window.shaka) await loadScript(LIBS.shaka)
    const shaka = window.shaka
    shaka.polyfill.installAll()
    if (!shaka.Player.isBrowserSupported()) throw new Error('DASH is not supported in this browser')
    const player = new shaka.Player()
    this.shaka = player
    this.engine = 'shaka'
    await player.attach(this.video)
    player.addEventListener('error', ev => {
      if (token === this.token) this.handleFatal(new Error(`DASH error ${ev.detail?.code || ''}`))
    })
    await player.load(url)
    if (token !== this.token) return
    this.emitTracks()
    this.autoplay()
  }

  startNative(url) {
    this.engine = 'native'
    this.video.src = url
    this.autoplay()
  }

  teardown() {
    const engine = this.engine
    this.engine = null
    if (this.hls) {
      this.hls.destroy()
      this.hls = null
    }
    if (this.mpegts) {
      try {
        this.mpegts.pause()
        this.mpegts.unload()
        this.mpegts.detachMediaElement()
        this.mpegts.destroy()
      } catch {
        // ignore
      }
      this.mpegts = null
    }
    if (this.shaka) {
      this.shaka.destroy()
      this.shaka = null
    }
    if (engine || this.video.getAttribute('src')) {
      this.video.removeAttribute('src')
      this.video.load()
    }
  }

  stop() {
    clearTimeout(this.retryTimer)
    this.stopRecording()
    this.token++
    this.teardown()
    this.source = null
    this.emit('state', 'idle')
    this.emitTracks()
  }

  tracks() {
    const out = { levels: [], level: -1, audio: [], audioIndex: -1, subs: [], subIndex: -1 }
    const video = this.video
    if (this.hls) {
      const seen = {}
      this.hls.levels.forEach(l => {
        const key = l.height || 0
        seen[key] = (seen[key] || 0) + 1
      })
      out.levels = this.hls.levels.map((l, i) => {
        const kbps = Math.round(l.bitrate / 1000)
        const label = l.height ? `${l.height}p${seen[l.height] > 1 ? ` · ${kbps} kbps` : ''}` : `${kbps} kbps`
        return { index: i, label }
      })
      out.level = this.hls.autoLevelEnabled ? -1 : this.hls.currentLevel
      out.audio = this.hls.audioTracks.map((t, i) => ({ index: i, label: t.name || t.lang || `Track ${i + 1}` }))
      out.audioIndex = this.hls.audioTrack
      out.subs = this.hls.subtitleTracks.map((t, i) => ({ index: i, label: t.name || t.lang || `Subtitle ${i + 1}` }))
      out.subIndex = this.hls.subtitleDisplay ? this.hls.subtitleTrack : -1
      return out
    }
    if (this.shaka) {
      const variants = this.shaka.getVariantTracks()
      const heights = [...new Set(variants.map(t => t.height).filter(Boolean))].sort((a, b) => b - a)
      out.levels = heights.map(h => ({ index: h, label: `${h}p` }))
      out.level = this.shaka.getConfiguration().abr.enabled ? -1 : variants.find(t => t.active)?.height ?? -1
      const langs = this.shaka.getAudioLanguages()
      out.audio = langs.map((l, i) => ({ index: i, label: l }))
      out.audioIndex = langs.indexOf(variants.find(t => t.active)?.language)
      const texts = this.shaka.getTextTracks()
      out.subs = texts.map((t, i) => ({ index: i, label: t.label || t.language || `Subtitle ${i + 1}` }))
      out.subIndex = this.shaka.isTextTrackVisible() ? texts.findIndex(t => t.active) : -1
      return out
    }
    const textTracks = [...(video.textTracks || [])]
    out.subs = textTracks.map((t, i) => ({ index: i, label: t.label || t.language || `Subtitle ${i + 1}` }))
    out.subIndex = textTracks.findIndex(t => t.mode === 'showing')
    const audioTracks = [...(video.audioTracks || [])]
    out.audio = audioTracks.map((t, i) => ({ index: i, label: t.label || t.language || `Track ${i + 1}` }))
    out.audioIndex = audioTracks.findIndex(t => t.enabled)
    return out
  }

  setLevel(index) {
    if (this.hls) this.hls.currentLevel = index
    if (this.shaka) {
      this.shaka.configure({ abr: { enabled: index === -1 } })
      if (index !== -1) {
        const track = this.shaka.getVariantTracks().find(t => t.height === index)
        if (track) this.shaka.selectVariantTrack(track, true)
      }
    }
    this.emitTracks()
  }

  setAudio(index) {
    if (this.hls) this.hls.audioTrack = index
    else if (this.shaka) this.shaka.selectAudioLanguage(this.shaka.getAudioLanguages()[index])
    else [...(this.video.audioTracks || [])].forEach((t, i) => (t.enabled = i === index))
    this.emitTracks()
  }

  setSubtitle(index) {
    if (this.hls) {
      this.hls.subtitleTrack = index
      this.hls.subtitleDisplay = index >= 0
    } else if (this.shaka) {
      const track = this.shaka.getTextTracks()[index]
      if (track) this.shaka.selectTextTrack(track)
      this.shaka.setTextTrackVisibility(index >= 0)
    } else {
      [...(this.video.textTracks || [])].forEach((t, i) => (t.mode = i === index ? 'showing' : 'disabled'))
    }
    this.emitTracks()
  }

  stats() {
    const v = this.video
    let bitrate = 0
    if (this.hls && this.hls.currentLevel >= 0) bitrate = this.hls.levels[this.hls.currentLevel]?.bitrate || 0
    if (this.shaka) bitrate = this.shaka.getStats().streamBandwidth || 0
    let buffer = 0
    for (let i = 0; i < v.buffered.length; i++) {
      if (v.buffered.start(i) <= v.currentTime && v.buffered.end(i) >= v.currentTime) {
        buffer = v.buffered.end(i) - v.currentTime
      }
    }
    const quality = v.getVideoPlaybackQuality?.()
    return {
      engine: this.engine || '—',
      resolution: v.videoWidth ? `${v.videoWidth}×${v.videoHeight}` : '—',
      bitrate: bitrate ? `${(bitrate / 1e6).toFixed(2)} Mbps` : '—',
      buffer: `${buffer.toFixed(1)} s`,
      dropped: quality ? `${quality.droppedVideoFrames} / ${quality.totalVideoFrames}` : '—',
      retries: this.retries
    }
  }

  snapshot() {
    const v = this.video
    if (!v.videoWidth) throw new Error('No video frame available yet')
    const canvas = document.createElement('canvas')
    canvas.width = v.videoWidth
    canvas.height = v.videoHeight
    canvas.getContext('2d').drawImage(v, 0, 0)
    return new Promise((resolve, reject) => {
      try {
        canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('Snapshot failed'))), 'image/png')
      } catch {
        reject(new Error('The stream server does not allow snapshots (CORS)'))
      }
    })
  }

  get recording() {
    return !!this.recorder
  }

  startRecording(onDone) {
    const v = this.video
    const capture = v.captureStream || v.mozCaptureStream
    if (!capture || !window.MediaRecorder) throw new Error('Recording is not supported in this browser')
    const stream = capture.call(v)
    const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']
      .find(t => MediaRecorder.isTypeSupported(t))
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
    const chunks = []
    recorder.ondataavailable = e => e.data.size && chunks.push(e.data)
    recorder.onstop = () => onDone(new Blob(chunks, { type: recorder.mimeType || 'video/webm' }))
    recorder.start(1000)
    this.recorder = recorder
  }

  stopRecording() {
    if (!this.recorder) return
    const recorder = this.recorder
    this.recorder = null
    if (recorder.state !== 'inactive') recorder.stop()
  }
}
