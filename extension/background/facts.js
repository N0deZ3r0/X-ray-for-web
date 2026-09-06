// Свод «Что о вас узнали».
//
// Единственное место, где прибор говорит утверждениями, а не показаниями.
// Поэтому здесь самое жёсткое правило проекта (01-product.md):
//
//   НИ ОДИН ФАКТ НЕ ВЫВОДИТСЯ БЕЗ ССЫЛКИ МИНИМУМ НА ОДНО ЗАПИСАННОЕ СОБЫТИЕ.
//   Нет события — нет факта. Свод есть проекция журнала, а не мнение прибора.
//
// Инвариант проверяется тестом: факт с пустым evidence — баг сборки.
//
// Здесь же живёт запрет на биты энтропии. Вместо «эта страница собрала о вас
// 18.4 бита» — счётчик снятого: «снято 9 поверхностей отпечатка из 14
// наблюдаемых». Первое требует распределения по популяции, которого у прибора
// нет; второе он измерил.

import { t, n as скл } from './i18n.js';

// Поверхности, которые считаются съёмом отпечатка. Группы shadow, egress и meta
// сюда не входят: создание воркера — не отпечаток, а контекст.
const ГРУППЫ_ОТПЕЧАТКА = new Set(['canvas', 'webgl', 'audio', 'fonts', 'device', 'hardware']);

// ── Правила вывода из наблюдений внутри страницы ────────────────────────────
//
// Каждое правило говорит: какие события его подтверждают и как это назвать.
// Значение берётся из результата вызова, а не придумывается.

const ПРАВИЛА = [
  {
    id: 'gpu',
    когда: (e) => e.surface === 'webgl.getParameter' && /UNMASKED_RENDERER/.test(e.arg || ''),
    текст: t('fact_gpu_model'),
    значение: (e) => e.result,
  },
  {
    id: 'gpu-vendor',
    когда: (e) => e.surface === 'webgl.getParameter' && /UNMASKED_VENDOR/.test(e.arg || ''),
    текст: t('fact_gpu_vendor'),
    значение: (e) => e.result,
  },
  {
    id: 'timezone',
    когда: (e) => e.surface === 'intl.resolvedOptions' && e.result,
    текст: t('fact_timezone'),
    значение: (e) => e.result,
  },
  {
    id: 'cores',
    когда: (e) => e.surface === 'navigator.hardwareConcurrency',
    текст: t('fact_cores'),
    значение: (e) => e.result,
  },
  {
    id: 'memory',
    когда: (e) => e.surface === 'navigator.deviceMemory',
    текст: t('fact_memory'),
    значение: (e) => (e.result ? e.result + t('fact_memory_unit') : null),
  },
  {
    id: 'platform',
    когда: (e) => e.surface === 'navigator.platform',
    текст: t('fact_os'),
    значение: (e) => e.result,
  },
  {
    id: 'screen',
    когда: (e) => e.surface === 'screen.width' || e.surface === 'screen.height',
    текст: t('fact_screen'),
    значение: (e, все) => {
      const w = все.find((x) => x.surface === 'screen.width' && x.result);
      const h = все.find((x) => x.surface === 'screen.height' && x.result);
      if (w && h) return w.result + t('fact_screen_by') + h.result;
      return (w || h || e).result;
    },
  },
  {
    id: 'ua-hints',
    когда: (e) => e.surface === 'navigator.getHighEntropyValues',
    текст: t('fact_ua_hints'),
    значение: (e) => e.arg,
    примечание: t('fact_ua_hints_note'),
  },
  {
    id: 'canvas',
    когда: (e) => e.surface === 'canvas.toDataURL' || e.surface === 'canvas.toBlob',
    текст: t('fact_canvas'),
    значение: () => null,
  },
  {
    id: 'canvas-pixels',
    когда: (e) => e.surface === 'canvas.getImageData',
    текст: t('fact_canvas_pixels'),
    значение: (e) => (e.count > 1 ? скл(e.count, 'plural_time') : null),
  },
  {
    id: 'audio',
    когда: (e) => e.group === 'audio',
    текст: t('fact_audio'),
    значение: () => null,
  },
  {
    id: 'fonts',
    когда: (e) => e.surface === 'fonts.check' || e.surface === 'canvas.measureText',
    текст: t('fact_fonts'),
    значение: (e, все) => {
      const n = все.reduce((s, x) => s + (x.count || 1), 0);
      return скл(n, 'plural_measurement');
    },
  },
  {
    id: 'webrtc',
    когда: (e) => e.surface === 'webrtc.RTCPeerConnection',
    текст: t('fact_webrtc'),
    значение: () => null,
  },
  {
    id: 'media',
    когда: (e) => e.surface === 'media.enumerateDevices',
    текст: t('fact_devices'),
    значение: (e) => e.result,
  },
  {
    id: 'voices',
    когда: (e) => e.surface === 'speech.getVoices',
    текст: t('fact_voices'),
    значение: (e) => e.result,
    примечание: t('fact_voices_note'),
  },
  {
    id: 'cookie-id',
    // Удаление куки выглядит так же, как постановка, только с прошедшей датой.
    // Назвать его «поставил долгоживущий идентификатор» было бы неправдой:
    // на живом сайте так стирают старые счётчики перед записью новых.
    когда: (e) => e.surface === 'cookie.write' && !удалениеКуки(e.arg),
    текст: t('fact_cookie_id'),
    значение: (e) => e.arg,
  },
  {
    id: 'storage-id',
    когда: (e) => e.surface === 'localStorage.setItem',
    текст: t('fact_storage'),
    значение: (e) => e.arg,
  },
  {
    id: 'worker',
    когда: (e) => e.surface === 'shadow.Worker' || e.surface === 'shadow.SharedWorker',
    текст: t('fact_worker'),
    значение: (e) => e.arg,
    примечание: t('fact_worker_note'),
  },
];

