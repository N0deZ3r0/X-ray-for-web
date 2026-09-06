// Экспорт сессии.
//
// Единственное место, где журнал покидает машину. Как только появляется кнопка
// «сохранить отчёт», люди начинают прикладывать его к багрепортам — а в журнале
// лежат идентификаторы, хеши почты и телефона, содержимое запросов.
//
// Поэтому редакция включена по умолчанию, а не предлагается галочкой
// (03-data-model.md). Вырезанное значение заменяется меткой, чтобы **факт
// наличия поля остался виден**: «здесь был идентификатор» — это само по себе
// содержание отчёта.
//
// Проверяется тестом наизнанку: в золотую сессию кладутся заведомые секреты, и
// тест ищет их в готовом экспорте. Найдено — провал.

import { t, n as скл, текст } from './i18n.js';

const МЕТКА = t('redacted');

// Заголовок раздела дополняется линией до одной ширины. Раньше длина линии
// стояла числом под каждый русский заголовок — на другом языке они разъехались
// бы, и отчёт, который человек читает глазами, потерял бы вид ровно там, где
// он должен внушать доверие.
const ШИРИНА_ОТЧЁТА = 60;
// Заголовок группы: код от движка либо двуязычный текст из декларации.
const заголовокГруппы = (g) => (g.titleKey ? t(g.titleKey, ...(g.titleArgs || [])) : текст(g.title));

const рамка = (заголовок) =>
  заголовок + '─'.repeat(Math.max(3, ШИРИНА_ОТЧЁТА - [...заголовок].length));

// Виды полей, значения которых не покидают машину без отдельного согласия.
//
// device-id и session-id добавлены к списку из 03-data-model.md намеренно:
// идентификатор браузера живёт два года и связывает все визиты, поэтому в
// пересланном отчёте он опаснее хеша почты — по нему человека найдут в чужой
// аналитике. referrer добавлен по той же причине: это чужая история просмотров,
// а не предмет отчёта.
const СЕКРЕТНЫЕ_ВИДЫ = new Set([
  'device-id',
  'session-id',
  'user-id',
  'email-hash',
  'phone-hash',
  'name-hash',
  // Advanced Matching у Meta шлёт хеши пола, даты рождения, города и индекса.
  // По отдельности каждый мало что значит, вместе — почти паспорт.
  'personal-hash',
  'referrer',
]);

function секретное(kind) {
  return СЕКРЕТНЫЕ_ВИДЫ.has(kind);
}

// ── Редакция ────────────────────────────────────────────────────────────────

function видыПолейПоИмени(parsed) {
  const map = new Map();
  if (!parsed) return map;
  for (const g of parsed.groups) {
    for (const f of g.fields) map.set(f.name, f.kind);
  }
  return map;
}

// Адрес маячка сам по себе несёт данные: у пикселя Meta хеши почты и телефона
// лежат прямо в строке запроса.
function редактироватьАдрес(url, parsed, счёт) {
  let u;
  try {
    u = new URL(url);
  } catch (e) {
    return url;
  }
  if (!u.search) return url;

  const виды = видыПолейПоИмени(parsed);

  // Разборщика нет — что в параметрах, неизвестно. Неизвестное вырезаем
  // целиком: «формат не опознан» и «здесь безопасно» — разные утверждения.
  if (!parsed) {
    const сколько = [...u.searchParams.keys()].length;
    счёт.вырезано += сколько;
    return u.origin + u.pathname + t('redacted_query', сколько);
  }

  const params = new URLSearchParams();
  for (const [имя, значение] of u.searchParams) {
    if (секретное(виды.get(имя))) {
      params.set(имя, МЕТКА);
      счёт.вырезано++;
    } else {
      params.set(имя, значение);
    }
  }
  return u.origin + u.pathname + '?' + decodeURIComponent(params.toString());
}

function редактироватьРазбор(parsed, счёт) {
  if (!parsed) return null;
  return Object.assign({}, parsed, {
    groups: parsed.groups.map((g) => ({
      // Копируем группу целиком: и заголовок-код от движка, и заголовок из
      // декларации. Перечисление полей руками однажды потеряло бы одно из них.
      ...g,
      fields: g.fields.map((f) => {
        if (!секретное(f.kind)) return f;
        счёт.вырезано++;
        // Поле остаётся на месте: «здесь был идентификатор» — это содержание,
        // а не то, что надо прятать.
        return Object.assign({}, f, { raw: МЕТКА, value: МЕТКА });
      }),
    })),
  });
}

