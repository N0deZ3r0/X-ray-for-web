// Движок разборщиков форматов.
//
// Разборщик — это ДАННЫЕ, а не код (05-parsers.md). MV3 запрещает исполнять
// загруженный код, поэтому декларация не содержит ни функций, ни выражений:
// только сопоставление адреса, словарь полей и шаблоны имён. Интерпретирует их
// вот этот файл, и он один тестируется отдельно от знаний о конкретном трекере.
//
// Главное правило: НЕИЗВЕСТНОЕ ПОЛЕ ПОКАЗЫВАЕТСЯ НЕИЗВЕСТНЫМ.
// Разбор никогда не додумывает. Нет правила — нет ярлыка, зато есть счётчик,
// по которому видно, что схема трекера ушла вперёд, а разборщик отстал.

const МАКС_ШАБЛОН = 200; // длина регулярного выражения из декларации

// ── Проверка декларации ─────────────────────────────────────────────────────
// Отвергаем всё, что не соответствует уговору. Битая декларация опаснее
// отсутствующей: она даёт правдоподобную неправду.

export function проверить(d) {
  const беды = [];
  if (!d || typeof d !== 'object') return ['декларация не объект'];
  if (!d.id) беды.push('нет id');
  if (!d.version) беды.push('нет version');
  if (!d.match || !Array.isArray(d.match.host) || !d.match.host.length) {
    беды.push('нет match.host');
  }
  if (d.unknown !== 'preserve') {
    беды.push('unknown обязано быть "preserve" — иначе разборщик сможет молча выкидывать поля');
  }
  if (d.fields && typeof d.fields !== 'object') беды.push('fields не объект');
  for (const p of d.patterns || []) {
    if (typeof p.test !== 'string' || p.test.length > МАКС_ШАБЛОН) {
      беды.push('шаблон не строка или длиннее ' + МАКС_ШАБЛОН);
    }
  }
  for (const имя of Object.keys(d.fields || {})) {
    const f = d.fields[имя];
    if (!f.label) беды.push('поле ' + имя + ' без label');
    if (f.confidence === 'guess') {
      беды.push('поле ' + имя + ': confidence "guess" запрещено — либо знаем, либо не опознано');
    }
  }
  return беды;
}

// ── Сопоставление адреса ────────────────────────────────────────────────────

function подходитХост(шаблон, хост) {
  if (шаблон === хост) return true;
  if (шаблон.startsWith('*.')) {
    const хвост = шаблон.slice(1); // ".google-analytics.com"
    return хост.endsWith(хвост);
  }
  return false;
}

export function подходит(d, url) {
  let u;
  try {
    u = new URL(url);
  } catch (e) {
    return false;
  }
  if (!d.match.host.some((h) => подходитХост(h, u.hostname))) return false;
  if (d.match.path) {
    try {
      if (!new RegExp(d.match.path).test(u.pathname)) return false;
    } catch (e) {
      return false;
    }
  }
  return true;
}

// ── Разбор ──────────────────────────────────────────────────────────────────

function опознать(d, имя) {
  if (d.fields && Object.prototype.hasOwnProperty.call(d.fields, имя)) {
    return d.fields[имя];
  }
  for (const p of d.patterns || []) {
    try {
      if (new RegExp(p.test).test(имя)) return p;
    } catch (e) {}
  }
  return null;
}

function читаемо(значение) {
  try {
    const d = decodeURIComponent(значение);
    return d !== значение ? d : значение;
  } catch (e) {
    return значение;
  }
}

function разобратьПары(d, params) {
  const поля = [];
  let известных = 0;
  let неопознанных = 0;

  for (const [имя, сырое] of params) {
    const правило = опознать(d, имя);
    if (правило) известных++;
    else неопознанных++;

    поля.push({
      name: имя,
      raw: сырое,
      value: читаемо(сырое),
      // null означает «не опознано» и так и печатается. Догадок здесь нет.
      label: правило ? правило.label : null,
      kind: правило ? правило.kind || null : null,
      note: правило ? правило.note || null : null,
      confidence: правило ? правило.confidence || 'documented' : null,
    });
  }

  return { поля, известных, неопознанных };
}

