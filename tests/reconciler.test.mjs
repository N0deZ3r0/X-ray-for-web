// Тест сверки двух источников — ядро этапа Э2.
//
// Проверяет критерии из 07-roadmap.md на числах стенда (bench/README.md).
//
// Главное здесь — ПОРЯДОК прихода наблюдений. Первая редакция этого теста
// подавала сначала наблюдения изнутри, потом из сети, и всё сходилось. В жизни
// наоборот: webRequest срабатывает мгновенно, а залп инструмента доходит до
// service worker до 200 мс позже. На живой странице это дало 2 подтверждено,
// 10 обходов и 40 «не дошло до сети» там, где должно было быть 6 и 3.
//
// Поэтому теперь прогоняются ОБА порядка, и оба обязаны дать один вердикт.
//
// Запуск: node tests/reconciler.test.mjs

import { readFileSync } from 'node:fs';
import { загрузить } from './lib/zagruzka.mjs';

// ── Заглушка chrome для модуля журнала ──────────────────────────────────────
const store = {};
globalThis.chrome = {
  storage: {
    session: {
      async get(k) {
        if (k == null) return { ...store };
        if (typeof k === 'string') return k in store ? { [k]: store[k] } : {};
        return {};
      },
      async set(patch) {
        Object.assign(store, patch);
      },
      async remove(k) {
        delete store[k];
      },
    },
  },
};
if (!globalThis.crypto) globalThis.crypto = {};
if (!globalThis.crypto.randomUUID) {
  let n = 0;
  globalThis.crypto.randomUUID = () => 'uuid-' + ++n;
}

const { модуль: S, убрать } = await загрузить('session-tests', [
  'extension/background/session.js',
]);

// ── Данные стенда ───────────────────────────────────────────────────────────
const B = 'http://localhost:8081';

// Семь обращений, которые прибор видит обоими источниками
const атрибутируемые = [
  { transport: 'beacon', method: 'POST', url: B + '/g/collect?en=page_view', type: 'ping' },
  { transport: 'beacon', method: 'POST', url: B + '/g/collect?en=frame_view', type: 'ping' },
  { transport: 'beacon', method: 'POST', url: B + '/g/collect?batch=1', type: 'ping' },
  { transport: 'fetch', method: 'POST', url: B + '/collect', type: 'xmlhttprequest' },
  { transport: 'xhr', method: 'POST', url: B + '/collect?xhr=1', type: 'xmlhttprequest' },
  { transport: 'image', method: 'GET', url: B + '/tr?id=123&ud=hash', type: 'image' },
  { transport: 'websocket', method: 'GET', url: 'ws://localhost:8081/webvisor', type: 'websocket' },
];

// Три обхода: прибор их не видел, сеть видела
const обходы = [
  { method: 'POST', url: B + '/g/collect?en=evaded_beacon', type: 'ping' },
  { method: 'POST', url: B + '/collect?evaded=fetch', type: 'xmlhttprequest' },
  { method: 'POST', url: B + '/g/collect?en=worker', type: 'xmlhttprequest' },
];

// Законный шум: обёрнутые API его не видят, и обвинять его нельзя
const шум = [
  ...Array.from({ length: 30 }, (_, i) => ({
    method: 'GET',
    url: 'http://localhost:8080/noise/img?i=' + i,
    type: 'image',
  })),
  { method: 'GET', url: 'http://localhost:8080/style.css', type: 'stylesheet' },
  { method: 'GET', url: 'http://localhost:8080/font.woff2', type: 'font' },
  { method: 'GET', url: 'http://localhost:8080/scenarios.js', type: 'script' },
  { method: 'GET', url: 'http://localhost:8080/noise/img?css=1', type: 'image' },
];

// Не исходящее вовсе: загрузка самой страницы и предполётные запросы CORS,
// которые порождает браузер, а не код страницы.
const обвязка = [
  { method: 'GET', url: 'http://localhost:8080/', type: 'main_frame' },
  { method: 'GET', url: B + '/frame.html', type: 'sub_frame' },
  { method: 'OPTIONS', url: B + '/collect', type: 'xmlhttprequest' },
  { method: 'OPTIONS', url: B + '/g/collect', type: 'xmlhttprequest' },
];

// WebSocket в сетевой источник НЕ подаётся намеренно: шаблоны разрешений вида
// *://*/* покрывают только http и https, и webRequest по схеме ws ничего не
// отдаёт. Прибор обязан сказать «сетью не проверяется», а не «в сеть не ушло».
const сеть = [
  ...атрибутируемые.filter((r) => r.transport !== 'websocket'),
  ...обходы,
  ...шум,
  ...обвязка,
];

