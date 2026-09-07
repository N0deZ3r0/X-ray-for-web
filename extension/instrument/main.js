// MAIN world. Ставится в document_start до любого скрипта страницы, во все фреймы.
//
// Здесь живёт машинерия наблюдения: снятие стека, бюджет, схлопывание повторов,
// мост наружу, и реестр поверхностей из 04-surfaces.md.
//
// Всё, что отсюда уходит, помечается trust: 'internal'. Страница видит этот код
// и видит канал доставки — пределы 1 и 2 из 06-limits.md.

(() => {
  'use strict';

  // Момент старта. Установка обёрток лежит на критическом пути целиком: они
  // обязаны встать до первого скрипта страницы. Замер LCP показал, что именно
  // она, а не горячий путь, стоит прибору просадки — значит её надо знать
  // числом, а не догадкой.
  const T_СТАРТ = performance.now();

  const CHANNEL = '__xray_v1';
  const READY = '__xray_v1_ready';

  // Кадр стека: адрес, строка, колонка. blob: и chrome-extension: включены —
  // трекер может лежать в blob-скрипте, а мы сами лежим в chrome-extension.
  const FRAME_RE = /((?:blob:)?(?:https?|file|chrome-extension):\/\/[^\s)]+?):(\d+):(\d+)/;

  // ── Собственный адрес: нужен, чтобы вычеркнуть себя из стека ──────────────
  // Ищем ЛЮБОЙ адрес, а не только chrome-extension: инструмент запускают ещё и
  // с отладочного стапеля стенда по http, и там он приписал бы вызовы себе.
  const SELF_URL = (() => {
    try {
      throw new Error('xray-init');
    } catch (e) {
      const m = FRAME_RE.exec(e.stack || '');
      return m ? m[1] : null;
    }
  })();

  // ── Бюджет (04-surfaces.md) ───────────────────────────────────────────────
  const BUDGET = {
    maxRecords: 20000,
    // Потолок на поверхность. 120 хватает на перечисление: у fonts.check это
    // 41 шрифт, у webgl.getParameter — под 60 параметров, и каждый должен
    // попасть в журнал отдельной записью.
    stacksPerSurface: 120,
    stacksHotPerSurface: 8,  // класс C — потолок на поверхность, не на пару
    // ОБЩИЙ бюджет снятий стека на документ. Замерено на стенде: один такой
    // вызов стоит около 25 мкс. Потолок только на поверхность давал худший
    // случай 67 x 120 = 8040 снятий, то есть свыше 200 мс на пустом месте.
    // Общий бюджет ограничивает цену сверху независимо от того, сколько
    // поверхностей дёргает страница.
    maxColdCalls: 1200,
    detailsPerRecord: 5,
    flushMs: 200,
    flushRecords: 50,
    // Kill-switch срабатывает по ЧАСТОТЕ вызовов, а не по времени.
    // Время горячего пути прибор измерить не может (см. health ниже), а частоту
    // может точно и бесплатно — это просто счётчик.
    killSwitchCallsPerSec: 300000,
  };

  const health = {
    recordsTracked: 0,
    recordsDropped: 0,
    callsSeen: 0,
    degradedSurfaces: [],
    killSwitchTripped: false,
    // Холодный путь измеряется честно: один такой вызов снимает стек и стоит
    // десятки микросекунд — это заметно выше точности таймера.
    coldCalls: 0,
    coldMs: 0,
    // Горячий путь НЕ измеряется по времени, и это осознанный отказ.
    // Проверено на стенде дважды: работа одного горячего вызова — доли
    // микросекунды, а два performance.now() вокруг неё стоят соизмеримо.
    // Хуже того, редко берущаяся ветка замера сама не оптимизируется JIT-ом,
    // поэтому замеряется именно медленный путь: секундомер давал 0.5 мс на
    // 20000 вызовов, а самозамер — 112 мс, завышение в 200 раз.
    // Врать в двести раз хуже, чем не знать. Поэтому здесь только счётчик.
    hotCalls: 0,
    callsPerSecond: 0,
    coldBudgetExhausted: false,
    egressDropped: 0,
    surfacesInstalled: 0,
    surfacesFailed: [],
    surfacesShadowed: [],
    installMs: 0,
  };

  let degraded = false;
  let coldMs = 0;
  let coldCalls = 0;
  let hotCalls = 0;
  let lastCalls = 0;
  let windowStart = performance.now();

  // Замеряем ТОЛЬКО своё время, без времени обёрнутого вызова.
  // Вызывается лишь с холодного пути: горячий по времени не измеряется.
  function noteCold(selfStart) {
    coldMs += performance.now() - selfStart;
    coldCalls++;
  }

  // Пересчёт раз в flushMs, а не на каждом вызове.
  function refreshOverhead() {
    health.coldCalls = coldCalls;
    health.coldMs = +coldMs.toFixed(1);
    health.hotCalls = hotCalls;

    const now = performance.now();
    const elapsed = now - windowStart;
    if (elapsed < 1000) return;

    const total = coldCalls + hotCalls;
    const perSecond = ((total - lastCalls) * 1000) / elapsed;
    health.callsPerSecond = Math.round(perSecond);

    if (!degraded && perSecond > BUDGET.killSwitchCallsPerSec) {
      degraded = true;
      health.killSwitchTripped = true;
    }
    lastCalls = total;
    windowStart = now;
  }

  // ── Атрибуция по стеку ────────────────────────────────────────────────────

  function attribution() {
    // Ограничивать глубину через Error.stackTraceLimit пробовали — стало хуже:
    // 46.7 мкс на вызов против 25.5. Запись в это свойство на каждом вызове
    // сбивает быстрый путь V8, и экономия на формировании строки не окупается.
    const stack = new Error().stack;
    if (!stack) return null;

    const lines = stack.split('\n');

    // Кадры ЧУЖИХ расширений пропускать молча нельзя. Найдено в реальном
    // браузере: другое расширение подменило конструктор Worker и внутри своей
    // ловушки делает синхронный XHR за скриптом воркера. Запрос настоящий, но
    // инициировала его не страница. Прежнее правило проматывало все кадры
    // chrome-extension:// подряд и приписывало такой запрос первой строке
    // страницы — то есть обвиняло сайт в том, чего он не делал.
    let черезРасширение = null;

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (SELF_URL && line.indexOf(SELF_URL) !== -1) continue;

      if (line.indexOf('chrome-extension://') !== -1) {
        if (!черезРасширение) {
          const ext = /chrome-extension:\/\/([a-p]{32})/.exec(line);
          if (ext) черезРасширение = ext[1];
        }
        continue;
      }

      const m = FRAME_RE.exec(line);
      if (!m) continue;

      const url = m[1];
      let thirdParty = false;
      let inline = false;
      try {
        const u = new URL(url);
        thirdParty = u.origin !== location.origin;
        inline = !thirdParty && url.split('#')[0] === location.href.split('#')[0];
      } catch (e) {}

      return {
        scriptUrl: url,
        line: +m[2],
        column: +m[3],
        inline,
        thirdParty,
        // Непосредственный вызывающий — чужое расширение, а страница лишь ниже
        // по стеку. Показывать это обязательно, иначе выйдет поклёп.
        viaExtension: черезРасширение,
      };
    }

    // Страницы в стеке нет вовсе — вызов целиком из расширения
    if (черезРасширение) {
      return {
        scriptUrl: null,
        line: null,
        column: null,
        inline: false,
        thirdParty: false,
        viaExtension: черезРасширение,
      };
    }
    // Разобрать не удалось — это результат, а не пустое место.
    return null;
  }

  // ── Журнал ────────────────────────────────────────────────────────────────
  const records = new Map();
  const dirty = new Set();

  function markDegraded(surface) {
    if (health.degradedSurfaces.indexOf(surface) === -1) {
      health.degradedSurfaces.push(surface);
    }
  }

  function newRecord(fields) {
    const rec = Object.assign(
      {
        kind: 'surface',
        attribution: null,
        count: 0,
        firstT: 0,
        lastT: 0,
        details: 0,
        detail: 'full',
        arg: null,
        result: null,
      },
      fields
    );
    records.set(rec.key, rec);
    health.recordsTracked++;
    return rec;
  }

  // Имя поверхности бывает известно только в момент вызова. localStorage и
  // sessionStorage — ДВА экземпляра одного Storage.prototype: обёртка на
  // прототипе ловит оба, и различить их можно, лишь сравнив получателя вызова
  // с window.localStorage. Угадывать нельзя: sessionStorage живёт до закрытия
  // вкладки, и приписать ему постоянство значит обвинить в персистентности то,
  // что персистентным не является.
  function имяПоверхности(meta, приёмник) {
    if (!meta.поверхностьПо) return meta.surface;
    try {
      return meta.поверхностьПо(приёмник) || meta.surface;
    } catch (e) {
      return meta.surface;
    }
  }

  function collapse(meta, at, имя) {
    const surface = имя || meta.surface;
    const key = surface + '|counted';
    let rec = records.get(key);
    if (!rec) {
      rec = newRecord({
        key,
        surface,
        group: meta.group,
        cls: meta.cls,
        detail: 'counted',
        firstT: at,
        lastT: at,
      });
    }
    // Счётчик кэшируется на мете только у поверхностей с постоянным именем.
    // У динамических он схлопнул бы localStorage и sessionStorage в одну строку.
    if (!meta.поверхностьПо) meta.countedRec = rec;
    markDegraded(surface);
    return rec;
  }

  function summarize(fn, input) {
    try {
      const v = fn(input);
      if (v == null) return null;
      const s = String(v);
      // «[object Promise]» и «[object NetworkInformation]» человеку не говорят
      // ничего. Показать их значит засорить вывод, притворившись, что мы что-то
      // узнали. Лучше не показывать: отсутствие результата честнее мусора.
      if (/^\[object /.test(s)) return null;
      return s.slice(0, 200);
    } catch (e) {
      return null;
    }
  }

  function record(meta, args, out, startedAt, приёмник) {
    health.callsSeen++;
    const surface = имяПоверхности(meta, приёмник);

    // ── Горячий путь: поверхность схлопнута ────────────────────────────────
    // Ни стека, ни склейки ключа, ни поиска по Map. Время снимаем только пока
    // не набрали exactHotCalls замеров; дальше вызов учитывается счётчиком.
    const counted = meta.countedRec;
    if (counted) {
      counted.count++;
      hotCalls++;
      dirty.add(counted.key);
      return;
    }

    // ── Холодный путь: замеряется всегда, он ограничен потолками ───────────
    const selfStart = performance.now();
    const at = startedAt === undefined ? selfStart : startedAt;

    if (degraded) {
      const rec = collapse(meta, at, surface);
      rec.count++;
      rec.lastT = at;
      dirty.add(rec.key);
      noteCold(selfStart);
      return;
    }

    if (coldCalls >= BUDGET.maxColdCalls) {
      if (!health.coldBudgetExhausted) health.coldBudgetExhausted = true;
      const rec = collapse(meta, at, surface);
      rec.count++;
      rec.lastT = at;
      dirty.add(rec.key);
      noteCold(selfStart);
      return;
    }

    meta.stacks = (meta.stacks || 0) + 1;
    const cap = meta.cls === 'C' ? BUDGET.stacksHotPerSurface : BUDGET.stacksPerSurface;
    if (meta.stacks > cap) {
      const rec = collapse(meta, at, surface);
      rec.count++;
      rec.lastT = at;
      dirty.add(rec.key);
      noteCold(selfStart);
      return;
    }

    const attr = attribution();

    // Для части поверхностей аргумент и есть содержание наблюдения:
    // «опрошено 12 параметров WebGL» бессмысленно без списка параметров.
    // Такие поверхности разводятся по разным записям аргументом.
    const argText = meta.arg ? summarize(meta.arg, args) : null;

    let key = attr
      ? surface + '|' + attr.scriptUrl + ':' + attr.line + ':' + attr.column
      : surface + '|unknown-source';
    if (meta.keyByArg && argText) key += '|' + argText;

    let rec = records.get(key);
    if (!rec) {
      if (records.size >= BUDGET.maxRecords) {
        health.recordsDropped++;
        noteCold(selfStart);
        return;
      }
      rec = newRecord({
        key,
        surface,
        group: meta.group,
        cls: meta.cls,
        attribution: attr,
        firstT: at,
        lastT: at,
      });
    }

    rec.count++;
    rec.lastT = at;

    if (rec.details < BUDGET.detailsPerRecord) {
      rec.details++;
      if (argText !== null) rec.arg = argText;
      if (meta.result) rec.result = summarize(meta.result, out);
    }

    dirty.add(key);
    noteCold(selfStart);
    if (dirty.size >= BUDGET.flushRecords) flush();
  }

  // ── Мост в ISOLATED world ─────────────────────────────────────────────────
  function flush() {
    refreshOverhead();
    if (!dirty.size) return;

    const batch = [];
    for (const key of dirty) {
      const r = records.get(key);
      if (r) batch.push(r);
    }
    dirty.clear();

    try {
      window.dispatchEvent(
        new CustomEvent(CHANNEL, {
          detail: JSON.stringify({ records: batch, health: health, url: location.href }),
        })
      );
    } catch (e) {}
  }

  function onReady() {
    for (const key of records.keys()) dirty.add(key);
    flush();
  }

  function onVisibility() {
    if (document.visibilityState === 'hidden') flush();
  }

  // Слушатели перевзводятся по таймеру, и это не перестраховка.
  // Проверено в Chrome: document.open() сносит слушатели не только с документа,
  // но и с window — при том, что сам объект window остаётся прежним. Фрейм,
  // наполненный через document.write (классический приём рекламных врезок),
  // терял мост: обёртки работали, а наблюдения никуда не шли. Таймеры
  // document.open() переживают, повторная установка слушателя работает.
  function armListeners() {
    window.addEventListener(READY, onReady);
    window.addEventListener('pagehide', flush, true);
    window.addEventListener('visibilitychange', onVisibility);
  }

  setInterval(() => {
    armListeners();
    flush();
  }, BUDGET.flushMs);

  armListeners();

  // ── Обёртки ───────────────────────────────────────────────────────────────
  const ORIGINALS = new WeakMap();

  function findDescriptor(target, prop) {
    let o = target;
    while (o) {
      const d = Object.getOwnPropertyDescriptor(o, prop);
      if (d) return { desc: d, owner: o };
      o = Object.getPrototypeOf(o);
    }
    return null;
  }

  function wrapMethod(target, prop, meta) {
    if (!target) return false;
    const found = findDescriptor(target, prop);
    if (!found || typeof found.desc.value !== 'function') return false;

    const desc = found.desc;
    const original = desc.value;
    const hot = meta.cls === 'C';

    // Две разновидности обёртки. У холодной время снимается ДО вызова — метка
    // «на 1.24 секунде» должна быть точной. У горячей его не снимаем вовсе:
    // на тысячах вызовов сам performance.now() и есть накладной расход.
    const wrapper = hot
      ? function () {
          let out;
          let threw = false;
          try {
            out = original.apply(this, arguments);
          } catch (e) {
            threw = true;
            throw e;
          } finally {
            try {
              record(meta, arguments, threw ? undefined : out, undefined, this);
            } catch (e) {}
          }
          return out;
        }
      : function () {
          const t = performance.now();
          let out;
          let threw = false;
          try {
            out = original.apply(this, arguments);
          } catch (e) {
            threw = true;
            throw e;
          } finally {
            try {
              record(meta, arguments, threw ? undefined : out, t, this);
            } catch (e) {}
          }
          return out;
        };

    try {
      Object.defineProperty(wrapper, 'name', { value: prop, configurable: true });
      Object.defineProperty(wrapper, 'length', { value: original.length, configurable: true });
    } catch (e) {}
    ORIGINALS.set(wrapper, original);

    try {
      Object.defineProperty(found.owner, prop, {
        value: wrapper,
        writable: desc.writable !== false,
        enumerable: desc.enumerable,
        configurable: true,
      });
    } catch (e) {
      return false;
    }
    return true;
  }

  // Геттер и сеттер. Постановка наблюдается отдельной поверхностью, если она
  // задана: чтение куки и её запись — разные события, и путать их нельзя.
  function wrapAccessor(target, prop, meta) {
    if (!target) return false;
    const found = findDescriptor(target, prop);
    if (!found) return false;

    const desc = found.desc;
    if (!desc.get && !desc.set) return false;

    const next = { enumerable: desc.enumerable, configurable: true };
    const hot = meta.cls === 'C';

    if (desc.get) {
      const origGet = desc.get;
      const getter = function () {
        const t = hot ? undefined : performance.now();
        const out = origGet.call(this);
        try {
          record(meta, [], out, t, this);
        } catch (e) {}
        return out;
      };
      try {
        Object.defineProperty(getter, 'name', { value: 'get ' + prop, configurable: true });
      } catch (e) {}
      ORIGINALS.set(getter, origGet);
      next.get = getter;
    }

    if (desc.set) {
      const origSet = desc.set;
      if (meta.onSet) {
        const setMeta = meta.onSet;
        const setter = function (value) {
          const t = performance.now();
          try {
            record(setMeta, [value], undefined, t);
          } catch (e) {}
          return origSet.call(this, value);
        };
        try {
          Object.defineProperty(setter, 'name', { value: 'set ' + prop, configurable: true });
        } catch (e) {}
        ORIGINALS.set(setter, origSet);
        next.set = setter;
      } else {
        next.set = origSet;
      }
    }

    try {
      Object.defineProperty(found.owner, prop, next);
    } catch (e) {
      return false;
    }
    return true;
  }

  // Конструкторы наблюдаются через Proxy: цепочка прототипов и instanceof
  // остаются нетронутыми, в отличие от подмены обычной функцией.
  function wrapConstructor(scope, name, meta) {
    if (!scope) return false;
    const Original = scope[name];
    if (typeof Original !== 'function') return false;

    const proxy = new Proxy(Original, {
      construct(target, args, newTarget) {
        const t = performance.now();
        try {
          record(meta, args, undefined, t);
        } catch (e) {}
        return Reflect.construct(target, args, newTarget);
      },
      apply(target, thisArg, args) {
        const t = performance.now();
        try {
          record(meta, args, undefined, t);
        } catch (e) {}
        return Reflect.apply(target, thisArg, args);
      },
    });

    ORIGINALS.set(proxy, Original);
    try {
      scope[name] = proxy;
    } catch (e) {
      return false;
    }
    return true;
  }

  // Гигиена, а не защита: без этого тривиальная проверка ломает наблюдение.
  // Страница всё равно может обнаружить прибор — предел 1 из 06-limits.md.
  (function maskToString() {
    const nativeToString = Function.prototype.toString;
    const masked = function toString() {
      const original = ORIGINALS.get(this);
      return nativeToString.call(original || this);
    };
    ORIGINALS.set(masked, nativeToString);
    Function.prototype.toString = masked;
  })();

  // ── Реестр поверхностей (04-surfaces.md) ──────────────────────────────────
  const installed = [];
  const installedGroups = [];
  const failed = [];

  // Обёрнуто — не значит наблюдается. Прибор оборачивает методы на ПРОТОТИПАХ;
  // если кто-то положит собственное свойство с тем же именем на сам ЭКЗЕМПЛЯР,
  // поиск по цепочке до прототипа не дойдёт, и обёртка не сработает ни разу.
  // Найдено на живой машине: другое расширение так подменяет
  // WebGLRenderingContext.prototype.getParameter (предел 3б).
  //
  // Для объектов, которые существуют в единственном числе, это проверяется
  // сразу: экземпляр уже есть. Для тех, чьи экземпляры создаются позже —
  // контексты canvas и WebGL — узнать при установке нельзя, и прибор об этом
  // молчать не должен.
  const shadowed = [];

  const ЕДИНСТВЕННЫЕ = new Map();

  function install(kind, target, prop, meta) {
    let ok = false;
    try {
      if (kind === 'method') ok = wrapMethod(target, prop, meta);
      else if (kind === 'accessor') ok = wrapAccessor(target, prop, meta);
      else if (kind === 'ctor') ok = wrapConstructor(target, prop, meta);
    } catch (e) {
      ok = false;
    }
    if (ok) {
      installed.push(meta.surface);

      // Обёртку положили — но доберётся ли до неё чтение? Если на экземпляре
      // уже лежит собственное свойство с тем же именем, не доберётся никогда.
      try {
        const экземпляр = ЕДИНСТВЕННЫЕ.get(target);
        if (экземпляр && Object.prototype.hasOwnProperty.call(экземпляр, prop)) {
          shadowed.push(meta.surface);
        }
      } catch (e) {}
      // Группу шлём вместе с именем, а не выводим потом из имени: вывод по
      // имени — это дублирование правила, которое рано или поздно разъедется
      // с реестром, и знаменатель свода станет враньём.
      installedGroups.push(meta.group);
    } else {
      failed.push(meta.surface);
    }
    return ok;
  }

  const W = window;
  const proto = (name) => (W[name] ? W[name].prototype : null);

  // Заполняется здесь, а не рядом с объявлением карты: proto и W объявлены
  // ниже по файлу, и обращение к ним раньше уронило бы прибор целиком — он не
  // обернул бы ни одной поверхности и молчал бы об этом.
  const единственный = (прототип, экземпляр) => {
    if (прототип && экземпляр) ЕДИНСТВЕННЫЕ.set(прототип, экземпляр);
  };
  единственный(proto('Navigator'), W.navigator);
  единственный(proto('Screen'), W.screen);
  единственный(proto('Document'), W.document);
  единственный(proto('Performance'), W.performance);
  единственный(proto('Storage'), W.localStorage);

  // Имена констант WebGL: без них getParameter(37446) ничего не говорит.
  //
  // Строится ЛЕНИВО, при первом обращении. Раньше карта собиралась на старте, и
  // это стоило 0.30 мс на критическом пути: перебор 863 свойств двух контекстов
  // ради 544 констант. Нужна она только тем страницам, которые действительно
  // зовут webgl.getParameter, — а платили за неё все, включая те, где WebGL не
  // трогают вовсе.
  //
  // Замер LCP показал, что просадку прибору делает установка, а не вызовы.
  // Значит всё, что можно с установки убрать, надо с неё убирать.
  let GL_NAMES = null;

  function glNames() {
    if (GL_NAMES) return GL_NAMES;
    GL_NAMES = new Map();
    for (const Ctor of [W.WebGLRenderingContext, W.WebGL2RenderingContext]) {
      if (!Ctor) continue;
      for (const k of Object.getOwnPropertyNames(Ctor)) {
        const v = Ctor[k];
        if (typeof v === 'number' && /^[A-Z0-9_]+$/.test(k) && !GL_NAMES.has(v)) GL_NAMES.set(v, k);
      }
    }
    // Из WEBGL_debug_renderer_info: самые говорящие, но не константы контекста
    GL_NAMES.set(37445, 'UNMASKED_VENDOR_WEBGL');
    GL_NAMES.set(37446, 'UNMASKED_RENDERER_WEBGL');
    return GL_NAMES;
  }

  const glName = (v) => glNames().get(v) || '0x' + Number(v).toString(16);
  const short = (v) => (v == null ? '' : String(v).slice(0, 120));
  const listLen = (v) => (v && v.length != null ? 'n:' + v.length : short(v));

  // ── Исходящее (Э2) ────────────────────────────────────────────────────────
  //
  // Ставится ДО поверхностей: если обёртка исходящего встанет позже, ранние
  // маячки уйдут неатрибутированными и всплывут как ложный обход.
  //
  // Эти записи НЕ схлопываются по месту вызова: каждый запрос важен сам по себе.
  // Ограничение — счётчик MAX_EGRESS, дальше только количество потерянных.
  //
  // Снятие стека для исходящего идёт в обход общего бюджета подробностей:
  // атрибуция маячка — самое ценное, что прибор умеет, и терять её из-за того,
  // что страница до этого начиталась navigator.userAgent, нельзя.

  const MAX_EGRESS = 500;
  let egressSeq = 0;

  function bodySummary(b) {
    try {
      if (b == null) return { form: 'none', size: 0, text: null };
      if (typeof b === 'string') return { form: 'text', size: b.length, text: b.slice(0, 4000) };
      if (typeof URLSearchParams !== 'undefined' && b instanceof URLSearchParams) {
        const t = b.toString();
        return { form: 'text', size: t.length, text: t.slice(0, 4000) };
      }
      if (typeof FormData !== 'undefined' && b instanceof FormData) {
        const parts = [];
        for (const pair of b.entries()) {
          parts.push(pair[0] + '=' + (typeof pair[1] === 'string' ? pair[1] : '[file]'));
        }
        const t = parts.join('&');
        return { form: 'text', size: t.length, text: t.slice(0, 4000) };
      }
      if (typeof Blob !== 'undefined' && b instanceof Blob) {
        return { form: 'blob', size: b.size, text: null, mime: b.type || '' };
      }
      if (b instanceof ArrayBuffer) return { form: 'binary', size: b.byteLength, text: null };
      if (ArrayBuffer.isView(b)) return { form: 'binary', size: b.byteLength, text: null };
    } catch (e) {}
    return { form: 'unknown', size: null, text: null };
  }

  function absolute(u) {
    try {
      return new URL(String(u), location.href).href;
    } catch (e) {
      return String(u);
    }
  }

  function noteEgress(transport, method, url, body) {
    if (egressSeq >= MAX_EGRESS) {
      health.egressDropped++;
      return null;
    }
    // Исходящее тоже перехвачено — иначе «со снятием стека» окажется больше,
    // чем «вызовов перехвачено», хотя должно быть его частью. Число, которое
    // больше того, чьей частью оно является, подрывает доверие ко всему блоку.
    health.callsSeen++;

    const at = performance.now();
    const attr = attribution();
    const sum = bodySummary(body);

    const rec = newRecord({
      key: 'egress|' + ++egressSeq,
      kind: 'egress',
      surface: 'egress.' + transport,
      group: 'egress',
      cls: 'A',
      transport: transport,
      method: method,
      url: absolute(url),
      bodyForm: sum.form,
      bodySize: sum.size,
      bodyText: sum.text,
      bodyMime: sum.mime || null,
      attribution: attr,
      count: 1,
      firstT: at,
      lastT: at,
      details: 1,
    });
    dirty.add(rec.key);
    noteCold(at);

    // Blob читается асинхронно: тело маячка часто именно в нём, а без него
    // разбирать нечего. Дочитанное дописывается в ту же запись.
    if (sum.form === 'blob' && body && body.size <= 64 * 1024) {
      const mime = sum.mime || '';
      const текстовый =
        !mime ||
        mime.indexOf('text/') === 0 ||
        mime.indexOf('json') >= 0 ||
        mime.indexOf('form-urlencoded') >= 0;
      if (текстовый) {
        try {
          body.text().then(
            function (t) {
              rec.bodyText = t.slice(0, 4000);
              rec.bodyForm = 'text';
              dirty.add(rec.key);
            },
            function () {}
          );
        } catch (e) {}
      }
    }
    return rec;
  }

  // Обёртки исходящего отмечаются ТОЙ ЖЕ парой списков, что и поверхности.
  // Шесть из них когда-то писали только в installed, и списки разъезжались на
  // шесть позиций: каждая поверхность получала группу соседа, а знаменатель
  // свода считался по чужим группам. Ровно то, о чём предупреждает комментарий
  // в install(). Найдено на снимке fingerprint.com: surfaces начинались с
  // egress.*, а surfaceGroups — с canvas.
  // Поверхность, которую наблюдает уже поставленная обёртка. Отдельной
  // установки не требует, но в реестре быть обязана.
  function отмеченаТакже(имя, группа) {
    installed.push(имя);
    installedGroups.push(группа);
  }

  function отмечен(имя) {
    installed.push(имя);
    installedGroups.push('egress');
  }

  (function installEgress() {
    // sendBeacon — основной транспорт аналитики
    const navProto = W.Navigator && W.Navigator.prototype;
    if (navProto && typeof navProto.sendBeacon === 'function') {
      const orig = navProto.sendBeacon;
      const wrapper = function (url, data) {
        try {
          noteEgress('beacon', 'POST', url, data);
        } catch (e) {}
        return orig.apply(this, arguments);
      };
      try {
        Object.defineProperty(wrapper, 'name', { value: 'sendBeacon', configurable: true });
        Object.defineProperty(wrapper, 'length', { value: orig.length, configurable: true });
      } catch (e) {}
      ORIGINALS.set(wrapper, orig);
      navProto.sendBeacon = wrapper;
      отмечен('egress.beacon');
    }

    // fetch
    if (typeof W.fetch === 'function') {
      const orig = W.fetch;
      const wrapper = function (input, init) {
        try {
          let url = input;
          let method = 'GET';
          let body = null;
          if (input && typeof input === 'object' && typeof input.url === 'string') {
            url = input.url;
            method = input.method || 'GET';
          }
          if (init) {
            if (init.method) method = init.method;
            if (init.body != null) body = init.body;
          }
          noteEgress('fetch', String(method).toUpperCase(), url, body);
        } catch (e) {}
        return orig.apply(this, arguments);
      };
      try {
        Object.defineProperty(wrapper, 'name', { value: 'fetch', configurable: true });
        Object.defineProperty(wrapper, 'length', { value: orig.length, configurable: true });
      } catch (e) {}
      ORIGINALS.set(wrapper, orig);
      W.fetch = wrapper;
      отмечен('egress.fetch');
    }

    // XHR: адрес известен в open, тело — в send
    const xhrProto = W.XMLHttpRequest && W.XMLHttpRequest.prototype;
    if (xhrProto) {
      const pending = new WeakMap();
      const origOpen = xhrProto.open;
      const origSend = xhrProto.send;

      const openWrap = function (method, url) {
        try {
          pending.set(this, { method: String(method).toUpperCase(), url: url });
        } catch (e) {}
        return origOpen.apply(this, arguments);
      };
      const sendWrap = function (body) {
        try {
          const info = pending.get(this) || { method: 'GET', url: '' };
          noteEgress('xhr', info.method, info.url, body);
        } catch (e) {}
        return origSend.apply(this, arguments);
      };
      try {
        Object.defineProperty(openWrap, 'name', { value: 'open', configurable: true });
        Object.defineProperty(sendWrap, 'name', { value: 'send', configurable: true });
      } catch (e) {}
      ORIGINALS.set(openWrap, origOpen);
      ORIGINALS.set(sendWrap, origSend);
      xhrProto.open = openWrap;
      xhrProto.send = sendWrap;
      отмечен('egress.xhr');
    }

    // Пиксель через Image.src
    const imgProto = W.HTMLImageElement && W.HTMLImageElement.prototype;
    if (imgProto) {
      const d = Object.getOwnPropertyDescriptor(imgProto, 'src');
      if (d && d.set) {
        const origSet = d.set;
        const setter = function (v) {
          try {
            noteEgress('image', 'GET', v, null);
          } catch (e) {}
          return origSet.call(this, v);
        };
        ORIGINALS.set(setter, origSet);
        try {
          Object.defineProperty(imgProto, 'src', {
            get: d.get,
            set: setter,
            enumerable: d.enumerable,
            configurable: true,
          });
          отмечен('egress.image');
        } catch (e) {}
      }
    }

    // WebSocket и EventSource — конструкторы
    const конструкторы = [
      ['WebSocket', 'websocket'],
      ['EventSource', 'eventsource'],
    ];
    for (const пара of конструкторы) {
      const name = пара[0];
      const transport = пара[1];
      if (typeof W[name] !== 'function') continue;
      const Original = W[name];
      const proxy = new Proxy(Original, {
        construct: function (target, args, newTarget) {
          try {
            noteEgress(transport, 'GET', args[0], null);
          } catch (e) {}
          return Reflect.construct(target, args, newTarget);
        },
      });
      ORIGINALS.set(proxy, Original);
      try {
        W[name] = proxy;
        отмечен('egress.' + transport);
      } catch (e) {}
    }
  })();


  // ── canvas ────────────────────────────────────────────────────────────────
  const CANVAS = proto('HTMLCanvasElement');
  const C2D = proto('CanvasRenderingContext2D');

  install('method', CANVAS, 'toDataURL', {
    surface: 'canvas.toDataURL', group: 'canvas', cls: 'A',
    arg: (a) => (a.length ? String(a[0]) : 'image/png'),
    result: (r) => (typeof r === 'string' ? 'chars:' + r.length : ''),
  });
  install('method', CANVAS, 'toBlob', {
    surface: 'canvas.toBlob', group: 'canvas', cls: 'A',
    arg: (a) => (a.length > 1 ? String(a[1]) : 'image/png'),
  });
  install('method', proto('OffscreenCanvas'), 'convertToBlob', {
    surface: 'canvas.convertToBlob', group: 'canvas', cls: 'A',
  });
  install('method', C2D, 'getImageData', {
    surface: 'canvas.getImageData', group: 'canvas', cls: 'C',
    arg: (a) => 'rect:' + a[2] + 'x' + a[3] + '@' + a[0] + ',' + a[1],
  });
  install('method', C2D, 'measureText', {
    surface: 'canvas.measureText', group: 'canvas', cls: 'C',
    arg: (a) => String(a[0]).slice(0, 60),
    result: (r) => (r && typeof r.width === 'number' ? r.width.toFixed(2) + ' px' : ''),
  });
  install('method', C2D, 'isPointInPath', {
    surface: 'canvas.isPointInPath', group: 'canvas', cls: 'C',
  });

  // ── webgl ─────────────────────────────────────────────────────────────────
  // getParameter отнесён к классу B, а не C: аргумент здесь и есть содержание
  // наблюдения, а схлопывание в счётчик его бы стёрло.
  for (const name of ['WebGLRenderingContext', 'WebGL2RenderingContext']) {
    const P = proto(name);
    if (!P) continue;
    install('method', P, 'getParameter', {
      surface: 'webgl.getParameter', group: 'webgl', cls: 'B', keyByArg: true,
      arg: (a) => glName(a[0]),
      result: (r) =>
        Array.isArray(r) || ArrayBuffer.isView(r) ? Array.from(r).join(', ') : short(r),
    });
    install('method', P, 'getExtension', {
      surface: 'webgl.getExtension', group: 'webgl', cls: 'B', keyByArg: true,
      arg: (a) => String(a[0]),
      result: (r) => (r ? 'yes' : 'no'),
    });
    install('method', P, 'getSupportedExtensions', {
      surface: 'webgl.getSupportedExtensions', group: 'webgl', cls: 'A', result: listLen,
    });
    install('method', P, 'getShaderPrecisionFormat', {
      surface: 'webgl.getShaderPrecisionFormat', group: 'webgl', cls: 'B', keyByArg: true,
      arg: (a) => glName(a[0]) + '/' + glName(a[1]),
    });
  }
  if (W.navigator.gpu) {
    install('method', Object.getPrototypeOf(W.navigator.gpu), 'requestAdapter', {
      surface: 'webgpu.requestAdapter', group: 'webgl', cls: 'A',
    });
  }

  // ── аудио ─────────────────────────────────────────────────────────────────
  install('ctor', W, 'OfflineAudioContext', {
    surface: 'audio.OfflineAudioContext', group: 'audio', cls: 'A',
    arg: (a) => (a.length > 1 ? 'audio:' + a[0] + ',' + a[1] : ''),
  });
  install('ctor', W, 'AudioContext', { surface: 'audio.AudioContext', group: 'audio', cls: 'A' });

  const BASE_AUDIO = proto('BaseAudioContext');
  install('method', BASE_AUDIO, 'createDynamicsCompressor', {
    surface: 'audio.createDynamicsCompressor', group: 'audio', cls: 'A',
  });
  install('method', BASE_AUDIO, 'createOscillator', {
    surface: 'audio.createOscillator', group: 'audio', cls: 'A',
  });
  install('method', proto('AnalyserNode'), 'getFloatFrequencyData', {
    surface: 'audio.getFloatFrequencyData', group: 'audio', cls: 'B',
  });
  install('method', proto('AudioBuffer'), 'getChannelData', {
    surface: 'audio.getChannelData', group: 'audio', cls: 'B',
  });

  // ── шрифты ────────────────────────────────────────────────────────────────
  if (document.fonts) {
    install('method', Object.getPrototypeOf(document.fonts), 'check', {
      surface: 'fonts.check', group: 'fonts', cls: 'B', keyByArg: true,
      arg: (a) => String(a[0]).slice(0, 60),
      result: (r) => (r ? 'yes' : 'no'),
    });
  }

  // ── среда ─────────────────────────────────────────────────────────────────
  const NAV = proto('Navigator');
  const SCR = proto('Screen');

  for (const p of [
    'userAgent', 'language', 'languages', 'platform', 'hardwareConcurrency',
    'deviceMemory', 'maxTouchPoints', 'plugins', 'mimeTypes', 'webdriver',
    'pdfViewerEnabled', 'doNotTrack', 'vendor', 'appVersion', 'connection',
  ]) {
    install('accessor', NAV, p, {
      surface: 'navigator.' + p, group: 'device', cls: 'B',
      result: (r) => (r && typeof r !== 'string' && r.length != null ? listLen(r) : short(r)),
    });
  }

  for (const p of ['width', 'height', 'availWidth', 'availHeight', 'colorDepth', 'pixelDepth']) {
    install('accessor', SCR, p, {
      surface: 'screen.' + p, group: 'device', cls: 'B', result: short,
    });
  }

  install('accessor', W, 'devicePixelRatio', {
    surface: 'window.devicePixelRatio', group: 'device', cls: 'B', result: short,
  });
  install('method', W.Intl && W.Intl.DateTimeFormat && W.Intl.DateTimeFormat.prototype,
    'resolvedOptions', {
      surface: 'intl.resolvedOptions', group: 'device', cls: 'B',
      result: (r) => (r && r.timeZone ? r.timeZone : ''),
    });
  install('method', Date.prototype, 'getTimezoneOffset', {
    surface: 'date.getTimezoneOffset', group: 'device', cls: 'B', result: short,
  });
  install('method', W, 'matchMedia', {
    surface: 'window.matchMedia', group: 'device', cls: 'B', keyByArg: true,
    arg: (a) => String(a[0]).slice(0, 80),
    result: (r) => (r && r.matches ? 'yes' : 'no'),
  });
  if (W.NavigatorUAData) {
    install('method', proto('NavigatorUAData'), 'getHighEntropyValues', {
      surface: 'navigator.getHighEntropyValues', group: 'device', cls: 'A',
      arg: (a) => (Array.isArray(a[0]) ? a[0].join(', ') : ''),
    });
  }

  // ── идентификаторы и хранилище ────────────────────────────────────────────
  // Значения не записываем: здесь живут сессионные токены. Имя и срок жизни —
  // достаточно для факта и безопасно для экспорта (03-data-model.md).
  install('accessor', proto('Document'), 'cookie', {
    surface: 'cookie.read', group: 'storage', cls: 'B',
    result: (r) => 'cookies:' + (r ? String(r).split(';').length : 0),
    onSet: {
      surface: 'cookie.write', group: 'storage', cls: 'B', keyByArg: true,
      arg: (a) => {
        const s = String(a[0]);
        const name = s.split('=')[0].trim();
        const age = /max-age=(\d+)/i.exec(s);
        const exp = /expires=([^;]+)/i.exec(s);
        if (age) return name + ' | days:' + Math.round(+age[1] / 86400);
        if (exp) return name + ' | until:' + exp[1].trim();
        return name;
      },
    },
  });

  // localStorage и sessionStorage — два экземпляра ОДНОГО Storage.prototype.
  // Обёртка на прототипе ловит оба, и различить их можно только сравнением
  // получателя вызова. Раньше всё подписывалось «localStorage», и запись в
  // sessionStorage — которая исчезает с закрытием вкладки — выглядела как
  // постоянная. Обвинять в персистентности то, что персистентным не является,
  // прибору нельзя.
  //
  // Именно сравнением, а не поиском отличий: спрашиваем получателя, а не
  // угадываем по косвенным признакам.
  const STORAGE = proto('Storage');
  const какоеХранилище = (приёмник) => {
    if (приёмник === W.sessionStorage) return 'sessionStorage';
    if (приёмник === W.localStorage) return 'localStorage';
    // Storage бывает и чужой — например у другого окна. Врать про него нечем.
    return 'storage';
  };
  install('method', STORAGE, 'setItem', {
    surface: 'localStorage.setItem', group: 'storage', cls: 'B', keyByArg: true,
    поверхностьПо: (п) => какоеХранилище(п) + '.setItem',
    arg: (a) => String(a[0]).slice(0, 60) + ' | chars:' + String(a[1]).length,
  });
  install('method', STORAGE, 'getItem', {
    surface: 'localStorage.getItem', group: 'storage', cls: 'B', keyByArg: true,
    поверхностьПо: (п) => какоеХранилище(п) + '.getItem',
    arg: (a) => String(a[0]).slice(0, 60),
  });
  // Одной обёрткой наблюдаются обе поверхности, и реестр обязан назвать обе:
  // иначе знаменатель свода и список наблюдаемого умолчат про sessionStorage.
  отмеченаТакже('sessionStorage.setItem', 'storage');
  отмеченаТакже('sessionStorage.getItem', 'storage');

  install('method', proto('IDBFactory'), 'open', {
    surface: 'indexedDB.open', group: 'storage', cls: 'A', keyByArg: true,
    arg: (a) => String(a[0]).slice(0, 60),
  });
  if (W.navigator.storage) {
    install('method', Object.getPrototypeOf(W.navigator.storage), 'estimate', {
      surface: 'storage.estimate', group: 'storage', cls: 'A',
    });
  }
  if (W.caches) {
    install('method', proto('CacheStorage'), 'open', {
      surface: 'caches.open', group: 'storage', cls: 'A', keyByArg: true,
      arg: (a) => String(a[0]).slice(0, 60),
    });
  }

  // ── оборудование и разрешения ─────────────────────────────────────────────
  if (W.navigator.mediaDevices) {
    install('method', proto('MediaDevices'), 'enumerateDevices', {
      surface: 'media.enumerateDevices', group: 'hardware', cls: 'A', result: listLen,
    });
  }
  if (W.navigator.permissions) {
    install('method', proto('Permissions'), 'query', {
      surface: 'permissions.query', group: 'hardware', cls: 'B', keyByArg: true,
      arg: (a) => (a[0] && a[0].name ? String(a[0].name) : ''),
    });
  }
  if (W.speechSynthesis) {
    install('method', proto('SpeechSynthesis'), 'getVoices', {
      surface: 'speech.getVoices', group: 'hardware', cls: 'B', result: listLen,
    });
  }
  install('method', NAV, 'getBattery', {
    surface: 'navigator.getBattery', group: 'hardware', cls: 'A',
  });
  install('ctor', W, 'RTCPeerConnection', {
    surface: 'webrtc.RTCPeerConnection', group: 'hardware', cls: 'A',
  });

  // ── уход в тень ───────────────────────────────────────────────────────────
  // Не поверхности отпечатка, а контекст для детектора обхода на Э2.
  install('ctor', W, 'Worker', {
    surface: 'shadow.Worker', group: 'shadow', cls: 'A', keyByArg: true,
    arg: (a) => String(a[0]).slice(0, 120),
  });
  install('ctor', W, 'SharedWorker', {
    surface: 'shadow.SharedWorker', group: 'shadow', cls: 'A',
    arg: (a) => String(a[0]).slice(0, 120),
  });
  if (W.navigator.serviceWorker) {
    install('method', proto('ServiceWorkerContainer'), 'register', {
      surface: 'shadow.serviceWorker.register', group: 'shadow', cls: 'A',
      arg: (a) => String(a[0]).slice(0, 120),
    });
  }
  install('accessor', proto('HTMLIFrameElement'), 'srcdoc', {
    surface: 'shadow.iframe.srcdoc.read', group: 'shadow', cls: 'A',
    onSet: {
      surface: 'shadow.iframe.srcdoc', group: 'shadow', cls: 'A',
      arg: (a) => 'html:' + String(a[0]).length,
    },
  });
  install('accessor', proto('HTMLScriptElement'), 'src', {
    surface: 'shadow.script.src.read', group: 'shadow', cls: 'B',
    onSet: {
      surface: 'shadow.script.src', group: 'shadow', cls: 'B', keyByArg: true,
      arg: (a) => String(a[0]).slice(0, 120),
    },
  });

  // document.write наблюдается не ради отпечатка: именно он сносит слушатели
  // моста, и счётчик подмен документа в панели объясняется этими записями.
  const DOC = proto('Document');
  install('method', DOC, 'write', {
    surface: 'shadow.document.write', group: 'shadow', cls: 'B',
    arg: (a) => 'chars:' + String(a[0] == null ? '' : a[0]).length,
  });
  install('method', DOC, 'writeln', {
    surface: 'shadow.document.writeln', group: 'shadow', cls: 'B',
  });
  install('method', DOC, 'open', { surface: 'shadow.document.open', group: 'shadow', cls: 'B' });

  // ── Отметка о самом приборе ───────────────────────────────────────────────
  health.surfacesInstalled = installed.length;
  health.surfacesFailed = failed;
  // Обёрнуты, но перекрыты на экземпляре: обёртка стоит, а вызовы мимо неё.
  // Проверено только для объектов, существующих в единственном числе.
  health.surfacesShadowed = shadowed;
  // Сколько прибор занял до того, как страница выполнила хоть строчку своего кода.
  health.installMs = +(performance.now() - T_СТАРТ).toFixed(2);

  const at = performance.now();
  newRecord({
    key: '__installed',
    kind: 'installed',
    surface: 'instrument.installed',
    group: 'meta',
    cls: 'A',
    count: 1,
    firstT: at,
    lastT: at,
    details: 1,
    arg:
      'surfaces:' + installed.length +
      (failed.length ? ' failed:' + failed.length + ':' + failed.join(',') : ''),
    // Полный список наблюдаемых поверхностей уходит ОДИН раз, вместе с отметкой
    // об установке. Он нужен, чтобы свод мог честно сказать «снято 9 из 14»:
    // без знаменателя это была бы выдумка, а слать его каждым залпом — расточительство.
    surfaces: installed.slice(),
    surfaceGroups: installedGroups.slice(),
    // Перекрытые уходят вместе со списком: без них знаменатель свода считал бы
    // наблюдаемым то, что не наблюдается.
    shadowed: shadowed.slice(),
    result: SELF_URL ? 'self:known' : 'self:unknown',
  });
  dirty.add('__installed');
  flush();
})();
