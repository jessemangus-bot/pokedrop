/* PokeDrop service worker — background push + notification tap-through */

self.addEventListener("install", (e) => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

/* A push arrives from the server whenever a watched item flips to
   in stock / preorder. Show it even if no PokeDrop tab is open. */
self.addEventListener("push", (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (_) {}
  const title = data.title || "PokeDrop alert";
  e.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      tag: data.tag || "pokedrop",
      data: { url: data.url || "/" },
      renotify: true
    })
  );
});

/* Tapping the notification goes STRAIGHT to the product page —
   that's the whole speed advantage. */
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) { if (c.navigate) c.navigate(url); return c.focus(); }
      }
      return clients.openWindow(url);
    })
  );
});