function записиИзнутри() {
  return атрибутируемые.map((r, i) => ({
    key: 'egress|' + (i + 1),
    kind: 'egress',
    surface: 'egress.' + r.transport,
    group: 'egress',
    transport: r.transport,
    method: r.method,
    url: r.url,
    bodyForm: 'none',
    bodySize: 0,
    bodyText: null,
    count: 1,
    firstT: 100 + i,
    lastT: 100 + i,
    detail: 'full',
    attribution: {
      scriptUrl: B + '/beacon.js',
      line: 39 + i,
      column: 5,
      inline: false,
      thirdParty: true,
    },
  }));
}

const sender = { frameId: 0, url: 'http://localhost:8080/', origin: 'http://localhost:8080' };

function податьСеть(session) {
  let reqId = 0;
  for (const n of сеть) {
    S.applyNetworkEvent(session, {
      requestId: 'r' + ++reqId,
      url: n.url,
      method: n.method,
      type: n.type,
      frameId: 0,
      seenAt: Date.now(),
      bodyText: null,
      bodySize: 0,
      bodyForm: 'none',
      cookieNames: null,
    });
  }
}

function прогон(порядок) {
  const session = S.blankSession(1, 'http://localhost:8080');

  if (порядок === 'сеть-первой') {
    податьСеть(session);
    S.applyRecords(session, sender, записиИзнутри(), null, null);
  } else if (порядок === 'изнутри-первой') {
    S.applyRecords(session, sender, записиИзнутри(), null, null);
    податьСеть(session);
  } else {
    // Вперемешку: половина сети, потом наблюдения, потом остаток сети
    const половина = сеть.length >> 1;
    let reqId = 0;
    const подать = (список) => {
      for (const n of список) {
        S.applyNetworkEvent(session, {
          requestId: 'm' + ++reqId,
          url: n.url,
          method: n.method,
          type: n.type,
          frameId: 0,
          seenAt: Date.now(),
          bodyText: null,
          bodySize: 0,
          bodyForm: 'none',
          cookieNames: null,
        });
      }
    };
    подать(сеть.slice(0, половина));
    S.applyRecords(session, sender, записиИзнутри(), null, null);
    подать(сеть.slice(половина));
  }

  S.reconcile(session, Date.now() + 5000);
  return session;
}

// ── Проверки ────────────────────────────────────────────────────────────────
let провал = 0;

for (const порядок of ['сеть-первой', 'изнутри-первой', 'вперемешку']) {
  const session = прогон(порядок);
  const egress = session.events.filter((e) => e.kind === 'egress');
  const по = (m) => egress.filter((e) => e.match === m);

  const проверки = [
    ['подтверждено обоими источниками = 6', по('confirmed').length === 6, по('confirmed').length],
    [
      'WebSocket помечен «нечем проверить», а не «не ушло»',
      по('no-network-source').length === 1 && по('no-network-source')[0].transport === 'websocket',
      по('no-network-source').map((e) => e.transport + '/' + e.match),
    ],
    ['прошло мимо инструментации = 3', по('network-only').length === 3, по('network-only').length],
    [
      'ложных обходов на шуме = 0',
      по('network-only').every((e) => !e.url.includes('8080')),
      по('network-only').map((e) => e.url),
    ],
    ['не дошло до сети = 0', по('hook-only').length === 0, по('hook-only').length],
    ['ничего не осталось в ожидании', по('pending').length === 0, по('pending').length],
    // Шум считается, но в журнал не попадает: обвинять его не в чем, а списком
    // он утопил бы маячки. На реальном сайте таких запросов сотни.
    ['шум посчитан вне наблюдения = 34', session.health.unobserved === 34, session.health.unobserved],
    ['шума нет в журнале', по('unobserved').length === 0, по('unobserved').length],
    // Предполётные CORS и загрузка страницы — не исходящее ни в каком виде
    ['в журнале ровно 10 записей', egress.length === 10, egress.length],
    ['предполётных CORS в журнале нет', !egress.some((e) => e.method === 'OPTIONS'), 'есть OPTIONS'],
    [
      'у обходов нет выдуманной атрибуции',
      по('network-only').every((e) => e.attribution === null),
      'есть атрибуция',
    ],
    [
      'подтверждённые имеют доверие confirmed',
      по('confirmed').every((e) => e.trust === 'confirmed'),
      по('confirmed').map((e) => e.trust),
    ],
    [
      'счётчики здоровья сошлись',
      session.health.confirmed === 6 &&
        session.health.networkOnly === 3 &&
        session.health.noNetworkSource === 1 &&
        session.health.hookOnly === 0,
      session.health,
    ],
  ];

  console.log('порядок: ' + порядок);
  for (const [имя, ок, факт] of проверки) {
    console.log((ок ? '  ok      ' : '  ПРОВАЛ  ') + имя + (ок ? '' : '  → ' + JSON.stringify(факт)));
    if (!ок) провал++;
  }
  console.log('');
}