// Метрика упаковывает всю начинку в один параметр browser-info строкой вида
// «ключ:значение:ключ:значение». Разбираем парами через двоеточие.
//
// Если «ключ» перестал быть похож на ключ — значит в каком-то значении было
// двоеточие и разбор рассинхронизировался. Продолжать нельзя: дальше пойдут
// подписи, сдвинутые на одно поле, то есть правдоподобная неправда. Остаток
// отдаётся одним неопознанным полем — пусть счётчик его покажет.
function парыЧерезДвоеточие(текст) {
  const части = String(текст).split(':');
  const пары = [];
  for (let i = 0; i + 1 < части.length; i += 2) {
    const ключ = части[i];
    if (!/^[a-zA-Z0-9_-]{1,12}$/.test(ключ)) {
      пары.push(['browser-info:остаток', части.slice(i).join(':')]);
      return пары;
    }
    пары.push([ключ, части[i + 1]]);
  }
  return пары;
}

// Тело GA4 — пачка событий, разделённых переводом строки, каждое urlencoded.
// Разбирать надо каждое отдельно, иначе пачка из шести событий покажется одним.
function строкиUrlencoded(текст) {
  return String(текст)
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function разобрать(d, url, bodyText) {
  const группы = [];
  let известных = 0;
  let неопознанных = 0;

  for (const шаг of d.extract || []) {
    // Часть данных живёт в пути адреса, а не в параметрах: у Метрики так
    // передаётся номер счётчика, то есть ответ на вопрос «кому это уходит».
    if (шаг.from === 'path') {
      let m = null;
      try {
        m = new RegExp(шаг.pattern).exec(new URL(url).pathname);
      } catch (e) {}
      if (!m) continue;
      const пары = (шаг.names || []).map((имя, i) => [имя, m[i + 1]]).filter((p) => p[1] != null);
      if (!пары.length) continue;
      const r = разобратьПары(d, пары);
      известных += r.известных;
      неопознанных += r.неопознанных;
      группы.push({ title: 'Из адреса', fields: r.поля });
      continue;
    }

    if (шаг.from === 'query') {
      let params;
      try {
        params = [...new URL(url).searchParams.entries()];
      } catch (e) {
        continue;
      }
      if (!params.length) continue;
      const r = разобратьПары(d, params);
      известных += r.известных;
      неопознанных += r.неопознанных;
      группы.push({ title: 'Параметры адреса', fields: r.поля });

      // Вложенная упаковка: один параметр содержит десятки полей внутри себя.
      for (const вложение of d.nested || []) {
        const значение = new URL(url).searchParams.get(вложение.param);
        if (!значение) continue;
        if (вложение.format !== 'colon-pairs') continue;
        const rv = разобратьПары(d, парыЧерезДвоеточие(значение));
        известных += rv.известных;
        неопознанных += rv.неопознанных;
        группы.push({ title: вложение.title || вложение.param, fields: rv.поля });
      }
      continue;
    }

    if (шаг.from === 'body' && bodyText) {
      if (шаг.format === 'lines-urlencoded') {
        const строки = строкиUrlencoded(bodyText);
        строки.forEach((строка, i) => {
          const r = разобратьПары(d, [...new URLSearchParams(строка).entries()]);
          известных += r.известных;
          неопознанных += r.неопознанных;
          группы.push({
            title: строки.length > 1 ? 'Событие ' + (i + 1) + ' из ' + строки.length : 'Тело запроса',
            fields: r.поля,
          });
        });
        continue;
      }
      if (шаг.format === 'urlencoded') {
        const r = разобратьПары(d, [...new URLSearchParams(bodyText).entries()]);
        известных += r.известных;
        неопознанных += r.неопознанных;
        группы.push({ title: 'Тело запроса', fields: r.поля });
        continue;
      }
    }
  }

  if (!группы.length) return null;

  return {
    parserId: d.id,
    parserTitle: d.title || d.id,
    // Дата знания о схеме. Видна в интерфейсе: по ней понятно, насколько
    // разборщик мог отстать от трекера.
    parserVersion: d.version,
    groups: группы,
    knownCount: известных,
    unknownCount: неопознанных,
  };
}

// ── Реестр ──────────────────────────────────────────────────────────────────

export function создатьРеестр(декларации) {
  const годные = [];
  const отвергнутые = [];
  for (const d of декларации) {
    const беды = проверить(d);
    if (беды.length) отвергнутые.push({ id: d && d.id, беды });
    else годные.push(d);
  }

  return {
    parsers: годные,
    rejected: отвергнутые,
    разобрать(url, bodyText) {
      for (const d of годные) {
        if (!подходит(d, url)) continue;
        const r = разобрать(d, url, bodyText);
        if (r) return r;
      }
      return null;
    },
  };
}
