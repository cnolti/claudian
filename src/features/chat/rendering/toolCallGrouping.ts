/**
 * Tool-call grouping (fork-only): collapses runs of consecutive tool calls and
 * thinking blocks into summary wrappers. Runs progressively while streaming and
 * again when a response is finalized or replayed from history; the completed
 * groups then move into the upstream "Worked for" history like any other work.
 *
 * Chain-breaker approach: groupable elements accumulate into runs; text blocks
 * and chain-breakers (AskUserQuestion, compact boundary) close the current run.
 * Runs shorter than MIN_GROUP_SIZE are left alone. The ephemeral thinking
 * indicator is transparent: it neither joins nor breaks a run.
 */

import { setIcon } from 'obsidian';

const MIN_GROUP_SIZE = 2;

/** How many trailing tool calls stay visible while the stream is active. */
export const STREAMING_TRAILING_VISIBLE = 4;

let nextGroupId = 0;

function isGroupableElement(el: Element): boolean {
  if (el.querySelector('.claudian-tool-content-ask')) return false;
  // Keep live tool and subagent status visible (incl. async "running in background").
  if (el.querySelector('.status-running')) return false;
  return el.classList.contains('claudian-tool-call')
    || el.classList.contains('claudian-write-edit-block')
    || el.classList.contains('claudian-thinking-block')
    || el.classList.contains('claudian-subagent-list');
}

function isChainBreaker(el: Element): boolean {
  return el.querySelector('.claudian-tool-content-ask') !== null
    || el.classList.contains('claudian-compact-boundary');
}

/** Ephemeral stream UI that neither joins nor breaks a run. */
function isTransparentElement(el: Element): boolean {
  return el.classList.contains('claudian-thinking');
}

function isAlreadyGrouped(el: Element): boolean {
  return el.classList.contains('claudian-tool-group');
}

interface GroupStats {
  toolCount: number;
  thinkingCount: number;
  thinkingDuration: number;
  hasErrors: boolean;
}

function countGroupStats(elements: Element[]): GroupStats {
  const stats: GroupStats = { toolCount: 0, thinkingCount: 0, thinkingDuration: 0, hasErrors: false };

  for (const el of elements) {
    if (
      el.classList.contains('claudian-tool-call')
      || el.classList.contains('claudian-write-edit-block')
      || el.classList.contains('claudian-subagent-list')
    ) {
      stats.toolCount++;
    } else if (el.classList.contains('claudian-thinking-block')) {
      stats.thinkingCount++;
      const match = el.querySelector('.claudian-thinking-label')?.textContent?.match(/(\d+)s/);
      if (match) stats.thinkingDuration += parseInt(match[1], 10);
    }
    if (el.querySelector('.status-error') || el.classList.contains('error')) {
      stats.hasErrors = true;
    }
  }

  return stats;
}

function buildGroupLabel({ toolCount, thinkingCount, thinkingDuration }: GroupStats): string {
  const parts: string[] = [];
  if (toolCount > 0) parts.push(`${toolCount} tool call${toolCount !== 1 ? 's' : ''}`);
  if (thinkingCount > 0) {
    parts.push(thinkingDuration > 0 ? `Thought for ${thinkingDuration}s` : `${thinkingCount} thinking`);
  }
  return parts.join(' · ');
}

/** Recomputes a group wrapper's label and status icon from its content. */
function refreshGroupSummary(wrapperEl: Element): void {
  const contentEl = wrapperEl.querySelector('.claudian-tool-group-content');
  const summaryEl = wrapperEl.querySelector('.claudian-tool-group-summary');
  const labelEl = wrapperEl.querySelector('.claudian-tool-group-label');
  const statusEl = wrapperEl.querySelector<HTMLElement>('.claudian-tool-group-status');
  if (!contentEl || !summaryEl || !labelEl || !statusEl) return;

  const stats = countGroupStats(Array.from(contentEl.children));
  const labelText = buildGroupLabel(stats);
  labelEl.textContent = labelText;
  summaryEl.setAttribute('aria-label', stats.hasErrors ? `${labelText} (with errors)` : labelText);
  if (statusEl.classList.contains('has-errors') !== stats.hasErrors || !statusEl.hasChildNodes()) {
    statusEl.classList.toggle('has-errors', stats.hasErrors);
    setIcon(statusEl, stats.hasErrors ? 'x' : 'check');
  }
}

/** Moves run elements into an existing adjacent group instead of nesting a new one. */
function absorbIntoGroup(groupEl: Element, elements: Element[]): void {
  const contentEl = groupEl.querySelector('.claudian-tool-group-content');
  if (!contentEl) return;
  for (const el of elements) {
    contentEl.appendChild(el);
  }
  refreshGroupSummary(groupEl);
}

