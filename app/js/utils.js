export const $ = (selector, root = document) => root.querySelector(selector)
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)]

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }

export function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, c => HTML_ESCAPES[c])
}

let proxyPrefix = ''

export function setProxy(prefix) {
  proxyPrefix = (prefix || '').trim()
}

// Supports both "https://proxy/?url={url}" (encoded) and "https://proxy/" (raw prefix) styles
export function proxied(url) {
  if (!proxyPrefix) return url
  if (proxyPrefix.includes('{url}')) return proxyPrefix.replace('{url}', encodeURIComponent(url))
  return proxyPrefix + url
}

export async function fetchWithTimeout(url, options = {}, timeout = 30000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`Request timed out: ${url}`)
    throw new Error(`Network/CORS error while loading ${url}`)
  } finally {
    clearTimeout(timer)
  }
}

async function fetchOk(url, timeout) {
  const res = await fetchWithTimeout(proxied(url), {}, timeout)
  if (!res.ok) throw new Error(`HTTP ${res.status} while loading ${url}`)
  return res
}

export async function fetchText(url, timeout) {
  return (await fetchOk(url, timeout)).text()
}

export async function fetchJSON(url, timeout) {
  return (await fetchOk(url, timeout)).json()
}

export async function fetchBuffer(url, timeout) {
  return (await fetchOk(url, timeout)).arrayBuffer()
}

export function toast(message, type = 'info', ms = 3500, action = null) {
  const host = document.getElementById('toasts')
  const el = document.createElement('div')
  el.className = `toast ${type}`
  el.textContent = message
  if (action) {
    const btn = document.createElement('button')
    btn.textContent = action.label
    btn.addEventListener('click', () => {
      action.onClick()
      el.remove()
    })
    el.appendChild(btn)
  }
  host.appendChild(el)
  setTimeout(() => el.remove(), ms)
  return el
}

export function debounce(fn, ms) {
  let timer
  return (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
}

export function download(filename, content, mime = 'text/plain') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
}

export async function sha256(text) {
  const data = new TextEncoder().encode(text)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('')
}

export function fmtClock(time) {
  return new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function fmtDuration(seconds) {
  if (!isFinite(seconds) || seconds < 0) return '--:--'
  const s = Math.floor(seconds % 60)
  const m = Math.floor(seconds / 60) % 60
  const h = Math.floor(seconds / 3600)
  const mm = String(m).padStart(h ? 2 : 1, '0')
  return `${h ? h + ':' : ''}${mm}:${String(s).padStart(2, '0')}`
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

export function initials(name = '') {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/)
  return ((words[0]?.[0] || '?') + (words[1]?.[0] || '')).toUpperCase()
}
