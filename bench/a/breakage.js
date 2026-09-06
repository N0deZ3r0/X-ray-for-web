// origin A — проверка на поломку.
//
// Появилась после случая с creepjs: пользователь увидел «Illegal invocation»
// на navigator.gpu.requestAdapter, а прибор к тому моменту уже был другим и
// воспроизвести не удалось. Чтобы такое ловилось до пользователя, каждая
// обёрнутая поверхность здесь вызывается обычным образом и результат
// сравнивается с прогоном без прибора.
//
// Правило простое: прибор наблюдает, а не вмешивается. Любое различие в этом
// списке — баг прибора, а не особенность сайта.

(function () {
  const P = (window.__breakage = window.__breakage || {});

  // Обычные вызовы: так их делает нормальный код
  const обычные = {
    'canvas.toDataURL': () => document.createElement('canvas').toDataURL().slice(0, 20),
    'canvas.measureText': () => {
      const x = document.createElement('canvas').getContext('2d');
      x.font = '12px Arial';
      return x.measureText('проба').width > 0;
    },
    'canvas.getImageData': () => {
      const c = document.createElement('canvas');
      c.width = c.height = 4;
      return c.getContext('2d').getImageData(0, 0, 2, 2).data.length;
    },
    'webgl.getParameter': () => {
      const gl = document.createElement('canvas').getContext('webgl');
      return gl ? typeof gl.getParameter(gl.VERSION) : 'нет webgl';
    },
    'webgl.getExtension': () => {
      const gl = document.createElement('canvas').getContext('webgl');
      return gl ? Boolean(gl.getExtension('WEBGL_debug_renderer_info')) : 'нет webgl';
    },
    'webgpu.requestAdapter': async () =>
      navigator.gpu ? typeof (await navigator.gpu.requestAdapter()) : 'нет gpu',
    'audio.OfflineAudioContext': () => new OfflineAudioContext(1, 1000, 44100).length,
    'audio.createDynamicsCompressor': () => {
      const c = new OfflineAudioContext(1, 1000, 44100);
      return c.createDynamicsCompressor().threshold.value;
    },
    'fonts.check': () => document.fonts.check('12px Arial'),
    'navigator.userAgent': () => navigator.userAgent.length > 10,
    'navigator.plugins': () => navigator.plugins.length,
    'navigator.mimeTypes': () => navigator.mimeTypes.length,
    'screen.width': () => screen.width > 0,
    'window.devicePixelRatio': () => devicePixelRatio > 0,
    'intl.resolvedOptions': () => typeof Intl.DateTimeFormat().resolvedOptions().timeZone,
    'date.getTimezoneOffset': () => typeof new Date().getTimezoneOffset(),
    'window.matchMedia': () => typeof matchMedia('(min-width: 1px)').matches,
    'cookie.read': () => typeof document.cookie,
    'cookie.write': () => {
      document.cookie = '__breakage=1; path=/';
      return document.cookie.indexOf('__breakage') >= 0;
    },
    'localStorage': () => {
      localStorage.setItem('__breakage', 'x');
      return localStorage.getItem('__breakage');
    },
    'indexedDB.open': () => typeof indexedDB.open('__breakage').readyState,
    'storage.estimate': async () => typeof (await navigator.storage.estimate()).quota,
    'caches.open': async () => Boolean(await caches.open('__breakage')),
    'media.enumerateDevices': async () => (await navigator.mediaDevices.enumerateDevices()).length,
    'permissions.query': async () =>
      (await navigator.permissions.query({ name: 'geolocation' })).state,
    'speech.getVoices': () => Array.isArray(speechSynthesis.getVoices()),
    'webrtc.RTCPeerConnection': () => {
      const p = new RTCPeerConnection();
      const ok = p instanceof RTCPeerConnection;
      p.close();
      return ok;
    },
    'shadow.Worker': () => {
      const w = new Worker('/worker.js');
      const ok = w instanceof Worker;
      w.terminate();
      return ok;
    },
    'shadow.iframe.srcdoc': () => {
      const f = document.createElement('iframe');
      f.srcdoc = '<p>x';
      return f.srcdoc;
    },
    'shadow.script.src': () => {
      const s = document.createElement('script');
      s.src = 'http://localhost:8080/noise.js';
      return s.src;
    },
    'shadow.document.write': () => {
      const f = document.createElement('iframe');
      document.body.appendChild(f);
      f.contentDocument.open();
      f.contentDocument.write('<p>x');
      f.contentDocument.close();
      const ok = f.contentDocument.body.textContent;
      f.remove();
      return ok;
    },
    'navigator.getHighEntropyValues': async () =>
      navigator.userAgentData
        ? Object.keys(await navigator.userAgentData.getHighEntropyValues(['model'])).length
        : 'нет',
  };

  // Вызовы с намеренно чужим this. Так делают детекторы подмены вроде creepjs.
  // Прибор обязан вести себя ровно как нативный код: где нативный бросает —
  // бросить, где возвращает отклонённый промис — вернуть его.
  const сЧужимThis = {
    'measureText чужой this': () =>
      CanvasRenderingContext2D.prototype.measureText.call({}, 'x'),
    'toDataURL чужой this': () => HTMLCanvasElement.prototype.toDataURL.call({}),
    'userAgent чужой this': () =>
      Object.getOwnPropertyDescriptor(Navigator.prototype, 'userAgent').get.call({}),
    'requestAdapter чужой this': () =>
      navigator.gpu ? navigator.gpu.requestAdapter.call({}) : 'нет gpu',
    'enumerateDevices чужой this': () => navigator.mediaDevices.enumerateDevices.call({}),
    'permissions.query чужой this': () =>
      navigator.permissions.query.call({}, { name: 'geolocation' }),
    'storage.estimate чужой this': () => navigator.storage.estimate.call({}),
    'caches.open чужой this': () => caches.open.call({}, 'x'),
    'getBattery чужой this': () => navigator.getBattery.call({}),
  };

  // Отсоединённая функция: const f = obj.method; f()
  const отсоединённые = {
    'toDataURL отсоединён': () => {
      const f = HTMLCanvasElement.prototype.toDataURL;
      return typeof f;
    },
    'requestAdapter отсоединён': async () => {
      if (!navigator.gpu) return 'нет gpu';
      const f = navigator.gpu.requestAdapter;
      return typeof (await f.call(navigator.gpu));
    },
  };

  // Признаки, по которым страница отличает нативную функцию от подменённой
  const признаки = {
    'toString toDataURL': () =>
      Function.prototype.toString.call(HTMLCanvasElement.prototype.toDataURL),
    'toString Worker': () => Function.prototype.toString.call(Worker),
    'toString getParameter': () =>
      window.WebGLRenderingContext
        ? Function.prototype.toString.call(WebGLRenderingContext.prototype.getParameter)
        : 'нет webgl',
    'name toDataURL': () => HTMLCanvasElement.prototype.toDataURL.name,
    'length toDataURL': () => HTMLCanvasElement.prototype.toDataURL.length,
    'дескриптор toDataURL': () => {
      const d = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'toDataURL');
      return [d.enumerable, d.configurable, d.writable].join(',');
    },
  };

  async function прогон(набор) {
    const out = {};
    for (const k in набор) {
      try {
        const r = await набор[k]();
        out[k] = r && typeof r.then === 'function' ? 'промис' : String(r);
      } catch (e) {
        out[k] = 'бросил ' + e.constructor.name + ': ' + e.message;
      }
    }
    return out;
  }

  async function всё() {
    const o = await прогон(обычные);
    // Промисы с чужим this отклоняются — гасим, чтобы не сорить в консоль
    const t = {};
    for (const k in сЧужимThis) {
      try {
        const r = сЧужимThis[k]();
        if (r && typeof r.then === 'function') {
          r.catch(() => {});
          t[k] = 'промис';
        } else t[k] = String(r);
      } catch (e) {
        t[k] = 'бросил ' + e.constructor.name + ': ' + e.message;
      }
    }
    const d = await прогон(отсоединённые);
    const p = await прогон(признаки);
    return { обычные: o, сЧужимThis: t, отсоединённые: d, признаки: p };
  }

  // Снимок делается ДО загрузки прибора и кладётся в sessionStorage, чтобы
  // пережить перезагрузку вкладки, которой начинается запись.
  P.снятьЭталон = async function снятьЭталон() {
    const snap = await всё();
    sessionStorage.setItem('__breakage_baseline', JSON.stringify(snap));
    return { записано: Object.keys(snap.обычные).length + Object.keys(snap.сЧужимThis).length };
  };

  P.сверить = async function сверить() {
    const raw = sessionStorage.getItem('__breakage_baseline');
    if (!raw) {
      return {
        ошибка: 'эталона нет. Сначала снимите его БЕЗ прибора: __breakage.снятьЭталон()',
      };
    }
    const было = JSON.parse(raw);
    const стало = await всё();

    const различия = {};
    for (const группа in было) {
      for (const k in было[группа]) {
        if (было[группа][k] !== стало[группа][k]) {
          различия[группа + ' / ' + k] = { без: было[группа][k], с: стало[группа][k] };
        }
      }
    }

    const ожидаемые = Object.keys(различия).filter((k) => k.startsWith('признаки'));
    const поломки = Object.keys(различия).filter((k) => !k.startsWith('признаки'));

    return {
      вердикт: поломки.length ? 'ПОЛОМКА: ' + поломки.length : 'поломок нет',
      поломки: подмножество(различия, поломки),
      // Различия в признаках — это не поломка, а видимость прибора.
      // Предел 1 из 06-limits.md: страница может нас обнаружить.
      видимость_прибора: подмножество(различия, ожидаемые),
      проверок: Object.keys(стало.обычные).length +
        Object.keys(стало.сЧужимThis).length +
        Object.keys(стало.отсоединённые).length +
        Object.keys(стало.признаки).length,
    };
  };

  function подмножество(различия, ключи) {
    const o = {};
    for (const k of ключи) o[k] = различия[k];
    return o;
  }
})();
