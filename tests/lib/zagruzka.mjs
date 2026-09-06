// Загрузка модулей расширения в node.
//
// Расширение — модули ES, но файлы у него .js, а node без package.json считает
// .js обычным скриптом. Раньше каждый набор копировал один файл во временный
// .mjs; после появления _locales модули стали ссылаться друг на друга, и
// копировать по одному стало нельзя.
//
// Поэтому копируем группу файлов разом, переименовывая .js → .mjs и правя
// относительные импорты. package.json в extension/ не заводим намеренно: он
// уехал бы в расширение, а лишний файл в пакете прибора — это лишний вопрос
// «что это и зачем».

import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

// Заглушка chrome.i18n поверх настоящего источника строк. Русский взят не
// потому, что он главный, а потому, что тесты писались на нём и сверяют
// формулировки. Отсутствующий ключ вернёт '[ключ]' и уронит проверку — это
// и есть проверка того, что ключ существует.
export async function поставитьI18n(язык = 'ru') {
  const { СТРОКИ } = await import('../../tools/messages.mjs');
  const индекс = язык === 'ru' ? 0 : 1;

  const i18n = {
    getUILanguage: () => (язык === 'ru' ? 'ru-RU' : 'en-US'),
    getMessage(ключ, подстановки) {
      const пара = СТРОКИ[ключ];
      if (!пара) return '';
      let s = пара[индекс];
      const список = подстановки || [];
      for (let i = список.length; i >= 1; i--) {
        s = s.split('$' + i).join(String(список[i - 1]));
      }
      return s;
    },
  };

  if (!globalThis.chrome) globalThis.chrome = {};
  globalThis.chrome.i18n = i18n;
  return i18n;
}

// Копирует файлы (пути от корня репозитория) во временный каталог и возвращает
// импортированный первый из них.
export async function загрузить(имяКаталога, файлы) {
  const каталог = join(tmpdir(), 'xray-' + имяКаталога);
  rmSync(каталог, { recursive: true, force: true });
  mkdirSync(каталог, { recursive: true });

  // Раскладка плоская, поэтому имена обязаны не пересекаться. В расширении есть
  // и background/index.js, и background/parsers/index.js — молча положить один
  // поверх другого значило бы проверять не то, что думаешь.
  const занято = new Map();
  for (const о of файлы) {
    const имя = назначение(о);
    if (занято.has(имя)) throw new Error("имена файлов совпали: " + занято.get(имя) + " и " + о);
    занято.set(имя, о);
  }

  for (const относительный of файлы) {
    const исходный = new URL('../../' + относительный, import.meta.url);
    let текст = readFileSync(исходный, 'utf8');
    // Только относительные импорты: './x.js' и '../y/z.js'. Внешних у проекта нет.
    текст = текст.replace(/(from\s+['"]\.{1,2}\/[^'"]+)\.js(['"])/g, '$1.mjs$2');
    const цель = join(каталог, назначение(относительный));
    mkdirSync(dirname(цель), { recursive: true });
    writeFileSync(цель, текст);
  }

  const вход = join(каталог, назначение(файлы[0]));
  const модуль = await import(pathToFileURL(вход).href + '?v=' + Date.now());
  return { модуль, каталог, убрать: () => rmSync(каталог, { recursive: true, force: true }) };
}

// Плоская раскладка: имена файлов расширения не пересекаются, а плоский
// каталог позволяет не переписывать пути импортов, только расширение.
function назначение(относительный) {
  return basename(относительный).replace(/\.js$/, '.mjs');
}