function редактироватьСобытие(e, счёт) {
  if (e.kind !== 'egress') {
    // Наблюдения внутри страницы безопасны по построению: инструмент с самого
    // начала пишет имя куки и длину значения, но не само значение
    // (04-surfaces.md). Резать здесь нечего.
    return e;
  }

  const parsed = редактироватьРазбор(e.parsed, счёт);
  const out = Object.assign({}, e, {
    url: редактироватьАдрес(e.url, e.parsed, счёт),
    parsed,
  });

  // Сырое тело не выпускаем никогда: в нём может быть что угодно, включая
  // содержимое форм. Разобранные поля выше показывают то же самое, но с
  // вырезанными секретами.
  if (e.bodyText || e.netBodyText) {
    const длина = (e.bodyText || e.netBodyText).length;
    out.bodyText = t('redacted_body', длина);
    out.netBodyText = null;
    счёт.вырезано++;
  }
  return out;
}

function редактироватьФакт(f, счёт) {
  // Значение факта берётся из наблюдения и может быть идентификатором.
  // Опознаём по тексту самого факта: он собран нами, а не страницей.
  // Раньше здесь искались русские слова в тексте факта. Это работало ровно до
  // тех пор, пока язык был один: на английском не вырезалось бы ничего, и файл,
  // который человек считает безопасным, вынес бы наружу настоящие хеши почты.
  // Теперь решение принимается по виду поля — он код, и он не переводится.
  if (!секретное(f.kind) || !f.value) return f;
  счёт.вырезано++;
  return Object.assign({}, f, { value: МЕТКА });
}

// ── Сборка экспорта ─────────────────────────────────────────────────────────

export function собратьЭкспорт(session, свод, { редакция = true } = {}) {
  const счёт = { вырезано: 0 };

  const события = редакция
    ? session.events.map((e) => редактироватьСобытие(e, счёт))
    : session.events;

  const факты = свод
    ? редакция
      ? свод.facts.map((f) => редактироватьФакт(f, счёт))
      : свод.facts
    : [];

  const данные = {
    // Предупреждение стоит ПЕРВЫМ полем и только когда оно уместно. Файл без
    // редакции легко переслать, не заметив вложенного признака: закопанное
    // «включена: false» в середине структуры этого не предотвращает.
    ВНИМАНИЕ: редакция
      ? undefined
      : t('report_warning'),
    сформирован: new Date().toISOString(),
    схема: session.schemaVersion,
    сайт: session.origin,
    началоЗаписи: new Date(session.startedAt).toISOString(),
    редакция: {
      включена: редакция,
      вырезаноЗначений: счёт.вырезано,
      что: редакция
        ? t('report_redacted_kinds')
        : t('report_nothing'),
    },
    факты,
    покрытие: свод ? свод.coverage : null,
    здоровье: session.health,
    навигации: session.navigations,
    события,
  };

  return { данные, вырезано: счёт.вырезано };
}

// ── Читаемый отчёт ──────────────────────────────────────────────────────────

function строкаСверки(match) {
  return (
    {
      confirmed: t('verdict_confirmed'),
      // Обход выделен заглавными: это единственное место отчёта, где прибор
      // повышает голос, и повод для этого есть.
      'network-only': t('verdict_network_only').toUpperCase(),
      'hook-only': t('verdict_hook_only'),
      'no-network-source': t('verdict_no_network_source'),
      unobserved: t('verdict_unobserved'),
    }[match] || String(match || '')
  );
}

