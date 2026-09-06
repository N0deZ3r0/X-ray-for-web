// ISOLATED world. Единственная задача — вынести наблюдения из страницы в
// service worker и посчитать, сколько по дороге потерялось.
//
// Здесь нельзя доверять содержимому: канал виден странице, и она может слать в
// него что угодно (предел 2 из 06-limits.md). Поэтому сборщик ничего не
// интерпретирует — он только переносит, а метку доверия ставит service worker.

(() => {
  'use strict';

  const CHANNEL = '__xray_v1';
  const READY = '__xray_v1_ready';
  const ARM_MS = 500;

  let gaps = 0; // события, не дошедшие до service worker
  let sent = 0;
  let replacements = 0; // сколько раз документ подменяли через document.open

  function deliver(payload) {
    // sendMessage будит уснувший service worker. Промах здесь — это потеря
    // данных, и она обязана быть посчитана, а не проглочена.
    try {
      chrome.runtime.sendMessage(payload).catch(() => {
        gaps++;
      });
    } catch (e) {
      gaps++;
    }
  }

  function onChannel(e) {
    let payload;
    try {
      payload = JSON.parse(e.detail);
    } catch (err) {
      // Мусор в канале: либо страница шутит, либо мы сломались.
      gaps++;
      return;
    }
    if (!payload || !Array.isArray(payload.records)) {
      gaps++;
      return;
    }

    sent += payload.records.length;
    deliver({
      type: 'xray:records',
      records: payload.records,
      health: payload.health || null,
      pageUrl: payload.url || location.href,
      bridge: { sent, gaps, replacements },
    });
  }

  // document.open() сносит слушатели и с документа, и с window — проверено на
  // стенде. Поэтому слушатель перевзводится по таймеру: повторная установка той
  // же функции ничего не стоит, если она уже стоит.
  //
  // Подмену документа ловим по смене documentElement: после open() и write()
  // это уже другой узел. Тогда просим инструмент переслать журнал заново —
  // иначе всё, что он выкинул в мёртвый канал, потерялось бы молча.
  let lastRoot = document.documentElement;

  function arm() {
    window.addEventListener(CHANNEL, onChannel, true);

    const root = document.documentElement;
    if (root !== lastRoot) {
      lastRoot = root;
      replacements++;
      try {
        window.dispatchEvent(new CustomEvent(READY));
      } catch (e) {}
    }
  }

  setInterval(arm, ARM_MS);
  arm();

  // Сообщаем инструменту, что приёмник встал: порядок внедрения MAIN и
  // ISOLATED не гарантирован, и первый залп мог уйти в пустоту.
  try {
    window.dispatchEvent(new CustomEvent(READY));
  } catch (e) {}
})();
