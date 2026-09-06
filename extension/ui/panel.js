// Боковая панель.
//
// Порт до service worker держит его живым, пока панель открыта. Это
// оптимизация, а не механизм корректности: всё обязано работать и с закрытой
// панелью, поэтому состояние панель всегда перечитывает, а не копит у себя.

(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  // Панель читают люди. «2 записей» подрывает доверие к тексту раньше, чем
  // содержание успевает сработать, а весь этап Э4 именно про это.
  function склонение(n, одна, две, много) {
    const сотня = n % 100;
    if (сотня >= 11 && сотня <= 14) return n + ' ' + много;
    const единица = n % 10;
    if (единица === 1) return n + ' ' + одна;
    if (единица >= 2 && единица <= 4) return n + ' ' + две;
    return n + ' ' + много;
  }

  let currentTab = null; // кэшируется, чтобы жест пользователя не тратился на await
  let port = null;

  // ── Связь с service worker ────────────────────────────────────────────────

  // Инструмент шлёт залпы раз в 200 мс, сеть — на каждый запрос. Перерисовывать
  // панель по каждому сообщению значит до пяти полных перерисовок в секунду, и
  // каждая заставляет service worker пересводить источники. Прибор, который сам
  // себя тормозит, противоречит всему, ради чего мы бились за 0.155 мкс на вызов.
  const ПАУЗА_ОБНОВЛЕНИЯ = 600;
  let таймерОбновления = null;
  let ждётОбновления = false;

  function запланироватьОбновление() {
    if (таймерОбновления) {
      ждётОбновления = true;
      return;
    }
    refresh();
    таймерОбновления = setTimeout(() => {
      таймерОбновления = null;
      if (ждётОбновления) {
        ждётОбновления = false;
        запланироватьОбновление();
      }
    }, ПАУЗА_ОБНОВЛЕНИЯ);
  }

  function connect() {
    port = chrome.runtime.connect({ name: 'panel' });
    port.onMessage.addListener((msg) => {
      if (!currentTab || msg.tabId !== currentTab.id) return;
      запланироватьОбновление();
    });
    port.onDisconnect.addListener(() => {
      port = null;
      // Worker уснул или перезапустился — переподключаемся и перечитываем.
      setTimeout(() => {
        connect();
        прошлаяПодпись = null;
        refresh();
      }, 300);
    });
  }

  function ask(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (r) => {
        void chrome.runtime.lastError;
        resolve(r || null);
      });
    });
  }

  // ── Текущая вкладка ───────────────────────────────────────────────────────

  async function loadTab() {
    // Другая вкладка или другой адрес: прошлая подпись к ним не относится,
    // а наполовину нажатое подтверждение стирания — тем более.
    прошлаяПодпись = null;
    сброситьПодтверждение();
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTab = tab || null;

    const box = $('origin');
    if (!currentTab || !/^https?:/.test(currentTab.url || '')) {
      box.textContent = 'Вкладка недоступна для наблюдения';
      $('start').disabled = true;
      return;
    }
    $('start').disabled = false;
    box.textContent = new URL(currentTab.url).origin;
  }

  // ── Отрисовка ─────────────────────────────────────────────────────────────

  function esc(v) {
    return String(v == null ? '' : v);
  }

  function attributionLine(a) {
    if (!a) return { text: 'источник не определён', cls: 'unknown' };

    // Непосредственный вызывающий — ДРУГОЕ расширение в этом браузере, а не
    // сайт. Найдено на живой машине: расширение подменило конструктор Worker и
    // само делало запросы. Приписать их странице значило бы оболгать сайт.
    if (a.viaExtension) {
      if (!a.scriptUrl) {
        return {
          text: 'другое расширение в вашем браузере: ' + a.viaExtension,
          cls: 'ext',
          badge: 'не сайт',
        };
      }
      const s = a.scriptUrl.length > 50 ? '…' + a.scriptUrl.slice(-47) : a.scriptUrl;
      return {
        text: 'другое расширение (' + a.viaExtension + '), ниже по стеку ' + s + ':' + a.line,
        cls: 'ext',
        badge: 'не сайт',
      };
    }

    const short = a.scriptUrl.length > 70 ? '…' + a.scriptUrl.slice(-67) : a.scriptUrl;
    return {
      text: short + ':' + a.line + ':' + a.column,
      cls: a.thirdParty ? 'third' : a.inline ? 'inline' : 'first',
      badge: a.thirdParty ? 'сторонний' : a.inline ? 'встроенный' : 'первая сторона',
    };
  }

  function renderHealth(session, recording) {
    const el = $('health');
    if (!session) {
      el.textContent = recording ? 'Запись включена, наблюдений пока нет.' : '';
      return;
    }
    const h = session.health;

    const rows = [
      ['Записей', h.eventsRecorded],
      ['Вызовов перехвачено', h.callsSeen != null ? h.callsSeen : '—'],
      ['Фреймов с прибором', h.instrumentedFrames],
      ['Поверхностей обёрнуто', h.surfacesInstalled != null ? h.surfacesInstalled : '—'],
      ['Потеряно записей', h.eventsDropped],
      ['Потерь на мосту', h.bridgeGaps],
      ['Подмен документа', h.documentReplacements || 0],
      ['Перезапусков worker', h.swRestarts],
      ['Со снятием стека', h.coldCalls != null ? h.coldCalls : '—'],
      ['На них ушло, мс', h.coldMs != null ? h.coldMs : '—'],
      ['Счётчиком, без стека', h.hotCalls != null ? h.hotCalls : '—'],
      ['Вызовов в секунду', h.callsPerSecond != null ? h.callsPerSecond : '—'],
    ];

    el.textContent = '';
    const grid = document.createElement('div');
    grid.className = 'health-grid';
    for (const [k, v] of rows) {
      const cell = document.createElement('div');
      const bad = (k === 'Потеряно записей' || k === 'Потерь на мосту') && Number(v) > 0;
      cell.className = 'health-cell' + (bad ? ' bad' : '');
      cell.innerHTML = '<span class="hk"></span><span class="hv"></span>';
      cell.querySelector('.hk').textContent = k;
      cell.querySelector('.hv').textContent = esc(v);
      grid.appendChild(cell);
    }
    el.appendChild(grid);

    // Сводка детектора обхода. Главное число этапа Э2: прибор не всегда может
    // сказать «кто», но всегда может сказать «мимо меня прошло вот это».
    const c = h.confirmed || 0;
    const no = h.networkOnly || 0;
    const ho = h.hookOnly || 0;
    const un = h.unobserved || 0;
    if (c + no + ho + un > 0) {
      const v = document.createElement('div');
      v.className = 'verdict';
      v.innerHTML =
        'Сверка источников: <b>' + c + '</b> подтверждено обоими, ' +
        '<b class="' + (no ? 'bad' : '') + '">' + no + '</b> прошло мимо инструментации, ' +
        '<b>' + ho + '</b> не дошло до сети, ' +
        '<b>' + (h.noNetworkSource || 0) + '</b> нечем проверить (WebSocket), ' +
        '<b>' + un + '</b> вне наблюдения — стили, скрипты, шрифты, картинки. ' +
        'Они посчитаны, но не показаны: обвинять их не в чем, а списком они ' +
        'утопили бы маячки.';
      el.appendChild(v);
    }

    // Прибор показывает только то, что действительно измерил. Время вызовов
    // со снятием стека измеримо; время вызовов-счётчиков — нет, оно меньше
    // точности, с которой прибор способен замерить себя изнутри.
    {
      const n = document.createElement('div');
      n.className = 'note';
      n.textContent =
        'Время показано только для вызовов со снятием стека — их можно замерить. ' +
        'Вызовы-счётчики стоят меньше, чем сам замер, поэтому их время не показано.';
      el.appendChild(n);
    }

    // Молчаливая деградация запрещена: если прибор снизил детализацию,
    // он обязан это сказать.
    if (h.killSwitchTripped) {
      const w = document.createElement('div');
      w.className = 'warn';
      w.textContent =
        'Прибор снизил детализацию, чтобы не мешать странице. Дальнейшие вызовы идут счётчиком без привязки к скрипту.';
      el.appendChild(w);
    }
    if (h.coldBudgetExhausted) {
      const w = document.createElement('div');
      w.className = 'warn';
      w.textContent =
        'Бюджет подробностей исчерпан. Дальнейшие вызовы считаются, но не ' +
        'привязываются к скрипту: снятие стека стоит около 25 мкс, и без ' +
        'потолка прибор заметно замедлил бы страницу.';
      el.appendChild(w);
    }
    if (h.degradedSurfaces && h.degradedSurfaces.length) {
      const w = document.createElement('div');
      w.className = 'note';
      w.textContent = 'Схлопнуты до счётчика: ' + h.degradedSurfaces.join(', ');
      el.appendChild(w);
    }
    // Поверхность, которую не удалось обернуть, — это слепое пятно. Молчать
    // о нём нельзя: пустота в журнале читалась бы как «ничего не было».
    if (h.surfacesFailed && h.surfacesFailed.length) {
      const w = document.createElement('div');
      w.className = 'warn';
      w.textContent =
        'Не удалось обернуть: ' + h.surfacesFailed.join(', ') +
        '. По этим поверхностям прибор слеп.';
      el.appendChild(w);
    }
    if (session.truncated) {
      const w = document.createElement('div');
      w.className = 'warn';
      w.textContent = 'Журнал обрезан по потолку размера. Часть наблюдений не сохранена.';
      el.appendChild(w);
    }
  }

  // Разбор формата в разметку.
  //
  // Счётчик неопознанного показывается всегда и рядом с датой схемы. Так
  // интерфейс сам сообщает о своём устаревании: когда GA4 добавит поле,
  // человек увидит «не опознано 4» вместо тихой лжи.
  function разборВРазметку(p) {
    const box = document.createElement('div');
    box.className = 'parsed';

    const head = document.createElement('div');
    head.className = 'parsed-head';
    const итог =
      'разобрано ' + p.knownCount + ', не опознано ' + p.unknownCount;
    head.innerHTML =
      '<span class="parser-name"></span><span class="parser-ver"></span>' +
      '<span class="parser-count' + (p.unknownCount ? ' warn-count' : '') + '"></span>';
    head.querySelector('.parser-name').textContent = p.parserTitle;
    head.querySelector('.parser-ver').textContent = 'схема от ' + p.parserVersion;
    head.querySelector('.parser-count').textContent = итог;
    box.appendChild(head);

    for (const g of p.groups) {
      if (p.groups.length > 1) {
        const gt = document.createElement('div');
        gt.className = 'group-title';
        gt.textContent = g.title;
        box.appendChild(gt);
      }
      for (const f of g.fields) {
        const fr = document.createElement('div');
        fr.className = 'field' + (f.label ? '' : ' unknown-field');

        const label = document.createElement('span');
        label.className = 'f-label';
        label.textContent = f.label || 'не опознано';

        const name = document.createElement('span');
        name.className = 'f-name';
        name.textContent = f.name;

        const value = document.createElement('span');
        value.className = 'f-value';
        value.textContent = f.value;

        fr.appendChild(label);
        fr.appendChild(name);
        fr.appendChild(value);
        box.appendChild(fr);

        if (f.note) {
          const n = document.createElement('div');
          n.className = 'f-note';
          n.textContent = f.note;
          box.appendChild(n);
        }
      }
    }
    return box;
  }

  // Свод фактов. Каждый факт обязан ссылаться на записанные события — это
  // проверяется тестом, но и здесь показывается человеку: сколько наблюдений
  // стоит за утверждением.
  function renderFacts(свод, session) {
    const box = $('facts');
    box.textContent = '';

    if (!свод || !свод.facts.length) {
      const p = document.createElement('p');
      p.className = 'empty';
      p.textContent = session ? 'Пока ничего не собрано.' : 'Записи нет.';
      box.appendChild(p);
      return;
    }

    for (const f of свод.facts) {
      const card = document.createElement('div');
      card.className = 'fact' + (f.id === 'evasion' ? ' evasion' : '');

      const t = document.createElement('div');
      t.className = 'fact-text';
      t.textContent = f.text;
      card.appendChild(t);

      if (f.value) {
        const v = document.createElement('div');
        v.className = 'fact-value';
        v.textContent = f.value;
        card.appendChild(v);
      }
      if (f.note) {
        const n = document.createElement('div');
        n.className = 'fact-note';
        n.textContent = f.note;
        card.appendChild(n);
      }

      // Доказательство. Факт без него — баг сборки, и мы это показываем.
      const ev = document.createElement('div');
      ev.className = 'fact-ev';
      ev.textContent =
        'основание: ' +
        склонение(f.evidence.length, 'запись', 'записи', 'записей') +
        ' в журнале';
      card.appendChild(ev);

      box.appendChild(card);
    }

    // Счётчик снятого вместо битов энтропии
    const c = свод.coverage;
    const cov = document.createElement('div');
    cov.className = 'coverage';
    cov.innerHTML =
      'Снято поверхностей отпечатка: <b></b> из <b></b>.' +
      '<span class="why"></span>';
    const b = cov.querySelectorAll('b');
    b[0].textContent = c.снято;
    b[1].textContent = c.наблюдается == null ? '?' : c.наблюдается;
    cov.querySelector('.why').textContent =
      'Битов энтропии здесь нет намеренно: их не существует без распределения ' +
      'по всем пользователям, а прибор стоит на одной машине. Любое такое ' +
      'число было бы доверием к чужому датасету, а не измерением.';
    box.appendChild(cov);
  }

  function renderEgress(session) {
    const box = $('egress');
    box.textContent = '';

    const list = (session ? session.events : []).filter((e) => e.kind === 'egress');
    if (!list.length) {
      const p = document.createElement('p');
      p.className = 'empty';
      p.textContent = session ? 'Исходящего не было.' : 'Записи нет.';
      box.appendChild(p);
      return;
    }

    // Порядок по значимости, а не по времени. Ничего не скрываем, но и не
    // топим главное во второстепенном: тридцать картинок с параметрами —
    // законное исходящее, однако обход прибора важнее, а запрос с телом
    // содержательнее пустого GET.
    const вес = (e) => {
      if (e.match === 'network-only') return 0;
      if (e.bodyText || e.netBodyText) return 1;
      if (e.match === 'hook-only') return 2;
      return 3;
    };
    list.sort((a, b) => вес(a) - вес(b) || (a.t || 0) - (b.t || 0));

    const счёт = document.createElement('p');
    счёт.className = 'note';
    счёт.textContent =
      склонение(list.length, 'Запись', 'Записи', 'Записей') +
      '. Сверху обходы, затем запросы с телом, затем остальное.';
    box.appendChild(счёт);

    const frame = document.createElement('section');
    frame.className = 'frame';

    for (const e of list) {
      const row = document.createElement('div');
      row.className = 'eg';

      const head = document.createElement('div');
      head.className = 'eg-head';

      const method = document.createElement('span');
      method.className = 'eg-method';
      method.textContent = e.method || '';

      const transport = document.createElement('span');
      transport.className = 'eg-transport';
      transport.textContent = e.transport || '';

      const m = document.createElement('span');
      m.className = 'm m-' + (e.match || 'ожидает');
      m.textContent =
        e.match === 'network-only'
          ? 'прошло мимо прибора'
          : e.match === 'confirmed'
            ? 'подтверждено сетью'
            : e.match === 'hook-only'
              ? 'в сеть не ушло'
              : e.match === 'no-network-source'
                ? 'сетью не проверяется'
                : e.match === 'unobserved'
                  ? 'вне наблюдения'
                  : 'ожидает';

      const url = document.createElement('span');
      url.className = 'eg-url';
      url.textContent = e.url || '';

      head.appendChild(method);
      head.appendChild(transport);
      head.appendChild(m);
      head.appendChild(url);
      row.appendChild(head);

      const текст = e.bodyText || e.netBodyText;

      if (e.parsed) {
        row.appendChild(разборВРазметку(e.parsed));
      } else if (текст) {
        // Разборщика на этот адрес нет. Показываем тело как есть и говорим об
        // этом прямо: «формат не опознан» — не то же самое, что «полей нет».
        const b = document.createElement('div');
        b.className = 'eg-body';
        b.textContent =
          'формат не опознан, тело как есть: ' +
          текст.slice(0, 400) + (текст.length > 400 ? ' …' : '');
        row.appendChild(b);
      } else if (e.bodySize) {
        const b = document.createElement('div');
        b.className = 'eg-body';
        b.textContent = 'тело: ' + e.bodySize + ' байт, ' + (e.bodyForm || '');
        row.appendChild(b);
      }

      const meta = [];
      if (e.attribution) {
        const a = attributionLine(e.attribution);
        meta.push(a.badge + ': ' + a.text);
      } else if (e.source === 'network') {
        // Источник не определён и выдумывать его нельзя
        meta.push('источник не определён — наблюдение только из сети');
      }
      if (e.cookiesSent && e.cookiesSent.length) {
        meta.push('ушли куки: ' + e.cookiesSent.join(', '));
      }
      if (meta.length) {
        const mt = document.createElement('div');
        mt.className = 'eg-meta';
        mt.textContent = meta.join('   ·   ');
        row.appendChild(mt);
      }

      frame.appendChild(row);
    }

    box.appendChild(frame);
  }

  // ── Фильтры журнала ───────────────────────────────────────────────────────
  //
  // Фильтр — это выбор человека, а не умолчание прибора. Поэтому: по умолчанию
  // выключен, строится по фактическим данным (пустых кнопок не бывает), и пока
  // он включён, над списком висит строка «показано N из M». Скрытое не должно
  // выглядеть отсутствующим — на этом держится всё остальное в этом приборе.

  const ИМЕНА_ГРУПП = {
    canvas: 'холст',
    webgl: 'видеокарта',
    audio: 'звук',
    fonts: 'шрифты',
    device: 'устройство',
    hardware: 'железо',
    storage: 'хранилища',
    shadow: 'теневой DOM',
    meta: 'служебное',
  };

  let фильтрГруппы = null;
  let фильтрФрейма = null;
  let фильтрТолькоСайт = false;

  function подходит(e) {
    if (фильтрГруппы && e.group !== фильтрГруппы) return false;
    if (фильтрФрейма !== null && e.frameId !== фильтрФрейма) return false;
    if (фильтрТолькоСайт && e.attribution && e.attribution.viaExtension) return false;
    return true;
  }

  function чип(текст, число, включён, действие) {
    const b = document.createElement('button');
    b.className = 'chip' + (включён ? ' on' : '');
    b.textContent = текст;
    if (число !== null) {
      const n = document.createElement('span');
      n.className = 'chip-n';
      n.textContent = число;
      b.appendChild(n);
    }
    b.addEventListener('click', () => {
      действие();
      // Перерисовываем немедленно и только журнал: состояние не менялось,
      // спрашивать worker не о чем.
      renderLog(последнийСеанс);
    });
    return b;
  }

  function renderFilters(surfaces) {
    const box = $('filters');
    box.textContent = '';

    const поГруппам = new Map();
    const поФреймам = new Map();
    let чужих = 0;
    for (const e of surfaces) {
      if (e.group) поГруппам.set(e.group, (поГруппам.get(e.group) || 0) + 1);
      поФреймам.set(e.frameId, (поФреймам.get(e.frameId) || 0) + 1);
      if (e.attribution && e.attribution.viaExtension) чужих++;
    }

    box.appendChild(
      чип('все', surfaces.length, !фильтрГруппы && фильтрФрейма === null && !фильтрТолькоСайт, () => {
        фильтрГруппы = null;
        фильтрФрейма = null;
        фильтрТолькоСайт = false;
      })
    );

    // Порядок по весу: то, чего много, важнее для беглого взгляда.
    for (const [g, n] of [...поГруппам].sort((a, b) => b[1] - a[1])) {
      box.appendChild(
        чип(ИМЕНА_ГРУПП[g] || g, n, фильтрГруппы === g, () => {
          фильтрГруппы = фильтрГруппы === g ? null : g;
        })
      );
    }

    // Кнопки фреймов появляются, только когда фреймов больше одного:
    // на обычной странице они были бы шумом.
    if (поФреймам.size > 1) {
      const sep = document.createElement('span');
      sep.className = 'filters-sep';
      box.appendChild(sep);
      for (const [f, n] of [...поФреймам].sort((a, b) => a[0] - b[0])) {
        box.appendChild(
          чип(f === 0 ? 'главный документ' : 'фрейм #' + f, n, фильтрФрейма === f, () => {
            фильтрФрейма = фильтрФрейма === f ? null : f;
          })
        );
      }
    }

    // Кнопка про чужие расширения — только если они действительно наследили.
    if (чужих) {
      const sep = document.createElement('span');
      sep.className = 'filters-sep';
      box.appendChild(sep);
      box.appendChild(
        чип('без чужих расширений', чужих, фильтрТолькоСайт, () => {
          фильтрТолькоСайт = !фильтрТолькоСайт;
        })
      );
    }
  }

  // Последний показанный сеанс — чтобы нажатие фильтра перерисовывало журнал,
  // не дёргая worker: данные не менялись, менялся только вид.
  let последнийСеанс = null;

  function renderLog(session) {
    const log = $('log');
    log.textContent = '';
    последнийСеанс = session;

    const surfaces = (session ? session.events : []).filter((e) => e.kind !== 'egress');
    if (!surfaces.length) {
      // Кнопки от прошлого сайта на экране остаться не должны.
      $('filters').textContent = '';
      const p = document.createElement('p');
      p.className = 'empty';
      p.textContent = 'Наблюдений нет.';
      log.appendChild(p);
      return;
    }

    renderFilters(surfaces);

    const видимые = surfaces.filter(подходит);
    if (видимые.length !== surfaces.length) {
      const n = document.createElement('p');
      n.className = 'filters-note';
      n.textContent =
        'Фильтр включён: показано ' + видимые.length + ' из ' + surfaces.length +
        '. Остальное не исчезло — оно скрыто вами и целиком уходит в экспорт.';
      $('filters').appendChild(n);
    }
    if (!видимые.length) {
      const p2 = document.createElement('p');
      p2.className = 'empty';
      p2.textContent = 'Под фильтр не попало ничего.';
      log.appendChild(p2);
      return;
    }

    // Группируем по фрейму: события главного документа и фреймов не смешиваем
    const frames = new Map();
    for (const e of видимые) {
      if (!frames.has(e.frameId)) frames.set(e.frameId, []);
      frames.get(e.frameId).push(e);
    }

    const order = [...frames.keys()].sort((a, b) => a - b);

    for (const frameId of order) {
      const events = frames.get(frameId).sort((a, b) => a.t - b.t);
      const first = events[0];

      const group = document.createElement('section');
      group.className = 'frame';

      const head = document.createElement('div');
      head.className = 'frame-head';
      const title = document.createElement('span');
      title.className = 'frame-title';
      title.textContent = first.frameKind + (frameId ? ' #' + frameId : '');
      const url = document.createElement('span');
      url.className = 'frame-url';
      url.textContent = first.frameUrl || first.frameOrigin || '';
      head.appendChild(title);
      head.appendChild(url);
      group.appendChild(head);

      for (const e of events) {
        if (e.kind === 'installed') {
          const row = document.createElement('div');
          row.className = 'row meta';
          row.textContent = 'прибор встал на ' + e.t + ' мс — обёрнуто: ' + (e.arg || '');
          group.appendChild(row);
          continue;
        }

        const a = attributionLine(e.attribution);
        const row = document.createElement('div');
        row.className = 'row';

        row.innerHTML =
          '<div class="r1">' +
          '<span class="t"></span>' +
          '<span class="surface"></span>' +
          '<span class="count"></span>' +
          '<span class="detail"></span>' +
          '</div>' +
          '<div class="r2"><span class="attr"></span><span class="who"></span></div>' +
          '<div class="r3"></div>';

        row.querySelector('.t').textContent = (e.t / 1000).toFixed(2) + ' с';
        row.querySelector('.surface').textContent = e.surface;
        row.querySelector('.count').textContent = e.count > 1 ? '×' + e.count : '';
        const det = row.querySelector('.detail');
        if (e.detail === 'counted') {
          det.textContent = 'счётчик';
          det.className = 'detail counted';
        }

        const attr = row.querySelector('.attr');
        attr.textContent = a.text;
        attr.className = 'attr ' + a.cls;
        if (a.badge) {
          const who = row.querySelector('.who');
          who.textContent = a.badge;
          who.className = 'who ' + a.cls;
        }

        const r3 = row.querySelector('.r3');
        const bits = [];
        if (e.arg) bits.push('аргумент: ' + e.arg);
        if (e.result) bits.push('результат: ' + e.result);
        if (bits.length) r3.textContent = bits.join('   ·   ');
        else r3.remove();

        group.appendChild(row);
      }

      log.appendChild(group);
    }
  }

  // Номер правки журнала, полученный в прошлый раз. Уходит обратно в worker:
  // если журнал не менялся, тот отвечает «без изменений» и ничего не копирует.
  let прошлаяПодпись = null;

  async function refresh() {
    if (!currentTab) return;
    const state = await ask({
      type: 'panel:state',
      tabId: currentTab.id,
      since: прошлаяПодпись,
    });
    if (!state) return;
    if (state.unchanged) return;
    прошлаяПодпись = state.rev || null;

    $('start').hidden = state.recording;
    $('stop').hidden = !state.recording;
    $('third-party').disabled = state.recording;

    renderFacts(state.facts, state.session);
    renderHealth(state.session, state.recording);
    renderEgress(state.session);
    renderLog(state.session);
  }

  // ── Действия ──────────────────────────────────────────────────────────────

  // Выбор «включая сторонние фреймы» запоминается между сессиями.
  // Перезагрузка расширения обнуляет запись — это правильно, прибор не должен
  // работать молча, — но заставлять человека каждый раз заново вспоминать про
  // галочку незачем: она не про разрешение, а про охват наблюдения.
  const ГАЛОЧКА = 'thirdPartyFrames';

  chrome.storage.local.get(ГАЛОЧКА, (v) => {
    void chrome.runtime.lastError;
    if (v && v[ГАЛОЧКА]) $('third-party').checked = true;
  });

  $('third-party').addEventListener('change', () => {
    try {
      chrome.storage.local.set({ [ГАЛОЧКА]: $('third-party').checked });
    } catch (e) {}
  });

  // Новая запись стирает прошлую: обёртки должны встать до первого скрипта,
  // значит вкладка перезагружается, значит прежний журнал теряется. Молча
  // терять его нельзя — прибор, который без предупреждения выбрасывает
  // собранные улики, не прибор. Поэтому первое нажатие только предупреждает.
  // Разделение на два нажатия ещё и сохраняет жест пользователя, без которого
  // chrome.permissions.request не работает.
  let подтвердитьСтирание = false;

  function сброситьПодтверждение() {
    if (!подтвердитьСтирание) return;
    подтвердитьСтирание = false;
    $('start').textContent = 'Записать этот сайт';
    $('start').classList.remove('danger-btn');
  }

  $('start').addEventListener('click', () => {
    if (!currentTab) return;

    const было = последнийСеанс ? последнийСеанс.events.length : 0;
    if (было && !подтвердитьСтирание) {
      подтвердитьСтирание = true;
      $('start').textContent = 'Стереть прошлую запись и начать';
      $('start').classList.add('danger-btn');
      $('hint').textContent =
        'В прошлой записи ' +
        склонение(было, 'наблюдение', 'наблюдения', 'наблюдений') +
        '. Перезагрузка вкладки их сотрёт — сохраните отчёт, если он нужен. ' +
        'Нажмите ещё раз, чтобы начать заново.';
      return;
    }

    const origin = new URL(currentTab.url).origin;
    const patterns = [origin + '/*'];
    // Сторонние фреймы — отдельные origin. Без разрешения на них прибор
    // не увидит ни их отпечатков, ни их маячков.
    if ($('third-party').checked) patterns.push('*://*/*');

    // permissions.request требует жеста пользователя — вызываем ДО любого await
    chrome.permissions.request({ origins: patterns }, async (granted) => {
      if (!granted) {
        $('hint').textContent = 'Разрешение не выдано — записывать нечем.';
        return;
      }
      const r = await ask({
        type: 'panel:start',
        payload: { tabId: currentTab.id, origin, patterns },
      });
      if (r && r.ok === false) $('hint').textContent = 'Не удалось начать: ' + r.error;
      сброситьПодтверждение();
      прошлаяПодпись = null;
      setTimeout(refresh, 400);
    });
  });

  // ── Экспорт ───────────────────────────────────────────────────────────────
  // Файл скачивается через blob и <a download> — без права `downloads`.
  // Лишнее право в манифесте пугает при установке и замедляет ревью, а здесь
  // без него обходится.
  function сохранить(имя, текст, тип) {
    const blob = new Blob([текст], { type: тип + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = имя;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  async function экспорт(вид) {
    if (!currentTab) return;

    // Отключение редакции — отдельное решение с прямым текстом о том, что
    // уходит в файл. Согласие «вообще» здесь не годится (03-data-model.md).
    let редакция = true;
    if ($('raw-export').checked) {
      редакция = !confirm(
        'Сохранить БЕЗ редакции?\n\n' +
          'В файл попадут настоящие идентификаторы устройства и сессии, ' +
          'идентификатор пользователя, хеши почты и телефона, адрес предыдущей ' +
          'страницы и сырые тела запросов.\n\n' +
          'Такой файл нельзя прикладывать к багрепортам и пересылать.\n\n' +
          'ОК — без редакции. Отмена — с редакцией.'
      );
    }

    const r = await ask({ type: 'panel:export', tabId: currentTab.id, редакция });
    if (!r || !r.ok) {
      $('hint').textContent = 'Экспорт не получился: ' + ((r && r.error) || 'нет ответа');
      return;
    }

    if (вид === 'json') сохранить(r.имя + '.json', r.json, 'application/json');
    else сохранить(r.имя + '.txt', r.отчёт, 'text/plain');

    if (!r.редакция) {
      // Небезопасный режим не липнет: следующий экспорт снова с редакцией.
      // Иначе один осознанный выбор превращается в постоянную настройку,
      // о которой забывают.
      $('raw-export').checked = false;
    }

    $('hint').textContent = r.редакция
      ? 'Сохранено. Вырезано значений: ' + r.вырезано + '. Поля остались видны.'
      : 'Сохранено БЕЗ редакции, файл помечен в имени. Галочка снята — ' +
        'следующий экспорт снова с редакцией.';
  }

  $('export-report').addEventListener('click', () => экспорт('отчёт'));
  $('export-json').addEventListener('click', () => экспорт('json'));

  $('stop').addEventListener('click', async () => {
    if (!currentTab) return;
    await ask({ type: 'panel:stop', tabId: currentTab.id });
    прошлаяПодпись = null;
    refresh();
  });

  $('clear').addEventListener('click', async () => {
    if (!currentTab) return;
    await ask({ type: 'panel:clear', tabId: currentTab.id });
    прошлаяПодпись = null;
    refresh();
  });

  chrome.tabs.onActivated.addListener(async () => {
    await loadTab();
    refresh();
  });

  chrome.tabs.onUpdated.addListener(async (tabId, info) => {
    if (currentTab && tabId === currentTab.id && info.url) {
      await loadTab();
      refresh();
    }
  });

  (async () => {
    await loadTab();
    connect();
    refresh();
  })();
})();
