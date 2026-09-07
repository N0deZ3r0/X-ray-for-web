// Журнал сессии.
//
// Главное ограничение MV3: service worker выгружается через 30 секунд простоя,
// и всё, что лежит в его памяти, пропадает (предел 8 из 06-limits.md).
// Поэтому любая память здесь — КЭШ, а истина живёт в chrome.storage.session.

const MEM = new Map(); // tabId -> session. Может обнулиться в любой момент.
const DIRTY = new Set();

const FLUSH_MS = 250;
const FLUSH_EVENTS = 50;
const MAX_SESSION_BYTES = 8 * 1024 * 1024; // при квоте storage.session в 10 МБ

// Сколько ждём пару из другого источника, прежде чем выносить приговор.
// Инструмент шлёт залпами раз в 200 мс, сеть приходит сразу; трёх секунд
// хватает с запасом, а вечно ждать нельзя — иначе журнал никогда не сойдётся.
const GRACE_MS = 3000;

let pendingEvents = 0;
let flushTimer = null;

const key = (tabId) => 'session:' + tabId;

function blankHealth() {
  return {
    eventsRecorded: 0,
    eventsDropped: 0,
    degradedSurfaces: [],
    killSwitchTripped: false,
    bridgeSent: 0,
    bridgeGaps: 0,
    // Сколько раз страница подменила документ через document.open/write.
    // Каждая подмена сносит слушатели моста; сборщик их перевзводит и просит
    // переслать журнал. Число видно пользователю: это место, где прибор
    // восстанавливался, а не место, где всё гладко.
    documentReplacements: 0,
    swRestarts: 0,
    instrumentedFrames: 0,
    // Сверка двух источников (02-architecture.md)
    confirmed: 0,
    hookOnly: 0,
    networkOnly: 0,
    unobserved: 0,
    // Транспорты, которые сетевой источник не наблюдает вовсе.
    // Считаются отдельно: сказать про них «в сеть не ушло» было бы ложью.
    noNetworkSource: 0,
    // Обёрнуто, но перекрыто на экземпляре: обёртка стоит, вызовы идут мимо.
    surfacesShadowed: [],
    // Цена установки прибора в миллисекундах. Своё число показываем тем же
    // способом, каким показываем чужие.
    installMs: null,
  };
}

export function blankSession(tabId, origin) {
  return {
    id: crypto.randomUUID(),
    schemaVersion: 1,
    tabId,
    origin,
    startedAt: Date.now(),
    // Номер правки. Растёт при каждом изменении журнала и нужен ровно для
    // одного: панель может спросить «что нового», не забирая весь журнал.
    rev: 0,
    navigations: [],
    events: [],
    // Список наблюдаемых поверхностей, присланный инструментом один раз.
    // Без него свод не смог бы честно назвать знаменатель.
    installedSurfaces: null,
    // Сетевые наблюдения, ещё не сопоставленные с наблюдениями изнутри.
    // Живут отдельно, пока не решится их судьба.
    pendingNetwork: [],
    health: blankHealth(),
    truncated: false,
  };
}

export async function getSession(tabId) {
  if (MEM.has(tabId)) return MEM.get(tabId);
  const stored = await chrome.storage.session.get(key(tabId));
  const session = stored[key(tabId)] || null;
  if (session) MEM.set(tabId, session);
  return session;
}

export function putSession(session) {
  // Единственные ворота изменения сеанса, поэтому счётчик правок живёт здесь.
  session.rev = (session.rev || 0) + 1;
  MEM.set(session.tabId, session);
  markDirty(session.tabId);
}

export async function dropSession(tabId) {
  MEM.delete(tabId);
  DIRTY.delete(tabId);
  await chrome.storage.session.remove(key(tabId));
}

function markDirty(tabId) {
  DIRTY.add(tabId);
  if (pendingEvents >= FLUSH_EVENTS) {
    flushNow();
    return;
  }
  if (!flushTimer) flushTimer = setTimeout(flushNow, FLUSH_MS);
}

export async function flushNow() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (!DIRTY.size) return;

  const patch = {};
  for (const tabId of DIRTY) {
    const s = MEM.get(tabId);
    if (s) patch[key(tabId)] = s;
  }
  DIRTY.clear();
  pendingEvents = 0;

  try {
    await chrome.storage.session.set(patch);
  } catch (e) {
    // Квота или гонка. Молчаливая потеря запрещена: помечаем сессии обрезанными.
    for (const k of Object.keys(patch)) {
      const s = MEM.get(Number(k.split(':')[1]));
      if (s) s.truncated = true;
    }
  }
}

// Приблизительный размер: точный расчёт дороже пользы, а нам нужен только
// момент, когда пора перестать копить детали.
function roughBytes(session) {
  return session.events.length * 320;
}

