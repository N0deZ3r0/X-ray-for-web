// Два языка для стенда.
//
// Стенд — это то место, куда README посылает человека проверять утверждения
// прибора своими руками. README английский; посылать по нему на русскую
// страницу — значит сделать проверяемость декларацией.
//
// Устроено иначе, чем в расширении, и намеренно. Там chrome.i18n и _locales;
// здесь обычная страница, где ни того, ни другого нет, а язык берётся из
// navigator.language. И главное: сценарии в scenarios.js НЕ трогаются. Реестр
// сценариев — оракул стенда, его читают, сверяя с журналом прибора, и вносить
// в каждую строку вторую половину значило бы удвоить то, что должно читаться
// с одного взгляда. Перевод лежит отдельной таблицей и подставляется на показе.
//
// Ключ таблицы — сама русская строка. Нет перевода — показывается русский:
// показать пустоту или ключ здесь было бы хуже. Что осталось непереведённым,
// стенд сообщает в консоль сам.

(() => {
  'use strict';

  const ЯЗЫК = (navigator.language || 'en').toLowerCase();
  const РУССКИЙ = ЯЗЫК.startsWith('ru') || ЯЗЫК.startsWith('uk') || ЯЗЫК.startsWith('be');

  const СЛОВАРЬ = {
    // ── Собственные надписи стенда ──────────────────────────────────────────
    'Стенд': 'Bench',
    'Тестовый оракул для прибора. Каждый сценарий выполняет настоящее действие и печатает рядом, что прибор обязан показать. Пока прибора нет — сверяет человек.':
      'The test oracle for the instrument. Each scenario performs a real action and prints beside it what the instrument is obliged to show. Until the instrument is there, a human does the checking.',
    'что прибор обязан показать': 'what the instrument is obliged to show',
    'Стенд не отправляет наружу ни одного байта: все приёмники — localhost. Формы адресов и полей повторяют настоящие, чтобы проверять разборщики.':
      'The bench sends not a single byte outside: every collector is on localhost. The shapes of the addresses and fields copy the real ones, so that the parsers can be checked.',
    'Прогнать всё': 'Run everything',
    'Что принял стенд': 'What the bench received',
    'Очистить приём': 'Clear received',
    'Замер LCP →': 'LCP measurement →',
    'Выполнить': 'Run',
    'Ожидание': 'Expected',
    'Все': 'All',
    'Шум': 'Noise',
    'выполнено': 'done',
    'идёт': 'running',
    'Прибор обязан показать': 'The instrument is obliged to show',
    'Стенд принял N обращений. Это независимое свидетельство: журнал прибора обязан совпасть с ним по составу.': 'The bench received N requests. This is independent evidence: the instrument journal is obliged to match it.',
    'ошибка': 'error',

    // ── Сценарии: названия ──────────────────────────────────────────────────
    'Canvas из стороннего скрипта': 'Canvas from a third-party script',
    'Canvas из встроенного скрипта страницы': 'Canvas from the page’s own inline script',
    'Кросс-origin фрейм снимает отпечаток и шлёт свой маячок':
      'A cross-origin frame takes a fingerprint and sends its own beacon',
    'Фрейм srcdoc снимает отпечаток': 'An srcdoc frame takes a fingerprint',
    'Фрейм about:blank через document.write': 'An about:blank frame filled by document.write',
    'Покрытие: в каких фреймах прибор реально встал':
      'Coverage: which frames the instrument actually got into',
    'Проверка на поломку: прибор наблюдает, а не вмешивается':
      'Breakage check: the instrument observes, it does not interfere',
    'WebGL: модель видеокарты и перебор параметров':
      'WebGL: the GPU model and a sweep of parameters',
    'Аудиоотпечаток': 'Audio fingerprint',
    'Перебор шрифтов через measureText': 'Font enumeration through measureText',
    'Перебор шрифтов через document.fonts.check': 'Font enumeration through document.fonts.check',
    'Среда: navigator, screen, часовой пояс, высокоэнтропийные подсказки':
      'Environment: navigator, screen, time zone, high-entropy hints',
    'Утечка локального адреса через WebRTC': 'Local address leak through WebRTC',
    'Нагрузка: 5000 measureText из библиотеки графиков':
      'Load: 5000 measureText calls from a charting library',
    'Нагрузка: 20000 getImageData из canvas-игры':
      'Load: 20000 getImageData calls from a canvas game',
    'sendBeacon с полями формы GA4': 'sendBeacon shaped like a GA4 payload',
    'sendBeacon пачкой из трёх событий': 'sendBeacon with a batch of three events',
    'fetch POST с JSON': 'fetch POST with JSON',
    'fetch GET обычных данных приложения': 'fetch GET of ordinary application data',
    'XHR POST urlencoded': 'XHR POST, urlencoded',
    'Пиксель Meta по форме, с хешами почты и телефона':
      'A Meta-shaped pixel, with hashes of email and phone',
    'WebSocket на путь вебвизора': 'WebSocket to a Webvisor path',
    'Постановка идентификаторов: куки, localStorage, IndexedDB':
      'Setting identifiers: cookies, localStorage, IndexedDB',
    'Чистый фрейм: sendBeacon в обход обёрток главного документа':
      'Clean frame: sendBeacon around the main document’s wrappers',
    'Чистый фрейм: fetch в обход обёрток главного документа':
      'Clean frame: fetch around the main document’s wrappers',
    'ОБХОД: отпечаток из воркера плюс маячок оттуда же':
      'EVASION: a fingerprint taken inside a worker, and a beacon from there too',
    'Негативный тест: 30 картинок, фон из CSS, внешний стиль':
      'Negative test: 30 images, a CSS background, an external stylesheet',
    'Яндекс.Метрика: счётчик в пути, начинка в browser-info':
      'Yandex.Metrica: the counter in the path, the payload in browser-info',
    'Вебвизор: запись действий на странице': 'Webvisor: recording what you do on the page',
    'Чистый прототип: canvas через свежий фрейм':
      'Clean prototype: canvas through a freshly created frame',
    'Страница ищет прибор': 'The page looks for the instrument',
    'Переходы SPA через history.pushState': 'SPA navigation through history.pushState',

    // ── Сценарии: примечания ────────────────────────────────────────────────
    'Классический съём отпечатка кодом с чужого origin.':
      'Classic fingerprinting by code from someone else’s origin.',
    'Тот же вызов, но инициатор — inline-скрипт первой стороны.':
      'The same call, but the initiator is a first-party inline script.',
    'Требует allFrames: true и разрешения на origin фрейма.':
      'Needs allFrames: true and permission for the frame’s origin.',
    'Без matchOriginAsFallback прибор здесь слеп. Прямая проверка версии Chrome 119+.':
      'Without matchOriginAsFallback the instrument is blind here. A direct check of the Chrome 119+ requirement.',
    'Второй путь к тому же слепому пятну.': 'A second route to the same blind spot.',
    'Щуп подаёт в канал сигнал готовности. Есть прибор — он в ответ выкидывает журнал; нет ответа — нет прибора. Опознавательных знаков от прибора не требуется.':
      'The probe sends a ready signal into the channel. If the instrument is there it answers with its journal; no answer means no instrument. No identifying marks are required from the instrument.',
    'Порядок: 1) БЕЗ прибора выполнить и получить эталон; 2) включить запись; 3) выполнить снова — сверит с эталоном. Эталон переживает перезагрузку вкладки.':
      'Order: 1) run WITHOUT the instrument to get the reference; 2) turn recording on; 3) run again — it compares against the reference. The reference survives a tab reload.',
    'Самая говорящая поверхность: WEBGL_debug_renderer_info отдаёт модель GPU.':
      'The most telling surface: WEBGL_debug_renderer_info hands over the GPU model.',
    'OfflineAudioContext + DynamicsCompressor — характерная связка.':
      'OfflineAudioContext + DynamicsCompressor — the characteristic pairing.',
    'Проверяет эвристику: много measureText с разными font-family за короткое окно.':
      'Exercises the heuristic: many measureText calls with different font-family values in a short window.',
    'Официальный API вместо измерения ширин.': 'The official API instead of measuring widths.',
    'Дешёвые геттеры класса A. Основной источник фактов для свода.':
      'Cheap class A getters. The main source of facts for the summary.',
    'Законный горячий код. Бюджет обязан схлопнуть повторы.':
      'Legitimate hot code. The budget is obliged to collapse the repeats.',
    'Проверка kill-switch.': 'Kill-switch check.',
    'Нормальный маячок. Оба источника обязаны его увидеть.':
      'An ordinary beacon. Both sources are obliged to see it.',
    'GA4 шлёт пачку одним POST через перевод строки.':
      'GA4 sends a batch as one POST, newline-separated.',
    'Негативный тест: это не маячок.': 'Negative test: this is not a beacon.',
    'Самый сильный факт для обычного человека.':
      'The strongest fact there is for an ordinary person.',
    'Сетевой источник эту схему не наблюдает: шаблоны разрешений не покрывают ws.':
      'The network source does not observe this scheme: permission patterns do not cover ws.',
    'Задумывался как обход и им НЕ является. Прибор ставится во все фреймы, включая свежесозданный about:blank, поэтому чистого realm тут нет: сработает обёртка внутри самого фрейма.':
      'Intended as an evasion and is NOT one. The instrument gets into every frame, including a freshly created about:blank, so there is no clean realm here: the wrapper inside the frame itself fires.',
    'То же, что S22, другим транспортом.': 'The same as S22, over a different transport.',
    'Единственный обход, который этот прибор НЕ закрывает. Предел 4: content scripts в воркеры не внедряются, поверхности там не видны.':
      'The one evasion this instrument does NOT close. Limit 4: content scripts are not injected into workers, and surfaces there are invisible.',
    'Критерий 2 этапа Э2 и он важнее первого.':
      'The second criterion of stage Э2, and it matters more than the first.',
    'Метрика кладёт номер счётчика в путь адреса, а всё остальное упаковывает в один параметр строкой «ключ:значение:ключ:значение».':
      'Metrica puts the counter number in the address path and packs everything else into a single parameter shaped «key:value:key:value».',
    'Не разновидность аналитики, а запись сеанса. Прибор обязан сказать это отдельным фактом, а не спрятать в общий список маячков.':
      'Not a kind of analytics but a recording of your session. The instrument is obliged to say so as a fact of its own, not hide it in the general list of beacons.',
    'Задумывался как слепое пятно и им НЕ является: прибор стоит и в этом фрейме тоже. Оставлен как сторож — если событие пропадёт, значит покрытие фреймов сломалось.':
      'Intended as a blind spot and is NOT one: the instrument is in this frame too. Kept as a watchdog — if the event ever disappears, frame coverage has broken.',
    'Предел 1: замер эффекта наблюдателя, а не атака.':
      'Limit 1: a measurement of the observer effect, not an attack.',
    'URL меняется, навигации не было.': 'The URL changes; there was no navigation.',

    // ── Сценарии: ожидания ──────────────────────────────────────────────────
    'surface canvas.toDataURL и canvas.getImageData': 'surface canvas.toDataURL and canvas.getImageData',
    'attribution.scriptUrl = http://localhost:8081/fp-basic.js со строкой и колонкой':
      'attribution.scriptUrl = http://localhost:8081/fp-basic.js with line and column',
    'метка времени от начала навигации': 'a timestamp from the start of navigation',
    'attribution.scriptUrl = http://localhost:8080/ (адрес документа)':
      'attribution.scriptUrl = http://localhost:8080/ (the document address)',
    'события с frameId != 0': 'events with frameId != 0',
    'egress из фрейма отдельной строкой, не смешан с главным документом':
      'egress from the frame on its own line, not mixed with the main document',
    'события из srcdoc-фрейма присутствуют': 'events from the srcdoc frame are present',
    'frameUrl помечен как srcdoc с origin родителя':
      'frameUrl marked as srcdoc with the parent’s origin',
    'события из about:blank фрейма присутствуют': 'events from the about:blank frame are present',
    'покрыто 4 из 4: главный документ, srcdoc, about:blank, кросс-origin':
      'covered 4 of 4: main document, srcdoc, about:blank, cross-origin',
    'srcdoc и about:blank подтверждают, что matchOriginAsFallback работает':
      'srcdoc and about:blank confirm that matchOriginAsFallback works',
    'кросс-origin требует разрешения на все адреса при включении записи':
      'cross-origin needs permission for all addresses when recording starts',
    'поломок нет: ни один обычный вызов не изменил поведения':
      'nothing broke: not one ordinary call changed its behaviour',
    'вызовы с чужим this ведут себя ровно как нативные':
      'calls with a foreign this behave exactly as the native ones do',
    'различия только в разделе «видимость прибора» — это предел 1, не баг':
      'differences only in the «instrument visibility» section — that is limit 1, not a bug',
    'webgl.getExtension с аргументом WEBGL_debug_renderer_info':
      'webgl.getExtension with the argument WEBGL_debug_renderer_info',
    'webgl.getParameter с UNMASKED_RENDERER_WEBGL и результатом-моделью':
      'webgl.getParameter with UNMASKED_RENDERER_WEBGL and the model as its result',
    'счётчик: опрошено N параметров WebGL': 'a counter: N WebGL parameters queried',
    'факт в своде: «Сайт узнал модель вашей видеокарты»':
      'a fact in the summary: «The site learned your GPU model»',
    'audio.OfflineAudioContext, createDynamicsCompressor, createOscillator':
      'audio.OfflineAudioContext, createDynamicsCompressor, createOscillator',
    'audio.getChannelData': 'audio.getChannelData',
    'canvas.measureText со счётчиком порядка 130 вызовов':
      'canvas.measureText with a counter of roughly 130 calls',
    'detail = counted после исчерпания бюджета стеков':
      'detail = counted once the stack budget is spent',
    'факт в своде: «Снят отпечаток шрифтов, N измерений»':
      'a fact in the summary: «A font fingerprint was taken, N measurements»',
    'fonts.check со счётчиком порядка 41 вызова': 'fonts.check with a counter of roughly 41 calls',
    'device.* по каждому прочитанному свойству': 'device.* for every property read',
    'navigator.userAgentData.getHighEntropyValues с перечнем запрошенных полей':
      'navigator.userAgentData.getHighEntropyValues with the list of requested fields',
    'факты: часовой пояс, число ядер, платформа, разрешение экрана':
      'facts: time zone, core count, platform, screen resolution',
    'surface RTCPeerConnection': 'surface RTCPeerConnection',
    'факт: «Запрошен ваш локальный сетевой адрес»':
      'a fact: «Your local network address was requested»',
    'одно событие с count = 5000, detail = counted':
      'a single event with count = 5000, detail = counted',
    'просадка LCP относительно прогона без прибора не более 5%':
      'LCP regression against a run without the instrument no worse than 5%',
    'Health.killSwitchTripped = true': 'Health.killSwitchTripped = true',
    'видимое сообщение «прибор снизил детализацию»':
      'a visible message «the instrument reduced detail»',
    'degradedSurfaces содержит canvas.getImageData': 'degradedSurfaces contains canvas.getImageData',
    'egress transport = beacon, match = confirmed, trust = confirmed':
      'egress transport = beacon, match = confirmed, trust = confirmed',
    'разбор GA4: cid как идентификатор браузера, uid как связка с учётной записью':
      'GA4 parsed: cid as the browser identifier, uid as the link to an account',
    'поле _bench_unknown_field показано НЕОПОЗНАННЫМ, счётчик неопознанного вырос':
      'the field _bench_unknown_field shown as NOT IDENTIFIED, the unidentified counter went up',
    'три отдельных разобранных события, а не одно':
      'three separate parsed events, not one',
    'match = confirmed': 'match = confirmed',
    'egress transport = fetch, match = confirmed, тело до отправки':
      'egress transport = fetch, match = confirmed, the body as it was sent',
    'egress показан': 'the egress is shown',
    'НЕ помечен трекером и НЕ приписан разборщику':
      'NOT marked as a tracker and NOT attributed to a parser',
    'ноль ложных срабатываний': 'zero false positives',
    'egress transport = xhr, match = confirmed': 'egress transport = xhr, match = confirmed',
    'egress transport = image': 'egress transport = image',
    'разбор Meta Pixel: ud[em] и ud[ph] названы хешами почты и телефона':
      'Meta Pixel parsed: ud[em] and ud[ph] named as hashes of email and phone',
    'у хеша почты оговорено, что он одинаков на всех сайтах':
      'the email hash carries the note that it is the same on every site',
    'факт в своде: «В localhost ушёл хеш вашего адреса электронной почты»':
      'a fact in the summary: «A hash of your email address went to localhost»',
    'в экспорте по умолчанию значения этих полей отредактированы':
      'in the default export the values of these fields are redacted',
    'egress transport = websocket': 'egress transport = websocket',
    'match = no-network-source, подпись «сетью не проверяется»':
      'match = no-network-source, labelled «not checkable against the network»',
    'НЕ «в сеть не ушло» — это разные утверждения':
      'NOT «never reached the network» — those are different statements',
    'surface cookie.set дважды, localStorage.setItem, indexedDB.open':
      'surface cookie.set twice, localStorage.setItem, indexedDB.open',
    'факт: «Сайт поставил идентификатор со сроком жизни 2 года»':
      'a fact: «The site set an identifier that lives for 2 years»',
    'match = confirmed — приём не сработал, и это правильный результат':
      'match = confirmed — the trick did not work, and that is the correct outcome',
    'attribution указывает на evasion.js, откуда шёл вызов':
      'attribution points at evasion.js, where the call came from',
    'если вдруг network-only — значит прибор не встал во фрейм, это баг':
      'if it ever shows network-only, the instrument did not get into the frame — that is a bug',
    'attribution указывает на evasion.js': 'attribution points at evasion.js',
    'поверхности воркера ОТСУТСТВУЮТ в журнале — это ожидаемо':
      'the worker’s surfaces are ABSENT from the journal — that is expected',
    'маячок из воркера присутствует как network-only':
      'the beacon from the worker is present as network-only',
    'attribution отсутствует и НЕ выдумана': 'attribution is absent and NOT invented',
    'зафиксировано создание воркера как контекст для обхода':
      'the creation of the worker is recorded as context for the evasion',
    'НОЛЬ событий с match = network-only': 'ZERO events with match = network-only',
    'всё попало в категорию unobserved без обвинений':
      'everything landed in the unobserved category, with no accusations',
    'номер счётчика разобран ИЗ ПУТИ и назван «кому уходят данные»':
      'the counter number is parsed FROM THE PATH and named «who the data goes to»',
    'browser-info распакован: идентификатор браузера, экран, часовой пояс, язык':
      'browser-info unpacked: browser identifier, screen, time zone, language',
    'поле zqz внутри упаковки показано НЕОПОЗНАННЫМ':
      'the field zqz inside the packing is shown as NOT IDENTIFIED',
    'факт в своде: «В localhost ушёл идентификатор вашего устройства»':
      'a fact in the summary: «Your device identifier went to localhost»',
    'разборщик — отдельный, с названием «запись действий»':
      'a parser of its own, named «session recording»',
    'факт в своде: «Сайт записывает ваши действия на странице»':
      'a fact in the summary: «The site is recording what you do on the page»',
    'оговорка, что содержимое записи прибору не видно':
      'the caveat that the contents of the recording are invisible to the instrument',
    'событие canvas.toDataURL ЕСТЬ в журнале': 'the canvas.toDataURL event IS in the journal',
    'список поверхностей, выдающих себя по toString':
      'the list of surfaces that give themselves away through toString',
    'время measureText: заметно ли замедление':
      'measureText timing: is the slowdown noticeable',
    'результат честно отражён в разделе «Пределы»':
      'the result is honestly reflected in the «Limits» section',
    't0 не сбрасывается': 't0 is not reset',
    'журнал остаётся одной сессией': 'the journal stays a single session',
  };

  const непереведённые = new Set();

  function тр(строка) {
    if (!РУССКИЙ) {
      const перевод = СЛОВАРЬ[строка];
      if (перевод) return перевод;
      // Русский вместо пустоты: показать нечего лучше, чем показать ничего.
      // Но молчать об этом нельзя — иначе непереведённое копится незамеченным.
      if (/[А-Яа-яЁё]/.test(строка)) непереведённые.add(строка);
    }
    return строка;
  }

  // Заполняем статическую разметку и жалуемся на пропуски один раз, после
  // отрисовки: список в консоли — это рабочий список, а не украшение.
  function применить() {
    for (const el of document.querySelectorAll('[data-tr]')) {
      el.textContent = тр(el.getAttribute('data-tr'));
    }
    document.documentElement.lang = РУССКИЙ ? 'ru' : 'en';
  }

  function пожаловаться() {
    if (!непереведённые.size) return;
    console.warn(
      'Стенд: без перевода осталось ' + непереведённые.size + ' строк — ' +
        'показаны по-русски. Добавить в СЛОВАРЬ в bench/a/i18n.js:'
    );
    for (const s of непереведённые) console.warn('  ' + JSON.stringify(s));
  }

  window.__tr = тр;
  window.__trПрименить = применить;
  window.__trПожаловаться = пожаловаться;
  window.__trРусский = РУССКИЙ;
})();
