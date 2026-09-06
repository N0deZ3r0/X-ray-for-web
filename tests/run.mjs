// Прогон всех наборов разом.
//
// Зависимостей нет: каждый набор — отдельный процесс node, свой chrome-заглушка
// и свой выход. Так набор не может случайно опереться на состояние соседнего,
// а упавший не уносит с собой остальные.
//
// Запуск: node tests/run.mjs   (или node tests/<имя>.test.mjs по одному)

import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const каталог = dirname(fileURLToPath(import.meta.url));
const наборы = readdirSync(каталог)
  .filter((f) => f.endsWith('.test.mjs'))
  .sort();

let провалено = 0;
let всегоПроверок = 0;
const итоги = [];

for (const набор of наборы) {
  const r = spawnSync(process.execPath, [join(каталог, набор)], { encoding: 'utf8' });
  const вывод = (r.stdout || '') + (r.stderr || '');
  const проверок = (вывод.match(/^ {2}ok {6}/gm) || []).length;
  const упало = (вывод.match(/^ {2}ПРОВАЛ {2}/gm) || []).length;
  всегоПроверок += проверок;

  if (r.status !== 0) {
    провалено++;
    console.log(вывод);
  }
  итоги.push({ набор, проверок, упало, код: r.status });
}

console.log('');
for (const и of итоги) {
  const метка = и.код === 0 ? 'ok    ' : 'ПРОВАЛ';
  console.log(
    метка + '  ' + и.набор.padEnd(22) + String(и.проверок).padStart(4) + ' проверок' +
      (и.упало ? '   упало: ' + и.упало : '')
  );
}
console.log('');
console.log(
  провалено
    ? провалено + ' наборов из ' + наборы.length + ' провалено'
    : 'все ' + всегоПроверок + ' проверок в ' + наборы.length + ' наборах пройдены'
);
process.exit(провалено ? 1 : 0);