// Код, а не текст. Журнал переживает перезапуск service worker и уходит в
// экспорт, поэтому язык в нём хранить нельзя: интерфейс переводится, а
// записанное — нет. Слова подставляет тот, кто показывает.
function frameKindOf(frameId, frameUrl) {
  if (frameId === 0) return 'main';
  if (frameUrl && frameUrl.startsWith('about:')) return 'about';
  return 'frame';
}

// ── Наблюдения изнутри страницы ─────────────────────────────────────────────
// Записи приходят кумулятивными: инструмент шлёт текущее состояние места
// вызова целиком, поэтому здесь именно upsert, а не сложение.

export function applyRecords(session, sender, records, instrumentHealth, bridge) {
  const frameId = sender.frameId || 0;
  const frameUrl = sender.url || '';
  const frameOrigin = sender.origin || null;

  const index = new Map();
  for (let i = 0; i < session.events.length; i++) {
    index.set(session.events[i].id, i);
  }

  let added = 0;

  for (const r of records) {
    const id = frameId + '|' + r.key;

    if (r.kind === 'installed' && !index.has(id)) {
      session.health.instrumentedFrames++;
      // Знаменатель для свода: что прибор вообще способен увидеть
      if (Array.isArray(r.surfaces) && !session.installedSurfaces) {
        // Перекрытая на экземпляре обёртка стоит, но вызовы идут мимо неё.
        // Помечаем сразу: знаменатель свода обязан считать наблюдаемым только
        // то, что действительно наблюдается (предел 3б).
        const перекрытые = new Set(r.shadowed || []);
        session.installedSurfaces = r.surfaces.map((имя, i) => ({
          surface: имя,
          group: (r.surfaceGroups || [])[i] || null,
          shadowed: перекрытые.has(имя),
        }));
      }
    }

    const base = {
      id,
      kind: r.kind,
      frameId,
      frameUrl,
      frameOrigin,
      frameKind: frameKindOf(frameId, frameUrl),
      surface: r.surface,
      group: r.group,
      cls: r.cls,
      t: Math.round(r.firstT),
      lastT: Math.round(r.lastT),
      count: r.count,
      detail: r.detail,
      arg: r.arg,
      result: r.result,
      attribution: r.attribution,
      // Наблюдение изнутри страницы. До 'confirmed' поднимает только сверка
      // с webRequest — страница до сетевого источника не дотягивается.
      trust: 'internal',
    };

    let event = base;
    if (r.kind === 'egress') {
      const prev = index.has(id) ? session.events[index.get(id)] : null;
      event = Object.assign(base, {
        source: 'hook',
        transport: r.transport,
        method: r.method,
        url: r.url,
        bodyForm: r.bodyForm,
        bodySize: r.bodySize,
        bodyText: r.bodyText,
        bodyMime: r.bodyMime,
        // Судьбу не сбрасываем: она могла уже решиться сетевым источником
        match: (prev && prev.match) || 'pending',
        seenAt: (prev && prev.seenAt) || Date.now(),
        netType: prev ? prev.netType : null,
        cookiesSent: prev ? prev.cookiesSent : null,
        netBodyText: prev ? prev.netBodyText : null,
      });
    }

    const at = index.get(id);
    if (at === undefined) {
      if (roughBytes(session) > MAX_SESSION_BYTES) {
        session.health.eventsDropped++;
        session.truncated = true;
        continue;
      }
      index.set(id, session.events.length);
      session.events.push(event);
      added++;
    } else {
      session.events[at] = event;
    }
  }

  session.health.eventsRecorded = session.events.length;

  if (instrumentHealth) {
    session.health.killSwitchTripped =
      session.health.killSwitchTripped || Boolean(instrumentHealth.killSwitchTripped);
    session.health.eventsDropped += instrumentHealth.recordsDropped || 0;
    for (const s of instrumentHealth.degradedSurfaces || []) {
      if (session.health.degradedSurfaces.indexOf(s) === -1) {
        session.health.degradedSurfaces.push(s);
      }
    }
    session.health.callsSeen = instrumentHealth.callsSeen;
    session.health.coldCalls = instrumentHealth.coldCalls;
    session.health.coldMs = instrumentHealth.coldMs;
    session.health.hotCalls = instrumentHealth.hotCalls;
    session.health.callsPerSecond = instrumentHealth.callsPerSecond;
    session.health.surfacesInstalled = instrumentHealth.surfacesInstalled;
    session.health.surfacesFailed = instrumentHealth.surfacesFailed || [];
    // Перекрытые на экземпляре обёртки и цена установки. Без переноса сюда
    // панель показывала бы прочерк, а знаменатель свода считал бы наблюдаемым
    // то, что не наблюдается: инструмент это знает, а журнал — нет.
    session.health.surfacesShadowed = instrumentHealth.surfacesShadowed || [];
    if (instrumentHealth.installMs != null) session.health.installMs = instrumentHealth.installMs;
    session.health.egressDropped = instrumentHealth.egressDropped || 0;
    session.health.coldBudgetExhausted =
      session.health.coldBudgetExhausted || Boolean(instrumentHealth.coldBudgetExhausted);
  }

  if (bridge) {
    session.health.bridgeSent = bridge.sent || 0;
    session.health.bridgeGaps = bridge.gaps || 0;
    session.health.documentReplacements = Math.max(
      session.health.documentReplacements || 0,
      bridge.replacements || 0
    );
  }

  pendingEvents += added;
  reconcile(session);
  putSession(session);
  return added;
}

