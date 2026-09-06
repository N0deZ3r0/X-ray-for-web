// Тест разборщиков — ядро этапа Э3.
//
// Главная проверка здесь не «известные поля разобраны», а «НЕИЗВЕСТНОЕ
// ПОКАЗАНО НЕИЗВЕСТНЫМ». Разборщик, который молча выкидывает незнакомое поле,
// выдаёт правдоподобную неправду, и это хуже, чем отсутствие разбора: схема
// GA4 меняется быстрее, чем расширение проходит ревью в магазине.
//
// Запуск: node tests/parsers.test.mjs

import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = join(tmpdir(), 'xray-parser-tests');
mkdirSync(dir, { recursive: true });
const copy = join(dir, 'engine.mjs');
writeFileSync(copy, readFileSync(new URL('../extension/background/parsers/engine.js', import.meta.url)));
const E = await import(pathToFileURL(copy).href);

const ga4 = JSON.parse(
  readFileSync(new URL('../extension/background/parsers/ga4.json', import.meta.url), 'utf8')
);
const bench = JSON.parse(
  readFileSync(new URL('../extension/background/parsers/ga4-bench.json', import.meta.url), 'utf8')
);

const meta = JSON.parse(
  readFileSync(new URL('../extension/background/parsers/meta-pixel.json', import.meta.url), 'utf8')
);
const metrika = JSON.parse(
  readFileSync(new URL('../extension/background/parsers/yandex-metrika.json', import.meta.url), 'utf8')
);
const webvisor = JSON.parse(
  readFileSync(new URL('../extension/background/parsers/yandex-webvisor.json', import.meta.url), 'utf8')
);

const реестр = E.создатьРеестр([ga4, meta, metrika, webvisor, bench]);

// ── Золотые образцы ─────────────────────────────────────────────────────────
// Форма взята с настоящего GA4. Поле _bench_unknown_field добавлено намеренно:
// его нет ни в словаре, ни в шаблонах, и разборщик обязан на нём споткнуться
// вслух.

const образецGET =
  'https://www.google-analytics.com/g/collect?v=2&tid=G-ABC123DEF4&gtm=45je4bench' +
  '&_p=1788614978190&cid=1847362910.1730000000&ul=ru-ru&sr=2560x1440&uid=user-42' +
  '&sid=1730000000&sct=3&seg=1&dl=https%3A%2F%2Fexample.org%2Fnews&dr=https%3A%2F%2Fyandex.ru%2F' +
  '&dt=%D0%9D%D0%BE%D0%B2%D0%BE%D1%81%D1%82%D0%B8&en=page_view&_et=4213' +
  '&ep.section=news&up.plan=pro&_bench_unknown_field=%D0%BF%D1%80%D0%BE%D0%B2%D0%B5%D1%80%D0%BA%D0%B0';

const пачкаPOST = [
  'v=2&tid=G-ABC123DEF4&cid=1847362910.1730000000&en=scroll&ep.depth=25',
  'v=2&tid=G-ABC123DEF4&cid=1847362910.1730000000&en=click&ep.target=button',
  'v=2&tid=G-ABC123DEF4&cid=1847362910.1730000000&en=user_engagement&_et=3100',
].join('\r\n');

const проверки = [];
const проверить = (имя, ок, факт) => проверки.push([имя, ок, факт]);

// ── Сопоставление адреса ────────────────────────────────────────────────────
проверить('www.google-analytics.com совпадает', E.подходит(ga4, образецGET), true);
проверить(
  'region1.google-analytics.com совпадает',
  E.подходит(ga4, 'https://region1.google-analytics.com/g/collect?v=2'),
  true
);
проверить(
  'analytics.google.com совпадает',
  E.подходит(ga4, 'https://analytics.google.com/g/collect?v=2'),
  true
);
// Подделка под домен не должна проходить: иначе прибор назовёт чужой сайт Google
проверить(
  'evilgoogle-analytics.com НЕ совпадает',
  !E.подходит(ga4, 'https://evilgoogle-analytics.com/g/collect?v=2'),
  'совпал, чего быть не должно'
);
проверить(
  'google-analytics.com.evil.net НЕ совпадает',
  !E.подходит(ga4, 'https://google-analytics.com.evil.net/g/collect?v=2'),
  'совпал, чего быть не должно'
);
проверить(
  'другой путь на том же хосте НЕ совпадает',
  !E.подходит(ga4, 'https://www.google-analytics.com/analytics.js'),
  'совпал, чего быть не должно'
);

