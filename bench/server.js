#!/usr/bin/env node
// Стенд «Рентген для веба» — два источника, чтобы получить настоящий кросс-origin.
//   http://localhost:8080  — origin A, первая сторона (страница)
//   http://localhost:8081  — origin B, третья сторона (скрипты, фреймы, приёмники)
// Зависимостей нет намеренно: стенд должен запускаться одной командой.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const PORT_A = 8080;
const PORT_B = 8081;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

// 1x1 прозрачный PNG — шумовые картинки и пиксели-маячки
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

// Журнал принятого — стенд сам себе свидетель, чтобы сверять с прибором.
// У каждого origin он свой: общий массив давал бы двойной счёт при слиянии.
function makeLog(originName) {
  const received = [];
  return {
    received,
    add(entry) {
      received.push(entry);
      if (received.length > 500) received.shift();
      const b = entry.body ? ` body=${entry.body.length}b` : '';
      console.log(`  [${originName}] ${entry.method} ${entry.path}${b}`);
    },
  };
}

function cors(res, req) {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type,x-bench');
  res.setHeader('Access-Control-Max-Age', '600');
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(''));
  });
}

function serveStatic(dir, urlPath, res) {
  const rel = urlPath === '/' ? '/index.html' : urlPath;
  const segments = rel.split('/').filter((s) => s && s !== '.' && s !== '..');
  const file = path.join(dir, ...segments);
  if (!file.startsWith(dir)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404 ' + rel);
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] || 'application/octet-stream',
      'cache-control': 'no-store',
    }).end(data);
  });
}

// Пути-приёмники. Форма адресов повторяет настоящие, но всё остаётся на localhost:
// стенд не отправляет наружу ни одного байта.
const COLLECTORS = ['/g/collect', '/tr', '/collect'];

// Метрика кладёт номер счётчика в путь, поэтому сравнением строк не обойтись.
const COLLECTOR_PREFIXES = ['/watch/', '/webvisor'];

function приёмник(p) {
  return COLLECTORS.includes(p) || COLLECTOR_PREFIXES.some((x) => p.startsWith(x));
}

function makeServer(originName, dir) {
  const logger = makeLog(originName);
  const received = logger.received;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost`);
    const p = url.pathname;

    if (req.method === 'OPTIONS') {
      cors(res, req);
      res.writeHead(204).end();
      return;
    }

    // Шумовые картинки: разные адреса, один пиксель
    if (p === '/noise/img') {
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' }).end(PIXEL);
      return;
    }

    if (приёмник(p)) {
      const body = req.method === 'POST' ? await readBody(req) : '';
      logger.add({
        at: Date.now(),
        origin: originName,
        method: req.method,
        path: p,
        query: url.search,
        body,
        cookie: req.headers.cookie || null,
        // Заголовки, по которым видно, кто начал запрос. Sec-Purpose Chrome
        // ставит сам на предзагрузку по подсказке в разметке; JS-запрос его не
        // несёт. Стенд — независимый свидетель, и это ровно тот случай, когда
        // его показания решают вопрос, который прибору изнутри не виден.
        sec: {
          purpose: req.headers['sec-purpose'] || req.headers.purpose || null,
          dest: req.headers['sec-fetch-dest'] || null,
          mode: req.headers['sec-fetch-mode'] || null,
          site: req.headers['sec-fetch-site'] || null,
        },
      });
      cors(res, req);
      // Пиксель отвечает картинкой, остальное — 204
      if (p === '/tr') {
        res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' }).end(PIXEL);
      } else {
        res.writeHead(204).end();
      }
      return;
    }

    // Отладочный стапель: отдаёт файлы расширения как обычные скрипты.
    // Нужен, чтобы гонять инструмент без переустановки расширения при каждой
    // правке. В самом расширении этого пути нет и быть не может.
    if (p.startsWith('/__ext/')) {
      const extDir = path.join(ROOT, '..', 'extension');
      serveStatic(extDir, p.slice('/__ext'.length), res);
      return;
    }

    // Что стенд принял — для сверки с журналом прибора
    if (p === '/__received') {
      cors(res, req);
      res.writeHead(200, { 'content-type': MIME['.json'], 'cache-control': 'no-store' })
        .end(JSON.stringify(received, null, 2));
      return;
    }
    if (p === '/__reset') {
      received.length = 0;
      cors(res, req);
      res.writeHead(204).end();
      return;
    }

    // Законные данные приложения — обычный GET, не маячок.
    // Прибор обязан показать его как исходящее, но НЕ как трекер.
    if (p === '/api/articles') {
      cors(res, req);
      res.writeHead(200, { 'content-type': MIME['.json'], 'cache-control': 'no-store' })
        .end(JSON.stringify({ items: [{ id: 1, title: 'Обычные данные страницы' }] }));
      return;
    }

    serveStatic(dir, p, res);
  });

  // Минимальное рукопожатие WebSocket: сценарию нужно, чтобы соединение открылось.
  server.on('upgrade', (req, socket) => {
    socket.on('error', () => {});
    const key = req.headers['sec-websocket-key'];
    if (!key) return socket.destroy();
    const accept = crypto
      .createHash('sha1')
      .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
      .digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    logger.add({ at: Date.now(), origin: originName, method: 'WS', path: req.url, body: '' });
  });

  return server;
}

makeServer('A', path.join(ROOT, 'a')).listen(PORT_A, () => {
  console.log(`origin A (страница)      http://localhost:${PORT_A}/`);
});
makeServer('B', path.join(ROOT, 'b')).listen(PORT_B, () => {
  console.log(`origin B (третья сторона) http://localhost:${PORT_B}/`);
  console.log('');
  console.log('Открывать надо origin A. Принятое видно на http://localhost:8080/__received');
  console.log('');
});