// ── Наблюдение из сети ──────────────────────────────────────────────────────
// Страница до этого источника не дотягивается, поэтому его метка доверия —
// 'external', и только совпадение с ним поднимает наблюдение до 'confirmed'.

// Сопоставление идёт В ОБЕ СТОРОНЫ, и это не перестраховка.
// webRequest срабатывает мгновенно, а запись инструмента доходит до service
// worker только со следующим залпом — до 200 мс позже. Значит сеть почти всегда
// приходит ПЕРВОЙ и ложится в ожидание. Если не пытаться сопоставить её с
// наблюдениями, пришедшими позже, всё разойдётся по одиночке: проверка на живой
// странице дала 2 подтверждено, 10 обходов и 40 «не дошло до сети» там, где
// должно было быть 6 и 3.
function пара(session, net) {
  for (const e of session.events) {
    if (e.kind !== 'egress' || e.match !== 'pending') continue;
    if (e.url !== net.url || e.method !== net.method) continue;
    return e;
  }
  return null;
}

function подтвердить(session, e, net) {
  e.match = 'confirmed';
  e.trust = 'confirmed';
  e.netType = net.type;
  e.netRequestId = net.requestId;
  if (net.bodyText && !e.bodyText) e.netBodyText = net.bodyText;
  if (net.cookieNames && !e.cookiesSent) e.cookiesSent = net.cookieNames;
  session.health.confirmed++;
}

// Разобрать отложенные сетевые наблюдения: для каждого поискать пару среди
// наблюдений изнутри, которые могли прийти позже.
function свестиОтложенные(session) {
  if (!session.pendingNetwork.length) return;
  const keep = [];
  for (const net of session.pendingNetwork) {
    const e = пара(session, net);
    if (e) подтвердить(session, e, net);
    else keep.push(net);
  }
  session.pendingNetwork = keep;
}

export function applyNetworkEvent(session, net) {
  const e = пара(session, net);
  if (e) {
    подтвердить(session, e, net);
    reconcile(session);
    putSession(session);
    return 'confirmed';
  }

  // Пары нет — откладываем. Приговор выносится по истечении GRACE_MS:
  // залп инструмента мог просто не успеть.
  session.pendingNetwork.push(net);
  reconcile(session);
  putSession(session);
  return 'pending';
}

export function applyNetworkHeaders(session, requestId, cookieNames, purpose) {
  for (const e of session.events) {
    if (e.netRequestId === requestId) {
      if (cookieNames) e.cookiesSent = cookieNames;
      if (purpose) e.purpose = purpose;
      putSession(session);
      return;
    }
  }
  for (const n of session.pendingNetwork) {
    if (n.requestId === requestId) {
      if (cookieNames) n.cookieNames = cookieNames;
      if (purpose) n.purpose = purpose;
      putSession(session);
      return;
    }
  }
}

// Обвязка самой страницы: это не исходящее, а её собственная загрузка.
// В журнал «что ушло наружу» ей вообще не место.
const ОБВЯЗКА = new Set(['main_frame', 'sub_frame']);

// Транспорты, до которых сетевой источник не дотягивается.
// WebSocket: шаблоны разрешений вида *://*/* покрывают только http и https,
// схемы ws и wss под них не подпадают, и webRequest по ним ничего не отдаёт.
// Значит наблюдение изнутри подтвердить нечем — но и «в сеть не ушло» про него
// говорить нельзя: это разные утверждения, и второе было бы враньём.
const БЕЗ_СЕТЕВОГО_ИСТОЧНИКА = new Set(['websocket']);

// Предполётный запрос CORS порождает сам браузер, а не код страницы.
// Обёртки его не видят и видеть не могут; помечать его обходом — врать.
function предполётный(net) {
  return net.method === 'OPTIONS';
}

