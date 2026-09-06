// Тест боковой панели.
//
// Панель — единственная часть прибора, которую человек видит. И при этом до сих
// пор она была единственной непокрытой: ошибку в ней не поймал бы ни один из
// остальных наборов, а увидел бы сразу пользователь.
//
// Проверяется то, что легко сломать незаметно:
//   — журнал рисуется, и число строк совпадает с числом наблюдений;
//   — фильтр НИЧЕГО не прячет молча: пока он включён, висит «показано N из M»;
//   — «Записать» второй раз не стирает журнал без предупреждения;
//   — при неизменившемся журнале панель не перерисовывается вовсе.
//
// Настоящего браузера здесь нет: DOM в tests/lib/dom.mjs — ровно тот кусок,
// который панель трогает. Всё, что она попросит сверх него, падает с внятным
// сообщением, а не молчит.
//
// Запуск: node tests/panel.test.mjs

import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { создатьDOM } from './lib/dom.mjs';

const корень = new URL('../extension/ui/', import.meta.url);
const html = readFileSync(new URL('panel.html', корень), 'utf8');
const код = readFileSync(new URL('panel.js', корень), 'utf8');

// Идентификаторы берём из настоящей разметки: если панель попросит элемент,
// которого в panel.html нет, тест упадёт — а в браузере это была бы тихая
// поломка всей панели на первой же строке.
const идентификаторы = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);

// ── Данные, по форме совпадающие с настоящими ───────────────────────────────

const САЙТ = { scriptUrl: 'https://site.example/app.js', line: 10, column: 3, thirdParty: false };
const ТРЕТИЙ = { scriptUrl: 'https://ads.example/t.js', line: 1, column: 1, thirdParty: true };
const ЧУЖОЕ_РАСШИРЕНИЕ = {
  scriptUrl: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/x.js',
  line: 1,
  column: 1,
  thirdParty: false,
  viaExtension: 'abcdefghijklmnopabcdefghijklmnop',
};

let n = 0;
const поверхность = (surface, group, extra = {}) =>
  Object.assign(
    {
      id: 'e' + ++n,
      kind: 'surface',
      surface,
      group,
      frameId: 0,
      frameUrl: 'https://site.example/',
      frameKind: 'главный документ',
      t: n * 10,
      count: 1,
      detail: null,
      arg: null,
      result: null,
      attribution: САЙТ,
      trust: 'internal',
    },
    extra
  );

const события = [
  поверхность('canvas.toDataURL', 'canvas', { result: 'data:image/png;… 4820 симв.' }),
  поверхность('canvas.measureText', 'canvas', { detail: 'counted', count: 40 }),
  поверхность('canvas.getImageData', 'canvas'),
  поверхность('webgl.getParameter', 'webgl', {
    arg: 'UNMASKED_RENDERER_WEBGL',
    attribution: ТРЕТИЙ,
  }),
  поверхность('webgl.getExtension', 'webgl', { attribution: ТРЕТИЙ }),
  поверхность('audio.OfflineAudioContext', 'audio'),
  поверхность('fonts.check', 'fonts', { attribution: ЧУЖОЕ_РАСШИРЕНИЕ }),
  поверхность('navigator.platform', 'device', { frameId: 3, frameKind: 'сторонний фрейм' }),
  {
    id: 'i0',
    kind: 'installed',
    frameId: 0,
    frameUrl: 'https://site.example/',
    frameKind: 'главный документ',
    t: 1,
    arg: '67 поверхностей',
    attribution: null,
  },
];

