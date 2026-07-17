import { groupToolBlocks } from '@/features/chat/rendering/toolCallGrouping';

/**
 * Minimal DOM fake with real child semantics (detach on append, positional
 * insertBefore, parentNode tracking) — the shared mockElement helper models
 * children as an append-only array, which cannot express element moves.
 */
class FakeEl {
  tagName: string;
  children: FakeEl[] = [];
  parentNode: FakeEl | null = null;
  className = '';
  textContent = '';
  innerHTML = '';
  ownerDocument = {
    createElement: (tag: string) => new FakeEl(tag),
  };
  private attributes = new Map<string, string>();
  private listeners = new Map<string, Array<(e: unknown) => void>>();

  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
  }

  get classList() {
    const self = this;
    return {
      contains: (cls: string) => self.classes().includes(cls),
      add: (cls: string) => {
        if (!self.classes().includes(cls)) self.className = `${self.className} ${cls}`.trim();
      },
      remove: (cls: string) => {
        self.className = self.classes().filter(c => c !== cls).join(' ');
      },
      toggle: (cls: string) => {
        if (self.classes().includes(cls)) {
          self.className = self.classes().filter(c => c !== cls).join(' ');
          return false;
        }
        self.className = `${self.className} ${cls}`.trim();
        return true;
      },
    };
  }

  private classes(): string[] {
    return this.className.split(/\s+/).filter(Boolean);
  }

  appendChild(child: FakeEl): FakeEl {
    child.detach();
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  insertBefore(el: FakeEl, ref: FakeEl | null): void {
    el.detach();
    el.parentNode = this;
    const idx = ref ? this.children.indexOf(ref) : -1;
    if (idx === -1) this.children.push(el);
    else this.children.splice(idx, 0, el);
  }

  private detach(): void {
    if (this.parentNode) {
      const idx = this.parentNode.children.indexOf(this);
      if (idx !== -1) this.parentNode.children.splice(idx, 1);
      this.parentNode = null;
    }
  }

  querySelector(selector: string): FakeEl | null {
    const cls = selector.replace(/^\./, '');
    for (const child of this.children) {
      if (child.classes().includes(cls)) return child;
      const found = child.querySelector(selector);
      if (found) return found;
    }
    return null;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  addEventListener(event: string, handler: (e: unknown) => void): void {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event)!.push(handler);
  }

  click(): void {
    for (const handler of this.listeners.get('click') ?? []) {
      handler({ type: 'click' });
    }
  }
}

function el(cls: string): FakeEl {
  const node = new FakeEl('div');
  node.className = cls;
  return node;
}

function container(...childEls: FakeEl[]): FakeEl {
  const c = new FakeEl('div');
  c.className = 'claudian-message-content';
  for (const child of childEls) c.appendChild(child);
  return c;
}

function asHtml(fake: FakeEl): HTMLElement {
  return fake as unknown as HTMLElement;
}

function groupsOf(c: FakeEl): FakeEl[] {
  return c.children.filter(ch => ch.classList.contains('claudian-tool-group'));
}

function groupContent(group: FakeEl): FakeEl {
  const content = group.children.find(ch => ch.classList.contains('claudian-tool-group-content'));
  if (!content) throw new Error('group has no content element');
  return content;
}

