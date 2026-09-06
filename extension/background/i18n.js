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
