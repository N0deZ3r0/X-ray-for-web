// origin B — перебор шрифтов.
// Проверяет эвристику из 04-surfaces.md: N вызовов measureText с разными
// font-family за короткое окно = «снят отпечаток шрифтов, N измерений».
(function () {
  const B = (window.__bench = window.__bench || {});

  const PROBES = [
    'Arial', 'Arial Black', 'Arial Narrow', 'Calibri', 'Cambria', 'Candara',
    'Comic Sans MS', 'Consolas', 'Constantia', 'Corbel', 'Courier New',
    'Franklin Gothic Medium', 'Gabriola', 'Georgia', 'Impact', 'Lucida Console',
    'Lucida Sans Unicode', 'Malgun Gothic', 'Marlett', 'Microsoft Sans Serif',
    'MingLiU', 'MS Gothic', 'MV Boli', 'Palatino Linotype', 'Segoe Print',
    'Segoe Script', 'Segoe UI', 'SimSun', 'Sylfaen', 'Symbol', 'Tahoma',
    'Times New Roman', 'Trebuchet MS', 'Verdana', 'Webdings', 'Wingdings',
    'Yu Gothic', 'Meiryo', 'Ebrima', 'Nirmala UI', 'Leelawadee UI',
  ];

  const SAMPLE = 'mmmmmmmmmmlli WWWWWWWW 0123456789';

  B.fontFingerprint = function fontFingerprint() {
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d');

    const baselines = {};
    for (const base of ['monospace', 'sans-serif', 'serif']) {
      ctx.font = '72px ' + base;
      baselines[base] = ctx.measureText(SAMPLE).width;
    }

    const present = [];
    for (const font of PROBES) {
      let detected = false;
      for (const base of ['monospace', 'sans-serif', 'serif']) {
        ctx.font = '72px "' + font + '", ' + base;
        if (ctx.measureText(SAMPLE).width !== baselines[base]) {
          detected = true;
          break;
        }
      }
      if (detected) present.push(font);
    }

    return {
      probed: PROBES.length,
      measureTextCalls: 3 + PROBES.length,
      detected: present.length,
      fonts: present,
    };
  };

  // Второй путь к тому же: официальный API вместо измерения ширин
  B.fontsCheck = function fontsCheck() {
    if (!document.fonts || !document.fonts.check) return { error: 'FontFaceSet недоступен' };
    const present = [];
    for (const font of PROBES) {
      if (document.fonts.check('12px "' + font + '"')) present.push(font);
    }
    return { probed: PROBES.length, detected: present.length, fonts: present };
  };
})();
