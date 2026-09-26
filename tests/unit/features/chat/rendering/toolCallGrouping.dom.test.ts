/** @jest-environment jsdom */
import { fireEvent, within } from '@testing-library/dom';
import { axe } from 'jest-axe';

import { groupToolBlocks, STREAMING_TRAILING_VISIBLE } from '@/features/chat/rendering/toolCallGrouping';

function el(cls: string, parent?: HTMLElement): HTMLElement {
  return (parent ?? document.body).createDiv({ cls });
}

function container(...childEls: HTMLElement[]): HTMLElement {
  const c = document.body.createDiv({ cls: 'claudian-message-content' });
  c.append(...childEls);
  return c;
}

function tools(count: number): HTMLElement[] {
  return Array.from({ length: count }, () => el('claudian-tool-call'));
}

function groupsOf(c: HTMLElement): HTMLElement[] {
  return Array.from(c.children).filter(
    (child): child is HTMLElement => child.classList.contains('claudian-tool-group'),
  );
}

function groupContent(group: HTMLElement): Element[] {
  return Array.from(group.querySelector('.claudian-tool-group-content')?.children ?? []);
}

function groupLabel(group: HTMLElement): string | null {
  return group.querySelector('.claudian-tool-group-label')?.textContent ?? null;
}

function withStatus(parent: HTMLElement, status: string): HTMLElement {
  el(`status-${status}`, parent);
  return parent;
}

describe('groupToolBlocks', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('wraps a run of consecutive tool calls in place, before the following text', () => {
    const [t1, t2] = tools(2);
    const text = el('claudian-text-block');
    const c = container(t1, t2, text);

    groupToolBlocks(c);

    const groups = groupsOf(c);
    expect(groups).toHaveLength(1);
    expect(groupContent(groups[0])).toEqual([t1, t2]);
    expect(Array.from(c.children)).toEqual([groups[0], text]);
    expect(groupLabel(groups[0])).toBe('2 tool calls');
  });

  it('leaves single tool calls ungrouped', () => {
    const [t1] = tools(1);
    const text = el('claudian-text-block');
    const c = container(t1, text);

    groupToolBlocks(c);

    expect(Array.from(c.children)).toEqual([t1, text]);
  });

  it('breaks runs at text blocks and groups each side independently', () => {
    const t1 = el('claudian-tool-call');
    const t2 = el('claudian-thinking-block');
    const text = el('claudian-text-block');
    const t3 = el('claudian-tool-call');
    const t4 = el('claudian-write-edit-block');
    const c = container(t1, t2, text, t3, t4);

    groupToolBlocks(c);

    const groups = groupsOf(c);
    expect(groups.map(groupContent)).toEqual([[t1, t2], [t3, t4]]);
  });

  it('keeps the trailing run open while streaming and groups it at the end of the turn', () => {
    const [t1, t2, t3, t4] = tools(4);
    const text = el('claudian-text-block');
    const c = container(t1, t2, text, t3, t4);

    groupToolBlocks(c, { keepTrailingOpen: true });
    expect(groupsOf(c).map(groupContent)).toEqual([[t1, t2]]);
    expect(t3.parentElement).toBe(c);
    expect(t4.parentElement).toBe(c);

    groupToolBlocks(c);
    expect(groupsOf(c).map(groupContent)).toEqual([[t1, t2], [t3, t4]]);
  });

  it('is idempotent across repeated passes', () => {
    const [t1, t2] = tools(2);
    const c = container(t1, t2, el('claudian-text-block'));

    groupToolBlocks(c);
    groupToolBlocks(c);

    expect(groupsOf(c).map(groupContent)).toEqual([[t1, t2]]);
  });

  it('keeps running tools and subagents visible, grouping completed ones', () => {
    const t1 = el('claudian-tool-call');
    const running = withStatus(el('claudian-subagent-list'), 'running');
    const completed = withStatus(el('claudian-subagent-list'), 'completed');
    const t2 = el('claudian-tool-call');
    const c = container(t1, running, completed, t2, el('claudian-text-block'));

    groupToolBlocks(c);

    expect(groupsOf(c).map(groupContent)).toEqual([[completed, t2]]);
    expect(t1.parentElement).toBe(c);
    expect(running.parentElement).toBe(c);
  });

  it('does not group across AskUserQuestion or compact-boundary chain-breakers', () => {
    const ask = el('claudian-tool-call');
    el('claudian-tool-content-ask', ask);
    const c = container(
      el('claudian-tool-call'), ask, el('claudian-tool-call'),
      el('claudian-compact-boundary'), el('claudian-tool-call'),
    );

    groupToolBlocks(c);

    expect(groupsOf(c)).toHaveLength(0);
  });

  it('labels thinking time and flags errors, refreshing after late results', () => {
    const thinking = el('claudian-thinking-block');
    el('claudian-thinking-label', thinking).textContent = 'Thought for 12s';
    const [t1] = tools(1);
    const c = container(thinking, t1, el('claudian-text-block'));

    groupToolBlocks(c);
    const [group] = groupsOf(c);
    const summary = within(group).getByRole('button', { name: '1 tool call · Thought for 12s' });
    expect(group.querySelector('.claudian-tool-group-status')?.classList.contains('has-errors')).toBe(false);

    withStatus(t1, 'error');
    groupToolBlocks(c);

    expect(summary.getAttribute('aria-label')).toBe('1 tool call · Thought for 12s (with errors)');
    expect(group.querySelector('.claudian-tool-group-status')?.classList.contains('has-errors')).toBe(true);
  });

  it('caps a long trailing run while streaming and grows one group instead of chaining', () => {
    const first = tools(7);
    const c = container(...first);

    groupToolBlocks(c, { keepTrailingOpen: true, maxTrailingVisible: STREAMING_TRAILING_VISIBLE });
    expect(groupsOf(c).map(groupContent)).toEqual([first.slice(0, 3)]);
    for (const t of first.slice(3)) expect(t.parentElement).toBe(c);

    c.append(...tools(3));
    groupToolBlocks(c, { keepTrailingOpen: true, maxTrailingVisible: STREAMING_TRAILING_VISIBLE });
    expect(groupsOf(c)).toHaveLength(1);
    expect(groupLabel(groupsOf(c)[0])).toBe('6 tool calls');

    groupToolBlocks(c);
    expect(groupsOf(c)).toHaveLength(1);
    expect(groupLabel(groupsOf(c)[0])).toBe('10 tool calls');
  });

  it('treats the transient thinking indicator as transparent for trailing detection', () => {
    const c = container(...tools(3));
    el('claudian-thinking', c);

    groupToolBlocks(c, { keepTrailingOpen: true });
    expect(groupsOf(c)).toHaveLength(0);

    groupToolBlocks(c);
    expect(groupsOf(c)).toHaveLength(1);
  });

  it('expands and collapses with a native, labelled disclosure button', async () => {
    const [t1, t2] = tools(2);
    const c = container(t1, t2, el('claudian-text-block'));

    groupToolBlocks(c);

    const summary = within(c).getByRole('button', { name: '2 tool calls' });
    const content = document.getElementById(summary.getAttribute('aria-controls') ?? '');
    expect(summary.getAttribute('type')).toBe('button');
    expect(summary.getAttribute('aria-expanded')).toBe('false');
    expect(content?.hidden).toBe(true);

    fireEvent.click(summary);

    expect(summary.getAttribute('aria-expanded')).toBe('true');
    expect(content?.hidden).toBe(false);
    expect(await axe(c)).toHaveNoViolations();
  });
});