function createGroupWrapper(parentEl: HTMLElement, elements: Element[]): void {
  const contentId = `claudian-tool-group-${nextGroupId++}`;

  // Obsidian's create helpers use the owning document, so popouts stay safe.
  const wrapperEl = parentEl.createDiv({ cls: 'claudian-tool-group' });
  if (elements.length > 0 && elements[0].parentNode === parentEl) {
    parentEl.insertBefore(wrapperEl, elements[0]);
  }

  const summaryEl = wrapperEl.createEl('button', {
    cls: 'claudian-tool-group-summary',
    attr: { type: 'button', 'aria-expanded': 'false', 'aria-controls': contentId },
  });
  summaryEl.createSpan({
    cls: 'claudian-tool-group-chevron',
    text: '▶',
    attr: { 'aria-hidden': 'true' },
  });
  summaryEl.createSpan({ cls: 'claudian-tool-group-label' });
  summaryEl.createSpan({ cls: 'claudian-tool-group-status', attr: { 'aria-hidden': 'true' } });

  const contentEl = wrapperEl.createDiv({ cls: 'claudian-tool-group-content', attr: { id: contentId } });
  contentEl.hidden = true;

  for (const el of elements) {
    contentEl.appendChild(el);
  }
  refreshGroupSummary(wrapperEl);

  summaryEl.addEventListener('click', () => {
    const isExpanded = wrapperEl.classList.toggle('expanded');
    contentEl.hidden = !isExpanded;
    summaryEl.setAttribute('aria-expanded', String(isExpanded));
  });
}

/** Nearest preceding sibling that is not transparent (thinking indicator). */
function previousRelevantSibling(el: Element): Element | null {
  let prev = el.previousElementSibling;
  while (prev && isTransparentElement(prev)) {
    prev = prev.previousElementSibling;
  }
  return prev;
}

function hasAdjacentGroup(el: Element): boolean {
  const prev = previousRelevantSibling(el);
  return prev !== null && isAlreadyGrouped(prev);
}

export interface GroupToolBlocksOptions {
  /**
   * Streaming mode: leave the trailing run (the one still being appended to)
   * ungrouped so live tool activity stays visible.
   */
  keepTrailingOpen?: boolean;
  /**
   * Streaming mode: when the trailing run grows beyond this many elements,
   * collapse the overflow anyway (into the adjacent group if one exists) and
   * keep only this many visible. Only meaningful with keepTrailingOpen.
   */
  maxTrailingVisible?: number;
}

/**
 * Post-processes a `.claudian-message-content` element: wraps each run of
 * groupable elements with length >= MIN_GROUP_SIZE in a collapsible summary.
 * Consecutive passes merge into existing adjacent groups instead of creating
 * chains of wrappers, so it is safe to call repeatedly.
 */
export function groupToolBlocks(
  contentEl: HTMLElement | null,
  options?: GroupToolBlocksOptions,
): void {
  if (!contentEl) return;

  const children = Array.from(contentEl.children);
  if (children.length < MIN_GROUP_SIZE) return;

  let lastRelevantChild: Element | null = null;
  for (let i = children.length - 1; i >= 0; i--) {
    if (!isTransparentElement(children[i])) {
      lastRelevantChild = children[i];
      break;
    }
  }

  const runs: Element[][] = [];
  let currentRun: Element[] | null = null;

  const closeRun = (): void => {
    const run = currentRun;
    currentRun = null;
    if (!run || run.length < MIN_GROUP_SIZE) return;

    const isTrailing = run[run.length - 1] === lastRelevantChild;
    if (options?.keepTrailingOpen && isTrailing) {
      // Trailing run stays open unless it exceeds the visibility cap; then the
      // overflow collapses and the newest calls stay visible.
      const cap = options.maxTrailingVisible;
      if (cap !== undefined && run.length > cap) {
        const overflow = run.slice(0, run.length - cap);
        if (overflow.length >= MIN_GROUP_SIZE || hasAdjacentGroup(overflow[0])) {
          runs.push(overflow);
        }
      }
      return;
    }
    runs.push(run);
  };

  for (const child of children) {
    if (isTransparentElement(child)) continue;
    if (isAlreadyGrouped(child) || isChainBreaker(child) || !isGroupableElement(child)) {
      closeRun();
      continue;
    }
    currentRun ??= [];
    currentRun.push(child);
  }
  closeRun();

  if (!options?.keepTrailingOpen) {
    // Final/replay pass: results may have arrived after a progressive pass
    // grouped their tool calls, so refresh every group's label and status.
    for (const child of children) {
      if (isAlreadyGrouped(child)) refreshGroupSummary(child);
    }
  }

  for (let r = runs.length - 1; r >= 0; r--) {
    const run = runs[r];
    const prev = previousRelevantSibling(run[0]);
    if (prev && isAlreadyGrouped(prev)) {
      absorbIntoGroup(prev, run);
    } else {
      createGroupWrapper(contentEl, run);
    }
  }
}