// Свод читают люди, а не машины: «41 измерений» и «2 запроса» портят
// доверие к тексту раньше, чем содержание успевает сработать.
function склонение(n, одна, две, много) {
  const сотня = n % 100;
  if (сотня >= 11 && сотня <= 14) return n + ' ' + много;
  const единица = n % 10;
  if (единица === 1) return n + ' ' + одна;
  if (единица >= 2 && единица <= 4) return n + ' ' + две;
  return n + ' ' + много;
}

// «имя, до <дата>» с датой в прошлом — это стирание куки, а не постановка.
function удалениеКуки(arg) {
  const m = /,\s*до\s+(.+)$/.exec(String(arg || ''));
  if (!m) return false;
  const когда = Date.parse(m[1]);
  return Number.isFinite(когда) && когда < Date.now();
}

function хост(url) {
  try {
    return new URL(url).hostname;
  } catch (e) {
    return url;
  }
}

// ── Факты из исходящего ─────────────────────────────────────────────────────
// Опираются на разобранные поля, а не на догадки об адресе.

const ПО_ВИДУ_ПОЛЯ = {
  'device-id': {
    текст: (кому) => t('fact_out_device_id', кому),
    примечание: t('fact_out_device_id_note'),
  },
  'user-id': {
    текст: (кому) => t('fact_out_user_id', кому),
    примечание: t('fact_out_user_id_note'),
  },
  'email-hash': {
    текст: (кому) => t('fact_out_email', кому),
    примечание: t('fact_out_email_note'),
  },
  'phone-hash': {
    текст: (кому) => t('fact_out_phone', кому),
  },
  'personal-hash': {
    текст: (кому) => t('fact_out_personal', кому),
    примечание: t('fact_out_personal_note'),
  },
  'referrer': {
    текст: (кому) => t('fact_out_referrer', кому),
  },
  'page-url': {
    текст: (кому) => t('fact_out_page_url', кому),
  },
};

