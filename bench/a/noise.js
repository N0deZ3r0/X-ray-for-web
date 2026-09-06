// origin A — законный шум.
// Это самый важный негативный тест стенда: критерий 2 этапа Э2 требует
// НОЛЬ ложных network-only на обычной странице. Детектор обхода, который
// кричит на каждую картинку, бесполезен.
(function () {
  const A = (window.__noise = window.__noise || {});

  // 30 разных адресов картинок — обычная галерея.
  // Через обёрнутые API они не проходят (грузит их сам браузер),
  // но маячками не являются и обвинения не заслуживают.
  A.images = function images(n) {
    n = n || 30;
    const box = document.getElementById('noise-box');
    box.textContent = '';
    for (let i = 0; i < n; i++) {
      const img = new Image();
      img.src = '/noise/img?i=' + i + '&t=' + Date.now();
      img.width = 6;
      img.height = 6;
      img.style.marginRight = '2px';
      box.appendChild(img);
    }
    return { загружено: n, ожидание: 'ноль network-only, категория unobserved' };
  };

  // Фоновая картинка из CSS — запрос инициирует движок стилей
  A.cssBackground = function cssBackground() {
    const el = document.getElementById('noise-box');
    el.style.backgroundImage = 'url("/noise/img?css=1&t=' + Date.now() + '")';
    return { ожидание: 'unobserved, не маячок' };
  };

  // Внешний стиль — ещё один запрос мимо JS
  A.stylesheet = function stylesheet() {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/style.css?v=' + Date.now();
    document.head.appendChild(link);
    return { ожидание: 'unobserved' };
  };

  // Библиотека графиков: measureText тысячами раз, законно.
  // Проверяет бюджет из 04-surfaces.md: класс C, стек только первые 3 раза,
  // дальше счётчик. Прибор обязан не замедлить страницу и честно показать,
  // что схлопнул повторы.
  A.chartLike = function chartLike(calls) {
    calls = calls || 5000;
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d');
    ctx.font = '11px system-ui';

    const t0 = performance.now();
    let total = 0;
    for (let i = 0; i < calls; i++) {
      total += ctx.measureText('подпись оси ' + (i % 120)).width;
    }
    const ms = performance.now() - t0;

    return {
      вызовов: calls,
      мс: ms.toFixed(1),
      мксНаВызов: ((ms * 1000) / calls).toFixed(2),
      сумма: total.toFixed(0),
      ожидание: 'одно схлопнутое событие с count=' + calls + ', detail=counted',
    };
  };

  // Съём пикселей десятками тысяч раз — сценарий canvas-игры.
  // Проверяет kill-switch: прибор обязан снизить детализацию и СКАЗАТЬ об этом.
  A.pixelLoop = function pixelLoop(calls) {
    calls = calls || 20000;
    const c = document.createElement('canvas');
    c.width = 32;
    c.height = 32;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#3a7';
    ctx.fillRect(0, 0, 32, 32);

    const t0 = performance.now();
    let checksum = 0;
    for (let i = 0; i < calls; i++) {
      const d = ctx.getImageData(i % 16, 0, 4, 4).data;
      checksum = (checksum + d[0]) >>> 0;
    }
    const ms = performance.now() - t0;

    return {
      вызовов: calls,
      мс: ms.toFixed(1),
      мксНаВызов: ((ms * 1000) / calls).toFixed(2),
      checksum,
      ожидание: 'killSwitchTripped=true и видимое сообщение о снижении детализации',
    };
  };

  // Обычная навигация внутри страницы: якоря, history.pushState.
  // Не сетевое, но меняет URL — прибор не должен считать это новой навигацией.
  A.spaNavigation = function spaNavigation() {
    for (const path of ['/section/a', '/section/b', '/section/c']) {
      history.pushState({}, '', path);
    }
    history.pushState({}, '', '/');
    return { переходов: 4, ожидание: 'та же навигация, t0 не сбрасывается' };
  };
})();
