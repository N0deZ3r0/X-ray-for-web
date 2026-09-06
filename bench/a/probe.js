// origin A — щуп покрытия.
//
// Отвечает на вопрос критерия Э0: встал ли прибор в этом фрейме.
// Способ честный и не требует от прибора никаких опознавательных знаков:
// сборщик подаёт в канал сигнал готовности, и если инструмент во фрейме есть,
// он в ответ выкидывает свой журнал. Нет ответа — нет прибора.

(function () {
  const P = (window.__probe = window.__probe || {});

  const CHANNEL = '__xray_v1';
  const READY = '__xray_v1_ready';

  // Щуп внутри произвольного документа (свой или same-origin фрейма)
  // Щуп работает по window, а не по document: канал прибора живёт именно там,
  // чтобы переживать document.open().
  function probeDocument(doc, win, timeoutMs) {
    return new Promise((resolve) => {
      const found = { прибор: false, поверхности: null, записей: 0 };
      const onEvent = (e) => {
        found.прибор = true;
        try {
          const payload = JSON.parse(e.detail);
          found.записей = payload.records.length;
          for (const r of payload.records) {
            if (r.kind === 'installed') found.поверхности = r.arg;
          }
        } catch (err) {}
      };

      win.addEventListener(CHANNEL, onEvent, true);

      // Сигнал подаём несколько раз. После document.open() слушатель инструмента
      // снесён и встанет обратно только на следующем тике его таймера — один
      // выстрел в эту дыру и попал бы.
      const ping = () => {
        try {
          win.dispatchEvent(new win.CustomEvent(READY));
        } catch (e) {}
      };
      ping();
      const beat = setInterval(ping, 150);

      setTimeout(() => {
        clearInterval(beat);
        win.removeEventListener(CHANNEL, onEvent, true);
        resolve(found);
      }, timeoutMs || 800);
    });
  }

  function frameShell() {
    const f = document.createElement('iframe');
    f.style.cssText = 'position:absolute;width:1px;height:1px;left:-9999px;border:0';
    return f;
  }

  // Главный документ
  P.probeTop = function probeTop() {
    return probeDocument(document, window);
  };

  // srcdoc-фрейм: наследует origin родителя, поэтому щупаем напрямую.
  // Без matchOriginAsFallback прибор сюда не попадает.
  P.probeSrcdoc = async function probeSrcdoc() {
    const f = frameShell();
    f.srcdoc = '<!doctype html><meta charset="utf-8"><p>srcdoc';
    document.body.appendChild(f);
    await new Promise((r) => (f.onload = r));
    const out = await probeDocument(f.contentDocument, f.contentWindow);
    f.remove();
    return Object.assign({ фрейм: 'srcdoc' }, out);
  };

  // about:blank, наполненный через document.write
  P.probeBlank = async function probeBlank() {
    const f = frameShell();
    document.body.appendChild(f);
    const doc = f.contentDocument;
    doc.open();
    doc.write('<!doctype html><meta charset="utf-8"><p>about:blank');
    doc.close();
    const out = await probeDocument(doc, f.contentWindow);
    f.remove();
    return Object.assign({ фрейм: 'about:blank' }, out);
  };

  // Кросс-origin: напрямую не дотянуться, фрейм щупает себя сам и отвечает
  P.probeCrossOrigin = function probeCrossOrigin() {
    return new Promise((resolve) => {
      const f = frameShell();
      f.src = 'http://localhost:8081/frame.html';

      const onMsg = (e) => {
        if (!e.data || e.data.__probe !== 'result') return;
        window.removeEventListener('message', onMsg);
        f.remove();
        resolve(Object.assign({ фрейм: 'кросс-origin localhost:8081' }, e.data.found));
      };
      window.addEventListener('message', onMsg);

      f.onload = () => {
        try {
          f.contentWindow.postMessage({ __probe: 'ping' }, 'http://localhost:8081');
        } catch (e) {}
      };
      document.body.appendChild(f);

      setTimeout(() => {
        window.removeEventListener('message', onMsg);
        resolve({ фрейм: 'кросс-origin localhost:8081', ошибка: 'нет ответа' });
      }, 3000);
    });
  };

  P.coverage = async function coverage() {
    const top = await P.probeTop();
    const srcdoc = await P.probeSrcdoc();
    const blank = await P.probeBlank();
    const cross = await P.probeCrossOrigin();

    const rows = [Object.assign({ фрейм: 'главный документ' }, top), srcdoc, blank, cross];
    const покрыто = rows.filter((r) => r.прибор).length;

    return {
      покрыто: покрыто + ' из 4',
      строки: rows,
      вывод:
        покрыто === 4
          ? 'прибор во всех фреймах'
          : покрыто === 0
            ? 'прибора нет нигде — запись не включена?'
            : 'есть непокрытые фреймы, смотрите строки',
    };
  };
})();
