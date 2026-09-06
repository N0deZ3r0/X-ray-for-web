// Целостность пакета расширения.
//
// Самый дешёвый и самый обидный способ сломать прибор — сослаться в манифесте
// или в разметке на файл, которого нет. Ни один из остальных наборов этого не
// поймает: они проверяют логику модулей, а не то, что Chrome сумеет их найти.
// Расплата — «Ошибка загрузки расширения» у постороннего человека, который
// первым делом решит, что дело в нём.
//
// Запуск: node tests/package.test.mjs

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const корень = join(dirname(fileURLToPath(import.meta.url)), '..', 'extension');
const есть = (...ч) => existsSync(join(корень, ...ч));
const читать = (...ч) => readFileSync(join(корень, ...ч), 'utf8');

let провал = 0;
function проверка(имя, ок, факт) {
  console.log((ок ? '  ok      ' : '  ПРОВАЛ  ') + имя + (ок ? '' : '  → ' + JSON.stringify(факт)));
  if (!ок) провал++;
}

const пропавшие = [];
const нужен = (путь, откуда) => {
  if (!есть(путь)) пропавшие.push(путь + ' (' + откуда + ')');
};

console.log('манифест');
let m = null;
try {
  m = JSON.parse(читать('manifest.json'));
  проверка('манифест — строгий JSON', true);
} catch (e) {
  проверка('манифест — строгий JSON', false, String(e.message));
}

if (m) {
  проверка('версия Chrome объявлена', Boolean(m.minimum_chrome_version), m.minimum_chrome_version);
  проверка('язык по умолчанию объявлен', Boolean(m.default_locale), m.default_locale);
  проверка(
    'host_permissions пуст: доступ спрашивается по сайту',
    Array.isArray(m.host_permissions) && m.host_permissions.length === 0,
    m.host_permissions
  );
  проверка(
    'значки объявлены во всех четырёх размерах',
    m.icons && ['16', '32', '48', '128'].every((р) => m.icons[р]),
    m.icons && Object.keys(m.icons)
  );

  нужен(m.background.service_worker, 'manifest.background');
  нужен(m.side_panel.default_path, 'manifest.side_panel');
  for (const [р, п] of Object.entries(m.icons || {})) нужен(п, 'icons.' + р);
  for (const [р, п] of Object.entries((m.action || {}).default_icon || {})) нужен(п, 'action.' + р);
  if (m.default_locale) нужен(join('_locales', m.default_locale, 'messages.json'), 'default_locale');
}
console.log('');

console.log('ссылки');
{
  // Скрипты и стили панели.
  const html = читать('ui', 'panel.html');
  for (const mm of html.matchAll(/(?:src|href)="([^"]+)"/g)) нужен(join('ui', mm[1]), 'panel.html');

  // Содержимые скрипты, которые регистрирует worker.
  const idx = читать('background', 'index.js');
  for (const mm of idx.matchAll(/js:\s*\[\s*'([^']+)'/g)) нужен(mm[1], 'registerContentScripts');

  // Декларации из реестра разборщиков: реестр читает их по имени во время
  // работы и молча пропускает ненайденное — то есть слепнет без единого слова.
  const реестр = читать('background', 'parsers', 'index.js');
  const начало = реестр.indexOf('const ФАЙЛЫ');
  const список = реестр.slice(начало, реестр.indexOf('];', начало));
  const объявлено = [...список.matchAll(/'([^']+\.json)'/g)].map((x) => x[1]);
  for (const имя of объявлено) нужен(join('background', 'parsers', имя), 'реестр разборщиков');

  проверка('всё, на что ссылаются, существует', пропавшие.length === 0, пропавшие);
  проверка('реестр не пуст', объявлено.length > 0, объявлено.length);
}
console.log('');

console.log('чего в пакете быть не должно');
{
  // Отладочный стапель стенда отдаёт файлы расширения по /__ext/. В самом
  // расширении этого пути нет и быть не может — проверяем, что не просочился.
  const модули = ['ui/panel.js', 'background/index.js', 'instrument/main.js', 'collector/isolated.js'];
  const следы = модули.filter((f) => читать(...f.split('/')).includes('/__ext/'));
  проверка('отладочного стапеля в расширении нет', следы.length === 0, следы);

  // Обещание README: расширение не ходит в сеть. Единственное исключение —
  // чтение собственных деклараций по chrome-extension://.
  const сеть = [];
  for (const f of ['ui/panel.js', 'background/index.js', 'background/session.js', 'background/facts.js', 'background/export.js', 'background/webrequest.js']) {
    const s = читать(...f.split('/'));
    if (/\bfetch\(|XMLHttpRequest|sendBeacon|new WebSocket|EventSource/.test(s)) сеть.push(f);
  }
  проверка('ни один модуль, кроме реестра, не ходит в сеть', сеть.length === 0, сеть);

  const реестр = читать('background', 'parsers', 'index.js');
  проверка(
    'реестр читает только собственные файлы',
    /fetch\(chrome\.runtime\.getURL\(/.test(реестр),
    'fetch не через chrome.runtime.getURL'
  );
}
console.log('');

console.log(провал ? провал + ' проверок провалено' : 'все проверки пакета пройдены');
process.exit(провал ? 1 : 0);