function сеанс() {
  return {
    id: 'сеанс-1',
    tabId: 1,
    rev: 7,
    origin: 'https://site.example',
    startedAt: Date.now(),
    events: события.map((e) => ({ ...e })),
    installedSurfaces: [
      { surface: 'canvas.toDataURL', group: 'canvas' },
      { surface: 'canvas.measureText', group: 'canvas' },
      { surface: 'canvas.getImageData', group: 'canvas' },
      { surface: 'webgl.getParameter', group: 'webgl' },
      { surface: 'webgl.getExtension', group: 'webgl' },
      { surface: 'audio.OfflineAudioContext', group: 'audio' },
      { surface: 'fonts.check', group: 'fonts' },
      { surface: 'navigator.platform', group: 'device' },
    ],
    pendingNetwork: [],
    health: {
      callsSeen: 44,
      coldCalls: 8,
      instrumentedFrames: 2,
      confirmed: 0,
      networkOnly: 0,
      hookOnly: 0,
      unobserved: 34,
      noNetworkSource: 0,
      swRestarts: 0,
      dropped: 0,
    },
    truncated: false,
  };
}

// ── Заглушки браузера ───────────────────────────────────────────────────────

const { document } = создатьDOM(идентификаторы);

const журналЗапросов = [];
let состояние = { rev: '1:7', recording: false, entry: null, session: сеанс(), facts: null };
let запрошеноРазрешение = 0;
let портПодписчик = null;

const chrome = {
  runtime: {
    lastError: undefined,
    connect: () => ({
      onMessage: {
        addListener: (fn) => {
          портПодписчик = fn;
        },
      },
      onDisconnect: { addListener: () => {} },
    }),
    sendMessage(msg, cb) {
      журналЗапросов.push(msg);
      if (msg.type === 'panel:state') {
        // Ровно то, что делает worker: не менялось — не присылаем.
        if (msg.since && msg.since === состояние.rev) return cb({ unchanged: true });
        return cb({ ...состояние });
      }
      return cb({ ok: true });
    },
  },
  storage: { local: { get: (k, cb) => cb({}), set: () => {} } },
  tabs: {
    query: async () => [{ id: 1, url: 'https://site.example/page' }],
    onActivated: { addListener: () => {} },
    onUpdated: { addListener: () => {} },
    reload: async () => {},
  },
  permissions: {
    request(_, cb) {
      запрошеноРазрешение++;
      cb(true);
    },
  },
};

const песочница = {
  document,
  chrome,
  setTimeout,
  clearTimeout,
  console,
  URL,
  Blob: class {},
  Promise,
};
песочница.window = песочница;
песочница.globalThis = песочница;

runInNewContext(код, песочница, { filename: 'panel.js' });

const пауза = (мс = 0) => new Promise((r) => setTimeout(r, мс));
await пауза();
await пауза();
await пауза();

// ── Проверки ────────────────────────────────────────────────────────────────

let провал = 0;
function проверка(имя, ок, факт) {
  console.log((ок ? '  ok      ' : '  ПРОВАЛ  ') + имя + (ок ? '' : '  → ' + JSON.stringify(факт)));
  if (!ок) провал++;
}

const $ = (id) => document.getElementById(id);
const строки = () => $('log').querySelectorAll('.row').filter((r) => !r.classList.contains('meta'));
const чипы = () => $('filters').querySelectorAll('.chip');
const текстЧипов = () => чипы().map((c) => c.textContent);
const заметка = () => $('filters').querySelector('.filters-note');

console.log('журнал');
проверка('журнал нарисован', строки().length === 8, строки().length);
проверка(
  'событие «прибор встал» показано отдельной строкой',
  $('log').querySelectorAll('.meta').length === 1,
  $('log').querySelectorAll('.meta').length
);
проверка(
  'фреймы не смешаны',
  $('log').querySelectorAll('.frame').length === 2,
  $('log').querySelectorAll('.frame').length
);
проверка(
  'вызов чужого расширения помечен, а не приписан сайту',
  $('log').querySelectorAll('.who.ext').length === 1,
  $('log').текстВсех('.who')
);
console.log('');