// ── Разбор GET ──────────────────────────────────────────────────────────────
const r1 = реестр.разобрать(образецGET, null);
const поля1 = r1 ? r1.groups.flatMap((g) => g.fields) : [];
const найти = (список, имя) => список.find((f) => f.name === имя);

проверить('разборщик выбран', r1 && r1.parserId === 'ga4', r1 && r1.parserId);
проверить('версия схемы показана', Boolean(r1 && r1.parserVersion), r1 && r1.parserVersion);

проверить(
  'cid назван идентификатором браузера',
  найти(поля1, 'cid').label === 'Идентификатор вашего браузера',
  найти(поля1, 'cid')
);
проверить(
  'cid снабжён пояснением про два года',
  (найти(поля1, 'cid').note || '').includes('два года'),
  найти(поля1, 'cid').note
);
проверить(
  'uid назван связкой с учётной записью',
  найти(поля1, 'uid').kind === 'user-id',
  найти(поля1, 'uid')
);
проверить(
  'dl раскодирован в читаемый адрес',
  найти(поля1, 'dl').value === 'https://example.org/news',
  найти(поля1, 'dl').value
);
проверить(
  'dt раскодирован из процентов в текст',
  найти(поля1, 'dt').value === 'Новости',
  найти(поля1, 'dt').value
);
проверить(
  'ep.section опознан шаблоном',
  найти(поля1, 'ep.section').label === 'Параметр события',
  найти(поля1, 'ep.section')
);
проверить(
  'up.plan опознан шаблоном',
  найти(поля1, 'up.plan').kind === 'user-property',
  найти(поля1, 'up.plan')
);

// ── ГЛАВНАЯ ПРОВЕРКА: неизвестное показано неизвестным ──────────────────────
const неизвестное = найти(поля1, '_bench_unknown_field');
проверить('неизвестное поле НЕ выброшено', Boolean(неизвестное), 'поля нет в выводе');
проверить(
  'у неизвестного поля нет ярлыка',
  неизвестное && неизвестное.label === null,
  неизвестное && неизвестное.label
);
проверить(
  'сырое значение неизвестного поля сохранено',
  неизвестное && неизвестное.value === 'проверка',
  неизвестное && неизвестное.value
);
проверить('счётчик неопознанного вырос', r1.unknownCount === 1, r1.unknownCount);
проверить(
  'доля разобранных полей не ниже 90%',
  r1.knownCount / (r1.knownCount + r1.unknownCount) >= 0.9,
  (r1.knownCount / (r1.knownCount + r1.unknownCount)).toFixed(3)
);

// ── Разбор пачки ────────────────────────────────────────────────────────────
const r2 = реестр.разобрать('https://www.google-analytics.com/g/collect?v=2&tid=G-ABC123DEF4', пачкаPOST);
const событий = r2 ? r2.groups.filter((g) => g.title.startsWith('Событие')).length : 0;
проверить('пачка разобрана на три события, а не одно', событий === 3, событий);
проверить(
  'у каждого события своё название',
  r2 &&
    ['scroll', 'click', 'user_engagement'].every((n) =>
      r2.groups.some((g) => g.fields.some((f) => f.name === 'en' && f.value === n))
    ),
  'названия не сошлись'
);

// ── Проверка деклараций ─────────────────────────────────────────────────────
проверить('годная декларация принята', E.проверить(ga4).length === 0, E.проверить(ga4));
проверить(
  'декларация без unknown:preserve отвергнута',
  E.проверить({ ...ga4, unknown: 'drop' }).some((b) => b.includes('preserve')),
  'не отвергнута'
);
проверить(
  'поле с confidence guess отвергнуто',
  E.проверить({ ...ga4, fields: { x: { label: 'а', confidence: 'guess' } } }).some((b) =>
    b.includes('guess')
  ),
  'не отвергнуто'
);
проверить(
  'декларация без id отвергнута',
  E.проверить({ ...ga4, id: undefined }).some((b) => b.includes('id')),
  'не отвергнута'
);

