// Service worker.
//
// Правило номер один для MV3: слушатели регистрируются СИНХРОННО на верхнем
// уровне модуля. Иначе Chrome не сможет разбудить уснувший worker на событие,
// и часть сессии пропадёт молча (02-architecture.md).
//
// Правило номер два: никакой глобальной изменяемой памяти без зеркала в
// chrome.storage.session. Всё, что здесь в переменных, считается кэшем.

import {
  blankSession,
  getSession,
  putSession,
  dropSession,
  applyRecords,
  reconcile,
  flushNow,
  noteServiceWorkerStart,
} from './session.js';

// Импорт со side-эффектом: модуль регистрирует слушатели webRequest на своём
// верхнем уровне, а значит синхронно, до первого события.
import { setNotify } from './webrequest.js';

import { разобратьИсходящее } from './parsers/index.js';
import { выводитьФакты } from './facts.js';
import { t } from './i18n.js';
import { собратьЭкспорт, собратьОтчёт } from './export.js';

const RECORDING_KEY = 'recording';
const SCRIPT_PREFIX = 'xray-';

// Кэш портов панели. Теряется вместе с worker — панель переподключается сама.
const panelPorts = new Set();

// ── Состояние записи ────────────────────────────────────────────────────────

async function getRecording() {
  const stored = await chrome.storage.session.get(RECORDING_KEY);
  return stored[RECORDING_KEY] || {};
}

async function setRecording(map) {
  await chrome.storage.session.set({ [RECORDING_KEY]: map });
}

// ── Регистрация инструмента ────────────────────────────────────────────────
// Разрешение запрашивает панель (нужен жест пользователя), сюда приходит уже
// выданное. Прибор включают — см. 02-architecture.md.

async function startRecording({ tabId, origin, patterns }) {
  const mainId = SCRIPT_PREFIX + 'main-' + tabId;
  const isoId = SCRIPT_PREFIX + 'iso-' + tabId;

  await unregisterIds([mainId, isoId]);

  await chrome.scripting.registerContentScripts([
    {
      id: mainId,
      js: ['instrument/main.js'],
      matches: patterns,
      runAt: 'document_start',
      allFrames: true,
      // Без этого не видно about:blank и srcdoc фреймов, которые трекер
      // создаёт сам. Требует Chrome 119+ и пути ровно /* в шаблоне.
      matchOriginAsFallback: true,
      world: 'MAIN',
    },
    {
      id: isoId,
      js: ['collector/isolated.js'],
      matches: patterns,
      runAt: 'document_start',
      allFrames: true,
      matchOriginAsFallback: true,
      world: 'ISOLATED',
    },
  ]);

  const recording = await getRecording();
  recording[tabId] = { origin, patterns, scriptIds: [mainId, isoId], startedAt: Date.now() };
  await setRecording(recording);

  const session = blankSession(tabId, origin);
  session.navigations.push({ navId: crypto.randomUUID(), tabId, url: origin, startedAt: Date.now() });
  putSession(session);
  await flushNow();

  // Обёртки обязаны стоять до первого скрипта страницы, а разрешение выдано
  // только что. Значит запись всегда начинается с перезагрузки — предел 9.
  await chrome.tabs.reload(tabId);

  broadcast({ type: 'recording', tabId, on: true });
  return { ok: true };
}

