// Источник всех строк интерфейса.
//
// Отсюда генерируются _locales/ru/messages.json и _locales/en/messages.json.
// Один источник, а не два файла: пары языков стоят рядом строкой, и разойтись
// они не могут по построению — ни ключом, ни числом подстановок. CI проверяет,
// что сгенерированное совпадает с тем, что лежит в репозитории.
//
// Подстановки — позиционные $1…$9, как их понимает chrome.i18n.getMessage.
//
// Множественное число: формы разделены «|». Русский даёт три (1 / 2-4 / 5-0),
// английский две (1 / прочее). Выбор формы делает вызывающая сторона, потому
// что chrome.i18n про множественное число не знает ничего.
//
// Запуск: node tools/messages.mjs

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

// [ключ]: [русский, английский]
export const СТРОКИ = {
  // ── Манифест ──────────────────────────────────────────────────────────────
  ext_name: ['X-ray for web', 'X-ray for web'],
  ext_description: [
    'Прибор, а не блокировщик. Показывает, какой скрипт какую поверхность отпечатка прочитал, и разбирает уходящие маячки по полям.',
    'An instrument, not a blocker. Shows which script read which fingerprinting surface, and parses outgoing beacons field by field.',
  ],

  // ── Шапка и управление ────────────────────────────────────────────────────
  tab_not_observable: ['Вкладка недоступна для наблюдения', 'This tab cannot be observed'],
  btn_record: ['Записать этот сайт', 'Record this site'],
  btn_record_erase: ['Стереть прошлую запись и начать', 'Erase the previous recording and start'],
  btn_stop: ['Остановить', 'Stop'],
  btn_clear: ['Очистить', 'Clear'],
  btn_export_report: ['Сохранить отчёт', 'Save report'],
  btn_export_json: ['Сохранить JSON', 'Save JSON'],
  check_third_party: ['включая сторонние фреймы', 'including third-party frames'],
  check_raw_export: ['экспорт без редакции', 'export without redaction'],
  hint_reload: [
    'Запись начинается с перезагрузки вкладки: обёртки должны стоять до первого скрипта страницы.',
    'Recording starts by reloading the tab: the wrappers have to be in place before the page’s first script.',
  ],
  hint_no_permission: [
    'Разрешение не выдано — записывать нечем.',
    'Permission was not granted — there is nothing to record with.',
  ],
  hint_start_failed: ['Не удалось начать: $1', 'Could not start: $1'],
  hint_stopped: [
    'Запись остановлена везде. Обёртки, уже стоящие в открытых страницах, исчезнут после их перезагрузки: снять их оттуда нельзя, они живут в мире страницы.',
    'Recording stopped everywhere. Wrappers already in place in open pages will go away when those pages reload: they cannot be removed from here, they live in the page’s own world.',
  ],
  hint_stop_failed: ['Не удалось остановить: $1', 'Could not stop: $1'],
  hint_erase: [
    'В прошлой записи $1. Перезагрузка вкладки их сотрёт — сохраните отчёт, если он нужен. Нажмите ещё раз, чтобы начать заново.',
    'The previous recording holds $1. Reloading the tab erases them — save the report first if you need it. Click again to start over.',
  ],

  // ── Что здесь наблюдается ─────────────────────────────────────────────────
  scope_text: [
    'Поверхности отпечатка и исходящее — из двух независимых источников: обёртки внутри страницы и сеть. Их несовпадение и есть детектор обхода.',
    'Fingerprinting surfaces and outgoing traffic — from two independent sources: the wrappers inside the page, and the network. Where they disagree is the evasion detector.',
  ],
  scope_title: ['Что здесь наблюдается.', 'What is observed here.'],
  scope_parsers: [
    'Разбор формата подключён для GA4, Meta Pixel, Яндекс.Метрики и Вебвизора. Для остальных адресов тело показано как есть с подписью «формат не опознан» — это не то же самое, что «полей нет». Отпечаток шрифтов через offsetWidth не покрыт намеренно.',
    'Format parsing is wired up for GA4, Meta Pixel, Yandex.Metrica and Webvisor. For every other address the body is shown as-is, labelled “format not identified” — which is not the same as “no fields”. Font fingerprinting through offsetWidth is deliberately not covered.',
  ],

  // ── Заголовки разделов ────────────────────────────────────────────────────
  h_facts: ['Что о вас узнали', 'What they learned about you'],
  h_egress: ['Что ушло наружу', 'What went out'],
  h_log: ['Что сайт прочитал', 'What the site read'],

  // ── Атрибуция ─────────────────────────────────────────────────────────────
  attr_unknown_source: ['источник не определён', 'source not determined'],
  attr_not_site: ['не сайт', 'not the site'],
  attr_via_extension: [
    'другое расширение в вашем браузере: $1',
    'another extension in your browser: $1',
  ],
  attr_via_extension_deeper: [
    'другое расширение ($1), ниже по стеку $2',
    'another extension ($1), further down the stack $2',
  ],
  attr_third: ['сторонний', 'third-party'],
  attr_inline: ['встроенный', 'inline'],
  attr_first: ['первая сторона', 'first-party'],

  // ── Здоровье прибора ──────────────────────────────────────────────────────
  health_empty: ['Запись включена, наблюдений пока нет.', 'Recording is on, no observations yet.'],
  health_records: ['Записей', 'Records'],
  health_calls: ['Вызовов перехвачено', 'Calls intercepted'],
  health_frames: ['Фреймов с прибором', 'Frames instrumented'],
  health_surfaces: ['Поверхностей обёрнуто', 'Surfaces wrapped'],
  health_dropped: ['Потеряно записей', 'Records dropped'],
  health_bridge_loss: ['Потерь на мосту', 'Bridge losses'],
  health_doc_replaced: ['Подмен документа', 'Document replacements'],
  health_sw_restarts: ['Перезапусков worker', 'Worker restarts'],
  health_with_stack: ['Со снятием стека', 'With stack capture'],
  health_stack_ms: ['На них ушло, мс', 'Time spent on them, ms'],
  health_counted: ['Счётчиком, без стека', 'Counted, no stack'],
  health_calls_per_sec: ['Вызовов в секунду', 'Calls per second'],
  health_install_ms: ['Установка прибора, мс', 'Instrument setup, ms'],
  health_reconcile: [
    'Сверка источников: <b>$1</b> подтверждено обоими, <b class="mimo">$2</b> прошло мимо инструментации, <b>$3</b> не дошло до сети, <b>$4</b> нечем проверить (WebSocket), <b>$5</b> вне наблюдения — стили, скрипты, шрифты, картинки. Они посчитаны, но не показаны: обвинять их не в чем, а списком они утопили бы маячки.',
    'Source reconciliation: <b>$1</b> confirmed by both, <b class="mimo">$2</b> went past the instrumentation, <b>$3</b> never reached the network, <b>$4</b> cannot be checked (WebSocket), <b>$5</b> outside observation — styles, scripts, fonts, images. They are counted but not listed: there is nothing to accuse them of, and as a list they would drown the beacons.',
  ],
  health_time_note: [
    'Время показано только для вызовов со снятием стека — их можно замерить. Вызовы-счётчики стоят меньше, чем сам замер, поэтому их время не показано.',
    'Time is shown only for calls with a stack capture — those can be measured. Counted calls cost less than the measurement itself, so their time is not shown.',
  ],
  health_killswitch: [
    'Прибор снизил детализацию, чтобы не мешать странице. Дальнейшие вызовы идут счётчиком без привязки к скрипту.',
    'The instrument reduced detail so as not to disturb the page. Further calls are counted without being attributed to a script.',
  ],
  health_budget: [
    'Бюджет подробностей исчерпан. Дальнейшие вызовы считаются, но не привязываются к скрипту: снятие стека стоит около 25 мкс, и без потолка прибор заметно замедлил бы страницу.',
    'The detail budget is spent. Further calls are counted but not attributed to a script: a stack capture costs about 25 µs, and without a ceiling the instrument would visibly slow the page down.',
  ],
  health_collapsed: ['Схлопнуты до счётчика: $1', 'Collapsed into counters: $1'],
  health_shadowed: [
    'Обёртка перекрыта на экземпляре: $1. Кто-то — почти наверняка другое расширение — положил собственное свойство поверх нашего, и эти поверхности не наблюдаются, хотя обёрнуты. Проверено только для объектов, существующих в единственном числе: у контекстов canvas и WebGL узнать это заранее нельзя (предел 3б).',
    'Wrapper shadowed on the instance: $1. Someone — almost certainly another extension — put an own property on top of ours, so these surfaces are not observed even though they are wrapped. Checked only for objects that exist as a single instance: for canvas and WebGL contexts this cannot be known in advance (limit 3b).',
  ],
  health_wrap_failed: [
    'Не удалось обернуть: $1. По этим поверхностям прибор слеп.',
    'Could not wrap: $1. The instrument is blind on these surfaces.',
  ],
  health_truncated: [
    'Журнал обрезан по потолку размера. Часть наблюдений не сохранена.',
    'The journal was truncated at its size ceiling. Some observations were not kept.',
  ],

  // ── Свод ──────────────────────────────────────────────────────────────────
  facts_empty_recording: ['Пока ничего не собрано.', 'Nothing collected yet.'],
  no_session: ['Записи нет.', 'No recording.'],
  fact_basis: ['основание: ', 'evidence: '],
  fact_basis_suffix: [' в журнале', ' in the journal'],
  coverage: [
    'Снято поверхностей отпечатка: <b>$1</b> из <b>$2</b>.',
    'Fingerprinting surfaces taken: <b>$1</b> of <b>$2</b>.',
  ],
  coverage_why: [
    'Битов энтропии здесь нет намеренно: их не существует без распределения по всем пользователям, а прибор стоит на одной машине. Любое такое число было бы доверием к чужому датасету, а не измерением.',
    'There are deliberately no entropy bits here: they do not exist without a distribution across all users, and this instrument runs on one machine. Any such number would be trust in someone else’s dataset, not a measurement.',
  ],

  // ── Исходящее ─────────────────────────────────────────────────────────────
  egress_empty: ['Исходящего не было.', 'Nothing went out.'],
  egress_order_note: [
    '. Сверху обходы, затем запросы с телом, затем остальное.',
    '. Evasions first, then requests with a body, then the rest.',
  ],
  // «Прошло мимо прибора» звучало как обвинение в обходе. Так выглядит и
  // обход, и предзагрузка, которую начинает сам браузер, и запрос из воркера.
  // Прибор различить их не может, значит и утверждать не должен.
  verdict_network_only: ['сеть видела, обёртки — нет', 'network saw it, wrappers did not'],
  verdict_confirmed: ['подтверждено сетью', 'confirmed by network'],
  verdict_hook_only: ['в сеть не ушло', 'never reached the network'],
  verdict_no_network_source: ['сетью не проверяется', 'not checkable against the network'],
  verdict_unobserved: ['вне наблюдения', 'outside observation'],
  verdict_pending: ['ожидает', 'pending'],
  body_unparsed: [
    'формат не опознан, тело как есть: $1',
    'format not identified, body as-is: $1',
  ],
  body_size: ['тело: $1 байт, $2', 'body: $1 bytes, $2'],
  source_network_only: [
    'источник не определён — наблюдение только из сети',
    'source not determined — observed from the network only',
  ],
  cookies_sent: ['ушли куки: $1', 'cookies sent: $1'],
  parser_schema: ['схема от $1', 'schema from $1'],
  parser_counts: ['разобрано $1, не опознано $2', '$1 parsed, $2 not identified'],
  not_identified: ['не опознано', 'not identified'],
  not_identified_caps: ['НЕ ОПОЗНАНО', 'NOT IDENTIFIED'],

  // Заголовки групп разбора — их отдаёт движок кодом, без слов.
  group_path: ['Из адреса', 'From the address'],
  group_query: ['Параметры адреса', 'Address parameters'],
  group_body: ['Тело запроса', 'Request body'],
  group_body_event: ['Событие $1 из $2', 'Event $1 of $2'],

  // ── Журнал поверхностей ───────────────────────────────────────────────────
  log_empty: ['Наблюдений нет.', 'No observations.'],
  installed_row: [
    'прибор встал на $1 мс — обёрнуто: $2',
    'instrument in place at $1 ms — wrapped: $2',
  ],
  seconds_suffix: [' с', ' s'],
  detail_counted: ['счётчик', 'counted'],
  arg_prefix: ['аргумент: ', 'argument: '],
  result_prefix: ['результат: ', 'result: '],

  frame_main: ['главный документ', 'main document'],
  frame_about: ['фрейм $1', 'frame $1'],
  frame_other: ['фрейм', 'frame'],
  frame_numbered: ['фрейм #$1', 'frame #$1'],

  // ── Фильтр журнала ────────────────────────────────────────────────────────
  filter_all: ['все', 'all'],
  filter_no_ext: ['без чужих расширений', 'without other extensions'],
  filter_note: [
    'Фильтр включён: показано $1 из $2. Остальное не исчезло — оно скрыто вами и целиком уходит в экспорт.',
    'A filter is on: showing $1 of $2. The rest did not vanish — you hid it, and all of it still goes into the export.',
  ],
  filter_empty: ['Под фильтр не попало ничего.', 'Nothing matched the filter.'],

  sgroup_canvas: ['холст', 'canvas'],
  sgroup_webgl: ['видеокарта', 'GPU'],
  sgroup_audio: ['звук', 'audio'],
  sgroup_fonts: ['шрифты', 'fonts'],
  sgroup_device: ['устройство', 'device'],
  sgroup_hardware: ['железо', 'hardware'],
  sgroup_storage: ['хранилища', 'storage'],
  sgroup_shadow: ['теневой DOM', 'shadow DOM'],
  sgroup_meta: ['служебное', 'housekeeping'],

  // ── Подробности вызова: инструмент отдаёт коды, слова здесь ───────────────
  det_chars: ['$1 символов', '$1 characters'],
  det_items: ['$1 шт.', '$1 items'],
  det_rect: ['$1×$2 от ($3,$4)', '$1×$2 at ($3,$4)'],
  det_yes: ['есть', 'yes'],
  det_no: ['нет', 'no'],
  det_audio: ['$1 кан., $2 сэмпл.', '$1 ch., $2 samples'],
  det_cookies: ['$1 куки', '$1 cookies'],
  det_days: ['живёт $1 дн.', 'lives $1 days'],
  det_until: ['до $1', 'until $1'],
  det_html: ['$1 символов разметки', '$1 characters of markup'],
  det_surfaces: ['$1 поверхностей', '$1 surfaces'],
  det_failed: ['не удалось $1: $2', '$1 failed: $2'],
  det_self_known: ['себя в стеке вычёркиваю', 'excluding myself from the stack'],
  det_self_unknown: ['СВОЙ АДРЕС НЕ ОПРЕДЕЛЁН', 'OWN ADDRESS NOT DETERMINED'],

  // ── Экспорт ───────────────────────────────────────────────────────────────
  confirm_raw_export: [
    'Сохранить БЕЗ редакции?\n\nВ файл попадут настоящие идентификаторы устройства и сессии, идентификатор пользователя, хеши почты и телефона, адрес предыдущей страницы и сырые тела запросов.\n\nТакой файл нельзя прикладывать к багрепортам и пересылать.\n\nОК — без редакции. Отмена — с редакцией.',
    'Save WITHOUT redaction?\n\nThe file will contain your real device and session identifiers, your user id, hashes of your email and phone, the previous page address and raw request bodies.\n\nA file like this must not be attached to bug reports or forwarded.\n\nOK — without redaction. Cancel — with redaction.',
  ],
  export_failed: ['Экспорт не получился: $1', 'Export failed: $1'],
  no_answer: ['нет ответа', 'no answer'],
  export_saved: [
    'Сохранено. Вырезано значений: $1. Поля остались видны.',
    'Saved. Values stripped: $1. The fields themselves are still visible.',
  ],
  export_saved_raw: [
    'Сохранено БЕЗ редакции, файл помечен в имени. Галочка снята — следующий экспорт снова с редакцией.',
    'Saved WITHOUT redaction; the filename says so. The checkbox is now cleared — the next export is redacted again.',
  ],

  // ── Пределы в подвале панели ──────────────────────────────────────────────
  limits_title: ['Пределы этой сборки', 'Limits of this build'],
  limit_internal: [
    'Наблюдение изнутри страницы помечено <code>internal</code>: канал виден странице. До <code>confirmed</code> его поднимает только совпадение с сетью, которую страница подделать не может.',
    'Observation from inside the page is marked <code>internal</code>: the channel is visible to the page. Only a match against the network — which the page cannot forge — raises it to <code>confirmed</code>.',
  ],
  limit_wrappers_visible: [
    'Страница видит обёртки и канал доставки.',
    'The page can see the wrappers and the delivery channel.',
  ],
  limit_workers: [
    '<b>Воркеры не наблюдаются.</b> Отпечаток, снятый внутри воркера, прибору не виден; заметен только маячок оттуда, и то по сети. Вызов из свежесозданного фрейма, наоборот, виден: прибор встаёт и туда тоже.',
    '<b>Workers are not observed.</b> A fingerprint taken inside a worker is invisible to the instrument; only a beacon from it shows up, and only through the network. A call from a freshly created frame, by contrast, is visible: the instrument gets in there too.',
  ],
  limit_other_extensions: [
    '<b>Другие расширения в вашем браузере</b> подменяют те же API. Их вызовы помечены «не сайт». Отличить, действует расширение само или по просьбе страницы, прибор не может.',
    '<b>Other extensions in your browser</b> replace the same APIs. Their calls are marked “not the site”. Whether an extension acts on its own or at the page’s request is something the instrument cannot tell.',
  ],
  limit_websocket: [
    '<b>WebSocket сетью не проверяется:</b> разрешения не покрывают схему <code>ws</code>. Это не то же самое, что «запрос не ушёл».',
    '<b>WebSocket is not checked against the network:</b> permissions do not cover the <code>ws</code> scheme. That is not the same as “the request did not go out”.',
  ],
  limit_parsers: [
    'Разбор формата есть для GA4, Meta Pixel, Метрики и Вебвизора. Для остальных адресов подпись «формат не опознан» — это не «полей нет».',
    'Format parsing exists for GA4, Meta Pixel, Metrica and Webvisor. For other addresses the label “format not identified” does not mean “no fields”.',
  ],
  limit_in_stacks: [
    '<b>Прибор виден в чужих стеках.</b> Ошибки и предупреждения браузера могут указывать на <code>instrument/main.js</code>: обёртка стоит в цепочке вызова, поэтому её кадр попадает в трассировку. Наличие прибора в стеке не делает его причиной — прежде чем винить его, воспроизведите без него.',
    '<b>The instrument shows up in other people’s stacks.</b> Browser errors and warnings may point at <code>instrument/main.js</code>: the wrapper sits in the call chain, so its frame lands in the trace. Being in the stack does not make it the cause — before blaming it, reproduce without it.',
  ],
  limit_unknown_source: [
    'Не удалось разобрать стек — пишем «источник не определён», а не подставляем страницу.',
    'When a stack cannot be parsed we write “source not determined” rather than putting the page there.',
  ],

  // ── Множественное число ───────────────────────────────────────────────────
  // Русский: 1 / 2-4 / 5-0. Английский: 1 / прочее.
  plural_record_lower: ['запись|записи|записей', 'record|records'],
  plural_record_upper: ['Запись|Записи|Записей', 'Record|Records'],
  plural_observation: ['наблюдение|наблюдения|наблюдений', 'observation|observations'],
  plural_time: ['раз|раза|раз', 'time|times'],
  plural_measurement: ['измерение|измерения|измерений', 'measurement|measurements'],
  plural_call: ['вызов|вызова|вызовов', 'call|calls'],
  plural_request: ['запрос|запроса|запросов', 'request|requests'],

  // ── Свод: сами факты ──────────────────────────────────────────────────────
  fact_gpu_model: ['Сайт узнал модель вашей видеокарты', 'The site learned your GPU model'],
  fact_gpu_vendor: ['Сайт узнал производителя вашей видеокарты', 'The site learned your GPU vendor'],
  fact_timezone: ['Сайт узнал ваш часовой пояс', 'The site learned your time zone'],
  fact_cores: [
    'Сайт узнал, сколько ядер у вашего процессора',
    'The site learned how many cores your processor has',
  ],
  fact_memory: ['Сайт узнал, сколько у вас оперативной памяти', 'The site learned how much RAM you have'],
  fact_memory_unit: [' ГБ', ' GB'],
  fact_os: ['Сайт узнал вашу операционную систему', 'The site learned your operating system'],
  fact_screen: ['Сайт узнал размер вашего экрана', 'The site learned your screen size'],
  fact_screen_by: [' на ', ' by '],
  fact_ua_hints: [
    'Сайт запросил точную модель платформы и версии браузера',
    'The site asked for the exact platform model and browser versions',
  ],
  fact_ua_hints_note: [
    'Это высокоэнтропийные подсказки User-Agent: они сужают круг машин сильнее обычного',
    'These are high-entropy User-Agent hints: they narrow down the set of machines more than usual',
  ],
  fact_canvas: [
    'Сайт снял отпечаток изображения через canvas',
    'The site took an image fingerprint through canvas',
  ],
  fact_canvas_pixels: [
    'Сайт считывал пиксели с canvas напрямую',
    'The site read pixels off a canvas directly',
  ],
  fact_audio: ['Сайт снял аудиоотпечаток', 'The site took an audio fingerprint'],
  fact_fonts: [
    'Сайт перебирал шрифты, установленные на вашей машине',
    'The site enumerated the fonts installed on your machine',
  ],
  fact_webrtc: [
    'Сайт запросил ваш локальный сетевой адрес через WebRTC',
    'The site asked for your local network address through WebRTC',
  ],
  fact_devices: [
    'Сайт запросил список ваших камер и микрофонов',
    'The site asked for the list of your cameras and microphones',
  ],
  fact_voices: [
    'Сайт запросил список голосов синтеза речи',
    'The site asked for the list of speech synthesis voices',
  ],
  fact_voices_note: [
    'Набор голосов сильно зависит от системы и потому хорошо различает машины',
    'The set of voices depends heavily on the system and therefore distinguishes machines well',
  ],
  fact_cookie_id: [
    'Сайт поставил вам долгоживущий идентификатор в куки',
    'The site set a long-lived identifier in a cookie',
  ],
  fact_storage: ['Сайт записал данные в хранилище браузера', 'The site wrote data into browser storage'],
  fact_worker: ['Сайт запустил фоновый поток', 'The site started a background worker'],
  fact_worker_note: [
    'Что происходит внутри воркера, прибор не видит — предел 4',
    'What happens inside a worker is invisible to the instrument — limit 4',
  ],
  fact_webvisor: [
    'Сайт записывает ваши действия на странице',
    'The site is recording what you do on the page',
  ],
  fact_webvisor_note: [
    'Движения мыши, прокрутку, клики и ввод в поля. Запись можно потом просмотреть как видео. Что именно попало в запись, прибор не видит',
    'Mouse movement, scrolling, clicks and typing into fields. The recording can later be played back as video. What exactly ended up in it is invisible to the instrument',
  ],
  fact_other_extension: [
    'Ваши данные читал не только сайт, но и другое расширение в браузере',
    'Your data was read not only by the site but by another extension in the browser',
  ],
  fact_other_extension_note: [
    'Отличить, действует расширение само или по просьбе страницы, прибор не может. Эти обращения не засчитаны сайту.',
    'Whether the extension acts on its own or at the page’s request is something the instrument cannot tell. These calls are not counted against the site.',
  ],
  fact_evasion: [
    'Сеть видела запросы, которых не видели обёртки',
    'The network saw requests the wrappers did not',
  ],
  fact_evasion_note: [
    'Так выглядит и обход прибора, и предзагрузка, которую начинает сам браузер по подсказке в разметке, и запрос из воркера. Прибор не может сказать, кто их отправил и почему, — только что они были',
    'This is what an evasion looks like, and also a preload the browser starts on its own from a hint in the markup, and a request from a worker. The instrument cannot say who sent them or why — only that they happened',
  ],
  fact_unattributed: [
    'Ещё $1 к источнику привязать не удалось',
    'A further $1 could not be attributed to a source',
  ],

  // Исходящие факты: «В <кому> ушло <что>»
  fact_out_device_id: [
    'В $1 ушёл идентификатор вашего устройства',
    'Your device identifier went to $1',
  ],
  fact_out_device_id_note: [
    'Он связывает разные ваши визиты между собой',
    'It ties your separate visits together',
  ],
  fact_out_user_id: ['В $1 ушёл ваш идентификатор в системе сайта', 'Your user id on the site went to $1'],
  fact_out_user_id_note: [
    'Это связывает визит с вашей учётной записью, а не только с браузером',
    'This ties the visit to your account, not just to your browser',
  ],
  fact_out_email: [
    'В $1 ушёл хеш вашего адреса электронной почты',
    'A hash of your email address went to $1',
  ],
  fact_out_email_note: [
    'Хеш не расшифровывается, но одинаков на всех сайтах и потому связывает их',
    'The hash cannot be reversed, but it is the same on every site and therefore links them',
  ],
  fact_out_phone: ['В $1 ушёл хеш вашего номера телефона', 'A hash of your phone number went to $1'],
  fact_out_personal: ['В $1 ушли хеши ваших личных данных', 'Hashes of your personal data went to $1'],
  fact_out_personal_note: [
    'Пол, дата рождения, город, индекс — по отдельности мало что значат, вместе опознают человека',
    'Gender, date of birth, city, postcode — individually they mean little, together they identify a person',
  ],
  fact_out_referrer: [
    'В $1 ушло, откуда вы пришли на эту страницу',
    'Where you came to this page from went to $1',
  ],
  fact_out_page_url: [
    'В $1 ушёл адрес страницы, которую вы смотрите',
    'The address of the page you are looking at went to $1',
  ],

  // ── Отчёт ─────────────────────────────────────────────────────────────────
  redacted: ['[отредактировано]', '[redacted]'],
  redacted_query: ['?[отредактировано: $1 парам.]', '?[redacted: $1 params]'],
  redacted_body: ['[отредактировано: тело $1 симв.]', '[redacted: body of $1 chars]'],
  report_warning: [
    'ЭТОТ ФАЙЛ СОХРАНЁН БЕЗ РЕДАКЦИИ. В нём настоящие идентификаторы устройства и сессии, идентификатор пользователя, хеши почты и телефона, адрес предыдущей страницы и сырые тела запросов. Не прикладывайте его к багрепортам и не пересылайте.',
    'THIS FILE WAS SAVED WITHOUT REDACTION. It contains real device and session identifiers, the user id, hashes of email and phone, the previous page address and raw request bodies. Do not attach it to bug reports and do not forward it.',
  ],
  report_redacted_kinds: [
    'идентификаторы устройства и сессии, идентификатор пользователя, хеши почты, телефона и имени, адрес предыдущей страницы, сырые тела запросов',
    'device and session identifiers, the user id, hashes of email, phone and name, the previous page address, raw request bodies',
  ],
  report_nothing: ['ничего', 'nothing'],
  report_title: ['X-RAY FOR WEB — отчёт', 'X-RAY FOR WEB — report'],
  report_site: ['Сайт:            ', 'Site:              '],
  report_started: ['Запись начата:   ', 'Recording started: '],
  report_generated: ['Отчёт сформирован: ', 'Report generated:  '],
  report_redaction_on: [
    'Редакция включена. Вырезано значений: $1',
    'Redaction is on. Values stripped: $1',
  ],
  report_redaction_off: [
    'РЕДАКЦИЯ ОТКЛЮЧЕНА. В файле настоящие идентификаторы и тела запросов.',
    'REDACTION IS OFF. This file holds real identifiers and request bodies.',
  ],
  report_stripped_kinds: ['Вырезается: $1', 'Stripped: $1'],
  report_fields_stay: [
    'Поля при этом остаются на месте: видно, что они были.',
    'The fields themselves stay in place: you can see they were there.',
  ],
  report_h_facts: ['── ЧТО О ВАС УЗНАЛИ ', '── WHAT THEY LEARNED ABOUT YOU '],
  report_h_egress: ['── ЧТО УШЛО НАРУЖУ ', '── WHAT WENT OUT '],
  report_h_log: ['── ЧТО САЙТ ПРОЧИТАЛ ', '── WHAT THE SITE READ '],
  report_h_health: ['── ЗДОРОВЬЕ ПРИБОРА ', '── INSTRUMENT HEALTH '],
  report_h_limits: ['── ПРЕДЕЛЫ ', '── LIMITS '],
  report_nothing_collected: ['  Ничего не собрано.', '  Nothing collected.'],
  report_coverage: ['  Снято поверхностей отпечатка: $1 из $2', '  Fingerprinting surfaces taken: $1 of $2'],
  report_coverage_why: [
    '  Битов энтропии здесь нет намеренно: без распределения по всем\n  пользователям их не существует, а прибор стоит на одной машине.',
    '  There are deliberately no entropy bits here: without a distribution across\n  all users they do not exist, and this instrument runs on one machine.',
  ],
  report_no_egress: ['  Исходящего не было.', '  Nothing went out.'],
  report_not_site_ext: ['    не сайт: другое расширение $1', '    not the site: another extension $1'],
  report_source: ['    источник: ', '    source: '],
  report_source_unknown: [
    '    источник не определён — наблюдение только из сети',
    '    source not determined — observed from the network only',
  ],
  report_cookies: ['    ушли куки: ', '    cookies sent: '],
  report_parser_line: [
    '$1, схема от $2 — разобрано $3, не опознано $4',
    '$1, schema from $2 — $3 parsed, $4 not identified',
  ],
  report_unparsed: ['    формат не опознан. ', '    format not identified. '],
  report_ext_short: ['не сайт: расширение $1', 'not the site: extension $1'],
  report_counted: ['  [счётчик]', '  [counted]'],
  report_arg: ['      аргумент: ', '      argument: '],
  report_result: ['      результат: ', '      result: '],
  report_health_records: ['  Записей: $1, потеряно: $2', '  Records: $1, dropped: $2'],
  report_health_bridge: [
    '  Потерь на мосту: $1, перезапусков worker: $2',
    '  Bridge losses: $1, worker restarts: $2',
  ],
  report_health_calls: [
    '  Вызовов перехвачено: $1, со снятием стека: $2',
    '  Calls intercepted: $1, with stack capture: $2',
  ],
  report_health_reconcile: [
    '  Сверка: $1 подтверждено, $2 мимо прибора, $3 не дошло до сети, $4 нечем проверить',
    '  Reconciliation: $1 confirmed, $2 past the instrument, $3 never reached the network, $4 not checkable',
  ],
  report_warn_killswitch: [
    '  ВНИМАНИЕ: прибор снижал детализацию под нагрузкой.',
    '  WARNING: the instrument reduced detail under load.',
  ],
  report_warn_budget: [
    '  ВНИМАНИЕ: бюджет подробностей исчерпан.',
    '  WARNING: the detail budget is spent.',
  ],
  report_limit_no_block: [
    '  Прибор наблюдает, а не защищает. Он ничего не заблокировал.',
    '  The instrument observes, it does not protect. It blocked nothing.',
  ],
  report_limit_workers: [
    '  Воркеры не наблюдаются: отпечаток внутри воркера прибору не виден.',
    '  Workers are not observed: a fingerprint taken inside a worker is invisible.',
  ],
  report_limit_extensions: [
    '  Другие расширения браузера подменяют те же API; их вызовы помечены\n  «не сайт», но отличить их собственную инициативу от просьбы страницы\n  прибор не может.',
    '  Other browser extensions replace the same APIs; their calls are marked\n  “not the site”, but the instrument cannot tell their own initiative from\n  the page asking them.',
  ],
  report_limit_unknown: [
    '  «Источник не определён» — признание незнания, а не улика.',
    '  “Source not determined” is an admission of ignorance, not evidence.',
  ],
  report_no_recording: ['записи нет', 'no recording'],
};

