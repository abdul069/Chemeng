// Minimale service worker: de app-schil werkt ook als het wifi even wegvalt.
const CACHE = "gezinsbord-v1";
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/", "/index.html", "/icon.svg", "/manifest.webmanifest"])));
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.pathname.startsWith("/api") || url.pathname.startsWith("/ws")) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match("/index.html"))),
  );
});

// Pushmeldingen (afspraak over 15 minuten, ochtendoverzicht, nieuwe memo)
self.addEventListener("push", (e) => {
  let d = { title: "Kinday", body: "" };
  try { d = e.data.json(); } catch { d.body = e.data ? e.data.text() : ""; }
  e.waitUntil(self.registration.showNotification(d.title || "Kinday", {
    body: d.body || "", icon: "/icon.svg", badge: "/icon.svg", tag: d.tag || undefined, data: { url: d.url || "/" }, renotify: !!d.tag,
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => {
    const c = cs.find((x) => "focus" in x);
    if (c) { c.navigate(url); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
