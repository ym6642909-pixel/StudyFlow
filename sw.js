/* StudyFlow service worker — studyflow-v6
   Network-first for pages, cache-first for hashed build assets.
   Clears every older studyflow cache so returning visitors get the new app. */
const CACHE = 'studyflow-v13'

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  // Hashed build assets are immutable: serve from cache, fall back to network.
  if (url.pathname.includes('/assets/')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put(req, copy))
            return res
          })
      )
    )
    return
  }

  // Everything else (navigations, manifest, sw.js): network first, cache as fallback.
  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone()
        caches.open(CACHE).then((c) => c.put(req, copy))
        return res
      })
      .catch(() => caches.match(req))
  )
})

/* Web Push: the server sends an empty ping when an alarm is due; the alarm
   text lives in the same IndexedDB the app writes, so no payload needed. */
function sfAlarmDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('sf-alarms', 1)
    req.onupgradeneeded = () => { req.result.createObjectStore('alarms', { keyPath: 'id' }) }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}
async function sfAlarmReadAll() {
  const db = await sfAlarmDb()
  return new Promise((resolve, reject) => {
    const q = db.transaction('alarms', 'readonly').objectStore('alarms').getAll()
    q.onsuccess = () => resolve(q.result || [])
    q.onerror = () => reject(q.error)
  })
}
async function sfAlarmWriteAll(list) {
  const db = await sfAlarmDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('alarms', 'readwrite')
    const store = tx.objectStore('alarms')
    store.clear()
    list.forEach((a) => store.put(a))
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let due = []
    try {
      const all = await sfAlarmReadAll()
      const now = Date.now()
      due = all.filter((a) => !a.fired && a.time <= now && now - a.time <= 3600000)
      if (due.length) {
        due.forEach((a) => { a.fired = true })
        await sfAlarmWriteAll(all)
      }
    } catch (e) { /* still must show something */ }
    const title = due.length ? '⏰ حان الآن: ' + due[0].title : '⏰ تذكير بموعد مذاكرة'
    const body = due.length > 1
      ? 'و ' + (due.length - 1) + ' مهمة أخرى في جدولك — StudyFlow'
      : 'لديك مهمة مجدولة في StudyFlow'
    await self.registration.showNotification(title, {
      body,
      dir: 'rtl',
      lang: 'ar',
      tag: due.length ? 'sf-alarm-' + due[0].id : 'sf-alarm',
    })
  })())
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ('focus' in c) return c.focus() }
      return clients.openWindow('/StudyFlow/')
    })
  )
})
