// origin B — исходящее по всем транспортам. Каждый вызов обязан быть виден
// обоими источниками и получить trust: 'confirmed'.
(function () {
  const B = (window.__bench = window.__bench || {});
  const ORIGIN_B = 'http://localhost:8081';

  // Форма полей повторяет GA4. Адрес — localhost: стенд не шлёт наружу ничего.
  function ga4Params(eventName, extra) {
    const p = new URLSearchParams({
      v: '2',
      tid: 'G-BENCH12345',
      gtm: '45je4bench',
      _p: String(Date.now()),
      cid: '1847362910.1730000000',
      ul: navigator.language.toLowerCase(),
      sr: screen.width + 'x' + screen.height,
      uid: 'user-42',
      sid: '1730000000',
      sct: '3',
      seg: '1',
      dl: location.href,
      dr: document.referrer || 'https://example.org/',
      dt: document.title,
      en: eventName,
      _et: '4213',
      'ep.section': 'bench',
      'ep.scenario': eventName,
      'up.plan': 'pro',
      // Поле, которого нет в декларации разборщика.
      // Обязано появиться в журнале как НЕОПОЗНАННОЕ, а не быть выкинутым.
      _bench_unknown_field: 'проверка-правила-неизвестного-поля',
    });
    if (extra) for (const k in extra) p.set(k, extra[k]);
    return p;
  }

  B.beaconSimple = function beaconSimple() {
    const url = ORIGIN_B + '/g/collect?' + ga4Params('page_view').toString();
    const ok = navigator.sendBeacon(url);
    return { transport: 'sendBeacon GET-подобный', ok, urlLength: url.length };
  };

  B.beaconBatched = function beaconBatched() {
    // GA4 шлёт пачку событий одним POST, разделяя их переводом строки.
    // Прибор обязан показать 3 события, а не одно.
    const body = [
      ga4Params('scroll', { 'ep.depth': '25' }).toString(),
      ga4Params('click', { 'ep.target': 'кнопка' }).toString(),
      ga4Params('user_engagement').toString(),
    ].join('\r\n');
    const ok = navigator.sendBeacon(ORIGIN_B + '/g/collect?v=2&tid=G-BENCH12345', new Blob([body], { type: 'text/plain' }));
    return { transport: 'sendBeacon POST пачкой', ok, events: 3, bodyLength: body.length };
  };

  B.fetchPost = function fetchPost() {
    return fetch(ORIGIN_B + '/collect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'bench', ts: Date.now(), payload: ga4Params('fetch_post').toString() }),
      keepalive: true,
    }).then((r) => ({ transport: 'fetch POST', status: r.status }));
  };

  B.fetchGetLegit = function fetchGetLegit() {
    // Законные данные приложения. Прибор обязан показать это как исходящее,
    // но НЕ пометить как маячок и НЕ приписать разборщику.
    return fetch('http://localhost:8080/api/articles')
      .then((r) => r.json())
      .then((d) => ({ transport: 'fetch GET (обычные данные)', items: d.items.length }));
  };

  B.xhrPost = function xhrPost() {
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', ORIGIN_B + '/collect');
      xhr.setRequestHeader('content-type', 'application/x-www-form-urlencoded');
      xhr.onloadend = () => resolve({ transport: 'XHR POST', status: xhr.status });
      xhr.send(ga4Params('xhr_event').toString());
    });
  };

  B.imagePixel = function imagePixel() {
    // Meta Pixel по форме: id, ev, и хеши в ud[...]
    const p = new URLSearchParams({
      id: '1234567890123456',
      ev: 'PageView',
      dl: location.href,
      rl: document.referrer || '',
      ts: String(Date.now()),
      'cd[content_name]': 'Стенд',
      // SHA-256 от строки — имитация Advanced Matching
      'ud[em]': '5d41402abc4b2a76b9719d911017c592aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'ud[ph]': '7d793037a0760186574b0282f2f435e7aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
    const img = new Image();
    img.src = ORIGIN_B + '/tr?' + p.toString();
    return { transport: 'пиксель Image.src', urlLength: img.src.length };
  };

  B.webSocket = function webSocket() {
    return new Promise((resolve) => {
      const ws = new WebSocket('ws://localhost:8081/webvisor?id=bench');
      const done = (r) => { try { ws.close(); } catch (e) {} resolve(r); };
      ws.onopen = () => done({ transport: 'WebSocket', opened: true });
      ws.onerror = () => done({ transport: 'WebSocket', opened: false });
      setTimeout(() => done({ transport: 'WebSocket', opened: false, note: 'таймаут' }), 2000);
    });
  };

  // Форма Яндекс.Метрики: номер счётчика в пути, вся начинка упакована в один
  // параметр browser-info строкой «ключ:значение:ключ:значение».
  B.metrikaHit = function metrikaHit() {
    const info = [
      'pv', '1',
      'u', '1730000000123456789',
      'ar', '1',
      's', screen.width + 'x' + screen.height + 'x' + screen.colorDepth,
      'w', innerWidth + 'x' + innerHeight,
      'z', String(-new Date().getTimezoneOffset()),
      'la', navigator.language,
      'c', '1',
      'en', 'utf-8',
      'et', String(Math.floor(Date.now() / 1000)),
      'rn', String(Math.floor(Math.random() * 1e6)),
      // Поле, которого нет в декларации: обязано остаться неопознанным
      'zqz', '7',
    ].join(':');

    const p = new URLSearchParams({
      'page-url': location.href,
      'page-ref': document.referrer || 'https://example.org/',
      'browser-info': info,
      charset: 'utf-8',
      t: document.title,
      'site-info': JSON.stringify({ раздел: 'стенд' }),
    });

    const img = new Image();
    img.src = ORIGIN_B + '/watch/12345678?' + p.toString();
    return { transport: 'Метрика, пиксель', счётчик: 12345678, полей_внутри: 12 };
  };

  // Вебвизор — не аналитика, а запись действий на странице
  B.webvisorHit = function webvisorHit() {
    const p = new URLSearchParams({ rn: String(Math.floor(Math.random() * 1e6)), 'wv-part': '1' });
    return fetch(ORIGIN_B + '/webvisor/12345678?' + p.toString(), {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: '[[1,0,0],[2,120,340],[3,"клик"]]',
    }).then((r) => ({ transport: 'Вебвизор', status: r.status }));
  };

  B.identifierWrite = function identifierWrite() {
    // Постановка идентификатора всеми носителями сразу
    document.cookie = '_ga=GA1.1.1847362910.1730000000; max-age=63072000; path=/';
    document.cookie = '_ym_uid=1730000000123456789; max-age=63072000; path=/';
    localStorage.setItem('_bench_device_id', '1847362910.1730000000');
    const req = indexedDB.open('bench-store', 1);
    return { cookies: 2, localStorage: 1, indexedDB: Boolean(req) };
  };
})();

// Подсказки предзагрузки: запрос делает САМ БРАУЗЕР, прочитав разметку.
// Никакого JS-вызова нет, значит обёрткам видеть нечего. Сценарий нужен, чтобы
// проверить: не назовёт ли прибор такое обходом. На fingerprint.com именно так
// и вышло — два запроса Gatsby попали в «прошло мимо прибора».
(function () {
  const B = (window.__bench = window.__bench || {});
  B.resourceHints = function resourceHints() {
    const A = 'http://localhost:8080';
    const сделать = (rel, extra) => {
      const l = document.createElement('link');
      l.rel = rel;
      Object.assign(l, extra);
      document.head.appendChild(l);
      return l.href;
    };
    const один = сделать('prefetch', { href: A + '/collect?hint=prefetch' });
    const два = сделать('preload', { href: A + '/collect?hint=preload', as: 'fetch', crossOrigin: 'anonymous' });
    return { prefetch: один, preload: два, вызововИзJS: 0 };
  };
})();