// Остановка снимает ВСЕ регистрации прибора, а не только числящиеся за этой
// вкладкой. Причина в том, как работает registerContentScripts: он регистрирует
// скрипты по ШАБЛОНУ АДРЕСА, а не по вкладке. Учёт «записываем вкладку N» —
// это бухгалтерия поверх глобального действия: обёртки встают на каждую
// подходящую страницу в любой вкладке.
//
// Пока остановка снимала только скрипты своей вкладки, она молча не делала
// ничего, если панель смотрела на другую вкладку: entry не находился, ничего
// не снималось, — а панель получала on:false и показывала «Записать этот
// сайт». То есть прибор утверждал, что не наблюдает, продолжая наблюдать.
// Найдено на живом замере: три подряд серии ушли в «с прибором», потому что
// «Остановить» ничего не останавливало.
//
// Обёртки, уже стоящие в открытых страницах, при этом остаются до следующей
// загрузки — снять их нельзя, они живут в мире страницы. Об этом сказано
// вызывающему, чтобы он мог сказать человеку.
async function stopRecording(tabId) {
  const recording = await getRecording();
  const былиВкладки = Object.keys(recording).map(Number);

  let снято = 0;
  try {
    const all = await chrome.scripting.getRegisteredContentScripts();
    const mine = all.filter((s) => s.id.startsWith(SCRIPT_PREFIX)).map((s) => s.id);
    if (mine.length) {
      await chrome.scripting.unregisterContentScripts({ ids: mine });
      снято = mine.length;
    }
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }

  await setRecording({});

  // Сообщаем всем вкладкам, а не только той, с которой нажали: остановка общая.
  for (const id of былиВкладки) broadcast({ type: 'recording', tabId: id, on: false });
  if (!былиВкладки.includes(Number(tabId))) {
    broadcast({ type: 'recording', tabId, on: false });
  }

  return { ok: true, снятоРегистраций: снято, остановленоВкладок: былиВкладки.length };
}

async function unregisterIds(ids) {
  if (!ids || !ids.length) return;
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids });
    if (existing.length) {
      await chrome.scripting.unregisterContentScripts({ ids: existing.map((s) => s.id) });
    }
  } catch (e) {
    // Нечего снимать
  }
}

// Регистрации переживают перезапуск браузера. Если состояния записи нет,
// а скрипты зарегистрированы — прибор работал бы молча, чего обещать нельзя.
async function dropOrphanRegistrations() {
  try {
    const all = await chrome.scripting.getRegisteredContentScripts();
    const mine = all.filter((s) => s.id.startsWith(SCRIPT_PREFIX));
    if (!mine.length) return;

    const recording = await getRecording();
    const alive = new Set();
    for (const tabId of Object.keys(recording)) {
      for (const id of recording[tabId].scriptIds || []) alive.add(id);
    }

    const orphans = mine.filter((s) => !alive.has(s.id)).map((s) => s.id);
    if (orphans.length) await chrome.scripting.unregisterContentScripts({ ids: orphans });
  } catch (e) {}
}

// ── Панель ──────────────────────────────────────────────────────────────────

function broadcast(message) {
  for (const port of panelPorts) {
    try {
      port.postMessage(message);
    } catch (e) {
      panelPorts.delete(port);
    }
  }
}

