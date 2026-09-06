# 03 — Модель данных

Это фактическая база проекта. UI, разборщики и своды — производные от неё.
Схема меняется только осознанно, с поднятием `schemaVersion`.

## Сессия

Запись начинается по команде пользователя и заканчивается по команде или при
закрытии вкладки.

```ts
type Session = {
  id: string;              // uuid
  schemaVersion: 1;
  origin: string;          // на что дано разрешение
  startedAt: number;       // Date.now()
  navigations: Navigation[];
  events: Event[];
  health: Health;          // самодиагностика прибора
};

type Navigation = {
  navId: string;
  tabId: number;
  url: string;
  startedAt: number;       // t0 для всех относительных меток времени
};
```

Все `t` в событиях — миллисекунды от `Navigation.startedAt`. «На 1.24 секунде»
берётся отсюда.

## Общая часть события

```ts
type EventBase = {
  id: string;
  navId: string;
  frameId: number;         // 0 = главный документ
  frameUrl: string;        // origin фрейма; для about:blank/srcdoc — origin родителя + пометка
  t: number;               // мс от начала навигации
  trust: 'external' | 'internal' | 'confirmed';
};
```

`trust` присваивается только системой, никогда — разборщиком или UI.

## Событие чтения поверхности

```ts
type SurfaceRead = EventBase & {
  kind: 'surface';
  surface: string;         // 'canvas.toDataURL', 'webgl.getParameter', ...
  group: SurfaceGroup;     // 'canvas' | 'webgl' | 'audio' | 'fonts' | 'device' | ...
  count: number;           // схлопнутые повторы из одного места вызова
  firstT: number;
  lastT: number;
  arg?: string;            // выжимка аргумента: 'UNMASKED_RENDERER_WEBGL'
  result?: string;         // выжимка результата: 'AMD Radeon RX 6600'
  attribution: Attribution | null;
  detail: 'full' | 'counted';  // 'counted' = бюджет исчерпан, стек не снимался
};
```

`count` вместе с `detail` — механизм честности: прибор не делает вид, что записал
всё, если он схлопнул.

## Атрибуция

```ts
type Attribution = {
  scriptUrl: string | null;  // null = не удалось разобрать стек
  line: number | null;
  column: number | null;
  inline: boolean;           // скрипт встроен в документ
  thirdParty: boolean;       // origin скрипта ≠ origin документа
  rawStack?: string;         // хранится только при detail:'full' и включённом режиме отладки
};
```

Если `scriptUrl === null`, UI пишет «источник не определён», а не подставляет
страницу. Неудача атрибуции — это результат, а не пустое место.

## Событие исходящего

```ts
type Egress = EventBase & {
  kind: 'egress';
  source: 'hook' | 'network';
  transport: 'beacon' | 'fetch' | 'xhr' | 'websocket' | 'image' | 'eventsource' | 'other';
  method: string;
  url: string;
  bodySize: number | null;
  body: BodyRef | null;
  cookiesSent?: string[];    // только имена, значения — по правилам редакции
  parsed: ParseResult | null;
  match: 'confirmed' | 'hook-only' | 'network-only' | 'unobserved';
  attribution: Attribution | null;   // только у source:'hook'
};

type BodyRef =
  | { form: 'text'; text: string; truncated: boolean }
  | { form: 'binary'; base64: string; truncated: boolean }
  | { form: 'dropped'; reason: 'too-large' | 'budget' | 'redacted' };
```

`match: 'unobserved'` — сетевой запрос, который законно не проходит через
обёрнутые API (картинка, шрифт, стиль). Он **не** считается обходом прибора.
Обход — только `network-only`. См. [02-architecture.md](02-architecture.md).

## Результат разбора

```ts
type ParseResult = {
  parserId: string;        // 'ga4'
  parserVersion: string;   // '2026-09'
  fields: ParsedField[];
  unknownCount: number;    // сколько полей не опознано
  knownCount: number;
};

type ParsedField = {
  name: string;            // сырое имя: 'cid'
  raw: string;             // сырое значение
  label: string | null;    // 'Идентификатор вашего браузера'; null = не опознано
  kind: FieldKind | null;
  note: string | null;     // 'Живёт 2 года, приходит из куки _ga'
  confidence: 'documented' | 'observed' | 'guess';
};

type FieldKind =
  | 'device-id' | 'session-id' | 'site-id' | 'user-id'
  | 'email-hash' | 'phone-hash' | 'name-hash' | 'personal-hash'
  | 'page-url' | 'page-title' | 'referrer' | 'screen' | 'language' | 'timezone'
  | 'event-name' | 'event-param' | 'user-property'
  | 'timing' | 'nonce' | 'technical' | 'unknown';
```

`confidence: 'guess'` в v1 запрещено к использованию — поле либо опознано по
документации/наблюдению, либо неопознано. Значение оставлено в схеме, чтобы
позже не менять её.

## Свод фактов

```ts
type Fact = {
  id: string;
  text: string;            // 'Сайт узнал модель вашей видеокарты'
  value: string | null;    // 'AMD Radeon RX 6600'
  recipient: string | null;// 'google-analytics.com' — для фактов об исходящем
  evidence: string[];      // id событий; НИКОГДА не пустой
};
```

Инвариант, проверяемый тестом: `evidence.length > 0` для каждого факта. Факт без
доказательства — баг сборки, а не косметика.

## Самодиагностика прибора

```ts
type Health = {
  eventsRecorded: number;
  eventsDropped: number;          // упёрлись в потолок
  degradedSurfaces: string[];     // ушли в detail:'counted'
  killSwitchTripped: boolean;     // прибор снизил детализацию из-за нагрузки
  bridgeGaps: number;             // события MAIN, не дошедшие до сборщика
  swRestarts: number;             // service worker перезапускался при живой сессии
  parserMisses: { parserId: string; unknownFields: string[] }[];
};
```

`Health` отображается в интерфейсе всегда, а не прячется в отладку. Прибор,
который молча теряет данные, хуже отсутствующего прибора.

## Хранение

- Горячий буфер — в памяти service worker.
- Флаш в `chrome.storage.session` каждые 250 мс или 50 событий.
- Потолок сессии — 8 МБ при квоте `chrome.storage.session` в 10 МБ. При
  достижении: новые события пишутся счётчиками, `eventsDropped` растёт, в UI
  появляется явное сообщение.
- Тело запроса > 64 КБ обрезается до 64 КБ с `truncated: true`.
- На диск (`chrome.storage.local`) ничего не пишется без явной команды
  «сохранить сессию». Журнал содержит токены и содержимое форм — по умолчанию он
  умирает вместе с браузером.

## Экспорт и редакция

При экспорте по умолчанию удаляются:

- значения заголовков `Cookie`, `Set-Cookie`, `Authorization`;
- значения полей с `kind` из `email-hash`, `phone-hash`, `name-hash`, `user-id`;
- содержимое тел с `Content-Type: application/x-www-form-urlencoded`, если поле
  не опознано разборщиком.

Каждое вырезанное значение заменяется на `[отредактировано]` — так, чтобы факт
наличия поля остался виден. Отключение редакции возможно, но требует отдельного
подтверждения с прямым текстом о том, что уходит в файл.
