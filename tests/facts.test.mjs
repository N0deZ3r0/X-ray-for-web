// Тест свода «Что о вас узнали» — ядро этапа Э4.
//
// Свод — единственное место, где прибор говорит утверждениями, а не
// показаниями. Поэтому здесь проверяется самое жёсткое правило проекта:
//
//   НИ ОДИН ФАКТ НЕ ВЫВОДИТСЯ БЕЗ ССЫЛКИ НА ЗАПИСАННОЕ СОБЫТИЕ.
//
// И запрет на биты энтропии: их не существует без распределения по популяции,
// а прибор стоит на одной машине.
//
// Запуск: node tests/facts.test.mjs

import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = join(tmpdir(), 'xray-facts-tests');
mkdirSync(dir, { recursive: true });
const copy = join(dir, 'facts.mjs');
writeFileSync(copy, readFileSync(new URL('../extension/background/facts.js', import.meta.url)));
const F = await import(pathToFileURL(copy).href);

// ── Сессия, похожая на прогон стенда ────────────────────────────────────────

// По умолчанию событие атрибутировано сайту: без этого факт о сайте не выводится,
// и так и задумано — «источник не определён» это признание незнания, а не улика.
const САЙТ = { scriptUrl: 'https://site.example/app.js', line: 10, column: 3, thirdParty: false };

const surface = (id, surface, group, extra = {}) =>
  Object.assign(
    { id, kind: 'surface', surface, group, count: 1, arg: null, result: null, attribution: САЙТ },
    extra
  );

const session = {
  installedSurfaces: [
    { surface: 'canvas.toDataURL', group: 'canvas' },
    { surface: 'canvas.getImageData', group: 'canvas' },
    { surface: 'canvas.measureText', group: 'canvas' },
    { surface: 'webgl.getParameter', group: 'webgl' },
    { surface: 'webgl.getExtension', group: 'webgl' },
    { surface: 'audio.OfflineAudioContext', group: 'audio' },
    { surface: 'fonts.check', group: 'fonts' },
    { surface: 'navigator.hardwareConcurrency', group: 'device' },
    { surface: 'navigator.platform', group: 'device' },
    { surface: 'intl.resolvedOptions', group: 'device' },
    { surface: 'screen.width', group: 'device' },
    { surface: 'webrtc.RTCPeerConnection', group: 'hardware' },
    // Не отпечаток: в знаменатель попадать не должны
    { surface: 'cookie.write', group: 'storage' },
    { surface: 'shadow.Worker', group: 'shadow' },
    { surface: 'egress.beacon', group: 'egress' },
  ],
  events: [
    surface('0|a', 'webgl.getParameter', 'webgl', {
      arg: 'UNMASKED_RENDERER_WEBGL',
      result: 'ANGLE (Intel, Intel(R) Arc(TM) Graphics)',
    }),
    surface('0|b', 'intl.resolvedOptions', 'device', { result: 'Europe/Moscow' }),
    surface('0|c', 'navigator.hardwareConcurrency', 'device', { result: '18' }),
    surface('0|d', 'canvas.toDataURL', 'canvas', { result: '8090 символов' }),
    surface('0|e', 'fonts.check', 'fonts', { count: 41 }),
    surface('0|f', 'webrtc.RTCPeerConnection', 'hardware'),
    surface('0|g', 'cookie.write', 'storage', { arg: '_ga, живёт 730 дн.' }),
    surface('0|h', 'shadow.Worker', 'shadow', { arg: '/worker.js' }),
    surface('0|k', 'screen.width', 'device', { result: '2008' }),
    surface('0|i', 'screen.height', 'device', { result: '1255' }),
    // Стирание куки: выглядит как постановка, но дата в прошлом
    surface('0|j', 'cookie.write', 'storage', { arg: '_old, до Thu, 01 Jan 1970 00:00:00 GMT' }),
    // Вызовы ЧУЖОГО расширения. Приписать их сайту — ложное обвинение.
    surface('0|ext1', 'localStorage.setItem', 'storage', {
      arg: 'v.ui.f (3 симв.)',
      attribution: { scriptUrl: null, viaExtension: 'fbhbgpmfpcfedkfodhemmlkmedhjjhch' },
    }),
    surface('0|ext2', 'navigator.getHighEntropyValues', 'device', {
      arg: 'platformVersion',
      attribution: { scriptUrl: 'https://site/x.js', line: 1, viaExtension: 'fbhbgpmfpcfedkfodhemmlkmedhjjhch' },
    }),
    {
      id: '0|egress|1',
      kind: 'egress',
      match: 'confirmed',
      url: 'https://www.google-analytics.com/g/collect?v=2',
      parsed: {
        parserId: 'ga4',
        groups: [
          {
            title: 'Параметры адреса',
            fields: [
              { name: 'cid', kind: 'device-id', label: 'Идентификатор вашего браузера', value: '1847362910.1730000000' },
              { name: 'uid', kind: 'user-id', label: 'Ваш идентификатор в системе сайта', value: 'user-42' },
              { name: 'dr', kind: 'referrer', label: 'Откуда вы пришли', value: 'https://example.org/' },
              { name: 'rcb', kind: null, label: null, value: '1' },
            ],
          },
        ],
        knownCount: 3,
        unknownCount: 1,
      },
    },
    // Второй запрос того же вида, но с ПУСТЫМ реферером: он не должен затереть
    // и не должен быть выбран вместо непустого. Найдено на живом стенде.
    {
      id: '0|e3',
      kind: 'egress',
      match: 'confirmed',
      method: 'GET',
      source: 'hook',
      url: 'https://www.facebook.com/tr?id=1&rl=',
      bodyText: null,
      attribution: { scriptUrl: 'https://cdn.example/px.js', line: 2, column: 1 },
      parsed: {
        parserId: 'meta-pixel',
        parserTitle: 'Meta Pixel',
        parserVersion: '2026-09',
        knownCount: 2,
        unknownCount: 0,
        groups: [
          {
            title: 'Параметры адреса',
            fields: [
              { name: 'id', kind: 'site-id', label: 'Пиксель', value: '1' },
              { name: 'rl', kind: 'referrer', label: 'Откуда вы пришли', value: '' },
            ],
          },
        ],
      },
    },
    {
      id: 'net|r9',
      kind: 'egress',
      match: 'network-only',
      url: 'https://www.google-analytics.com/g/collect?en=worker',
      parsed: null,
    },
  ],
};

