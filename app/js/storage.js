const PREFIX = 'iptvplus:'

// Small JSON values (settings, favorites, history) live in localStorage
export const store = {
  get(key, fallback) {
    try {
      const value = localStorage.getItem(PREFIX + key)
      return value === null ? fallback : JSON.parse(value)
    } catch {
      return fallback
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value))
    } catch (err) {
      console.warn('Could not save', key, err)
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(PREFIX + key)
    } catch {
      // ignore
    }
  },
  clear() {
    try {
      Object.keys(localStorage)
        .filter(k => k.startsWith(PREFIX))
        .forEach(k => localStorage.removeItem(k))
    } catch {
      // ignore
    }
  }
}

// Large values (parsed playlists, EPG data, uploaded files) live in IndexedDB
let dbPromise

function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open('iptvplus', 1)
      req.onupgradeneeded = () => req.result.createObjectStore('kv')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }
  return dbPromise
}

async function tx(mode, fn) {
  try {
    const database = await db()
    return await new Promise((resolve, reject) => {
      const t = database.transaction('kv', mode)
      const req = fn(t.objectStore('kv'))
      t.oncomplete = () => resolve(req?.result)
      t.onerror = () => reject(t.error)
      t.onabort = () => reject(t.error)
    })
  } catch (err) {
    console.warn('IndexedDB unavailable', err)
    return undefined
  }
}

export const idbGet = key => tx('readonly', s => s.get(key))
export const idbSet = (key, value) => tx('readwrite', s => s.put(value, key))
export const idbDelete = key => tx('readwrite', s => s.delete(key))
export const idbClear = () => tx('readwrite', s => s.clear())