// Запрос «похож на маячок»? От этого зависит, назвать ли его обходом.
//
// Дисциплина ложных срабатываний из 02-architecture.md: большинство сетевых
// запросов законно не проходит через обёрнутые API — картинки, шрифты, стили,
// навигация, предзагрузка. Помечать их обходом значит врать.
function beaconLike(net) {
  // Предзагрузку по подсказке в разметке начинает САМ БРАУЗЕР: JS-вызова нет,
  // обёрткам видеть нечего, и называть её несовпадением источников — врать.
  // Chrome помечает такие запросы сам, это измерено на стенде (сценарий S33):
  //
  //   <link rel=prefetch>          Sec-Purpose: prefetch
  //   <link rel=preload as=fetch>  заголовка нет, от fetch неотличим
  //
  // Отсюда и объём починки: prefetch убираем из подозрений, preload остаётся
  // неотличимым и честно назван в пределе 4а.
  if (net.purpose && /prefetch/i.test(net.purpose)) return false;

  if (net.type === 'ping' || net.type === 'websocket') return true;
  if (net.type === 'xmlhttprequest') return true;
  if (net.method && net.method !== 'GET' && net.method !== 'HEAD') return true;
  return false;
}

// Возвращает true, если что-то изменилось. Панель обращается сюда на КАЖДЫЙ
// свой запрос, а запись журнала в хранилище стоит дорого: на живом сайте это
// сотни килобайт. Писать при каждом чтении — верный способ затормозить прибор
// ровно там, где он обещает не мешать.
export function reconcile(session, now) {
  const t = now || Date.now();
  const былоСобытий = session.events.length;
  const былоОтложенных = session.pendingNetwork.length;

  // Сначала попытаться свести — наблюдение изнутри могло прийти только что.
  свестиОтложенные(session);

  const keep = [];

  for (const net of session.pendingNetwork) {
    // Ещё есть шанс дождаться пары
    if (t - net.seenAt < GRACE_MS) {
      keep.push(net);
      continue;
    }

    // Загрузка самой страницы и её фреймов — не исходящее. Не считаем и не
    // показываем: иначе первой строкой журнала стоял бы сам адрес страницы.
    if (ОБВЯЗКА.has(net.type) || предполётный(net)) continue;

    const обход = beaconLike(net);

    // Стили, скрипты, шрифты, картинки, которых прибор не наблюдает изнутри.
    // Обвинять их нельзя — но и показывать каждую строкой в журнале нельзя:
    // на реальном сайте их сотни, и маячок в них утонет. Считаем, не печатаем.
    if (!обход) {
      session.health.unobserved++;
      continue;
    }

    const id = 'net|' + net.requestId;

    session.events.push({
      id,
      kind: 'egress',
      source: 'network',
      frameId: net.frameId || 0,
      frameUrl: '',
      frameOrigin: null,
      frameKind: frameKindOf(net.frameId || 0, ''),
      surface: 'egress.' + (net.type || 'other'),
      group: 'egress',
      t: 0,
      count: 1,
      transport: net.type,
      method: net.method,
      url: net.url,
      bodyForm: net.bodyText ? 'text' : 'none',
      bodySize: net.bodySize,
      bodyText: net.bodyText,
      cookiesSent: net.cookieNames || null,
      netType: net.type,
      netRequestId: net.requestId,
      // Сеть видела, обёртки не видели: прибор обошли.
      match: 'network-only',
      // Свидетельство из сети: страница подделать его не может
      trust: 'external',
      // Атрибуции нет и выдумывать её нельзя
      attribution: null,
    });

    session.health.networkOnly++;
  }

  session.pendingNetwork = keep;

  // Наблюдение изнутри, которого сеть так и не увидела.
  let приговорено = 0;
  for (const e of session.events) {
    if (e.kind !== 'egress' || e.match !== 'pending') continue;
    if (t - (e.seenAt || 0) < GRACE_MS) continue;
    приговорено++;

    if (БЕЗ_СЕТЕВОГО_ИСТОЧНИКА.has(e.transport)) {
      // Не «не ушло», а «проверить нечем». Разница принципиальная.
      e.match = 'no-network-source';
      e.trust = 'internal';
      session.health.noNetworkSource++;
      continue;
    }

    // Запрос действительно не ушёл: погашен другим расширением, отменён,
    // или это был не сетевой вызов.
    e.match = 'hook-only';
    session.health.hookOnly++;
  }

  session.health.eventsRecorded = session.events.length;

  return (
    session.events.length !== былоСобытий ||
    session.pendingNetwork.length !== былоОтложенных ||
    приговорено > 0
  );
}

// Service worker перезапустился при живых сессиях — это потеря данных
// в окне между флашами, и пользователь обязан её видеть.
export async function noteServiceWorkerStart() {
  const all = await chrome.storage.session.get(null);
  const patch = {};
  for (const k of Object.keys(all)) {
    if (!k.startsWith('session:')) continue;
    const s = all[k];
    if (!s || !s.health) continue;
    s.health.swRestarts = (s.health.swRestarts || 0) + 1;
    patch[k] = s;
  }
  if (Object.keys(patch).length) await chrome.storage.session.set(patch);
}
