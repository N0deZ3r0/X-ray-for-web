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

console.log('остановка записи');
{
  // Проверка по исходнику, а не по поведению: поднять здесь chrome.scripting
  // целиком дороже, чем стоит, а инвариант простой и легко нарушается обратно.
  //
  // registerContentScripts регистрирует скрипты по ШАБЛОНУ АДРЕСА, а не по
  // вкладке. Учёт «записываем вкладку N» — бухгалтерия поверх глобального
  // действия. Пока остановка снимала только скрипты своей вкладки, она молча
  // не делала ничего, если панель смотрела на другую вкладку, — а панель при
  // этом показывала «Записать этот сайт». Прибор утверждал, что не наблюдает,
  // продолжая наблюдать. Найдено на живом замере.
  const idx = читать('background', 'index.js');
  const начало = idx.indexOf('async function stopRecording');
  const тело = idx.slice(начало, idx.indexOf(String.fromCharCode(10) + String.fromCharCode(125), начало));
  проверка(
    'остановка снимает регистрации по префиксу, а не по вкладке',
    начало > 0 && /startsWith\(SCRIPT_PREFIX\)/.test(тело),
    начало > 0 ? 'снимает не по префиксу' : 'stopRecording не найден'
  );
  проверка(
    'остановка не опирается на запись этой вкладки при снятии',
    начало > 0 && !/recording\[tabId\]/.test(тело),
    'смотрит recording[tabId]'
  );
  проверка(
    'состояние записи обнуляется целиком',
    начало > 0 && /setRecording\(\{\}\)/.test(тело),
    'recording очищается не полностью'
  );
}
console.log('');

console.log('реестр поверхностей');
{
  // Инструмент шлёт два параллельных списка: имена поверхностей и их группы.
  // Знаменатель свода собирается их попарным сопоставлением, поэтому длины
  // обязаны совпадать, а записи — соответствовать друг другу.
  //
  // Шесть обёрток исходящего когда-то писали только в installed. Списки
  // разъезжались на шесть позиций, и каждая поверхность получала группу
  // соседа: egress.beacon числился холстом. Видимое число совпало случайно —
  // егресс не входит в отпечаток ни при каком сдвиге, — но данные под ним были
  // неверны, и любая будущая работа по группе сломалась бы молча.
  const src = читать('instrument', 'main.js');
  const пишетИмена = (src.match(/installed\.push\(/g) || []).length;
  const пишетГруппы = (src.match(/installedGroups\.push\(/g) || []).length;
  проверка(
    'имена и группы поверхностей пишутся из одних и тех же мест',
    пишетИмена === пишетГруппы && пишетИмена > 0,
    { имена: пишетИмена, группы: пишетГруппы }
  );
  проверка(
    'обёртки исходящего отмечаются общим помощником, а не напрямую',
    /function отмечен\(/.test(src) && (src.match(/отмечен\(/g) || []).length >= 6,
    (src.match(/отмечен\(/g) || []).length
  );
}
console.log('');

console.log('сборка релиза');
{
  // tools/pack.mjs кладёт в zip ровно расширение. Он падает на файле незнакомого
  // вида — это охрана от того, чтобы в релиз уехало лишнее. Проверяем здесь же,
  // чтобы узнать об этом при обычном прогоне, а не при выпуске тега.
  const { собратьФайлы, собратьZip } = await import('../tools/pack.mjs');

  let файлы = null;
  try {
    файлы = собратьФайлы();
    проверка('обход дерева расширения не спотыкается', true);
  } catch (e) {
    проверка('обход дерева расширения не спотыкается', false, String(e.message));
  }

  if (файлы) {
    const пути = файлы.map((f) => f.путь);
    проверка(
      'в пакет попадает манифест, worker и панель',
      ['manifest.json', 'background/index.js', 'ui/panel.html'].every((п) => пути.includes(п)),
      пути.length
    );
    проверка(
      'README расширения в пакет не попадает',
      !пути.some((п) => п.endsWith('.md')),
      пути.filter((п) => п.endsWith('.md'))
    );
    проверка('обе локали попадают в пакет', пути.includes('_locales/ru/messages.json') && пути.includes('_locales/en/messages.json'), пути.filter((п) => п.startsWith('_locales')));

    const архив = собратьZip(файлы);
    проверка('архив начинается сигнатурой ZIP', архив.slice(0, 4).toString('hex') === '504b0304', архив.slice(0, 4).toString('hex'));
    проверка('в архиве есть конец центрального каталога', архив.includes(Buffer.from([0x50, 0x4b, 0x05, 0x06])), 'нет EOCD');
    // Дважды собранный из одних файлов архив обязан совпасть побайтово, иначе
    // «тот же ли это пакет» проверить нечем.
    проверка('сборка воспроизводима', собратьZip(файлы).equals(архив), 'два прогона дали разное');
  }
}
console.log('');

console.log(провал ? провал + ' проверок провалено' : 'все проверки пакета пройдены');
process.exit(провал ? 1 : 0);