export function собратьОтчёт(session, свод, { редакция = true } = {}) {
  const { данные, вырезано } = собратьЭкспорт(session, свод, { редакция });
  const L = [];

  L.push(t('report_title'));
  L.push('');
  L.push(t('report_site') + данные.сайт);
  L.push(t('report_started') + данные.началоЗаписи);
  L.push(t('report_generated') + данные.сформирован);
  L.push('');
  L.push(
    редакция
      ? t('report_redaction_on', вырезано) + '.'
      : t('report_redaction_off')
  );
  L.push(t('report_stripped_kinds', данные.редакция.что) + '.');
  L.push(t('report_fields_stay'));
  L.push('');

  L.push(рамка(t('report_h_facts')));
  L.push('');
  if (!данные.факты.length) L.push(t('report_nothing_collected'));
  for (const f of данные.факты) {
    L.push('  • ' + f.text + (f.value ? ': ' + f.value : ''));
    if (f.note) L.push('    ' + f.note);
    L.push('  ' + t('fact_basis') + скл(f.evidence.length, 'plural_record_lower') + t('fact_basis_suffix'));
  }
  L.push('');
  if (данные.покрытие) {
    L.push(
      t(
        'report_coverage',
        данные.покрытие.снято,
        данные.покрытие.наблюдается == null ? '?' : данные.покрытие.наблюдается
      )
    );
    L.push(t('report_coverage_why'));
  }
  L.push('');

  L.push(рамка(t('report_h_egress')));
  L.push('');
  const исходящее = данные.события.filter((e) => e.kind === 'egress');
  if (!исходящее.length) L.push(t('report_no_egress'));
  for (const e of исходящее) {
    L.push('  [' + строкаСверки(e.match) + '] ' + (e.method || '') + ' ' + e.url);
    if (e.attribution && e.attribution.viaExtension) {
      L.push(t('report_not_site_ext', e.attribution.viaExtension));
    } else if (e.attribution && e.attribution.scriptUrl) {
      L.push(t('report_source') + e.attribution.scriptUrl + ':' + e.attribution.line);
    } else if (e.source === 'network') {
      L.push(t('report_source_unknown'));
    }
    if (e.cookiesSent && e.cookiesSent.length) {
      L.push(t('report_cookies') + e.cookiesSent.join(', '));
    }
    if (e.parsed) {
      L.push(
        '    ' +
          t(
            'report_parser_line',
            e.parsed.parserTitle,
            e.parsed.parserVersion,
            e.parsed.knownCount,
            e.parsed.unknownCount
          )
      );
      for (const g of e.parsed.groups) {
        if (e.parsed.groups.length > 1) L.push('      ' + заголовокГруппы(g));
        for (const f of g.fields) {
          L.push('      ' + (текст(f.label) || t('not_identified_caps')) + ' (' + f.name + ') = ' + f.value);
        }
      }
    } else if (e.bodyText) {
      L.push(t('report_unparsed') + e.bodyText);
    }
    L.push('');
  }

  L.push(рамка(t('report_h_log')));
  L.push('');
  const поверхности = данные.события.filter((e) => e.kind === 'surface');
  for (const e of поверхности) {
    const кто =
      e.attribution && e.attribution.viaExtension
        ? t('report_ext_short', e.attribution.viaExtension)
        : e.attribution && e.attribution.scriptUrl
          ? e.attribution.scriptUrl + ':' + e.attribution.line
          : t('attr_unknown_source');
    L.push(
      '  ' + (e.t / 1000).toFixed(2) + t('seconds_suffix') + '  ' + e.surface +
        (e.count > 1 ? ' ×' + e.count : '') +
        (e.detail === 'counted' ? t('report_counted') : '')
    );
    L.push('      ' + кто);
    if (e.arg) L.push(t('report_arg') + e.arg);
    if (e.result) L.push(t('report_result') + e.result);
  }
  L.push('');

  L.push(рамка(t('report_h_health')));
  L.push('');
  const h = данные.здоровье;
  L.push(t('report_health_records', h.eventsRecorded, h.eventsDropped));
  L.push(t('report_health_bridge', h.bridgeGaps, h.swRestarts));
  L.push(t('report_health_calls', h.callsSeen, h.coldCalls));
  L.push(
    t('report_health_reconcile', h.confirmed, h.networkOnly, h.hookOnly, h.noNetworkSource || 0)
  );
  if (h.killSwitchTripped) L.push(t('report_warn_killswitch'));
  if (h.coldBudgetExhausted) L.push(t('report_warn_budget'));
  L.push('');

  L.push(рамка(t('report_h_limits')));
  L.push('');
  L.push(t('report_limit_no_block'));
  L.push(t('report_limit_workers'));
  L.push(t('report_limit_extensions'));
  L.push(t('report_limit_unknown'));
  L.push('');

  return L.join('\n');
}