console.log('лишняя работа');
{
  const было = строки().length;
  $('log').textContent = 'следа не осталось';
  портПодписчик({ tabId: 1 });
  await пауза();
  await пауза();
  проверка(
    'при неизменившемся журнале панель не перерисовывает ничего',
    $('log').textContent === 'следа не осталось',
    $('log').textContent.slice(0, 40)
  );
  // Молчание worker обеспечено не панелью, а номером правки в запросе: без него
  // worker обязан собрать журнал и свод заново, чего мы и добивались избежать.
  проверка(
    'панель спрашивает по номеру правки, а не вслепую',
    журналЗапросов.filter((m) => m.type === 'panel:state' && m.since).length > 0,
    журналЗапросов.filter((m) => m.type === 'panel:state').map((m) => m.since)
  );

  // А как только журнал изменился — обязана, и не позже паузы слипания.
  состояние = { ...состояние, rev: '1:8', session: сеанс() };
  портПодписчик({ tabId: 1 });
  await пауза(900);
  проверка('после изменения журнал перерисован', строки().length === было, строки().length);
}
console.log('');

console.log('фильтр');
проверка('кнопка «все» есть и включена', чипы()[0].classList.contains('on'), текстЧипов());
проверка(
  'кнопки построены по фактическим данным, пустых не бывает',
  текстЧипов().some((t) => t.startsWith('холст')) &&
    текстЧипов().some((t) => t.startsWith('видеокарта')) &&
    !текстЧипов().some((t) => t.startsWith('хранилища')),
  текстЧипов()
);
проверка(
  'кнопки фреймов появились: фреймов больше одного',
  текстЧипов().some((t) => t.startsWith('фрейм #3')),
  текстЧипов()
);
проверка(
  'кнопка про чужие расширения появилась: они наследили',
  текстЧипов().some((t) => t.startsWith('без чужих расширений')),
  текстЧипов()
);

чипы()
  .find((c) => c.textContent.startsWith('холст'))
  .нажать();
проверка('фильтр по группе оставил только холст', строки().length === 3, строки().length);
проверка(
  'фильтр по группе убрал и лишний фрейм',
  $('log').querySelectorAll('.frame').length === 1,
  $('log').querySelectorAll('.frame').length
);
проверка('сказано, сколько скрыто', заметка() && /показано 3 из 9/.test(заметка().textContent), заметка() && заметка().textContent);
проверка(
  'сказано, что скрытое не потеряно',
  заметка() && /экспорт/.test(заметка().textContent),
  'нет слова про экспорт'
);

чипы()
  .find((c) => c.textContent.startsWith('холст'))
  .нажать();
проверка('повторное нажатие снимает фильтр', строки().length === 8, строки().length);
проверка('строки «показано N из M» больше нет', !заметка(), 'осталась');

чипы()
  .find((c) => c.textContent.startsWith('без чужих расширений'))
  .нажать();
проверка(
  'чужое расширение спрятано по просьбе человека',
  $('log').querySelectorAll('.who.ext').length === 0,
  $('log').текстВсех('.who')
);
чипы()[0].нажать();
проверка('«все» сбрасывает всё сразу', строки().length === 8, строки().length);
console.log('');

console.log('повторная запись');
{
  const было = журналЗапросов.filter((m) => m.type === 'panel:start').length;
  $('start').нажать();
  проверка('первое нажатие ничего не запустило', запрошеноРазрешение === 0, запрошеноРазрешение);
  проверка(
    'первое нажатие предупредило о стирании и назвало число',
    /сотр/.test($('hint').textContent) && /9 наблюдений/.test($('hint').textContent),
    $('hint').textContent
  );
  проверка(
    'кнопка помечена как опасная',
    $('start').classList.contains('danger-btn'),
    $('start').className
  );

  $('start').нажать();
  проверка('второе нажатие запустило запись', запрошеноРазрешение === 1, запрошеноРазрешение);
  проверка(
    'запись действительно начата',
    журналЗапросов.filter((m) => m.type === 'panel:start').length === было + 1,
    журналЗапросов.filter((m) => m.type === 'panel:start').length
  );
  await пауза();
  проверка(
    'после старта кнопка вернулась в обычный вид',
    !$('start').classList.contains('danger-btn'),
    $('start').className
  );
}
console.log('');

console.log(провал ? провал + ' проверок провалено' : 'все проверки панели пройдены');
process.exit(провал ? 1 : 0);
