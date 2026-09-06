// origin B — третья сторона. Классический съём отпечатка.
// Стек вызова обязан указывать на ЭТОТ файл, а не на страницу.
(function () {
  const B = (window.__bench = window.__bench || {});

  B.canvasFingerprint = function canvasFingerprint() {
    const c = document.createElement('canvas');
    c.width = 280;
    c.height = 60;
    const ctx = c.getContext('2d');
    ctx.textBaseline = 'top';
    ctx.font = '14px Arial';
    ctx.fillStyle = '#f60';
    ctx.fillRect(0, 0, 120, 20);
    ctx.fillStyle = '#069';
    ctx.fillText('Рентген для веба 0123456789', 2, 15);
    ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
    ctx.fillText('Рентген для веба 0123456789', 4, 17);

    const dataUrl = c.toDataURL();
    const pixels = ctx.getImageData(0, 0, 120, 20);

    return {
      dataUrlLength: dataUrl.length,
      pixelSample: Array.from(pixels.data.slice(0, 8)),
    };
  };

  B.canvasToBlob = function canvasToBlob() {
    return new Promise((resolve) => {
      const c = document.createElement('canvas');
      c.width = 40;
      c.height = 40;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#123456';
      ctx.fillRect(0, 0, 40, 40);
      c.toBlob((blob) => resolve({ blobSize: blob ? blob.size : null }));
    });
  };

  B.webglFingerprint = function webglFingerprint() {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl') || c.getContext('experimental-webgl');
    if (!gl) return { error: 'webgl недоступен' };

    const out = {};
    out.vendor = gl.getParameter(gl.VENDOR);
    out.renderer = gl.getParameter(gl.RENDERER);
    out.version = gl.getParameter(gl.VERSION);
    out.shadingLanguage = gl.getParameter(gl.SHADING_LANGUAGE_VERSION);

    // Прямой запрос модели видеокарты — самая говорящая поверхность
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    if (dbg) {
      out.unmaskedVendor = gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL);
      out.unmaskedRenderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL);
    }

    // Перебор параметров: то самое «опрошено 12 параметров WebGL»
    const params = [
      'MAX_TEXTURE_SIZE', 'MAX_VIEWPORT_DIMS', 'MAX_RENDERBUFFER_SIZE',
      'MAX_VERTEX_ATTRIBS', 'MAX_VARYING_VECTORS', 'MAX_TEXTURE_IMAGE_UNITS',
      'MAX_VERTEX_UNIFORM_VECTORS', 'MAX_FRAGMENT_UNIFORM_VECTORS',
      'MAX_CUBE_MAP_TEXTURE_SIZE', 'ALIASED_LINE_WIDTH_RANGE',
      'ALIASED_POINT_SIZE_RANGE', 'RED_BITS', 'GREEN_BITS', 'BLUE_BITS',
      'ALPHA_BITS', 'DEPTH_BITS', 'STENCIL_BITS',
    ];
    out.params = {};
    for (const name of params) {
      if (gl[name] !== undefined) out.params[name] = String(gl.getParameter(gl[name]));
    }

    out.extensions = (gl.getSupportedExtensions() || []).length;

    out.precision = {};
    for (const shader of ['VERTEX_SHADER', 'FRAGMENT_SHADER']) {
      for (const prec of ['HIGH_FLOAT', 'MEDIUM_FLOAT', 'LOW_FLOAT']) {
        const p = gl.getShaderPrecisionFormat(gl[shader], gl[prec]);
        if (p) out.precision[shader + '.' + prec] = p.precision + '/' + p.rangeMax;
      }
    }

    return out;
  };

  B.audioFingerprint = async function audioFingerprint() {
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OAC) return { error: 'OfflineAudioContext недоступен' };

    const ctx = new OAC(1, 44100, 44100);
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 10000;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -50;
    comp.knee.value = 40;
    comp.ratio.value = 12;
    comp.attack.value = 0;
    comp.release.value = 0.25;

    osc.connect(comp);
    comp.connect(ctx.destination);
    osc.start(0);

    const buffer = await ctx.startRendering();
    const channel = buffer.getChannelData(0);

    let sum = 0;
    for (let i = 4500; i < 5000; i++) sum += Math.abs(channel[i]);

    return { sum: sum.toFixed(8), sampleRate: ctx.sampleRate };
  };
})();
