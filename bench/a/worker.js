// origin B — воркер. Слепая зона прибора, предел 4 из 06-limits.md.
// Content scripts в воркеры не внедряются, поэтому эти вызовы прибор не увидит.
// Но маячок отсюда обязан всплыть в webRequest как network-only.

const ORIGIN_B = 'http://localhost:8081';

function offscreenCanvasFingerprint() {
  if (typeof OffscreenCanvas === 'undefined') return { error: 'OffscreenCanvas недоступен' };

  const c = new OffscreenCanvas(200, 50);
  const ctx = c.getContext('2d');
  ctx.textBaseline = 'top';
  ctx.font = '14px Arial';
  ctx.fillStyle = '#f60';
  ctx.fillRect(0, 0, 100, 20);
  ctx.fillStyle = '#069';
  ctx.fillText('отпечаток из воркера', 2, 15);

  const pixels = ctx.getImageData(0, 0, 100, 20);
  let hash = 0;
  for (let i = 0; i < pixels.data.length; i += 97) {
    hash = (hash * 31 + pixels.data[i]) >>> 0;
  }

  const measured = ctx.measureText('mmmmmmmmmmlli').width;

  return { canvasHash: hash, measuredWidth: measured };
}

function webglFingerprint() {
  if (typeof OffscreenCanvas === 'undefined') return { error: 'OffscreenCanvas недоступен' };
  const gl = new OffscreenCanvas(1, 1).getContext('webgl');
  if (!gl) return { error: 'webgl в воркере недоступен' };
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    vendor: gl.getParameter(gl.VENDOR),
    renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
  };
}

self.onmessage = async function () {
  const canvas = offscreenCanvasFingerprint();
  const webgl = webglFingerprint();

  const env = {
    hardwareConcurrency: navigator.hardwareConcurrency,
    language: navigator.language,
    platform: navigator.platform,
    userAgent: navigator.userAgent.slice(0, 60),
  };

  // Маячок прямо из воркера, минуя все обёртки главного потока
  let beaconStatus = null;
  try {
    const res = await fetch(ORIGIN_B + '/g/collect', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'v=2&tid=G-BENCH12345&cid=1847362910.1730000000&en=worker_fingerprint&ep.source=worker',
    });
    beaconStatus = res.status;
  } catch (e) {
    beaconStatus = 'ошибка: ' + String(e);
  }

  self.postMessage({
    источник: 'worker',
    canvas,
    webgl,
    env,
    beaconStatus,
  });
};
