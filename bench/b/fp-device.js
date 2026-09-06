// origin B — дешёвые геттеры среды. Класс A/B по 04-surfaces.md.
(function () {
  const B = (window.__bench = window.__bench || {});

  B.deviceFingerprint = async function deviceFingerprint() {
    const out = {};

    out.userAgent = navigator.userAgent;
    out.language = navigator.language;
    out.languages = (navigator.languages || []).join(',');
    out.platform = navigator.platform;
    out.hardwareConcurrency = navigator.hardwareConcurrency;
    out.deviceMemory = navigator.deviceMemory;
    out.maxTouchPoints = navigator.maxTouchPoints;
    out.pdfViewerEnabled = navigator.pdfViewerEnabled;
    out.webdriver = navigator.webdriver;
    out.plugins = navigator.plugins ? navigator.plugins.length : null;

    out.screen = [
      screen.width, screen.height, screen.availWidth, screen.availHeight,
      screen.colorDepth, screen.pixelDepth,
    ].join('x');
    out.devicePixelRatio = window.devicePixelRatio;

    out.timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    out.timezoneOffset = new Date().getTimezoneOffset();

    for (const q of ['(prefers-color-scheme: dark)', '(prefers-reduced-motion: reduce)', '(prefers-contrast: more)']) {
      out['media ' + q] = window.matchMedia(q).matches;
    }

    // Официальный путь к точной модели платформы — растущая замена User-Agent
    if (navigator.userAgentData && navigator.userAgentData.getHighEntropyValues) {
      out.highEntropy = await navigator.userAgentData.getHighEntropyValues([
        'architecture', 'bitness', 'model', 'platformVersion',
        'uaFullVersion', 'fullVersionList', 'wow64',
      ]);
    }

    if (navigator.storage && navigator.storage.estimate) {
      out.storageEstimate = await navigator.storage.estimate();
    }

    if (window.speechSynthesis) {
      out.voices = speechSynthesis.getVoices().length;
    }

    if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
      const devices = await navigator.mediaDevices.enumerateDevices();
      out.mediaDevices = devices.map((d) => d.kind).join(',');
    }

    if (navigator.permissions) {
      out.permissions = {};
      for (const name of ['geolocation', 'notifications', 'camera', 'microphone']) {
        try {
          out.permissions[name] = (await navigator.permissions.query({ name })).state;
        } catch (e) {
          out.permissions[name] = 'недоступно';
        }
      }
    }

    if (navigator.connection) {
      out.connection = navigator.connection.effectiveType;
    }

    return out;
  };

  // Утечка локального адреса через WebRTC
  B.webrtcLeak = function webrtcLeak() {
    return new Promise((resolve) => {
      let pc;
      try {
        pc = new RTCPeerConnection({ iceServers: [] });
      } catch (e) {
        return resolve({ error: 'RTCPeerConnection недоступен' });
      }
      const found = new Set();
      pc.onicecandidate = (e) => {
        if (!e.candidate) {
          pc.close();
          return resolve({ candidates: Array.from(found) });
        }
        found.add(e.candidate.candidate.split(' ').slice(4, 6).join(':'));
      };
      pc.createDataChannel('bench');
      pc.createOffer().then((o) => pc.setLocalDescription(o));
      setTimeout(() => {
        try { pc.close(); } catch (e) {}
        resolve({ candidates: Array.from(found), note: 'по таймауту' });
      }, 1500);
    });
  };
})();