const свод = F.выводитьФакты(session);
const найти = (id) => свод.facts.find((f) => f.id === id);
const идСобытий = new Set(session.events.map((e) => e.id));

const проверки = [];
const проверить = (имя, ок, факт) => проверки.push([имя, ок, факт]);

// ── ГЛАВНОЕ: факт без доказательства — баг сборки ───────────────────────────
проверить(
  'у каждого факта есть основание',
  свод.facts.every((f) => Array.isArray(f.evidence) && f.evidence.length > 0),
  свод.facts.filter((f) => !f.evidence || !f.evidence.length).map((f) => f.id)
);
проверить(
  'каждое основание ссылается на существующее событие',
  свод.facts.every((f) => f.evidence.every((id) => идСобытий.has(id))),
  свод.facts
    .map((f) => f.evidence.filter((id) => !идСобытий.has(id)))
    .filter((x) => x.length)
);
проверить('на пустой сессии фактов нет', F.выводитьФакты({ events: [] }).facts.length === 0, 'факты появились из ничего');

// ── Значения берутся из наблюдений, а не придумываются ──────────────────────
проверить(
  'модель видеокарты взята из результата вызова',
  найти('gpu') && найти('gpu').value === 'ANGLE (Intel, Intel(R) Arc(TM) Graphics)',
  найти('gpu')
);
проверить('часовой пояс назван', найти('timezone') && найти('timezone').value === 'Europe/Moscow', найти('timezone'));
проверить('число ядер названо', найти('cores') && найти('cores').value === '18', найти('cores'));
проверить(
  'перебор шрифтов посчитан по count и склонён по-русски',
  найти('fonts') && найти('fonts').value === '41 измерение',
  найти('fonts')
);
проверить('запрос локального адреса замечен', Boolean(найти('webrtc')), 'нет факта про WebRTC');
проверить(
  'постановка идентификатора замечена со сроком жизни',
  найти('cookie-id') && найти('cookie-id').value.includes('730'),
  найти('cookie-id')
);

// ── Факты из исходящего опираются на разобранные поля ───────────────────────
const девайс = свод.facts.find((f) => f.id === 'egress:device-id|www.google-analytics.com');
const юзер = свод.facts.find((f) => f.id === 'egress:user-id|www.google-analytics.com');
проверить('идентификатор устройства: получатель назван', девайс && девайс.recipient === 'www.google-analytics.com', девайс);
проверить('идентификатор в системе сайта назван отдельно', Boolean(юзер), 'нет факта про uid');
проверить(
  'неопознанное поле НЕ порождает факта',
  !свод.facts.some((f) => (f.text || '').includes('rcb')),
  'факт выведен из неопознанного поля'
);

