/* Service worker de Notas de obra */
const CACHE = 'notas-v1.3.0';
const ARCHIVOS = [
  './', 'index.html', 'app.css', 'app.js', 'manifest.json',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/badge.png',
  'fonts/barlow-400.woff2', 'fonts/barlow-500.woff2', 'fonts/barlow-600.woff2', 'fonts/barlow-700.woff2',
  'fonts/barlow-condensed-600.woff2', 'fonts/barlow-condensed-700.woff2',
];

self.addEventListener('install', ev => {
  ev.waitUntil(caches.open(CACHE).then(c => c.addAll(ARCHIVOS)));
});
self.addEventListener('activate', ev => {
  ev.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('message', ev => { if (ev.data === 'activar') self.skipWaiting(); });

// La app se sirve desde la caché; las llamadas al worker (otro dominio) no se tocan.
self.addEventListener('fetch', ev => {
  const url = new URL(ev.request.url);
  if (ev.request.method !== 'GET' || url.origin !== self.location.origin) return;
  ev.respondWith(
    caches.match(ev.request, { ignoreSearch: true }).then(r => r || fetch(ev.request).catch(() => caches.match('index.html')))
  );
});

// ---------- Avisos ----------
function leerConfig() {
  return new Promise(res => {
    const r = indexedDB.open('notas-app', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onerror = () => res(null);
    r.onsuccess = () => {
      try {
        const g = r.result.transaction('kv').objectStore('kv').get('config');
        g.onsuccess = () => res(g.result || null);
        g.onerror = () => res(null);
      } catch { res(null); }
    };
  });
}

self.addEventListener('push', ev => {
  let d = {};
  try { d = ev.data ? ev.data.json() : {}; } catch { d = { titulo: 'Notas', cuerpo: ev.data ? ev.data.text() : '' }; }
  if (d.tipo === 'cerrar') {
    ev.waitUntil(self.registration.getNotifications({ tag: d.tag }).then(ns => ns.forEach(n => n.close())));
    return;
  }
  const alarma = d.tipo === 'alarma';
  ev.waitUntil(self.registration.showNotification(d.titulo || 'Notas', {
    body: d.cuerpo || '',
    tag: d.tag || undefined,
    renotify: true,
    requireInteraction: alarma,
    icon: 'icons/icon-192.png',
    badge: 'icons/badge.png',
    vibrate: alarma ? [200, 100, 200] : undefined,
    data: { nota_id: d.nota_id || null, url: d.url || (d.nota_id ? '#/nota/' + d.nota_id : '#/') },
    actions: alarma ? [{ action: 'hecha', title: 'Hecha' }, { action: 'posponer', title: 'Posponer 10 min' }] : [],
  }));
});

async function abrirApp(url) {
  const cs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const c = cs.find(x => x.url.startsWith(self.registration.scope));
  if (c) { await c.focus(); c.postMessage({ tipo: 'abrir', url }); return; }
  await self.clients.openWindow(self.registration.scope + url);
}

self.addEventListener('notificationclick', ev => {
  const n = ev.notification;
  const { nota_id, url } = n.data || {};
  n.close();
  if (!nota_id || !ev.action) { ev.waitUntil(abrirApp(url || '#/')); return; }
  ev.waitUntil((async () => {
    const cfg = await leerConfig();
    try {
      if (!cfg || !cfg.url || !cfg.token) throw new Error('sin config');
      const r = await fetch(cfg.url.replace(/\/+$/, '') + '/notas/' + nota_id + '/alarma', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + cfg.token, 'Content-Type': 'application/json', 'X-Dispositivo': cfg.dispositivo || 'Aviso' },
        body: JSON.stringify({ accion: ev.action, minutos: 10, endpoint: cfg.pushEndpoint || '' }),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const cs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      cs.forEach(c => c.postMessage({ tipo: 'sync' }));
    } catch {
      await abrirApp('#/nota/' + nota_id);
    }
  })());
});
