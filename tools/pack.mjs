// Сборка zip с расширением.
//
// Из репозитория человек скачивает весь workshop: стенд, тесты, документы,
// генераторы. Для чтения и проверки это правильно, для установки — нет: в
// «Загрузить распакованное» надо ткнуть одной папкой, и лишнее рядом только
// сбивает. Поэтому по тегу собирается zip, в котором лежит ровно расширение.
//
// Зависимостей нет и здесь. ZIP пишется руками: заголовок на файл, центральный
// каталог, конец каталога. Сжатие — deflate из встроенного zlib. Формат
// открытый и небольшой, а тянуть ради него пакет из npm в проект, который
// обещает ноль зависимостей, значило бы обещание нарушить.
//
// Запуск: node tools/pack.mjs [выходной-файл.zip]

import { deflateRawSync } from 'node:zlib';
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

const корень = join(dirname(fileURLToPath(import.meta.url)), '..');
const источник = join(корень, 'extension');

// В расширении не должно оказаться ничего, что туда не относится. Список
// закрытый: новое расширение файлов надо добавить осознанно, а не обнаружить
// в собранном пакете.
export const РАЗРЕШЁННЫЕ = new Set(['.js', '.json', '.html', '.css', '.png']);

// Читается в репозитории, в пакете не нужен: Chrome его игнорирует, а человек,
// поставивший расширение, читает README на GitHub.
const ПРОПУСКАЕМЫЕ = new Set(['.md']);

// ── Обход дерева ────────────────────────────────────────────────────────────

export function собратьФайлы(каталог = источник, префикс = '') {
  const из = [];
  for (const имя of readdirSync(каталог).sort()) {
    const полный = join(каталог, имя);
    const внутри = префикс ? префикс + '/' + имя : имя;
    if (statSync(полный).isDirectory()) {
      из.push(...собратьФайлы(полный, внутри));
      continue;
    }
    const точка = имя.lastIndexOf('.');
    const расширение = точка < 0 ? '' : имя.slice(точка);
    if (ПРОПУСКАЕМЫЕ.has(расширение)) continue;
    if (!РАЗРЕШЁННЫЕ.has(расширение)) {
      throw new Error('в extension/ лежит файл неожиданного вида: ' + внутри);
    }
    из.push({ путь: внутри, данные: readFileSync(полный) });
  }
  return из;
}

// ── CRC32 ───────────────────────────────────────────────────────────────────

const ТАБЛИЦА = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = ТАБЛИЦА[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ── ZIP ─────────────────────────────────────────────────────────────────────

// Время в архиве фиксированное. Иначе один и тот же набор файлов давал бы
// разные архивы при каждой сборке, и проверить «это тот же пакет» стало бы
// нечем. 1980-01-01 — самая ранняя дата, которую формат вообще умеет.
const ВРЕМЯ = 0;
const ДАТА = (1 << 5) | 1; // год 1980, месяц 1, день 1

export function собратьZip(файлы) {
  const куски = [];
  const каталог = [];
  let смещение = 0;

  for (const f of файлы) {
    const имя = Buffer.from(f.путь, 'utf8');
    const сжатое = deflateRawSync(f.данные, { level: 9 });
    const сумма = crc32(f.данные);

    const заголовок = Buffer.alloc(30);
    заголовок.writeUInt32LE(0x04034b50, 0);
    заголовок.writeUInt16LE(20, 4); // нужна версия 2.0
    заголовок.writeUInt16LE(0x0800, 6); // имена в UTF-8
    заголовок.writeUInt16LE(8, 8); // deflate
    заголовок.writeUInt16LE(ВРЕМЯ, 10);
    заголовок.writeUInt16LE(ДАТА, 12);
    заголовок.writeUInt32LE(сумма, 14);
    заголовок.writeUInt32LE(сжатое.length, 18);
    заголовок.writeUInt32LE(f.данные.length, 22);
    заголовок.writeUInt16LE(имя.length, 26);
    заголовок.writeUInt16LE(0, 28);

    куски.push(заголовок, имя, сжатое);

    const запись = Buffer.alloc(46);
    запись.writeUInt32LE(0x02014b50, 0);
    запись.writeUInt16LE(20, 4);
    запись.writeUInt16LE(20, 6);
    запись.writeUInt16LE(0x0800, 8);
    запись.writeUInt16LE(8, 10);
    запись.writeUInt16LE(ВРЕМЯ, 12);
    запись.writeUInt16LE(ДАТА, 14);
    запись.writeUInt32LE(сумма, 16);
    запись.writeUInt32LE(сжатое.length, 20);
    запись.writeUInt32LE(f.данные.length, 24);
    запись.writeUInt16LE(имя.length, 28);
    запись.writeUInt32LE(смещение, 42);
    каталог.push(запись, имя);

    смещение += заголовок.length + имя.length + сжатое.length;
  }

  const телоКаталога = Buffer.concat(каталог);
  const конец = Buffer.alloc(22);
  конец.writeUInt32LE(0x06054b50, 0);
  конец.writeUInt16LE(файлы.length, 8);
  конец.writeUInt16LE(файлы.length, 10);
  конец.writeUInt32LE(телоКаталога.length, 12);
  конец.writeUInt32LE(смещение, 16);

  return Buffer.concat([...куски, телоКаталога, конец]);
}

// ── Сборка ──────────────────────────────────────────────────────────────────

// Собираем только при прямом запуске: набор проверок пакета импортирует
// отсюда обход дерева и список допустимых видов файлов, а писать при этом
// ничего не должен.
if (pathToFileURL(process.argv[1] || '').href === import.meta.url) {
  const манифест = JSON.parse(readFileSync(join(источник, 'manifest.json'), 'utf8'));
  const файлы = собратьФайлы(источник);

  // Пакет без манифеста Chrome не примет, а без панели и обёрток он бесполезен.
  // Проверяем до записи: собранный и молча неполный архив хуже несобранного.
  const обязательные = [
    'manifest.json',
    манифест.background.service_worker,
    манифест.side_panel.default_path,
    '_locales/' + манифест.default_locale + '/messages.json',
  ];
  for (const н of обязательные) {
    if (!файлы.some((f) => f.путь === н.split(sep).join('/'))) {
      throw new Error('в пакет не попал обязательный файл: ' + н);
    }
  }

  const выход = process.argv[2] || join(корень, 'dist', 'x-ray-for-web-' + манифест.version + '.zip');
  mkdirSync(dirname(выход), { recursive: true });

  const архив = собратьZip(файлы);
  writeFileSync(выход, архив);

  const байт = файлы.reduce((s, f) => s + f.данные.length, 0);
  console.log(
    файлы.length + ' файлов, ' + байт + ' Б → ' + архив.length + ' Б  ' + relative(корень, выход)
  );

}