// ── Номер правки ────────────────────────────────────────────────────────────
//
// Панель спрашивает состояние по номеру правки: если он не изменился, worker
// не присылает журнал вовсе. Значит, пропущенный инкремент — это не потеря
// скорости, а замерзшая панель, показывающая вчерашние данные. Проверяем, что
// каждый путь изменения журнала номер двигает.

{
  const session = S.blankSession(9, 'http://localhost:8080');
  const проверки = [];
  const было = () => session.rev;

  проверки.push(['новый сеанс начинается с нуля', session.rev === 0, session.rev]);

  let r = было();
  S.applyRecords(session, sender, записиИзнутри(), null, null);
  проверки.push(['наблюдения изнутри двигают номер', session.rev > r, session.rev]);

  r = было();
  податьСеть(session);
  проверки.push(['сетевые наблюдения двигают номер', session.rev > r, session.rev]);

  // Сверка сама по себе меняет вердикты, и это изменение журнала.
  r = было();
  const свелось = S.reconcile(session, Date.now() + 5000);
  проверки.push(['сверка сообщила об изменении', свелось === true, свелось]);
  S.putSession(session);
  проверки.push(['после сверки номер вырос', session.rev > r, session.rev]);

  // А вот повторная сверка менять уже нечего — и обязана это признать,
  // иначе панель будет перерисовываться вечно.
  const второй = S.reconcile(session, Date.now() + 6000);
  проверки.push(['повторная сверка изменений не нашла', второй === false, второй]);

  console.log('номер правки');
  for (const [имя, ок, факт] of проверки) {
    console.log((ок ? '  ok      ' : '  ПРОВАЛ  ') + имя + (ок ? '' : '  → ' + JSON.stringify(факт)));
    if (!ок) провал++;
  }
  console.log('');
}

// ── Здоровье доезжает из инструмента в журнал ───────────────────────────────
//
// Инструмент считает своё здоровье в мире страницы, журнал складывает его в
// сеанс, панель показывает. Звено посередине легко забыть: поле добавили в
// инструмент и в панель, а перенос не написали — и человек видит прочерк там,
// где прибор всё знает.
//
// Так и случилось дважды подряд: installMs и surfacesShadowed были у
// инструмента и в панели, но не переносились. Проверка ниже сверяет то, что
// панель читает, с тем, что журнал переносит.

// ── Предзагрузка не выдаётся за несовпадение источников ─────────────────────
//
// Запрос по <link rel=prefetch> делает САМ БРАУЗЕР, прочитав разметку. JS-вызова
// нет, обёрткам видеть нечего — и назвать это несовпадением двух источников
// значит обвинить страницу в том, чего она не делала.
//
// Отличить можно: Chrome помечает такие запросы заголовком Sec-Purpose:
// prefetch. Измерено на стенде, сценарий S33:
//
//   <link rel=prefetch>          Sec-Purpose: prefetch
//   <link rel=preload as=fetch>  заголовка нет, от fetch неотличим
//
// Поэтому prefetch выведен из подозрений, а preload честно остаётся в них и
// назван в пределе 4а.

