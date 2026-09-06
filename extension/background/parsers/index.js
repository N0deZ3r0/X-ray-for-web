// Реестр разборщиков.
//
// Декларации лежат рядом обычными JSON-файлами и читаются через fetch по
// chrome-extension:// адресу. Это ДАННЫЕ, а не код: запрет MV3 на исполнение
// загруженного кода они не нарушают, и тот же механизм позже примет пакет
// деклараций, обновляемый без релиза движка.

import { создатьРеестр } from './engine.js';

const ФАЙЛЫ = [
  'ga4.json',
  'meta-pixel.json',
  'yandex-metrika.json',
  // Вебвизор идёт ПЕРЕД Метрикой по смыслу, но порядок здесь не важен:
  // пути /watch/ и /webvisor/ не пересекаются.
  'yandex-webvisor.json',
  'meta-pixel-bench.json',
  'yandex-metrika-bench.json',
  'yandex-webvisor-bench.json',
  // Совпадает только с localhost и 127.0.0.1, поэтому на живом сайте
  // сработать не может. Нужна, чтобы стенд проверял разбор теми же полями.
  // Перед релизом в магазин её можно убрать без последствий.
  'ga4-bench.json',
];

let реестр = null;
let загрузка = null;

export function ensureRegistry() {
  if (реестр) return Promise.resolve(реестр);
  if (!загрузка) {
    загрузка = Promise.all(
      ФАЙЛЫ.map((f) =>
        fetch(chrome.runtime.getURL('background/parsers/' + f))
          .then((r) => r.json())
          .catch(() => null)
      )
    ).then((список) => {
      реестр = создатьРеестр(список.filter(Boolean));
      if (реестр.rejected.length) {
        // Отвергнутая декларация — это молчаливая слепота, о ней надо знать
        console.warn('Рентген: декларации отвергнуты', реестр.rejected);
      }
      return реестр;
    });
  }
  return загрузка;
}

// Разобрать те события исходящего, у которых разбора ещё нет.
// Вызывается лениво при обращении панели: реестр читается асинхронно, а
// слушатели service worker обязаны регистрироваться синхронно.
export async function разобратьИсходящее(session) {
  const r = await ensureRegistry();
  let разобрано = 0;

  for (const e of session.events) {
    if (e.kind !== 'egress') continue;
    if (e.parsed !== undefined) continue;

    const тело = e.bodyText || e.netBodyText || null;
    const итог = r.разобрать(e.url, тело);

    // null означает «разборщика на этот адрес нет». Записываем именно null,
    // чтобы не пытаться снова и чтобы в интерфейсе было видно: не «полей нет»,
    // а «формат не опознан».
    e.parsed = итог;
    if (итог) разобрано++;
  }

  return разобрано;
}