// ── Декларация-стенд не может сработать на живом сайте ──────────────────────
проверить(
  'стендовая декларация совпадает с localhost',
  E.подходит(bench, 'http://localhost:8081/g/collect?v=2'),
  false
);
проверить(
  'стендовая декларация НЕ совпадает с чужим сайтом',
  !E.подходит(bench, 'https://example.org/g/collect?v=2'),
  'совпала, чего быть не должно'
);

// ── Нет разборщика — так и говорим ──────────────────────────────────────────
проверить(
  'на незнакомый адрес разбора нет',
  реестр.разобрать('https://example.org/track?a=1', null) === null,
  'что-то разобралось'
);

// ── Meta Pixel ──────────────────────────────────────────────────────────────
// Ради этого разбора всё и затевалось: «в Meta ушёл хеш вашей почты» — самый
// сильный факт, какой прибор может показать обычному человеку.
{
  const пиксель =
    'https://www.facebook.com/tr?id=1234567890&ev=Purchase&dl=https%3A%2F%2Fshop.example%2Fcart' +
    '&rl=https%3A%2F%2Fyandex.ru%2F&ts=1788700000000&sw=2560&sh=1440' +
    '&ud%5Bem%5D=5d41402abc4b2a76b9719d911017c592' +
    '&ud%5Bph%5D=7d793037a0760186574b0282f2f435e7' +
    '&ud%5Bexternal_id%5D=user-42' +
    '&ud%5Bzp%5D=aaaa1111' +
    '&ud%5Bнеизвестное%5D=bbbb2222' +
    '&cd%5Bvalue%5D=4990&cd%5Bcurrency%5D=RUB&неведомое=1';

  const r = реестр.разобрать(пиксель, null);
  const поля = r ? r.groups.flatMap((g) => g.fields) : [];
  const f = (имя) => поля.find((x) => x.name === имя);

  проверить('Meta: разборщик выбран', r && r.parserId === 'meta-pixel', r && r.parserId);
  проверить(
    'Meta: хеш почты назван словами',
    f('ud[em]') && f('ud[em]').kind === 'email-hash' && /почты/.test(f('ud[em]').label),
    f('ud[em]')
  );
  проверить(
    'Meta: у хеша почты сказано, чем он опасен',
    /одинаков на всех сайтах/.test((f('ud[em]') || {}).note || ''),
    (f('ud[em]') || {}).note
  );
  проверить('Meta: хеш телефона назван', f('ud[ph]') && f('ud[ph]').kind === 'phone-hash', f('ud[ph]'));
  проверить(
    'Meta: идентификатор в системе сайта назван',
    f('ud[external_id]') && f('ud[external_id]').kind === 'user-id',
    f('ud[external_id]')
  );
  проверить('Meta: событие названо', f('ev') && f('ev').value === 'Purchase', f('ev'));
  проверить(
    'Meta: данные события опознаны шаблоном',
    f('cd[value]') && f('cd[value]').kind === 'event-param',
    f('cd[value]')
  );
  // Любое поле группы ud[] — это данные о человеке, даже если конкретное
  // назначение неизвестно. Назвать его так — не догадка, а обобщение.
  проверить(
    'Meta: незнакомое поле ud[] помечено личными данными, а не выброшено',
    f('ud[неизвестное]') && f('ud[неизвестное]').kind === 'personal-hash',
    f('ud[неизвестное]')
  );
  проверить(
    'Meta: у него оговорено, что точное назначение не установлено',
    /не установлено/.test((f('ud[неизвестное]') || {}).note || ''),
    'оговорки нет'
  );
  проверить('Meta: постороннее поле не опознано', f('неведомое') && f('неведомое').label === null, f('неведомое'));
  проверить(
    'Meta: подделка под домен не проходит',
    !E.подходит(meta, 'https://notfacebook.com/tr?id=1'),
    'совпало'
  );
}