// ── Пустое значение не выигрывает у непустого ───────────────────────────────
{
  const реферер = свод.facts.filter((f) => f.id.startsWith('egress:referrer|'));
  проверить(
    'у факта про переход значение не пустое, если хоть где-то оно есть',
    реферер.every((f) => f.value === null || f.value.length > 0),
    реферер.map((f) => [f.id, f.value])
  );
  const gaРеферер = свод.facts.find((f) => f.id === 'egress:referrer|www.google-analytics.com');
  проверить(
    'взято настоящее значение, а не пустое из другого запроса',
    gaРеферер && gaРеферер.value === '[отредактировано]' ? true : Boolean(gaРеферер && gaРеферер.value),
    gaРеферер
  );
}

// ── Обход показан как факт, но без выдуманного виновника ────────────────────
const обход = найти('evasion');
проверить('обход показан фактом', Boolean(обход), 'нет факта про обход');
проверить(
  'у обхода не назван виновник',
  обход && обходБезВиновника(обход),
  обход
);
function обходБезВиновника(f) {
  return f.recipient === null && /не может сказать, кто/.test(f.note || '');
}

// ── Событие с неразобранным стеком не подтверждает факт о сайте ─────────────
{
  const толькоНеизвестные = {
    installedSurfaces: session.installedSurfaces,
    events: [
      {
        id: '0|x',
        kind: 'surface',
        surface: 'localStorage.setItem',
        group: 'storage',
        count: 1,
        arg: 'чужой.ключ',
        result: null,
        attribution: null,
      },
    ],
  };
  проверить(
    'из события «источник не определён» факт о сайте не выводится',
    F.выводитьФакты(толькоНеизвестные).facts.length === 0,
    F.выводитьФакты(толькоНеизвестные).facts.map((f) => f.id)
  );
}

// ── Чужое расширение — не сайт ──────────────────────────────────────────────
проверить(
  'вызовы чужого расширения НЕ приписаны сайту',
  !свод.facts.some(
    (f) => f.id !== 'extensions' && f.evidence.some((id) => id === '0|ext1' || id === '0|ext2')
  ),
  свод.facts.filter((f) => f.evidence.some((id) => String(id).startsWith('0|ext'))).map((f) => f.id)
);
проверить(
  'про чужое расширение сказано отдельным фактом с его идентификатором',
  найти('extensions') && найти('extensions').value.includes('fbhbgpmf'),
  найти('extensions')
);
проверить(
  'факт про модель платформы не появился: его вызывало расширение',
  !найти('ua-hints'),
  найти('ua-hints')
);
проверить(
  'факт про запись в хранилище не появился: писало расширение',
  !найти('storage-id'),
  найти('storage-id')
);

// ── Мелочи, которые ломают доверие к тексту ─────────────────────────────────
проверить(
  'размер экрана назван целиком, а не одной стороной',
  найти('screen') && найти('screen').value === '2008 на 1255',
  найти('screen')
);
проверить(
  'стирание куки не выдано за постановку идентификатора',
  найти('cookie-id') && !найти('cookie-id').evidence.includes('0|j'),
  найти('cookie-id')
);

// ── Счётчик снятого вместо битов энтропии ───────────────────────────────────
проверить(
  'знаменатель считает только поверхности отпечатка',
  свод.coverage.наблюдается === 12,
  свод.coverage
);
проверить(
  'числитель не превышает знаменателя',
  свод.coverage.снято <= свод.coverage.наблюдается,
  свод.coverage
);
проверить(
  'в числитель не попали хранилище, тень и исходящее',
  !свод.coverage.список.some((s) => /^(cookie|localStorage|shadow|egress)\./.test(s)),
  свод.coverage.список
);
проверить(
  'битов энтропии в выводе нет',
  !JSON.stringify(свод).match(/бит|entropy|уникальн/i),
  'найдено упоминание битов или уникальности'
);

// ── Убери событие — исчезнет факт ───────────────────────────────────────────
const безGPU = {
  installedSurfaces: session.installedSurfaces,
  events: session.events.filter((e) => e.id !== '0|a'),
};
проверить(
  'без события про видеокарту факт исчезает',
  !F.выводитьФакты(безGPU).facts.some((f) => f.id === 'gpu'),
  'факт остался без события'
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
