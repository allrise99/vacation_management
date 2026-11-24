// 홈 화면 앱용 서비스 워커: 앱 화면 파일만 캐시해서 오프라인에서도 열리게 한다.
// 연차 기록이나 동기화 요청(Supabase)은 캐시하지 않는다.
const CACHE = 'vacation-app-v1';
const MAX_ASSETS = 40;
const scope = new URL(self.registration.scope);
const INDEX = new URL('./', scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.add(INDEX)).catch(() => undefined).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== scope.origin || !url.href.startsWith(scope.href)) return;

  // 화면(HTML): 항상 최신을 먼저 받고, 오프라인이면 저장해 둔 화면
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(INDEX, copy));
          }
          return res;
        })
        .catch(() => caches.match(INDEX).then((r) => r || Response.error())),
    );
    return;
  }

  // 빌드 파일(/assets/, 이름에 해시 포함): 한 번 받으면 바뀌지 않으므로 캐시 우선
  if (url.pathname.includes('/assets/')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then(async (c) => {
                await c.put(req, copy);
                const keys = (await c.keys()).filter((k) => k.url.includes('/assets/'));
                for (const old of keys.slice(0, Math.max(0, keys.length - MAX_ASSETS))) await c.delete(old);
              });
            }
            return res;
          }),
      ),
    );
    return;
  }

  // 아이콘·매니페스트: 캐시를 먼저 보여 주고 뒤에서 갱신
  event.respondWith(
    caches.match(req).then((hit) => {
      const network = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => hit || Response.error());
      return hit || network;
    }),
  );
});