// ── Генерация ───────────────────────────────────────────────────────────────

const ЯЗЫКИ = { ru: 0, en: 1 };

function собрать(индекс) {
  const из = {};
  for (const [ключ, пара] of Object.entries(СТРОКИ)) {
    из[ключ] = { message: пара[индекс] };
  }
  return из;
}

// Проверяем сами себя: число подстановок в паре обязано совпадать. Разное
// число — это не опечатка в переводе, а строка, которая на одном языке
// потеряет данные, и молча.
export function проверитьПодстановки() {
  const беды = [];
  for (const [ключ, [ru, en]] of Object.entries(СТРОКИ)) {
    const счёт = (s) => new Set([...String(s).matchAll(/\$(\d)/g)].map((m) => m[1])).size;
    if (счёт(ru) !== счёт(en)) {
      беды.push(ключ + ': подстановок ru=' + счёт(ru) + ', en=' + счёт(en));
    }
    const формы = (s) => String(s).split('|').length;
    if (ключ.startsWith('plural_')) {
      if (формы(ru) !== 3) беды.push(ключ + ': в русском должно быть три формы');
      if (формы(en) !== 2) беды.push(ключ + ': в английском должно быть две формы');
    }
  }
  return беды;
}

// Запущены напрямую, а не импортированы набором тестов.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const беды = проверитьПодстановки();
  if (беды.length) {
    console.error('строки не согласованы:');
    for (const b of беды) console.error('  ' + b);
    process.exit(1);
  }

  const корень = join(dirname(fileURLToPath(import.meta.url)), '..', 'extension', '_locales');
  for (const [язык, индекс] of Object.entries(ЯЗЫКИ)) {
    const каталог = join(корень, язык);
    mkdirSync(каталог, { recursive: true });
    writeFileSync(join(каталог, 'messages.json'), JSON.stringify(собрать(индекс), null, 2) + '\n');
    console.log(язык + ': ' + Object.keys(СТРОКИ).length + ' строк');
  }
}
