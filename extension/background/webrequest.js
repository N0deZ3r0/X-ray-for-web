// Сетевой источник наблюдения.
//
// Второй из двух источников (02-architecture.md). Видит то, что реально ушло в
// сеть, включая запросы, прошедшие мимо обёрток: из воркера, из чистого фрейма,
// из WASM. Данных меньше — нет стека, нет намерения, — но страница до этого
// источника не дотягивается, поэтому его метка доверия 'external'.
//
// Слушатели регистрируются на верхнем уровне модуля. Модуль импортируется
// синхронно из index.js, значит регистрация происходит до первого события и
// Chrome сможет разбудить уснувший worker.

import { getSession, applyNetworkEvent, applyNetworkHeaders, flushNow } from './session.js';

const FILTER = { urls: ['<all_urls>'] };
const MAX_BODY = 64 * 1024;

// Кэш состояния записи. Теряется вместе с worker — перечитываем из storage.
async function recordingTabs() {
  const stored = await chrome.storage.session.get('recording');
  return stored.recording || {};
}

function decodeBody(requestBody) {
  if (!requestBody) return { text: null, size: 0, form: 'none' };

  if (requestBody.error) return { text: null, size: 0, form: 'ошибка: ' + requestBody.error };

  // urlencoded и multipart Chrome разбирает сам
  if (requestBody.formData) {
    const parts = [];
    for (const k of Object.keys(requestBody.formData)) {
      for (const v of requestBody.formData[k]) parts.push(k + '=' + v);
    }
    const t = parts.join('&');
    return { text: t.slice(0, 4000), size: t.length, form: 'text' };
  }

  // Всё остальное приходит сырыми байтами. Тело маячка обычно здесь.
  if (requestBody.raw && requestBody.raw.length) {
    let total = 0;
    const chunks = [];
    for (const part of requestBody.raw) {
      if (!part.bytes) continue;
      total += part.bytes.byteLength;
      if (total <= MAX_BODY) chunks.push(new Uint8Array(part.bytes));
    }
    if (!chunks.length) return { text: null, size: total, form: 'binary' };

    let len = 0;
    for (const c of chunks) len += c.length;
    const all = new Uint8Array(len);
    let off = 0;
    for (const c of chunks) {
      all.set(c, off);
      off += c.length;
    }
    try {
      const text = new TextDecoder('utf-8', { fatal: false }).decode(all);
      // Если декодировалось в мусор с заменяющими символами — считаем двоичным
      const мусор = (text.match(/�/g) || []).length;
      if (мусор > text.length / 20) return { text: null, size: total, form: 'binary' };
      return { text: text.slice(0, 4000), size: total, form: 'text' };
    } catch (e) {
      return { text: null, size: total, form: 'binary' };
    }
  }

  return { text: null, size: 0, form: 'none' };
}

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    const tabId = details.tabId;
    if (typeof tabId !== 'number' || tabId < 0) return;

    (async () => {
      const recording = await recordingTabs();
      if (!recording[tabId]) return;

      const session = await getSession(tabId);
      if (!session) return;

      const body = decodeBody(details.requestBody);

      applyNetworkEvent(session, {
        requestId: details.requestId,
        url: details.url,
        method: details.method,
        type: details.type,
        frameId: details.frameId,
        seenAt: Date.now(),
        bodyText: body.text,
        bodySize: body.size,
        bodyForm: body.form,
        cookieNames: null,
      });
      await flushNow();
      notify(tabId);
    })();
  },
  FILTER,
  ['requestBody']
);

// Куки, ушедшие с запросом. Записываем ТОЛЬКО имена: значения здесь — это
// сессионные токены, и их место не в журнале (03-data-model.md).
chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    const tabId = details.tabId;
    if (typeof tabId !== 'number' || tabId < 0) return;
    if (!details.requestHeaders) return;

    let cookieHeader = null;
    for (const h of details.requestHeaders) {
      if (h.name && h.name.toLowerCase() === 'cookie') {
        cookieHeader = h.value || '';
        break;
      }
    }
    if (!cookieHeader) return;

    const names = cookieHeader
      .split(';')
      .map((c) => c.split('=')[0].trim())
      .filter(Boolean);

    (async () => {
      const recording = await recordingTabs();
      if (!recording[tabId]) return;
      const session = await getSession(tabId);
      if (!session) return;
      applyNetworkHeaders(session, details.requestId, names);
      await flushNow();
    })();
  },
  FILTER,
  ['requestHeaders', 'extraHeaders']
);

// Оповещение панели держим здесь, чтобы webrequest.js не зависел от index.js
let notifyFn = () => {};
export function setNotify(fn) {
  notifyFn = fn;
}
function notify(tabId) {
  try {
    notifyFn(tabId);
  } catch (e) {}
}
