// Тест перевода.
//
// Двуязычность ломается тихо. Забытый ключ не падает — он показывает «[ключ]»
// или пустоту, и увидит это только тот, у кого браузер на другом языке, то есть
// не автор. Поэтому здесь проверяется не «перевод красивый», а «перевод
// полный»: каждый ключ, который зовут из кода, существует; каждый ключ, который
// лежит в источнике, кем-то зовётся; обе локали собраны из одного источника и
// совпадают с тем, что лежит в репозитории.
//
// Отдельно проверяются декларации разборщиков. Они данные, и текст в них свой:
// декларация с одним языком показала бы русскую метку английскому читателю.
//
// Запуск: node tests/i18n.test.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { СТРОКИ, проверитьПодстановки } from '../tools/messages.mjs';

const корень = join(dirname(fileURLToPath(import.meta.url)), '..');
const чтение = (...ч) => readFileSync(join(корень, ...ч), 'utf8');

let провал = 0;
function проверка(имя, ок, факт) {
  console.log((ок ? '  ok      ' : '  ПРОВАЛ  ') + имя + (ок ? '' : '  → ' + JSON.stringify(факт)));
  if (!ок) провал++;
}

// ── Источник согласован сам с собой ─────────────────────────────────────────

console.log('источник строк');
{
  const беды = проверитьПодстановки();
  проверка('подстановки и формы совпадают в обоих языках', беды.length === 0, беды);

  const пустые = Object.entries(СТРОКИ).filter(([, [ru, en]]) => !ru || !en);
  проверка('нет пустых переводов', пустые.length === 0, пустые.map((p) => p[0]));

  // Одинаковый текст в обоих языках допустим только для имён собственных.
  const ИМЕНА = new Set(['ext_name']);
  const одинаковые = Object.entries(СТРОКИ)
    .filter(([к, [ru, en]]) => ru === en && !ИМЕНА.has(к))
    .map(([к]) => к);
  проверка('нет строк, забытых непереведёнными', одинаковые.length === 0, одинаковые);
}
console.log('');

// ── Локали собраны из источника ─────────────────────────────────────────────

console.log('файлы локалей');
{
  const ключи = Object.keys(СТРОКИ);
  for (const [язык, индекс] of [
    ['ru', 0],
    ['en', 1],
  ]) {
    let json = null;
    try {
      json = JSON.parse(чтение('extension', '_locales', язык, 'messages.json'));
    } catch (e) {
      проверка('локаль ' + язык + ' читается', false, String(e.message));
      continue;
    }

    const свои = Object.keys(json);
    проверка(
      'локаль ' + язык + ': тот же набор ключей, что в источнике',
      свои.length === ключи.length && ключи.every((к) => к in json),
      { источник: ключи.length, файл: свои.length }
    );

    const расхождения = ключи.filter((к) => json[к] && json[к].message !== СТРОКИ[к][индекс]);
    проверка(
      'локаль ' + язык + ': файл совпадает с источником — node tools/messages.mjs не забыт',
      расхождения.length === 0,
      расхождения.slice(0, 5)
    );
  }

  // Chrome не принимает дефисы в именах сообщений.
  const плохиеИмена = Object.keys(СТРОКИ).filter((к) => !/^[A-Za-z0-9_@]+$/.test(к));
  проверка('имена сообщений годятся для chrome.i18n', плохиеИмена.length === 0, плохиеИмена);
}
console.log('');

// ── Код и источник не разошлись ─────────────────────────────────────────────

