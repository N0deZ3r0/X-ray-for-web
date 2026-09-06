// Крошечный DOM для проверки панели.
//
// Зависимостей у проекта нет и не будет: тесты запускаются голым node. Поэтому
// здесь ровно тот кусок DOM, который панель действительно трогает, — и ни
// строчкой больше. Если панель однажды возьмётся за что-то ещё, тест упадёт с
// внятным «нет такого метода», а не соврёт зелёным.

class Element {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parent = null;
    // Текстовые узлы лежат В ОДНОМ списке с элементами. Иначе порядок между
    // текстом и вложенной разметкой теряется, и проверка показывает не то,
    // что увидит человек.
    this._class = '';
    this.hidden = false;
    this.disabled = false;
    this.listeners = new Map();
    this.attrs = new Map();
    const self = this;
    this.classList = {
      add(...c) { self._setClasses([...self._classes(), ...c]); },
      remove(...c) { self._setClasses(self._classes().filter((x) => !c.includes(x))); },
      contains(c) { return self._classes().includes(c); },
    };
  }

  _classes() { return this._class.split(/\s+/).filter(Boolean); }
  _setClasses(list) { this._class = [...new Set(list)].join(' '); }

  get className() { return this._class; }
  set className(v) { this._class = String(v == null ? '' : v).trim(); }

  get id() { return this.attrs.get('id') || ''; }
  set id(v) { this.attrs.set('id', v); }

  get textContent() {
    return this.children.map((c) => (c.текстовый ? c.значение : c.textContent)).join('');
  }
  set textContent(v) {
    for (const c of this.children) if (!c.текстовый) c.parent = null;
    this.children = [];
    const s = String(v == null ? '' : v);
    if (s) this.children.push({ текстовый: true, значение: s });
  }

  _добавитьТекст(s) {
    if (s) this.children.push({ текстовый: true, значение: s });
  }

  set innerHTML(html) {
    this.textContent = '';
    разобратьРазметку(String(html), this);
  }
  get innerHTML() {
    throw new Error('чтение innerHTML в тесте не поддержано — и не должно понадобиться');
  }

  appendChild(node) {
    node.parent = this;
    this.children.push(node);
    return node;
  }

  remove() {
    if (!this.parent) return;
    const i = this.parent.children.indexOf(this);
    if (i >= 0) this.parent.children.splice(i, 1);
    this.parent = null;
  }

  addEventListener(тип, fn) {
    if (!this.listeners.has(тип)) this.listeners.set(тип, []);
    this.listeners.get(тип).push(fn);
  }

  // Тест «нажимает» кнопку так же, как это делает человек.
  нажать(тип = 'click') {
    for (const fn of this.listeners.get(тип) || []) fn({ type: тип });
  }

  // Поддержаны ровно те формы, что встречаются в панели: «div», «.who»,
  // «.who.ext», «#log». Составные классы важны: именно ими панель отличает
  // вызов чужого расширения от вызова сайта.
  подходит(селектор) {
    if (селектор.startsWith('#')) return this.id === селектор.slice(1);
    const части = селектор.split('.');
    const тег = части.shift();
    if (тег && this.tagName !== тег.toUpperCase()) return false;
    const мои = this._classes();
    return части.every((c) => мои.includes(c));
  }

  querySelector(селектор) {
    for (const c of this.children) {
      if (c.текстовый) continue;
      if (c.подходит(селектор)) return c;
      const глубже = c.querySelector(селектор);
      if (глубже) return глубже;
    }
    return null;
  }

  querySelectorAll(селектор) {
    const из = [];
    const обойти = (узел) => {
      for (const c of узел.children) {
        if (c.текстовый) continue;
        if (c.подходит(селектор)) из.push(c);
        обойти(c);
      }
    };
    обойти(this);
    return из;
  }

  // Удобства для проверок, в настоящем DOM их нет.
  все(селектор) { return this.querySelectorAll(селектор); }
  текстВсех(селектор) { return this.querySelectorAll(селектор).map((e) => e.textContent); }
}

// Разбор той разметки, которую панель кладёт через innerHTML: вложенные теги с
// атрибутом class и текстом. Ничего сверх этого в панели нет, и если появится —
// пусть тест об этом скажет.
function разобратьРазметку(html, корень) {
  const re = /<(\/?)([a-zA-Z0-9]+)((?:\s+[a-zA-Z-]+="[^"]*")*)\s*>|([^<]+)/g;
  const стек = [корень];
  let m;
  while ((m = re.exec(html))) {
    const [, закрывающий, тег, атрибуты, текст] = m;
    const верх = стек[стек.length - 1];
    if (текст !== undefined) {
      верх._добавитьТекст(текст);
      continue;
    }
    if (закрывающий) {
      if (стек.length > 1) стек.pop();
      continue;
    }
    const el = new Element(тег);
    if (атрибуты) {
      for (const a of атрибуты.matchAll(/([a-zA-Z-]+)="([^"]*)"/g)) {
        if (a[1] === 'class') el.className = a[2];
        else el.attrs.set(a[1], a[2]);
      }
    }
    верх.appendChild(el);
    стек.push(el);
  }
}

export function создатьDOM(идентификаторы) {
  const реестр = new Map();
  for (const id of идентификаторы) {
    const el = new Element(id === 'третий' ? 'div' : 'div');
    el.id = id;
    реестр.set(id, el);
  }
  const body = new Element('body');
  for (const el of реестр.values()) body.appendChild(el);

  const document = {
    body,
    getElementById(id) {
      const el = реестр.get(id);
      if (!el) throw new Error('панель просит элемент, которого нет в разметке: ' + id);
      return el;
    },
    createElement(tag) { return new Element(tag); },
  };

  return { document, реестр, body, Element };
}

export { Element };
