/**
 * Tool-call post-processing: groups consecutive tool calls + thinking blocks
 * into collapsible summary wrappers. Runs after a message is fully rendered
 * (post-stream or replay), keeping the interactive code path independent from
 * the new frame-batched StreamController.
 *
 * Chain-breaker approach: groupable elements accumulate into runs; text blocks
 * and chain-breakers (AskUserQuestion, response-footer, compact boundary) close
 * the current run. Runs shorter than MIN_GROUP_SIZE are left alone.
 */

const CHECKMARK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
const ERROR_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';

const MIN_GROUP_SIZE = 2;

function isGroupableElement(el: Element): boolean {
  if (el.querySelector('.claudian-tool-content-ask')) return false;
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

function createGroupWrapper(parentEl: HTMLElement, elements: Element[]): void {
  const { toolCount, thinkingCount, thinkingDuration, hasErrors } = countGroupStats(elements);
  const labelText = buildGroupLabel(toolCount, thinkingCount, thinkingDuration);

  const wrapperEl = document.createElement('div');
  wrapperEl.className = 'claudian-tool-group';

  const summaryEl = document.createElement('div');
  summaryEl.className = 'claudian-tool-group-summary';
  summaryEl.setAttribute('tabindex', '0');
  summaryEl.setAttribute('role', 'button');
  summaryEl.setAttribute('aria-expanded', 'false');
  summaryEl.setAttribute('aria-label', labelText);

  const chevron = document.createElement('span');
  chevron.className = 'claudian-tool-group-chevron';
  chevron.textContent = '▶';

  const labelEl = document.createElement('span');
  labelEl.className = 'claudian-tool-group-label';
  labelEl.textContent = labelText;

  const statusEl = document.createElement('span');
  statusEl.className = 'claudian-tool-group-status';
  if (hasErrors) {
    statusEl.classList.add('has-errors');
    statusEl.innerHTML = ERROR_SVG;
  } else {
    statusEl.innerHTML = CHECKMARK_SVG;
  }

  summaryEl.appendChild(chevron);
  summaryEl.appendChild(labelEl);
  summaryEl.appendChild(statusEl);

  const contentEl = document.createElement('div');
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

/**
 * Post-processes a `.claudian-message-content` element: finds runs of
 * groupable elements (tool calls, thinking, write-edit, subagent lists) and
 * wraps each run of length >= MIN_GROUP_SIZE in a collapsible summary.
 *
 * Safe to call multiple times — already-grouped wrappers are skipped.
 */
export function groupToolBlocks(contentEl: HTMLElement | null): void {
  if (!contentEl) return;

  const children = Array.from(contentEl.children);
  if (children.length < MIN_GROUP_SIZE) return;

  interface Run {
    elements: Element[];
    groupableCount: number;
  }
  const runs: Run[] = [];
  let currentRun: Run | null = null;

  const closeRun = () => {
    if (currentRun && currentRun.groupableCount >= MIN_GROUP_SIZE) {
      runs.push(currentRun);
    }
    currentRun = null;
  };

  for (const child of children) {
    if (isAlreadyGrouped(child)) {
      closeRun();
      continue;
    }
    if (isChainBreaker(child)) {
      closeRun();
    } else if (isGroupableElement(child)) {
      if (!currentRun) {
        currentRun = { elements: [], groupableCount: 0 };
      }
      currentRun.elements.push(child);
      currentRun.groupableCount++;
    } else {
      closeRun();
    }
  }
  closeRun();

  if (runs.length === 0) return;

  for (let r = runs.length - 1; r >= 0; r--) {
    createGroupWrapper(contentEl, runs[r].elements);
  }
}