// ── Яндекс.Метрика ──────────────────────────────────────────────────────────
{
  const адрес =
    'https://mc.yandex.ru/watch/12345678?page-url=https%3A%2F%2Fshop.example%2F' +
    '&page-ref=https%3A%2F%2Fya.ru%2F&charset=utf-8&rn=555' +
    '&browser-info=pv%3A1%3Au%3A1730000000123456789%3Aar%3A1%3As%3A2008x1255x24' +
    '%3Aw%3A1280x800%3Az%3A180%3Ala%3Aru%3Ac%3A1%3Aet%3A1788700000%3Azzz%3A9';

  const r = реестр.разобрать(адрес, null);
  const поля = r ? r.groups.flatMap((g) => g.fields) : [];
  const f = (имя) => поля.find((x) => x.name === имя);

  проверить('Метрика: разборщик выбран', r && r.parserId === 'yandex-metrika', r && r.parserId);
  проверить(
    'Метрика: номер счётчика взят ИЗ ПУТИ адреса',
    f('counter') && f('counter').value === '12345678' && f('counter').kind === 'site-id',
    f('counter')
  );
  проверить(
    'Метрика: browser-info распакован',
    r && r.groups.some((g) => /browser-info/.test(g.title)),
    r && r.groups.map((g) => g.title)
  );
  проверить(
    'Метрика: идентификатор браузера найден внутри упаковки',
    f('u') && f('u').kind === 'device-id' && f('u').value === '1730000000123456789',
    f('u')
  );
  проверить('Метрика: экран найден внутри упаковки', f('s') && f('s').kind === 'screen', f('s'));
  проверить('Метрика: часовой пояс найден', f('z') && f('z').kind === 'timezone', f('z'));
  проверить(
    'Метрика: незнакомое поле внутри упаковки не опознано',
    f('zzz') && f('zzz').label === null,
    f('zzz')
  );
}

// ── Рассинхронизация упаковки не даёт сдвинутых подписей ────────────────────
{
  // В значении встретилось двоеточие: дальше пары поедут, и подписи окажутся
  // сдвинуты на одно поле. Это правдоподобная неправда, и она хуже молчания.
  const кривой =
    'https://mc.yandex.ru/watch/999?browser-info=u%3A123%3Aочень_длинный_ключ%3Aa%3Ab%3Ac';
  const r = реестр.разобрать(кривой, null);
  const поля = r ? r.groups.flatMap((g) => g.fields) : [];
  const остаток = поля.find((x) => x.name === 'browser-info:остаток');
  проверить(
    'Метрика: до сбоя поля разобраны',
    поля.some((x) => x.name === 'u' && x.value === '123'),
    поля.map((x) => x.name)
  );
  проверить('Метрика: остаток после сбоя отдан целиком', Boolean(остаток), 'остатка нет');
  проверить(
    'Метрика: остаток помечен неопознанным, а не подписан наугад',
    остаток && остаток.label === null,
    остаток
  );
}

// ── Вебвизор — отдельный разборщик, а не разновидность аналитики ────────────
{
  const r = реестр.разобрать('https://mc.yandex.ru/webvisor/12345678?rn=1&wv-part=2', null);
  проверить('Вебвизор: свой разборщик', r && r.parserId === 'yandex-webvisor', r && r.parserId);
  проверить(
    'Вебвизор: в названии сказано, что это запись действий',
    r && /запись действий/i.test(r.parserTitle),
    r && r.parserTitle
  );
  проверить(
    'Вебвизор не путается с Метрикой: пути не пересекаются',
    !E.подходит(metrika, 'https://mc.yandex.ru/webvisor/1') &&
      !E.подходит(webvisor, 'https://mc.yandex.ru/watch/1'),
    'пересеклись'
  );
}

// ── Все декларации годны ────────────────────────────────────────────────────
проверить(
  'все декларации приняты движком',
  реестр.rejected.length === 0,
  реестр.rejected
);

// ── Итог ────────────────────────────────────────────────────────────────────
let провал = 0;
for (const [имя, ок, факт] of проверки) {
  console.log((ок ? '  ok      ' : '  ПРОВАЛ  ') + имя + (ок ? '' : '  → ' + JSON.stringify(факт)));
  if (!ок) провал++;
}
console.log('');
console.log(провал ? провал + ' проверок провалено' : 'все ' + проверки.length + ' проверок пройдены');
rmSync(dir, { recursive: true, force: true });
process.exit(провал ? 1 : 0);