export function выводитьФакты(session) {
  const события = session.events || [];
  const факты = [];

  // Свод обязан соблюдать то же правило, что и журнал (предел 3a): вызовы
  // чужих расширений — не действия сайта. Проверка на живом браузере поймала
  // ровно это: свод писал «Сайт записал данные в хранилище», хотя писало
  // соседнее расширение в своё собственное хранилище. Для прибора, чья
  // ценность в доказательности, ложное обвинение сайта — худший из отказов.
  const расширение = (e) => Boolean(e.attribution && e.attribution.viaExtension);
  const сайтом = (e) => e.kind === 'surface' && !расширение(e);

  // Утверждение «Сайт сделал X» требует хотя бы одного события, про которое
  // ИЗВЕСТНО, что это был сайт. Событие с неразобранным стеком таким не
  // является: «источник не определён» — это признание незнания, а не улика.
  //
  // Найдено на живом браузере: чужое расширение писало в своё хранилище двумя
  // способами, и один из них шёл с неразобранным стеком. Свод пропускал его
  // как сайт и печатал чужой ключ как действие сайта.
  const точноСайт = (e) => сайтом(e) && e.attribution && e.attribution.scriptUrl;

  // ── Из наблюдений внутри страницы ────────────────────────────────────────
  for (const правило of ПРАВИЛА) {
    const подходящие = события.filter((e) => сайтом(e) && правило.когда(e));
    if (!подходящие.length) continue;

    // Без хотя бы одной достоверно сайтовой улики факта нет.
    const улики = подходящие.filter(точноСайт);
    if (!улики.length) continue;

    // Значение берём ТОЛЬКО из достоверно сайтовых событий, и предпочитаем то,
    // где есть результат: у схлопнутых записей его нет.
    const источник = улики.find((e) => e.result) || улики[0];
    let значение = null;
    try {
      значение = правило.значение(источник, подходящие);
    } catch (e) {}

    // Часть вызовов той же поверхности могла прийти с неразобранным стеком.
    // В счёт они идут, но об этом надо сказать, а не умолчать.
    const безИсточника = подходящие.length - улики.length;
    const оговорка = безИсточника
      ? t('fact_unattributed', скл(безИсточника, 'plural_call'))
      : null;

    факты.push({
      id: правило.id,
      text: правило.текст,
      value: значение == null || значение === '' ? null : String(значение),
      note: [правило.примечание, оговорка].filter(Boolean).join('. ') || null,
      recipient: null,
      // Инвариант: evidence НИКОГДА не пуст
      evidence: подходящие.map((e) => e.id),
    });
  }

  // ── Из исходящего ────────────────────────────────────────────────────────
  const поПолучателю = new Map();

  for (const e of события) {
    if (e.kind !== 'egress' || !e.parsed) continue;
    const кому = хост(e.url);
    for (const g of e.parsed.groups) {
      for (const f of g.fields) {
        const шаблон = ПО_ВИДУ_ПОЛЯ[f.kind];
        if (!шаблон) continue;
        const ключ = f.kind + '|' + кому;
        if (!поПолучателю.has(ключ)) {
          поПолучателю.set(ключ, {
            id: 'egress:' + ключ,
            // Вид поля, из которого выведен факт. По нему — и только по нему —
            // экспорт решает, вырезать ли значение. Слова показа для этого
            // негодны: они переводятся, а безопасность переводиться не должна.
            kind: f.kind,
            text: шаблон.текст(кому),
            value: f.value || null,
            note: шаблон.примечание || null,
            recipient: кому,
            evidence: [],
          });
        }
        const факт = поПолучателю.get(ключ);
        if (факт.evidence.indexOf(e.id) === -1) факт.evidence.push(e.id);

        // Один и тот же вид поля приходит из разных запросов, и у части из них
        // значение пустое: пиксель шлёт rl= пустым, когда перехода не было,
        // а Метрика в page-ref кладёт настоящий адрес. Брать первое попавшееся
        // значит показать пустоту там, где данные есть.
        if ((факт.value === null || факт.value === '') && f.value) {
          факт.value = f.value;
        }
      }
    }
  }
  for (const f of поПолучателю.values()) факты.push(f);

  // ── Запись действий на странице ──────────────────────────────────────────
  // Это не разновидность аналитики, а запись сеанса, и говорить о ней надо
  // отдельно: человек читает «аналитика» и думает про счётчик посещений.
  const записьДействий = события.filter(
    (e) => e.kind === 'egress' && e.parsed && /^yandex-webvisor/.test(e.parsed.parserId)
  );
  if (записьДействий.length) {
    факты.push({
      id: 'session-recording',
      text: t('fact_webvisor'),
      value: хост(записьДействий[0].url),
      note:
        t('fact_webvisor_note'),
      recipient: хост(записьДействий[0].url),
      evidence: записьДействий.map((e) => e.id),
    });
  }

  // ── Про чужие расширения ─────────────────────────────────────────────────
  // Их вызовы не приписываются сайту, но и молчать о них нельзя: человек видит
  // в журнале обращения к своим данным и вправе знать, кто их делал.
  const отРасширений = события.filter((e) => e.kind === 'surface' && расширение(e));
  if (отРасширений.length) {
    const кто = [...new Set(отРасширений.map((e) => e.attribution.viaExtension))];
    факты.push({
      id: 'extensions',
      text: t('fact_other_extension'),
      value: кто.join(', '),
      note:
        t('fact_other_extension_note'),
      recipient: null,
      evidence: отРасширений.map((e) => e.id),
    });
  }

  // ── Про сам прибор ───────────────────────────────────────────────────────
  const обходы = события.filter((e) => e.kind === 'egress' && e.match === 'network-only');
  if (обходы.length) {
    факты.push({
      id: 'evasion',
      text: t('fact_evasion'),
      value: скл(обходы.length, 'plural_request'),
      note: t('fact_evasion_note'),
      recipient: null,
      evidence: обходы.map((e) => e.id),
    });
  }

  // ── Счётчик снятого вместо битов энтропии ────────────────────────────────
  //
  // Биты энтропии здесь запрещены: их не существует без распределения по
  // популяции, а популяции у прибора нет — он стоит на одной машине.
  // Любая цифра там была бы доверием к чужому устаревающему датасету, то есть
  // ровно тем враньём, за которое мы ругаем «47 заблокированных трекеров».
  const снятые = new Set();
  for (const e of события) {
    // Что снял сайт. Обращения чужих расширений сюда не идут по той же причине:
    // счётчик отвечает на вопрос «что узнал сайт», а не «что кто-то прочитал».
    if (сайтом(e) && ГРУППЫ_ОТПЕЧАТКА.has(e.group)) снятые.add(e.surface);
  }
  // Знаменатель берётся из списка, присланного инструментом вместе с группами.
  // Выводить группу из имени поверхности нельзя: это дублирование правила,
  // которое разъедется с реестром, и «9 из 14» станет выдумкой.
  const наблюдаемые = (session.installedSurfaces || []).filter((x) =>
    ГРУППЫ_ОТПЕЧАТКА.has(x.group)
  );

  return {
    facts: факты,
    coverage: {
      снято: снятые.size,
      наблюдается: наблюдаемые.length || null,
      список: [...снятые].sort(),
    },
  };
}
