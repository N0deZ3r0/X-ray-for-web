// Перевод для service worker: свод и экспорт.
//
// Двойник панельного ui/i18n.js. Различие только в способе подключения —
// здесь модуль, там классический скрипт, — и обе стороны читают одни и те же
// _locales. Логика выбора формы продублирована на десяток строк; сами строки
// не продублированы нигде.
//
// В тестах chrome нет, и это нормально: t() возвращает ключ, а тесты свода
// сверяют ключи, а не слова. Утверждение «прибор не говорит больше, чем
// записал» от языка не зависит, и проверять его надо на ключах.

const ЯЗЫК = (typeof chrome !== 'undefined' && chrome.i18n && chrome.i18n.getUILanguage
  ? chrome.i18n.getUILanguage()
  : 'en'
).toLowerCase();

const РУССКИЙ = ЯЗЫК.startsWith('ru') || ЯЗЫК.startsWith('uk') || ЯЗЫК.startsWith('be');

function форма(n) {
  if (!РУССКИЙ) return n === 1 ? 0 : 1;
  const сотня = n % 100;
  if (сотня >= 11 && сотня <= 14) return 2;
  const единица = n % 10;
  if (единица === 1) return 0;
  if (единица >= 2 && единица <= 4) return 1;
  return 2;
}

export function t(ключ, ...подстановки) {
  const s =
    typeof chrome !== 'undefined' && chrome.i18n && chrome.i18n.getMessage
      ? chrome.i18n.getMessage(ключ, подстановки.map(String))
      : '';
  return s || '[' + ключ + ']';
}

export function n(число, ключ) {
  const формы = t(ключ).split('|');
  const i = форма(число);
  return число + ' ' + (формы[i] !== undefined ? формы[i] : формы[формы.length - 1]);
}

// Метка поля из декларации. Декларация — данные, и её текст двуязычен прямо
// в JSON: {"ru": "…", "en": "…"}. Строка вместо объекта означает, что автор
// декларации дал один язык — показываем как есть, выдумывать перевод нельзя.
export function текст(значение) {
  if (значение == null) return '';
  if (typeof значение === 'string') return значение;
  if (typeof значение !== 'object') return String(значение);
  if (значение[ЯЗЫК]) return значение[ЯЗЫК];
  const короткий = ЯЗЫК.split('-')[0];
  if (значение[короткий]) return значение[короткий];
  if (значение.en) return значение.en;
  const первый = Object.keys(значение)[0];
  return первый ? значение[первый] : '';
}

export const язык = ЯЗЫК;

// Подробность вызова: инструмент живёт в мире страницы, где chrome.i18n нет,
// поэтому пишет коды — «chars:4820», «rect:200x100@0,0», «yes». Слова
// подставляются здесь. Незнакомый код показывается как есть: придумывать ему
// расшифровку нельзя, а потерять её ещё хуже.
//
// Живёт рядом с переводом, а не в панели, потому что коды доходят не только до
// панели: свод и отчёт показывают те же значения, и до этой правки человек
// видел в фактах «n:4» вместо «4 шт.».
function подробностьС(t, код) {
  const v = String(код == null ? '' : код);
  let m;
  if ((m = /^chars:(\d+)$/.exec(v))) return t('det_chars', m[1]);
  if ((m = /^n:(\d+)$/.exec(v))) return t('det_items', m[1]);
  if ((m = /^rect:(\d+)x(\d+)@(-?\d+),(-?\d+)$/.exec(v))) {
    return t('det_rect', m[1], m[2], m[3], m[4]);
  }
  if ((m = /^audio:([\d.]+),([\d.]+)$/.exec(v))) return t('det_audio', m[1], m[2]);
  if ((m = /^cookies:(\d+)$/.exec(v))) return t('det_cookies', m[1]);
  if ((m = /^html:(\d+)$/.exec(v))) return t('det_html', m[1]);
  if ((m = /^surfaces:(\d+)(?: failed:(\d+):(.*))?$/.exec(v))) {
    const голова = t('det_surfaces', m[1]);
    return m[2] ? голова + '; ' + t('det_failed', m[2], m[3]) : голова;
  }
  if (v === 'yes') return t('det_yes');
  if (v === 'no') return t('det_no');
  if (v === 'self:known') return t('det_self_known');
  if (v === 'self:unknown') return t('det_self_unknown');
  // Разделитель именно « | » целиком: без экранирования он становится
  // альтернативой, и тогда любая строка с пробелом обрезается по последнему
  // пробелу и обрастает хвостом про дни. Так и было на живом сайте.
  if ((m = /^(.*) \| days:(\d+)$/.exec(v))) return m[1] + ', ' + t('det_days', m[2]);
  if ((m = /^(.*) \| until:(.*)$/.exec(v))) return m[1] + ', ' + t('det_until', m[2]);
  if ((m = /^(.*) \| chars:(\d+)$/.exec(v))) return m[1] + ' (' + t('det_chars', m[2]) + ')';
  return v;
}

export const подробность = (код) => подробностьС(t, код);