describe('groupToolBlocks', () => {
  it('wraps a run of >=2 consecutive tool calls in a collapsible group', () => {
    const t1 = el('claudian-tool-call');
    const t2 = el('claudian-tool-call');
    const text = el('claudian-text-block');
    const c = container(t1, t2, text);

    groupToolBlocks(asHtml(c));

    const groups = groupsOf(c);
    expect(groups).toHaveLength(1);
    expect(groupContent(groups[0]).children).toEqual([t1, t2]);
    // Group replaces the run at its original position, text stays after it.
    expect(c.children.indexOf(groups[0])).toBe(0);
    expect(c.children).toContain(text);
    const label = groups[0].querySelector('.claudian-tool-group-label');
    expect(label?.textContent).toBe('2 tool calls');
  });

  it('leaves single tool calls ungrouped', () => {
    const t1 = el('claudian-tool-call');
    const text = el('claudian-text-block');
    const c = container(t1, text);

    groupToolBlocks(asHtml(c));

    expect(groupsOf(c)).toHaveLength(0);
    expect(c.children).toEqual([t1, text]);
  });

  it('breaks runs at text blocks and groups each side independently', () => {
    const t1 = el('claudian-tool-call');
    const t2 = el('claudian-thinking-block');
    const text = el('claudian-text-block');
    const t3 = el('claudian-tool-call');
    const t4 = el('claudian-write-edit-block');
    const c = container(t1, t2, text, t3, t4);

    groupToolBlocks(asHtml(c));

    const groups = groupsOf(c);
    expect(groups).toHaveLength(2);
    expect(groupContent(groups[0]).children).toEqual([t1, t2]);
    expect(groupContent(groups[1]).children).toEqual([t3, t4]);
  });

  it('keepTrailingOpen leaves the trailing run open during streaming', () => {
    const t1 = el('claudian-tool-call');
    const t2 = el('claudian-tool-call');
    const text = el('claudian-text-block');
    const t3 = el('claudian-tool-call');
    const t4 = el('claudian-tool-call');
    const c = container(t1, t2, text, t3, t4);

    groupToolBlocks(asHtml(c), { keepTrailingOpen: true });

    const groups = groupsOf(c);
    expect(groups).toHaveLength(1);
    expect(groupContent(groups[0]).children).toEqual([t1, t2]);
    // Trailing run stays inline while the stream continues.
    expect(c.children).toContain(t3);
    expect(c.children).toContain(t4);
  });

  it('groups the trailing run without keepTrailingOpen (end of turn)', () => {
    const text = el('claudian-text-block');
    const t1 = el('claudian-tool-call');
    const t2 = el('claudian-tool-call');
    const c = container(text, t1, t2);

    groupToolBlocks(asHtml(c));

    const groups = groupsOf(c);
    expect(groups).toHaveLength(1);
    expect(groupContent(groups[0]).children).toEqual([t1, t2]);
  });

  it('is idempotent — a second pass does not re-wrap grouped content', () => {
    const t1 = el('claudian-tool-call');
    const t2 = el('claudian-tool-call');
    const text = el('claudian-text-block');
    const c = container(t1, t2, text);

    groupToolBlocks(asHtml(c));
    groupToolBlocks(asHtml(c));

    expect(groupsOf(c)).toHaveLength(1);
    expect(groupContent(groupsOf(c)[0]).children).toEqual([t1, t2]);
  });

  it('progressive pass then final pass groups incrementally without double-wrapping', () => {
    const t1 = el('claudian-tool-call');
    const t2 = el('claudian-tool-call');
    const text = el('claudian-text-block');
    const t3 = el('claudian-tool-call');
    const t4 = el('claudian-tool-call');
    const c = container(t1, t2, text, t3, t4);

    groupToolBlocks(asHtml(c), { keepTrailingOpen: true });
    groupToolBlocks(asHtml(c));

    const groups = groupsOf(c);
    expect(groups).toHaveLength(2);
    expect(groupContent(groups[0]).children).toEqual([t1, t2]);
    expect(groupContent(groups[1]).children).toEqual([t3, t4]);
  });

  it('excludes subagent lists with a running status from grouping', () => {
    const t1 = el('claudian-tool-call');
    const subagent = el('claudian-subagent-list');
    const status = el('claudian-subagent-status status-running');
    subagent.appendChild(status);
    const t2 = el('claudian-tool-call');
    const t3 = el('claudian-tool-call');
    const text = el('claudian-text-block');
    const c = container(t1, subagent, t2, t3, text);

    groupToolBlocks(asHtml(c));

    // The running subagent breaks the run: t1 alone stays inline, t2+t3 group.
    const groups = groupsOf(c);
    expect(groups).toHaveLength(1);
    expect(groupContent(groups[0]).children).toEqual([t2, t3]);
    expect(c.children).toContain(t1);
    expect(c.children).toContain(subagent);
  });

  it('groups completed subagent lists together with tool calls', () => {
    const subagent = el('claudian-subagent-list');
    const status = el('claudian-subagent-status status-completed');
    subagent.appendChild(status);
    const t1 = el('claudian-tool-call');
    const text = el('claudian-text-block');
    const c = container(subagent, t1, text);

    groupToolBlocks(asHtml(c));

    const groups = groupsOf(c);
    expect(groups).toHaveLength(1);
    expect(groupContent(groups[0]).children).toEqual([subagent, t1]);
  });

  it('does not group across AskUserQuestion chain-breakers', () => {
    const t1 = el('claudian-tool-call');
    const ask = el('claudian-tool-call');
    ask.appendChild(el('claudian-tool-content-ask'));
    const t2 = el('claudian-tool-call');
    const text = el('claudian-text-block');
    const c = container(t1, ask, t2, text);

    groupToolBlocks(asHtml(c));

    expect(groupsOf(c)).toHaveLength(0);
  });

  it('reports errors in the group status icon', () => {
    const t1 = el('claudian-tool-call');
    t1.appendChild(el('status-error'));
    const t2 = el('claudian-tool-call');
    const text = el('claudian-text-block');
    const c = container(t1, t2, text);

    groupToolBlocks(asHtml(c));

    const status = groupsOf(c)[0].querySelector('.claudian-tool-group-status');
    expect(status?.classList.contains('has-errors')).toBe(true);
  });

  it('toggles expansion on summary click', () => {
    const t1 = el('claudian-tool-call');
    const t2 = el('claudian-tool-call');
    const c = container(t1, t2, el('claudian-text-block'));

    groupToolBlocks(asHtml(c));

    const group = groupsOf(c)[0];
    const summary = group.querySelector('.claudian-tool-group-summary');
    expect(group.classList.contains('expanded')).toBe(false);
    summary?.click();
    expect(group.classList.contains('expanded')).toBe(true);
    expect(summary?.getAttribute('aria-expanded')).toBe('true');
  });
});
