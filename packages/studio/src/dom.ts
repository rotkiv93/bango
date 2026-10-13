type Child = Node | string | number | null | undefined | false;
type Props = Record<string, unknown>;

/** Tiny hyperscript helper: `h('div', { class: 'x', onclick: fn }, 'text', childElement)`. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = String(value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value as EventListener);
    else if (key in el) (el as unknown as Props)[key] = value;
    else el.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
  }
  return el;
}

export function clear(el: Node): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** A message that stands where a panel would be. */
export function empty(title: string, text = ''): HTMLElement {
  return h('div', { class: 'bs-empty' }, h('strong', {}, title), text ? h('p', {}, text) : null);
}
