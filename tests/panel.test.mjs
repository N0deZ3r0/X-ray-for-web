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

import { поставитьI18n } from './lib/zagruzka.mjs';

const корень = new URL('../extension/ui/', import.meta.url);
const html = readFileSync(new URL('panel.html', корень), 'utf8');
const кодI18n = readFileSync(new URL('i18n.js', корень), 'utf8');
const код = readFileSync(new URL('panel.js', корень), 'utf8');

// Панель берёт слова из chrome.i18n. Ставим настоящий источник строк и русский
// язык: проверки сверяют формулировки, и подмена их выдуманными сделала бы
// набор проверкой самого себя.
const i18n = await поставитьI18n('ru');

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
      frameKind: 'main',
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
  поверхность('canvas.toDataURL', 'canvas', { arg: 'image/png', result: 'chars:11818' }),
  поверхность('canvas.measureText', 'canvas', { detail: 'counted', count: 40 }),
  поверхность('canvas.getImageData', 'canvas'),
  поверхность('webgl.getParameter', 'webgl', {
    arg: 'UNMASKED_RENDERER_WEBGL',
    attribution: ТРЕТИЙ,
  }),
  поверхность('webgl.getExtension', 'webgl', { attribution: ТРЕТИЙ }),
  поверхность('audio.OfflineAudioContext', 'audio'),
  поверхность('fonts.check', 'fonts', { attribution: ЧУЖОЕ_РАСШИРЕНИЕ }),
  поверхность('navigator.platform', 'device', { frameId: 3, frameKind: 'frame' }),
  {
    id: 'i0',
    kind: 'installed',
    frameId: 0,
    frameUrl: 'https://site.example/',
    frameKind: 'main',
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

// Свод. Раньше здесь стоял null, и renderFacts выходил на первой же строке —
// то есть отрисовка карточек фактов не выполнялась в тестах ни разу. Ровно там
// потом и нашлась ошибка: локальная переменная перекрыла функцию перевода, и
// панель падала на первом факте у живого человека.
const свод = {
  facts: [
    {
      id: 'gpu',
      text: 'Сайт узнал модель вашей видеокарты',
      value: 'ANGLE (Intel, UHD Graphics 620)',
      note: null,
      recipient: null,
      evidence: ['e4'],
    },
    {
      id: 'egress:email-hash|www.facebook.com',
      kind: 'email-hash',
      text: 'В www.facebook.com ушёл хеш вашего адреса электронной почты',
      value: 'e3b0c44298fc1c14',
      note: 'Хеш не расшифровывается, но одинаков на всех сайтах и потому связывает их',
      recipient: 'www.facebook.com',
      evidence: ['e1', 'e2'],
    },
    {
      id: 'evasion',
      text: 'Часть запросов прошла мимо инструментации',
      value: '3 запроса',
      note: 'Прибор не может сказать, кто их отправил, — только что они были',
      recipient: null,
      evidence: ['e5', 'e6', 'e7'],
    },
  ],
  coverage: { снято: 5, наблюдается: 67, список: ['canvas.toDataURL'] },
};

// ── Заглушки браузера ───────────────────────────────────────────────────────

const { document, body } = создатьDOM(идентификаторы);

// Панель при запуске обходит document.querySelectorAll('[data-i18n]'). В нашем
// DOM атрибутов нет: узлы создаются по идентификаторам из разметки, а не
// разбором HTML. Возвращаем пустой список — заполнение статической разметки
// проверяется не здесь.
document.querySelectorAll = () => [];
document.documentElement = { lang: '' };

const журналЗапросов = [];
let состояние = { rev: '1:7', recording: false, entry: null, session: сеанс(), facts: свод };
let запрошеноРазрешение = 0;
let портПодписчик = null;

const chrome = {
  i18n,
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
// В боковой панели self и window — одно и то же окно; i18n.js кладёт себя в self.
песочница.self = песочница;
песочница.globalThis = песочница;

// i18n.js кладёт себя в self — так же, как в браузере, где panel.html
// подключает его отдельным <script> перед панелью.
runInNewContext(кодI18n, песочница, { filename: 'i18n.js' });
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

console.log('расшифровка кодов инструмента');
{
  // Инструмент живёт в мире страницы, где chrome.i18n нет, поэтому подробности
  // вызова он пишет кодами. Расшифровывает их панель. Если расшифровка
  // промахнётся, человек увидит «chars:11818» вместо «11818 символов» — или,
  // как случилось на самом деле, получит к любому значению с пробелом хвост
  // «, живёт undefined дн.».
  const строки = $('log').текстВсех('.r3').join(' | ');

  проверка(
    'код длины расшифрован словами',
    /11818 символов/.test(строки) && !/chars:/.test(строки),
    строки.slice(0, 120)
  );
  проверка(
    'сырых кодов в журнале не осталось',
    !/(^|[^a-z])(chars|rect|audio|cookies|html|surfaces|n):[0-9]/.test(строки),
    строки.slice(0, 160)
  );
  проверка(
    'ничего не обросло хвостом про дни',
    !/живёт undefined/.test(строки),
    строки.slice(0, 160)
  );

  // И прямая проверка расшифровщика на всех кодах, которые пишет инструмент.
  // Значение без разделителя « | » обязано доходить до человека нетронутым:
  // именно на этом сломалась первая редакция.
  const образцы = [
    ['chars:4820', /4820 символов/],
    ['n:4', /4 шт\./],
    ['rect:4x4@0,0', /4×4 от \(0,0\)/],
    ['audio:1,5000', /1 кан\., 5000 сэмпл\./],
    ['cookies:3', /3 куки/],
    ['html:95', /95 символов разметки/],
    ['surfaces:73', /73 поверхностей/],
    ['yes', /^есть$/],
    ['no', /^нет$/],
    ['_ga | days:730', /^_ga, живёт 730 дн\.$/],
    ['cookietest | until:Thu, 01-Jan-1970', /^cookietest, до Thu, 01-Jan-1970$/],
    ['cookieChoice | chars:15', /^cookieChoice \(15 символов\)$/],
    ['Google Inc.', /^Google Inc\.$/],
    ['Mozilla/5.0 (Windows NT 10.0) Chrome/152', /^Mozilla\/5\.0 \(Windows NT 10\.0\) Chrome\/152$/],
    ['(max-width: 768px)', /^\(max-width: 768px\)$/],
    ['UNMASKED_RENDERER_WEBGL', /^UNMASKED_RENDERER_WEBGL$/],
  ];
  const промахи = [];
  for (const [код, ждём] of образцы) {
    const из = песочница.__подробность(код);
    if (!ждём.test(из)) промахи.push(код + ' → ' + из);
  }
  проверка('каждый код инструмента расшифрован верно', промахи.length === 0, промахи);
}
console.log('');

console.log('свод');
{
  const карточки = $('facts').querySelectorAll('.fact');
  проверка('карточки фактов нарисованы', карточки.length === 3, карточки.length);
  проверка(
    'текст факта показан',
    $('facts').текстВсех('.fact-text').includes('Сайт узнал модель вашей видеокарты'),
    $('facts').текстВсех('.fact-text')
  );
  проверка(
    'значение факта показано',
    $('facts').текстВсех('.fact-value').some((v) => v.includes('UHD Graphics')),
    $('facts').текстВсех('.fact-value')
  );
  проверка(
    'примечание показано там, где оно есть',
    $('facts').querySelectorAll('.fact-note').length === 2,
    $('facts').querySelectorAll('.fact-note').length
  );
  // Главное правило проекта, доведённое до интерфейса: у каждого факта видно,
  // на скольких записях журнала он держится.
  const основания = $('facts').текстВсех('.fact-ev');
  проверка(
    'у каждого факта показано основание',
    основания.length === 3,
    основания.length
  );
  проверка(
    'основание названо числом записей, а не общими словами',
    основания.some((s) => /1 запись/.test(s)) && основания.some((s) => /3 записи/.test(s)),
    основания
  );
  проверка(
    'обход выделен отдельным видом карточки',
    $('facts').querySelectorAll('.fact.evasion').length === 1,
    $('facts').querySelectorAll('.fact.evasion').length
  );
  // Числа обязаны стоять В строке, а не после неё: подстановка идёт внутрь
  // разметки, и потерянный порядок дал бы «Снято:  из .567» — ровно то, что
  // человек прочитает как сломанный интерфейс.
  const покрытие = $('facts').querySelector('.coverage').textContent;
  // Примечание — отдельный узел. Спаном внутри строки оно слипалось с
  // предыдущим предложением: «…39 из 53.Битов энтропии».
  const примечание = $('facts').querySelector('.why');
  проверка(
    'счётчик снятого показан числами внутри фразы',
    /Снято поверхностей отпечатка: 5 из 67/.test(покрытие),
    покрытие.slice(0, 60)
  );
  // Слово «биты» здесь есть — и именно потому, что прибор объясняет, почему их
  // НЕ показывает. Проверяем отсутствие числа битов, а не отсутствие слова.
  проверка(
    'примечание про биты вынесено отдельным узлом, а не слито со строкой',
    Boolean(примечание) && /^Битов энтропии/.test(примечание.textContent),
    примечание && примечание.textContent.slice(0, 40)
  );
  проверка(
    'битов энтропии не названо ни одного',
    /Битов энтропии здесь нет намеренно/.test(покрытие) && !/d+(.d+)?s*бит/i.test(покрытие),
    покрытие.slice(60, 160)
  );
}
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

// Число у чипа — это «сколько будет видно после нажатия». У всех чипов так и
// было, кроме этого: он показывал число ОТБРАСЫВАЕМЫХ записей. На
// fingerprint.com чип читался «без чужих расширений 10», хотя нажатие
// оставляло 237 записей из 247, — число описывало не то действие, рядом с
// которым стояло.
const чипБезРасширений = () => чипы().find((c) => c.textContent.startsWith('без чужих расширений'));
const числоЧипа = (c) => Number(c.querySelector('.chip-n').textContent);
const обещано = числоЧипа(чипБезРасширений());
const чужихЗаписей = $('log').querySelectorAll('.who.ext').length;

чипБезРасширений().нажать();
проверка(
  'чужое расширение спрятано по просьбе человека',
  $('log').querySelectorAll('.who.ext').length === 0,
  $('log').текстВсех('.who')
);
// Считаем ВСЕ строки, включая служебную «прибор встал на N мс»: она такая же
// запись журнала, входит в счётчики чипов и в живой панели видна человеком
// (в снимке с fingerprint.com — группа «служебное 3», по одной на фрейм).
const всехСтрок = () => $('log').querySelectorAll('.row').length;
проверка(
  'число у чипа обещает то, что останется, а не то, что уберут',
  обещано === всехСтрок(),
  { обещано, осталось: всехСтрок() }
);
проверка(
  'то есть это не счётчик чужих записей',
  обещано > чужихЗаписей,
  { обещано, чужих: чужихЗаписей }
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