// ── Слушатели: только синхронная регистрация ────────────────────────────────

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'panel') return;
  panelPorts.add(port);
  port.onDisconnect.addListener(() => panelPorts.delete(port));
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return;

  // Наблюдения из страницы
  if (message.type === 'xray:records') {
    const tabId = sender.tab && sender.tab.id;
    if (typeof tabId !== 'number') return;

    // Отвечаем сразу: иначе промис в сборщике повиснет и он засчитает потерю
    // моста там, где её не было.
    sendResponse({ ok: true });

    (async () => {
      const recording = await getRecording();
      // Content scripts подобраны по шаблону адреса, а не по вкладке: тот же
      // сайт в другой вкладке тоже их получит. Пишем только то, что включено.
      if (!recording[tabId]) return;

      const session = (await getSession(tabId)) || blankSession(tabId, recording[tabId].origin);
      const added = applyRecords(
        session,
        sender,
        message.records,
        message.health,
        message.bridge
      );
      if (added) broadcast({ type: 'delta', tabId });
      else broadcast({ type: 'touch', tabId });
    })();
    return;
  }

  // Команды панели
  if (message.type === 'panel:start') {
    startRecording(message.payload).then(sendResponse, (e) =>
      sendResponse({ ok: false, error: String(e && e.message) })
    );
    return true;
  }

  if (message.type === 'panel:stop') {
    stopRecording(message.tabId).then(sendResponse, (e) =>
      sendResponse({ ok: false, error: String(e && e.message) })
    );
    return true;
  }

  if (message.type === 'panel:state') {
    (async () => {
      const [recording, session] = await Promise.all([
        getRecording(),
        getSession(message.tabId),
      ]);
      // Сверка источников идёт лениво: таймеров в MV3 на такие интервалы нет,
      // а worker может уснуть в любой момент. Поэтому приговор откладываемым
      // наблюдениям выносится при каждом обращении.
      if (session) {
        const свелось = reconcile(session);
        // Разбор форматов идёт здесь, а не на горячем пути: реестр читается
        // асинхронно, а слушатели worker обязаны регистрироваться синхронно.
        const разобрано = await разобратьИсходящее(session);

        // Пишем только если что-то действительно изменилось. Панель опрашивает
        // состояние постоянно, а запись всего журнала стоит дорого: чтение не
        // должно превращаться в запись.
        if (свелось || разобрано) {
          putSession(session);
          await flushNow();
        }
      }
      // Панель присылает номер правки, который у неё уже есть. Если журнал с
      // тех пор не менялся, отдавать его заново незачем: на живом сайте это
      // мегабайты копирования между процессами по нескольку раз в секунду.
      const правка = (recording[message.tabId] ? '1' : '0') + ':' + (session ? session.rev : -1);
      if (message.since && message.since === правка) {
        sendResponse({ unchanged: true });
        return;
      }

      // Свод выводится на лету и НЕ хранится в журнале: это проекция, а не
      // самостоятельные данные. Хранить его значило бы завести второй источник
      // истины, который может разойтись с журналом.
      const свод = session ? выводитьФакты(session) : null;

      sendResponse({
        rev: правка,
        recording: Boolean(recording[message.tabId]),
        entry: recording[message.tabId] || null,
        session: session || null,
        facts: свод,
      });
    })();
    return true;
  }

  if (message.type === 'panel:export') {
    (async () => {
      const session = await getSession(message.tabId);
      if (!session) {
        sendResponse({ ok: false, error: t('report_no_recording') });
        return;
      }
      reconcile(session);
      await разобратьИсходящее(session);
      putSession(session);
      await flushNow();

      const свод = выводитьФакты(session);
      // Редакция по умолчанию. Отключить её можно только явным флагом с
      // отдельным подтверждением на стороне панели.
      const редакция = message.редакция !== false;
      const { данные, вырезано } = собратьЭкспорт(session, свод, { редакция });
      const отчёт = собратьОтчёт(session, свод, { редакция });

      sendResponse({
        ok: true,
        редакция,
        вырезано,
        отчёт,
        json: JSON.stringify(данные, null, 2),
        // Имя файла — последняя линия обороны: его видно в списке загрузок и
        // во вложении письма, когда содержимое уже никто не читает.
        // Имя файла остаётся латиницей независимо от языка интерфейса:
        // его увидит файловая система, почтовый клиент и багтрекер, а там
        // кириллица превращается в проценты и знаки вопроса.
        имя:
          'xray-' +
          (session.origin || 'session').replace(/[^a-zA-Z0-9]+/g, '-') +
          (редакция ? '' : '-NOT-REDACTED'),
      });
    })();
    return true;
  }

  if (message.type === 'panel:clear') {
    (async () => {
      await dropSession(message.tabId);
      const recording = await getRecording();
      if (recording[message.tabId]) {
        const session = blankSession(message.tabId, recording[message.tabId].origin);
        putSession(session);
        await flushNow();
      }
      sendResponse({ ok: true });
    })();
    return true;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  stopRecording(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== 'loading' || !changeInfo.url) return;
  (async () => {
    const recording = await getRecording();
    if (!recording[tabId]) return;
    const session = await getSession(tabId);
    if (!session) return;
    session.navigations.push({
      navId: crypto.randomUUID(),
      tabId,
      url: changeInfo.url,
      startedAt: Date.now(),
    });
    putSession(session);
    await flushNow();
    broadcast({ type: 'delta', tabId });
  })();
});

// ── Инициализация: только после того, как слушатели уже стоят ───────────────

setNotify((tabId) => broadcast({ type: 'delta', tabId }));

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
noteServiceWorkerStart().catch(() => {});
dropOrphanRegistrations().catch(() => {});
