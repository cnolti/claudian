/**
 * Tool-call post-processing: groups consecutive tool calls + thinking blocks
 * into collapsible summary wrappers. Runs progressively during streaming and
 * again when a message finishes rendering (or is replayed from history).
 *
 * Chain-breaker approach: groupable elements accumulate into runs; text blocks
 * and chain-breakers (AskUserQuestion, response-footer, compact boundary) close
 * the current run. Runs shorter than MIN_GROUP_SIZE are left alone. The
 * ephemeral thinking indicator is transparent: it neither joins nor breaks
 * a run.
 */

const CHECKMARK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
const ERROR_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';

const MIN_GROUP_SIZE = 2;

/** How many trailing tool calls stay visible while the stream is active. */
export const STREAMING_TRAILING_VISIBLE = 4;

function isGroupableElement(el: Element): boolean {
  if (el.querySelector('.claudian-tool-content-ask')) return false;
  // Keep live subagent status visible (incl. async "running in background").
  if (el.querySelector('.status-running')) return false;
  if (el.classList.contains('claudian-tool-call')) return true;
  if (el.classList.contains('claudian-write-edit-block')) return true;
  if (el.classList.contains('claudian-thinking-block')) return true;
  if (el.classList.contains('claudian-subagent-list')) return true;
  return false;
}

function isChainBreaker(el: Element): boolean {
  if (el.querySelector('.claudian-tool-content-ask')) return true;
  if (el.classList.contains('claudian-response-footer')) return true;
  if (el.classList.contains('claudian-compact-boundary')) return true;
  return false;
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
  let toolCount = 0;
  let thinkingCount = 0;
  let thinkingDuration = 0;
  let hasErrors = false;

  for (const el of elements) {
    if (
      el.classList.contains('claudian-tool-call') ||
      el.classList.contains('claudian-write-edit-block') ||
      el.classList.contains('claudian-subagent-list')
    ) {
      toolCount++;
    } else if (el.classList.contains('claudian-thinking-block')) {
      thinkingCount++;
      const label = el.querySelector('.claudian-thinking-label');
      if (label?.textContent) {
        const match = label.textContent.match(/(\d+)s/);
        if (match) thinkingDuration += parseInt(match[1], 10);
      }
    }
    if (el.querySelector('.status-error') || el.classList.contains('error')) {
      hasErrors = true;
    }
  }

  return { toolCount, thinkingCount, thinkingDuration, hasErrors };
}

function buildGroupLabel(toolCount: number, thinkingCount: number, thinkingDuration: number): string {
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
  const statusEl = wrapperEl.querySelector('.claudian-tool-group-status');
  if (!contentEl || !summaryEl || !labelEl || !statusEl) return;

  const { toolCount, thinkingCount, thinkingDuration, hasErrors } =
    countGroupStats(Array.from(contentEl.children));
  const labelText = buildGroupLabel(toolCount, thinkingCount, thinkingDuration);
  labelEl.textContent = labelText;
  summaryEl.setAttribute('aria-label', labelText);
  if (hasErrors) {
    statusEl.classList.add('has-errors');
    statusEl.innerHTML = ERROR_SVG;
  } else {
    statusEl.classList.remove('has-errors');
    statusEl.innerHTML = CHECKMARK_SVG;
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
  // Popout-window safety: create elements in the document that owns the message.
  const doc = parentEl.ownerDocument;

  const wrapperEl = doc.createElement('div');
  wrapperEl.className = 'claudian-tool-group';

  const summaryEl = doc.createElement('div');
  summaryEl.className = 'claudian-tool-group-summary';
  summaryEl.setAttribute('tabindex', '0');
  summaryEl.setAttribute('role', 'button');
  summaryEl.setAttribute('aria-expanded', 'false');

  const chevron = doc.createElement('span');
  chevron.className = 'claudian-tool-group-chevron';
  chevron.textContent = '▶';

  const labelEl = doc.createElement('span');
  labelEl.className = 'claudian-tool-group-label';

  const statusEl = doc.createElement('span');
  statusEl.className = 'claudian-tool-group-status';

  summaryEl.appendChild(chevron);
  summaryEl.appendChild(labelEl);
  summaryEl.appendChild(statusEl);

  const contentEl = doc.createElement('div');
  contentEl.className = 'claudian-tool-group-content';

  wrapperEl.appendChild(summaryEl);
  wrapperEl.appendChild(contentEl);

  if (elements.length > 0 && elements[0].parentNode === parentEl) {
    parentEl.insertBefore(wrapperEl, elements[0]);
  } else {
    parentEl.appendChild(wrapperEl);
  }

  for (const el of elements) {
    contentEl.appendChild(el);
  }
  refreshGroupSummary(wrapperEl);

  summaryEl.addEventListener('click', () => {
    const isExpanded = wrapperEl.classList.toggle('expanded');
    summaryEl.setAttribute('aria-expanded', String(isExpanded));
  });

  summaryEl.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      summaryEl.click();
    }
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
 * Post-processes a `.claudian-message-content` element: finds runs of
 * groupable elements (tool calls, thinking, write-edit, subagent lists) and
 * wraps each run of length >= MIN_GROUP_SIZE in a collapsible summary.
 * Consecutive passes merge into existing adjacent groups instead of creating
 * chains of wrappers.
 *
 * Safe to call multiple times — already-grouped wrappers are skipped, so it
 * can run progressively during streaming and again at end of turn.
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

  interface Run {
    elements: Element[];
  }
  const runs: Run[] = [];
  let currentRun: Run | null = null;

  const closeRun = () => {
    if (!currentRun) return;
    const run = currentRun;
    currentRun = null;
    if (run.elements.length < MIN_GROUP_SIZE) return;

    const isTrailing = run.elements[run.elements.length - 1] === lastRelevantChild;
    if (options?.keepTrailingOpen && isTrailing) {
      // Trailing run stays open — unless it exceeds the visibility cap, in
      // which case the overflow is collapsed and the newest calls stay visible.
      const cap = options.maxTrailingVisible;
      if (cap !== undefined && run.elements.length > cap) {
        const overflow = run.elements.slice(0, run.elements.length - cap);
        if (overflow.length >= MIN_GROUP_SIZE || hasAdjacentGroup(overflow[0])) {
          runs.push({ elements: overflow });
        }
      }
      return;
    }
    runs.push(run);
  };

  const hasAdjacentGroup = (el: Element): boolean => {
    const prev = previousRelevantSibling(el);
    return prev !== null && isAlreadyGrouped(prev);
  };

  for (const child of children) {
    if (isTransparentElement(child)) {
      continue;
    }
    if (isAlreadyGrouped(child)) {
      closeRun();
      continue;
    }
    if (isChainBreaker(child)) {
      closeRun();
    } else if (isGroupableElement(child)) {
      if (!currentRun) {
        currentRun = { elements: [] };
      }
      currentRun.elements.push(child);
    } else {
      closeRun();
    }
  }
  closeRun();

  if (!options?.keepTrailingOpen) {
    // Final/replay pass: results may have arrived after a progressive pass
    // grouped their tool calls — refresh every group's label and status.
    for (const child of children) {
      if (isAlreadyGrouped(child)) refreshGroupSummary(child);
    }
  }

  if (runs.length === 0) return;

  for (let r = runs.length - 1; r >= 0; r--) {
    const run = runs[r];
    const prev = previousRelevantSibling(run.elements[0]);
    if (prev && isAlreadyGrouped(prev)) {
      absorbIntoGroup(prev, run.elements);
    } else {
      createGroupWrapper(contentEl, run.elements);
    }
  }
}
