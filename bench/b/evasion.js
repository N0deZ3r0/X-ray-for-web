// origin B — обход прибора. Главный файл стенда.
// Каждый сценарий здесь — либо признанная слепая зона из 06-limits.md,
// либо случай, который обязан всплыть как network-only.
(function () {
  const B = (window.__bench = window.__bench || {});
  const ORIGIN_B = 'http://localhost:8081';

  // Чистый realm: у свежего same-origin фрейма прототипы не тронуты обёртками,
  // потому что обёртки ставятся в каждый фрейм отдельно, а этот создан позже.
  function makeCleanFrame() {
    const f = document.createElement('iframe');
    f.style.cssText = 'position:absolute;width:1px;height:1px;left:-9999px;border:0';
    document.body.appendChild(f);
    return f;
  }

  // Предел 3 из 06-limits.md. Обёртка не сработает — это ожидаемо.
  // Прибор обязан не показать ложную атрибуцию, а не «поймать» вызов.
  B.evadeCanvasCleanProto = function evadeCanvasCleanProto() {
    const f = makeCleanFrame();
    const doc = f.contentWindow.document;

    const c = doc.createElement('canvas');
    c.width = 200;
    c.height = 50;
    const ctx = c.getContext('2d');
    ctx.textBaseline = 'top';
    ctx.font = '14px Arial';
    ctx.fillStyle = '#069';
    ctx.fillText('обход через чистый фрейм', 2, 15);

    const dataUrl = c.toDataURL();
    f.remove();

    return {
      dataUrlLength: dataUrl.length,
      ожидание: 'обёртка НЕ сработала; прибор не должен приписывать вызов кому-либо',
    };
  };

  // Ключевой сценарий Э2. Маячок уходит мимо обёртки, но виден webRequest.
  // Прибор обязан пометить его network-only.
  B.evadeBeaconCleanProto = function evadeBeaconCleanProto() {
    const f = makeCleanFrame();
    const win = f.contentWindow;

    const url =
      ORIGIN_B +
      '/g/collect?' +
      new URLSearchParams({
        v: '2',
        tid: 'G-BENCH12345',
        cid: '1847362910.1730000000',
        en: 'evaded_beacon',
        dl: location.href,
      }).toString();

    const ok = win.navigator.sendBeacon.call(win.navigator, url);
    setTimeout(() => f.remove(), 100);

    return { ok, ожидание: 'network-only — прибор обязан показать обход' };
  };

  // То же через чистый fetch
  B.evadeFetchCleanProto = function evadeFetchCleanProto() {
    const f = makeCleanFrame();
    const win = f.contentWindow;
    return win
      .fetch(ORIGIN_B + '/collect', {
        method: 'POST',
        body: 'evaded=fetch&cid=1847362910.1730000000',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      })
      .then((r) => {
        setTimeout(() => f.remove(), 100);
        return { status: r.status, ожидание: 'network-only' };
      });
  };

  // Предел 4: воркер. Отпечаток снимается там, куда content script не достаёт.
  B.workerFingerprint = function workerFingerprint() {
    return new Promise((resolve) => {
      // Воркер обязан быть same-origin — грузим с origin A.
      // Для слепой зоны это не важно: важно, что это воркер.
      const w = new Worker('/worker.js');
      const done = (r) => {
        try {
          w.terminate();
        } catch (e) {}
        resolve(r);
      };
      w.onmessage = (e) =>
        done(
          Object.assign({}, e.data, {
            ожидание: 'поверхности НЕ видны прибору; маячок из воркера обязан быть network-only',
          })
        );
      w.onerror = (e) => done({ error: String(e.message || e), ожидание: 'воркер не запустился' });
      w.postMessage('снимай');
      setTimeout(() => done({ error: 'таймаут воркера' }), 3000);
    });
  };

  // Фрейм srcdoc. Требует matchOriginAsFallback — без него прибор слеп здесь.
  B.srcdocFrameFingerprint = function srcdocFrameFingerprint() {
    return new Promise((resolve) => {
      const f = document.createElement('iframe');
      f.style.cssText = 'position:absolute;width:1px;height:1px;left:-9999px;border:0';

      const inner = [
        'var c=document.createElement("canvas");c.width=120;c.height=30;',
        'var x=c.getContext("2d");x.font="12px Arial";x.fillText("srcdoc",2,12);',
        'var d=c.toDataURL();',
        'var gl=document.createElement("canvas").getContext("webgl");',
        'var r=gl?gl.getParameter(gl.RENDERER):null;',
        'parent.postMessage({__bench:"srcdoc",len:d.length,renderer:r},"*");',
      ].join('');

      const open = '<' + 'script>';
      const close = '<' + '/script>';
      f.srcdoc = '<!doctype html><meta charset="utf-8">' + open + inner + close;

      const onMsg = (e) => {
        if (!e.data || e.data.__bench !== 'srcdoc') return;
        window.removeEventListener('message', onMsg);
        f.remove();
        resolve(Object.assign({}, e.data, { ожидание: 'событие с frameId != 0, фрейм srcdoc' }));
      };
      window.addEventListener('message', onMsg);
      document.body.appendChild(f);
      setTimeout(() => resolve({ error: 'таймаут srcdoc' }), 2000);
    });
  };

  // Фрейм about:blank, наполненный через document.write
  B.blankFrameFingerprint = function blankFrameFingerprint() {
    const f = makeCleanFrame();
    const doc = f.contentWindow.document;

    const inner = [
      'var c=document.createElement("canvas");c.width=120;c.height=30;',
      'var x=c.getContext("2d");x.font="12px Arial";x.fillText("blank",2,12);',
      'window.__len=c.toDataURL().length;',
    ].join('');

    const open = '<' + 'script>';
    const close = '<' + '/script>';

    doc.open();
    doc.write('<!doctype html><meta charset="utf-8">' + open + inner + close);
    doc.close();

    const len = f.contentWindow.__len;
    setTimeout(() => f.remove(), 100);
    return { len, ожидание: 'событие из about:blank фрейма' };
  };

  // Кросс-origin фрейм: свой origin, свой набор обёрток, свой frameId
  B.crossOriginFrameFingerprint = function crossOriginFrameFingerprint() {
    return new Promise((resolve) => {
      const f = document.createElement('iframe');
      f.style.cssText = 'position:absolute;width:1px;height:1px;left:-9999px;border:0';
      f.src = ORIGIN_B + '/frame.html';
      const onMsg = (e) => {
        if (!e.data || e.data.__bench !== 'cross-origin-frame') return;
        window.removeEventListener('message', onMsg);
        setTimeout(() => f.remove(), 100);
        resolve(
          Object.assign({}, e.data, {
            ожидание: 'события с frameUrl = http://localhost:8081, включая свой маячок',
          })
        );
      };
      window.addEventListener('message', onMsg);
      document.body.appendChild(f);
      setTimeout(() => resolve({ error: 'таймаут кросс-origin фрейма' }), 3000);
    });
  };

  // Предел 1: измеряем, насколько прибор заметен странице.
  // Это не атака на прибор, а честный замер эффекта наблюдателя.
  B.detectInstrument = function detectInstrument() {
    const norm = (s) => s.replace(/[\s]+/g, ' ').trim();

    const targets = {
      'canvas.toDataURL': HTMLCanvasElement.prototype.toDataURL,
      'canvas.getImageData': CanvasRenderingContext2D.prototype.getImageData,
      'canvas.measureText': CanvasRenderingContext2D.prototype.measureText,
      'webgl.getParameter':
        window.WebGLRenderingContext && WebGLRenderingContext.prototype.getParameter,
      'navigator.sendBeacon': navigator.sendBeacon,
      'window.fetch': window.fetch,
      'XHR.send': XMLHttpRequest.prototype.send,
    };

    const suspicious = [];
    for (const name in targets) {
      const fn = targets[name];
      if (!fn) continue;
      const src = norm(Function.prototype.toString.call(fn));
      // Нативные методы печатаются с именем: function toDataURL() { [native code] }
      if (src.indexOf('[native code]') === -1) suspicious.push(name + ' (toString)');
    }

    // Замер: обёртка со снятием стека медленнее нативного вызова
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d');
    const t0 = performance.now();
    for (let i = 0; i < 2000; i++) ctx.measureText('проба ' + i);
    const perCall = (performance.now() - t0) / 2000;

    return {
      обнаружено: suspicious,
      measureTextМкс: (perCall * 1000).toFixed(2),
      вывод: suspicious.length
        ? 'страница видит прибор — это признанный предел, а не баг'
        : 'обёртки не обнаружены по toString',
    };
  };
})();