console.log('предзагрузка');
{
  const session = S.blankSession(11, 'https://site.example');
  const общее = {
    method: 'GET',
    type: 'xmlhttprequest',
    frameId: 0,
    seenAt: Date.now(),
    bodyText: null,
    bodySize: 0,
    bodyForm: 'none',
    cookieNames: null,
  };

  S.applyNetworkEvent(session, { ...общее, requestId: 'p1', url: 'https://site.example/page-data.json' });
  S.applyNetworkEvent(session, { ...общее, requestId: 'p2', url: 'https://site.example/beacon.json' });
  S.applyNetworkEvent(session, { ...общее, requestId: 'p3', url: 'https://site.example/other.json' });

  // Заголовки приходят отдельным событием, как и в браузере.
  S.applyNetworkHeaders(session, 'p1', null, 'prefetch');
  // Намерение, которого прибор не знает. Из подозрений оно НЕ выводит — но
  // доехать до человека обязано: пусть решает он, а не молчание прибора.
  S.applyNetworkHeaders(session, 'p3', null, 'какое-то-иное');

  S.reconcile(session, Date.now() + 5000);

  const по = (u) => session.events.find((e) => e.url && e.url.includes(u));
  const предзагрузка = по('page-data.json');
  const обычный = по('beacon.json');

  const проверки = [
    [
      'предзагрузка не попала в журнал как несовпадение',
      !предзагрузка || предзагрузка.match !== 'network-only',
      предзагрузка && предзагрузка.match,
    ],
    [
      'обычный запрос без пары по-прежнему замечен',
      Boolean(обычный) && обычный.match === 'network-only',
      обычный && обычный.match,
    ],
    [
      'предзагрузка посчитана как вне наблюдения, а не потеряна',
      session.health.unobserved >= 1,
      session.health,
    ],
    // Заголовок Sec-Purpose был измерен НА ПРОВОДЕ — на стенде, со стороны
    // сервера. Что его видит webRequest в браузере, из этого не следует, и
    // проверить это можно только на живом замере. Поэтому прибор считает такие
    // пометки и показывает число: ноль на странице с предзагрузкой означает,
    // что исключение не работает, и молчать об этом нельзя.
    [
      'пометки браузера сосчитаны — иначе нечем узнать, доходят ли они',
      session.health.purposeSeen === 2,
      session.health.purposeSeen,
    ],
    [
      'запрос без пометки её и не получает',
      обычный && обычный.purpose == null,
      обычный && обычный.purpose,
    ],
    [
      'незнакомое намерение не выводит из подозрений',
      по('other.json') && по('other.json').match === 'network-only',
      по('other.json') && по('other.json').match,
    ],
    [
      'но доезжает до записи — человеку видно, чем это объясняется',
      по('other.json') && по('other.json').purpose === 'какое-то-иное',
      по('other.json') && по('other.json').purpose,
    ],
  ];

  for (const [имя, ок, факт] of проверки) {
    console.log((ок ? '  ok      ' : '  ПРОВАЛ  ') + имя + (ок ? '' : '  → ' + JSON.stringify(факт)));
    if (!ок) провал++;
  }
  console.log('');
}

console.log('перенос здоровья');
{
  const инструментальное = {
    callsSeen: 415,
    coldCalls: 415,
    coldMs: 16.5,
    hotCalls: 0,
    callsPerSecond: 1,
    recordsDropped: 0,
    degradedSurfaces: [],
    killSwitchTripped: false,
    coldBudgetExhausted: false,
    egressDropped: 0,
    surfacesInstalled: 73,
    surfacesFailed: [],
    surfacesShadowed: ['navigator.platform'],
    installMs: 4.9,
  };

  const session = S.blankSession(7, 'https://site.example');
  S.applyRecords(session, sender, [], инструментальное, { sent: 3, gaps: 0 });
  const h = session.health;

  const проверки = [
    ['цена установки доехала', h.installMs === 4.9, h.installMs],
    [
      'перекрытые обёртки доехали',
      Array.isArray(h.surfacesShadowed) && h.surfacesShadowed[0] === 'navigator.platform',
      h.surfacesShadowed,
    ],
    ['счётчики вызовов доехали', h.callsSeen === 415 && h.coldMs === 16.5, [h.callsSeen, h.coldMs]],
    ['число обёрнутых доехало', h.surfacesInstalled === 73, h.surfacesInstalled],
  ];

  // И общее правило: каждое поле, которое панель читает из здоровья, обязано
  // либо считаться в журнале, либо переноситься из инструмента. Список берётся
  // из самой панели, чтобы не разъехаться с ней.
  const панель = readFileSync(new URL('../extension/ui/panel.js', import.meta.url), 'utf8');
  const начало = панель.indexOf('const rows = [');
  const конец = панель.indexOf('];', начало);
  const читаемые = [...панель.slice(начало, конец).matchAll(/h\.([a-zA-Z]+)/g)].map((m) => m[1]);
  const нетВЖурнале = [...new Set(читаемые)].filter((k) => !(k in h));
  проверки.push(['все поля здоровья из панели есть в журнале', нетВЖурнале.length === 0, нетВЖурнале]);

  for (const [имя, ок, факт] of проверки) {
    console.log((ок ? '  ok      ' : '  ПРОВАЛ  ') + имя + (ок ? '' : '  → ' + JSON.stringify(факт)));
    if (!ок) провал++;
  }
  console.log('');
}

console.log(провал ? провал + ' проверок провалено' : 'все проверки пройдены во всех трёх порядках');
убрать();
process.exit(провал ? 1 : 0);
