// Генератор значков расширения.
//
// Значки лежат в репозитории готовыми PNG, но рисуются кодом: так видно, из
// чего они состоят, и так их можно перерисовать под другой размер, не открывая
// редактор. Зависимостей нет — PNG собирается вручную, сжатие берётся из
// встроенного zlib.
//
// Знак: тёмный круг, светлое кольцо-диафрагма и короткая полоса просвета внутри
// него. Читается на светлой и тёмной панели одинаково — фон непрозрачный.
//
// Запуск: node tools/icons.mjs

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const РАЗМЕРЫ = [16, 32, 48, 128];
const СГЛАЖИВАНИЕ = 4; // рисуем крупнее и усредняем — иначе кромки рвутся

// Те же цвета, что в панели: у прибора один язык цвета везде.
const ФОН = [23, 21, 15, 255];
const КОЛЬЦО = [251, 250, 248, 255];
const ПРОСВЕТ = [224, 136, 90, 255];

// ── Растр ───────────────────────────────────────────────────────────────────

function нарисовать(N) {
  const S = N * СГЛАЖИВАНИЕ;
  const пиксели = new Uint8Array(S * S * 4);

  const центр = (S - 1) / 2;
  const радиусФона = S * 0.5;
  const радиусКольца = S * 0.315;
  const толщинаКольца = Math.max(S * 0.085, СГЛАЖИВАНИЕ);
  // Полоса просвета идёт ВНУТРИ кольца и не пересекает его. Первая редакция
  // вела её через весь знак насквозь — получался запрещающий знак, то есть
  // ровно то сообщение, которое прибор о себе не подаёт: он ничего не блокирует.
  const полуширинаПолосы = Math.max(S * 0.045, СГЛАЖИВАНИЕ);
  const длинаПолосы = радиусКольца - толщинаКольца * 0.9;

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = x - центр;
      const dy = y - центр;
      const r = Math.hypot(dx, dy);

      let цвет = null;
      if (r <= радиусФона) цвет = ФОН;
      if (Math.abs(r - радиусКольца) <= толщинаКольца / 2) цвет = КОЛЬЦО;
      if (Math.abs(dy) <= полуширинаПолосы && Math.abs(dx) <= длинаПолосы) {
        цвет = ПРОСВЕТ;
      }

      const i = (y * S + x) * 4;
      if (цвет) {
        пиксели[i] = цвет[0];
        пиксели[i + 1] = цвет[1];
        пиксели[i + 2] = цвет[2];
        пиксели[i + 3] = цвет[3];
      }
    }
  }

  return усреднить(пиксели, S, N);
}

// Усреднение блоками СГЛАЖИВАНИЕ×СГЛАЖИВАНИЕ. Цвет считается с учётом альфы,
// иначе прозрачные края тянут за собой чёрный и знак получается в грязной кайме.
function усреднить(источник, S, N) {
  const из = new Uint8Array(N * N * 4);
  const k = СГЛАЖИВАНИЕ * СГЛАЖИВАНИЕ;

  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let dy = 0; dy < СГЛАЖИВАНИЕ; dy++) {
        for (let dx = 0; dx < СГЛАЖИВАНИЕ; dx++) {
          const i = ((y * СГЛАЖИВАНИЕ + dy) * S + (x * СГЛАЖИВАНИЕ + dx)) * 4;
          const альфа = источник[i + 3] / 255;
          r += источник[i] * альфа;
          g += источник[i + 1] * альфа;
          b += источник[i + 2] * альфа;
          a += источник[i + 3];
        }
      }
      const сумАльфы = a / 255;
      const o = (y * N + x) * 4;
      из[o] = сумАльфы ? Math.round(r / сумАльфы) : 0;
      из[o + 1] = сумАльфы ? Math.round(g / сумАльфы) : 0;
      из[o + 2] = сумАльфы ? Math.round(b / сумАльфы) : 0;
      из[o + 3] = Math.round(a / k);
    }
  }
  return из;
}

// ── PNG ─────────────────────────────────────────────────────────────────────

const ТАБЛИЦА_CRC = (() => {
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
  for (let i = 0; i < buf.length; i++) c = ТАБЛИЦА_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function кусок(тип, данные) {
  const имя = Buffer.from(тип, 'ascii');
  const тело = Buffer.concat([имя, данные]);
  const длина = Buffer.alloc(4);
  длина.writeUInt32BE(данные.length);
  const сумма = Buffer.alloc(4);
  сумма.writeUInt32BE(crc32(тело));
  return Buffer.concat([длина, тело, сумма]);
}

function png(пиксели, N) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(N, 0);
  ihdr.writeUInt32BE(N, 4);
  ihdr[8] = 8; // бит на канал
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // Каждая строка с байтом фильтра 0: картинки крошечные, экономия не стоит кода.
  const строки = Buffer.alloc(N * (N * 4 + 1));
  for (let y = 0; y < N; y++) {
    строки[y * (N * 4 + 1)] = 0;
    Buffer.from(пиксели.buffer, y * N * 4, N * 4).copy(строки, y * (N * 4 + 1) + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    кусок('IHDR', ihdr),
    кусок('IDAT', deflateSync(строки, { level: 9 })),
    кусок('IEND', Buffer.alloc(0)),
  ]);
}

// ── Запись ──────────────────────────────────────────────────────────────────

const каталог = join(dirname(fileURLToPath(import.meta.url)), '..', 'extension', 'icons');
mkdirSync(каталог, { recursive: true });

for (const N of РАЗМЕРЫ) {
  const файл = join(каталог, N + '.png');
  const данные = png(нарисовать(N), N);
  writeFileSync(файл, данные);
  console.log(N + '×' + N + '  ' + данные.length + ' Б  ' + файл);
}