console.log('код против источника');
{
  const файлы = [
    ['extension', 'ui', 'panel.js'],
    ['extension', 'ui', 'panel.html'],
    ['extension', 'background', 'facts.js'],
    ['extension', 'background', 'export.js'],
    ['extension', 'background', 'index.js'],
    ['extension', 'manifest.json'],
  ];
  const тексты = файлы.map((ф) => чтение(...ф));
  const всё = тексты.join('\n');

  // Вызовы t('ключ') и скл(n, 'ключ'), атрибуты data-i18n, __MSG_ключ__.
  const зовут = new Set();
  // Закрывающая скобка или запятая сразу за кавычкой обязательны: иначе сюда
  // попадёт приставка из t('sgroup_' + группа), которая ключом не является.
  for (const m of всё.matchAll(/\bt\(\s*'([a-z0-9_]+)'\s*[,)]/g)) зовут.add(m[1]);
  for (const m of всё.matchAll(/скл\([^,]+,\s*'([a-z0-9_]+)'/g)) зовут.add(m[1]);
  for (const m of всё.matchAll(/data-i18n(?:-html)?="([a-z0-9_]+)"/g)) зовут.add(m[1]);
  for (const m of всё.matchAll(/__MSG_([a-zA-Z0-9_]+)__/g)) зовут.add(m[1]);

  // Ключи, собираемые из кусков: 'sgroup_' + группа, 'group_…' от движка.
  const СОБИРАЕМЫЕ = [
    /^sgroup_/,
    /^group_(path|query|body|body_event)$/,
    /^det_/,
    /^frame_/,
    /^plural_/,
    /^ext_name$/,
  ];

  const нетВИсточнике = [...зовут].filter((к) => !(к in СТРОКИ));
  проверка('каждый ключ из кода есть в источнике', нетВИсточнике.length === 0, нетВИсточнике);

  const неЗовут = Object.keys(СТРОКИ).filter(
    (к) => !зовут.has(к) && !СОБИРАЕМЫЕ.some((r) => r.test(к))
  );
  проверка('в источнике нет строк, которые никто не показывает', неЗовут.length === 0, неЗовут);
}
console.log('');

// ── Декларации разборщиков ──────────────────────────────────────────────────

console.log('декларации');
{
  const каталог = join(корень, 'extension', 'background', 'parsers');
  const файлы = readdirSync(каталог).filter((f) => f.endsWith('.json'));
  const односторонние = [];
  const ключиТекста = new Set(['label', 'note', 'title']);

  const обойти = (o, файл, путь) => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) return o.forEach((x, i) => обойти(x, файл, путь + '[' + i + ']'));
    for (const [k, v] of Object.entries(o)) {
      const где = путь + '.' + k;
      if (ключиТекста.has(k)) {
        if (typeof v === 'string' || !v || !v.ru || !v.en) односторонние.push(файл + где);
        continue;
      }
      обойти(v, файл, где);
    }
  };

  for (const f of файлы) обойти(JSON.parse(чтение('extension', 'background', 'parsers', f)), f, '');

  проверка(
    'каждая метка и примечание даны на обоих языках',
    односторонние.length === 0,
    односторонние.slice(0, 8)
  );

  // Двойники стенда обязаны наследоваться, а не копироваться: расхождение
  // копий уже однажды описано в 05-parsers.md как заведённая на будущее ошибка.
  const двойники = файлы.filter((f) => f.endsWith('-bench.json'));
  const копии = двойники.filter((f) => {
    const j = JSON.parse(чтение('extension', 'background', 'parsers', f));
    return !j.extends || j.fields;
  });
  проверка('двойники стенда наследуют, а не копируют', копии.length === 0, копии);
}
console.log('');

// ── Английский действительно доходит до вывода ──────────────────────────────
//
// Всё выше проверяет файлы. Здесь проверяется цепочка целиком: язык браузера →
// chrome.i18n → свод. Без этого можно иметь безупречные локали и всё равно
// показывать русский всем подряд.

console.log('английский на живом своде');
{
  const { загрузить, поставитьI18n } = await import('./lib/zagruzka.mjs');
  await поставитьI18n('en');
  const { модуль: F, убрать } = await загрузить('i18n-en', [
    'extension/background/facts.js',
    'extension/background/i18n.js',
  ]);

  const САЙТ = { scriptUrl: 'https://site.example/app.js', line: 1, column: 1, thirdParty: false };
  const session = {
    installedSurfaces: [{ surface: 'intl.resolvedOptions', group: 'device' }],
    events: [
      {
        id: 'e1',
        kind: 'surface',
        surface: 'intl.resolvedOptions',
        group: 'device',
        count: 1,
        result: 'Europe/Moscow',
        attribution: САЙТ,
      },
    ],
    health: {},
  };

  const свод = F.выводитьФакты(session);
  const факт = свод.facts.find((f) => f.id === 'timezone');

  проверка('факт выведен', Boolean(факт), свод.facts.map((f) => f.id));
  проверка(
    'текст факта на английском, а не по-русски',
    Boolean(факт) && факт.text === 'The site learned your time zone',
    факт && факт.text
  );
  проверка(
    'ключ не просочился в текст вместо перевода',
    Boolean(факт) && !/^\[/.test(факт.text),
    факт && факт.text
  );

  убрать();
}
console.log('');

console.log(провал ? провал + ' проверок провалено' : 'все проверки перевода пройдены');
process.exit(провал ? 1 : 0);
