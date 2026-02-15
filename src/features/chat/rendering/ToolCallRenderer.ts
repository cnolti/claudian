import { setIcon } from 'obsidian';

import { extractResolvedAnswersFromResultText, type TodoItem } from '../../../core/tools';
import { getToolIcon, MCP_ICON_MARKER } from '../../../core/tools/toolIcons';
import {
  TOOL_ASK_USER_QUESTION,
  TOOL_BASH,
  TOOL_EDIT,
  TOOL_ENTER_PLAN_MODE,
  TOOL_EXIT_PLAN_MODE,
  TOOL_GLOB,
  TOOL_GREP,
  TOOL_LS,
  TOOL_READ,
  TOOL_SKILL,
  TOOL_TODO_WRITE,
  TOOL_WEB_FETCH,
  TOOL_WEB_SEARCH,
  TOOL_WRITE,
} from '../../../core/tools/toolNames';

const CHECKMARK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
const ERROR_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
import type { ToolCallInfo } from '../../../core/types';
import { MCP_ICON_SVG } from '../../../shared/icons';
import { setupCollapsible } from './collapsible';
import { renderTodoItems } from './todoUtils';

export function setToolIcon(el: HTMLElement, name: string): void {
  const icon = getToolIcon(name);
  if (icon === MCP_ICON_MARKER) {
    el.innerHTML = MCP_ICON_SVG;
  } else {
    setIcon(el, icon);
  }
}

export function getToolName(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case TOOL_TODO_WRITE: {
      const todos = input.todos as Array<{ status: string }> | undefined;
      if (todos && Array.isArray(todos) && todos.length > 0) {
        const completed = todos.filter(t => t.status === 'completed').length;
        return `Tasks ${completed}/${todos.length}`;
      }
      return 'Tasks';
    }
    case TOOL_ENTER_PLAN_MODE:
      return 'Entering plan mode';
    case TOOL_EXIT_PLAN_MODE:
      return 'Plan complete';
    default:
      return name;
  }
}

export function getToolSummary(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case TOOL_READ:
    case TOOL_WRITE:
    case TOOL_EDIT: {
      const filePath = (input.file_path as string) || '';
      return fileNameOnly(filePath);
    }
    case TOOL_BASH: {
      const cmd = (input.command as string) || '';
      return truncateText(cmd, 60);
    }
    case TOOL_GLOB:
    case TOOL_GREP:
      return (input.pattern as string) || '';
    case TOOL_WEB_SEARCH:
      return truncateText((input.query as string) || '', 60);
    case TOOL_WEB_FETCH:
      return truncateText((input.url as string) || '', 60);
    case TOOL_LS:
      return fileNameOnly((input.path as string) || '.');
    case TOOL_SKILL:
      return (input.skill as string) || '';
    case TOOL_TODO_WRITE:
      return '';
    default:
      return '';
  }
}

/** Combined name+summary for ARIA labels (collapsible regions need a single descriptive phrase). */
export function getToolLabel(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case TOOL_READ:
      return `Read: ${shortenPath(input.file_path as string) || 'file'}`;
    case TOOL_WRITE:
      return `Write: ${shortenPath(input.file_path as string) || 'file'}`;
    case TOOL_EDIT:
      return `Edit: ${shortenPath(input.file_path as string) || 'file'}`;
    case TOOL_BASH: {
      const cmd = (input.command as string) || 'command';
      return `Bash: ${cmd.length > 40 ? cmd.substring(0, 40) + '...' : cmd}`;
    }
    case TOOL_GLOB:
      return `Glob: ${input.pattern || 'files'}`;
    case TOOL_GREP:
      return `Grep: ${input.pattern || 'pattern'}`;
    case TOOL_WEB_SEARCH: {
      const query = (input.query as string) || 'search';
      return `WebSearch: ${query.length > 40 ? query.substring(0, 40) + '...' : query}`;
    }
    case TOOL_WEB_FETCH: {
      const url = (input.url as string) || 'url';
      return `WebFetch: ${url.length > 40 ? url.substring(0, 40) + '...' : url}`;
    }
    case TOOL_LS:
      return `LS: ${shortenPath(input.path as string) || '.'}`;
    case TOOL_TODO_WRITE: {
      const todos = input.todos as Array<{ status: string }> | undefined;
      if (todos && Array.isArray(todos)) {
        const completed = todos.filter(t => t.status === 'completed').length;
        return `Tasks (${completed}/${todos.length})`;
      }
      return 'Tasks';
    }
    case TOOL_SKILL: {
      const skillName = (input.skill as string) || 'skill';
      return `Skill: ${skillName}`;
    }
    case TOOL_ENTER_PLAN_MODE:
      return 'Entering plan mode';
    case TOOL_EXIT_PLAN_MODE:
      return 'Plan complete';
    default:
      return name;
  }
}

export function fileNameOnly(filePath: string): string {
  if (!filePath) return '';
  const normalized = filePath.replace(/\\/g, '/');
  return normalized.split('/').pop() ?? normalized;
}

function shortenPath(filePath: string | undefined): string {
  if (!filePath) return '';
  const normalized = filePath.replace(/\\/g, '/');
  const parts = normalized.split('/');
  if (parts.length <= 3) return normalized;
  return '.../' + parts.slice(-2).join('/');
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

interface WebSearchLink {
  title: string;
  url: string;
}

function parseWebSearchResult(result: string): { links: WebSearchLink[]; summary: string } | null {
  const linksMatch = result.match(/Links:\s*(\[[\s\S]*?\])(?:\n|$)/);
  if (!linksMatch) return null;

  try {
    const parsed = JSON.parse(linksMatch[1]) as WebSearchLink[];
    if (!Array.isArray(parsed) || parsed.length === 0) return null;

    const linksEndIndex = result.indexOf(linksMatch[0]) + linksMatch[0].length;
    const summary = result.slice(linksEndIndex).trim();
    return { links: parsed.filter(l => l.title && l.url), summary };
  } catch {
    return null;
  }
}

function renderWebSearchExpanded(container: HTMLElement, result: string): void {
  const parsed = parseWebSearchResult(result);
  if (!parsed || parsed.links.length === 0) {
    renderLinesExpanded(container, result, 20);
    return;
  }

  const linksEl = container.createDiv({ cls: 'claudian-tool-lines' });
  for (const link of parsed.links) {
    const linkEl = linksEl.createEl('a', { cls: 'claudian-tool-link' });
    linkEl.setAttribute('href', link.url);
    linkEl.setAttribute('target', '_blank');
    linkEl.setAttribute('rel', 'noopener noreferrer');

    const iconEl = linkEl.createSpan({ cls: 'claudian-tool-link-icon' });
    setIcon(iconEl, 'external-link');

    linkEl.createSpan({ cls: 'claudian-tool-link-title', text: link.title });
  }

  if (parsed.summary) {
    const summaryEl = container.createDiv({ cls: 'claudian-tool-web-summary' });
    summaryEl.setText(parsed.summary.length > 800 ? parsed.summary.slice(0, 800) + '...' : parsed.summary);
  }
}

function renderFileSearchExpanded(container: HTMLElement, result: string): void {
  const lines = result.split(/\r?\n/).filter(line => line.trim());
  if (lines.length === 0) {
    container.createDiv({ cls: 'claudian-tool-empty', text: 'No matches found' });
    return;
  }
  renderLinesExpanded(container, result, 15, true);
}

function renderLinesExpanded(
  container: HTMLElement,
  result: string,
  maxLines: number,
  hoverable = false
): void {
  const lines = result.split(/\r?\n/);
  const truncated = lines.length > maxLines;
  const displayLines = truncated ? lines.slice(0, maxLines) : lines;

  const linesEl = container.createDiv({ cls: 'claudian-tool-lines' });
  for (const line of displayLines) {
    const stripped = line.replace(/^\s*\d+→/, '');
    const lineEl = linesEl.createDiv({ cls: 'claudian-tool-line' });
    if (hoverable) lineEl.addClass('hoverable');
    lineEl.setText(stripped || ' ');
  }

  if (truncated) {
    linesEl.createDiv({
      cls: 'claudian-tool-truncated',
      text: `... ${lines.length - maxLines} more lines`,
    });
  }
}

function renderWebFetchExpanded(container: HTMLElement, result: string): void {
  const maxChars = 500;
  const linesEl = container.createDiv({ cls: 'claudian-tool-lines' });
  const lineEl = linesEl.createDiv({ cls: 'claudian-tool-line' });
  lineEl.style.whiteSpace = 'pre-wrap';
  lineEl.style.wordBreak = 'break-word';

  if (result.length > maxChars) {
    lineEl.setText(result.slice(0, maxChars));
    linesEl.createDiv({
      cls: 'claudian-tool-truncated',
      text: `... ${result.length - maxChars} more characters`,
    });
  } else {
    lineEl.setText(result);
  }
}

export function renderExpandedContent(container: HTMLElement, toolName: string, result: string | undefined): void {
  if (!result) {
    container.createDiv({ cls: 'claudian-tool-empty', text: 'No result' });
    return;
  }

  switch (toolName) {
    case TOOL_BASH:
      renderLinesExpanded(container, result, 20);
      break;
    case TOOL_READ:
      renderLinesExpanded(container, result, 15);
      break;
    case TOOL_GLOB:
    case TOOL_GREP:
    case TOOL_LS:
      renderFileSearchExpanded(container, result);
      break;
    case TOOL_WEB_SEARCH:
      renderWebSearchExpanded(container, result);
      break;
    case TOOL_WEB_FETCH:
      renderWebFetchExpanded(container, result);
      break;
    default:
      renderLinesExpanded(container, result, 20);
      break;
  }
}

function getTodos(input: Record<string, unknown>): TodoItem[] | undefined {
  const todos = input.todos;
  if (!todos || !Array.isArray(todos)) return undefined;
  return todos as TodoItem[];
}

function getCurrentTask(input: Record<string, unknown>): TodoItem | undefined {
  const todos = getTodos(input);
  if (!todos) return undefined;
  return todos.find(t => t.status === 'in_progress');
}

function areAllTodosCompleted(input: Record<string, unknown>): boolean {
  const todos = getTodos(input);
  if (!todos || todos.length === 0) return false;
  return todos.every(t => t.status === 'completed');
}

function resetStatusElement(statusEl: HTMLElement, statusClass: string, ariaLabel: string): void {
  statusEl.className = 'claudian-tool-status';
  statusEl.empty();
  statusEl.addClass(statusClass);
  statusEl.setAttribute('aria-label', ariaLabel);
}

const STATUS_ICONS: Record<string, string> = {
  completed: 'check',
  error: 'x',
  blocked: 'shield-off',
};

function setTodoWriteStatus(statusEl: HTMLElement, input: Record<string, unknown>): void {
  const isComplete = areAllTodosCompleted(input);
  const status = isComplete ? 'completed' : 'running';
  const ariaLabel = isComplete ? 'Status: completed' : 'Status: in progress';
  resetStatusElement(statusEl, `status-${status}`, ariaLabel);
  if (isComplete) setIcon(statusEl, 'check');
}

function setToolStatus(statusEl: HTMLElement, status: ToolCallInfo['status']): void {
  resetStatusElement(statusEl, `status-${status}`, `Status: ${status}`);
  const icon = STATUS_ICONS[status];
  if (icon) setIcon(statusEl, icon);
}

export function renderTodoWriteResult(
  container: HTMLElement,
  input: Record<string, unknown>
): void {
  container.empty();
  container.addClass('claudian-todo-panel-content');
  container.addClass('claudian-todo-list-container');

  const todos = input.todos as TodoItem[] | undefined;
  if (!todos || !Array.isArray(todos)) {
    const item = container.createSpan({ cls: 'claudian-tool-result-item' });
    item.setText('Tasks updated');
    return;
  }

  renderTodoItems(container, todos);
}

export function isBlockedToolResult(content: string, isError?: boolean): boolean {
  const lower = content.toLowerCase();
  if (lower.includes('blocked by blocklist')) return true;
  if (lower.includes('outside the vault')) return true;
  if (lower.includes('access denied')) return true;
  if (lower.includes('user denied')) return true;
  if (lower.includes('approval')) return true;
  if (isError && lower.includes('deny')) return true;
  return false;
}

interface ToolElementStructure {
  toolEl: HTMLElement;
  header: HTMLElement;
  iconEl: HTMLElement;
  nameEl: HTMLElement;
  summaryEl: HTMLElement;
  statusEl: HTMLElement;
  content: HTMLElement;
  currentTaskEl: HTMLElement | null;
}

function createToolElementStructure(
  parentEl: HTMLElement,
  toolCall: ToolCallInfo
): ToolElementStructure {
  const toolEl = parentEl.createDiv({ cls: 'claudian-tool-call' });

  const header = toolEl.createDiv({ cls: 'claudian-tool-header' });
  header.setAttribute('tabindex', '0');
  header.setAttribute('role', 'button');

  const iconEl = header.createSpan({ cls: 'claudian-tool-icon' });
  iconEl.setAttribute('aria-hidden', 'true');
  setToolIcon(iconEl, toolCall.name);

  const nameEl = header.createSpan({ cls: 'claudian-tool-name' });
  nameEl.setText(getToolName(toolCall.name, toolCall.input));

  const summaryEl = header.createSpan({ cls: 'claudian-tool-summary' });
  summaryEl.setText(getToolSummary(toolCall.name, toolCall.input));

  const currentTaskEl = toolCall.name === TOOL_TODO_WRITE
    ? createCurrentTaskPreview(header, toolCall.input)
    : null;

  const statusEl = header.createSpan({ cls: 'claudian-tool-status' });

  const content = toolEl.createDiv({ cls: 'claudian-tool-content' });

  return { toolEl, header, iconEl, nameEl, summaryEl, statusEl, content, currentTaskEl };
}

function formatAnswer(raw: unknown): string {
  if (Array.isArray(raw)) return raw.join(', ');
  if (typeof raw === 'string') return raw;
  return '';
}

function resolveAskUserAnswers(toolCall: ToolCallInfo): Record<string, unknown> | undefined {
  if (toolCall.resolvedAnswers) return toolCall.resolvedAnswers as Record<string, unknown>;

  const parsed = extractResolvedAnswersFromResultText(toolCall.result);
  if (parsed) {
    toolCall.resolvedAnswers = parsed;
    return parsed;
  }

  return undefined;
}

function renderAskUserQuestionResult(container: HTMLElement, toolCall: ToolCallInfo): boolean {
  container.empty();
  const questions = toolCall.input.questions as Array<{ question: string }> | undefined;
  const answers = resolveAskUserAnswers(toolCall);
  if (!questions || !Array.isArray(questions) || !answers) return false;

  const reviewEl = container.createDiv({ cls: 'claudian-ask-review' });
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const answer = formatAnswer(answers[q.question]);
    const pairEl = reviewEl.createDiv({ cls: 'claudian-ask-review-pair' });
    pairEl.createDiv({ text: `${i + 1}.`, cls: 'claudian-ask-review-num' });
    const bodyEl = pairEl.createDiv({ cls: 'claudian-ask-review-body' });
    bodyEl.createDiv({ text: q.question, cls: 'claudian-ask-review-q-text' });
    bodyEl.createDiv({
      text: answer || 'Not answered',
      cls: answer ? 'claudian-ask-review-a-text' : 'claudian-ask-review-empty',
    });
  }

  return true;
}

function renderAskUserQuestionFallback(container: HTMLElement, toolCall: ToolCallInfo, initialText?: string): void {
  contentFallback(container, initialText || toolCall.result || 'Waiting for answer...');
}

function contentFallback(container: HTMLElement, text: string): void {
  const resultRow = container.createDiv({ cls: 'claudian-tool-result-row' });
  const resultText = resultRow.createSpan({ cls: 'claudian-tool-result-text' });
  resultText.setText(text);
}

function createCurrentTaskPreview(
  header: HTMLElement,
  input: Record<string, unknown>
): HTMLElement {
  const currentTaskEl = header.createSpan({ cls: 'claudian-tool-current' });
  const currentTask = getCurrentTask(input);
  if (currentTask) {
    currentTaskEl.setText(currentTask.activeForm);
  }
  return currentTaskEl;
}

function createTodoToggleHandler(
  currentTaskEl: HTMLElement | null,
  statusEl: HTMLElement | null,
  onExpandChange?: (expanded: boolean) => void
): (expanded: boolean) => void {
  return (expanded: boolean) => {
    if (onExpandChange) onExpandChange(expanded);
    if (currentTaskEl) {
      currentTaskEl.style.display = expanded ? 'none' : '';
    }
    if (statusEl) {
      statusEl.style.display = expanded ? 'none' : '';
    }
  };
}

function renderToolContent(
  content: HTMLElement,
  toolCall: ToolCallInfo,
  initialText?: string
): void {
  if (toolCall.name === TOOL_TODO_WRITE) {
    content.addClass('claudian-tool-content-todo');
    renderTodoWriteResult(content, toolCall.input);
  } else if (toolCall.name === TOOL_ASK_USER_QUESTION) {
    content.addClass('claudian-tool-content-ask');
    if (initialText) {
      renderAskUserQuestionFallback(content, toolCall, 'Waiting for answer...');
    } else if (!renderAskUserQuestionResult(content, toolCall)) {
      renderAskUserQuestionFallback(content, toolCall);
    }
  } else if (initialText) {
    contentFallback(content, initialText);
  } else {
    renderExpandedContent(content, toolCall.name, toolCall.result);
  }
}

export function renderToolCall(
  parentEl: HTMLElement,
  toolCall: ToolCallInfo,
  toolCallElements: Map<string, HTMLElement>
): HTMLElement {
  const { toolEl, header, statusEl, content, currentTaskEl } =
    createToolElementStructure(parentEl, toolCall);

  toolEl.dataset.toolId = toolCall.id;
  toolCallElements.set(toolCall.id, toolEl);

  statusEl.addClass(`status-${toolCall.status}`);
  statusEl.setAttribute('aria-label', `Status: ${toolCall.status}`);

  renderToolContent(content, toolCall, 'Running...');

  const state = { isExpanded: false };
  toolCall.isExpanded = false;
  const todoStatusEl = toolCall.name === TOOL_TODO_WRITE ? statusEl : null;
  setupCollapsible(toolEl, header, content, state, {
    initiallyExpanded: false,
    onToggle: createTodoToggleHandler(currentTaskEl, todoStatusEl, (expanded) => {
      toolCall.isExpanded = expanded;
    }),
    baseAriaLabel: getToolLabel(toolCall.name, toolCall.input)
  });

  return toolEl;
}

export function updateToolCallResult(
  toolId: string,
  toolCall: ToolCallInfo,
  toolCallElements: Map<string, HTMLElement>
) {
  const toolEl = toolCallElements.get(toolId);
  if (!toolEl) return;

  if (toolCall.name === TOOL_TODO_WRITE) {
    const statusEl = toolEl.querySelector('.claudian-tool-status') as HTMLElement;
    if (statusEl) {
      setTodoWriteStatus(statusEl, toolCall.input);
    }
    const content = toolEl.querySelector('.claudian-tool-content') as HTMLElement;
    if (content) {
      renderTodoWriteResult(content, toolCall.input);
    }
    const nameEl = toolEl.querySelector('.claudian-tool-name') as HTMLElement;
    if (nameEl) {
      nameEl.setText(getToolName(toolCall.name, toolCall.input));
    }
    const currentTaskEl = toolEl.querySelector('.claudian-tool-current') as HTMLElement;
    if (currentTaskEl) {
      const currentTask = getCurrentTask(toolCall.input);
      currentTaskEl.setText(currentTask ? currentTask.activeForm : '');
    }
    return;
  }

  const statusEl = toolEl.querySelector('.claudian-tool-status') as HTMLElement;
  if (statusEl) {
    setToolStatus(statusEl, toolCall.status);
  }

  if (toolCall.name === TOOL_ASK_USER_QUESTION) {
    const content = toolEl.querySelector('.claudian-tool-content') as HTMLElement;
    if (content) {
      content.addClass('claudian-tool-content-ask');
      if (!renderAskUserQuestionResult(content, toolCall)) {
        renderAskUserQuestionFallback(content, toolCall);
      }
    }
    return;
  }

  const content = toolEl.querySelector('.claudian-tool-content') as HTMLElement;
  if (content) {
    content.empty();
    renderExpandedContent(content, toolCall.name, toolCall.result);
  }
}

/** For stored (non-streaming) tool calls — collapsed by default. */
export function renderStoredToolCall(
  parentEl: HTMLElement,
  toolCall: ToolCallInfo
): HTMLElement {
  const { toolEl, header, statusEl, content, currentTaskEl } =
    createToolElementStructure(parentEl, toolCall);

  if (toolCall.name === TOOL_TODO_WRITE) {
    setTodoWriteStatus(statusEl, toolCall.input);
  } else {
    setToolStatus(statusEl, toolCall.status);
  }

  renderToolContent(content, toolCall);

  const state = { isExpanded: false };
  const todoStatusEl = toolCall.name === TOOL_TODO_WRITE ? statusEl : null;
  setupCollapsible(toolEl, header, content, state, {
    initiallyExpanded: false,
    onToggle: createTodoToggleHandler(currentTaskEl, todoStatusEl),
    baseAriaLabel: getToolLabel(toolCall.name, toolCall.input)
  });

  return toolEl;
}

// ============================================
// Tool Call Grouping
// ============================================

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

function isTransparentElement(_el: Element): boolean {
  return false;
}

function countGroupStats(elements: Element[]): {
  toolCount: number;
  thinkingCount: number;
  thinkingDuration: number;
  hasErrors: boolean;
} {
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
  return parts.join(' \u00B7 ');
}

export interface GroupWrapper {
  wrapperEl: HTMLElement;
  summaryEl: HTMLElement;
  labelEl: HTMLElement;
  statusEl: HTMLElement;
  contentEl: HTMLElement;
}

export function createGroupWrapper(
  parentEl: HTMLElement,
  elements: Element[],
  insertBefore?: Element | null,
  streaming = false,
): GroupWrapper {
  const { toolCount, thinkingCount, thinkingDuration, hasErrors } = countGroupStats(elements);
  const labelText = buildGroupLabel(toolCount, thinkingCount, thinkingDuration);

  const wrapperEl = document.createElement('div');
  wrapperEl.className = streaming ? 'claudian-tool-group claudian-tool-group--streaming' : 'claudian-tool-group';

  const summaryEl = document.createElement('div');
  summaryEl.className = 'claudian-tool-group-summary';
  summaryEl.setAttribute('tabindex', '0');
  summaryEl.setAttribute('role', 'button');
  summaryEl.setAttribute('aria-expanded', 'false');
  summaryEl.setAttribute('aria-label', labelText);

  const chevron = document.createElement('span');
  chevron.className = 'claudian-tool-group-chevron';
  chevron.textContent = '\u25B6';

  const labelEl = document.createElement('span');
  labelEl.className = 'claudian-tool-group-label';
  labelEl.textContent = labelText;

  const statusEl = document.createElement('span');
  statusEl.className = 'claudian-tool-group-status';
  if (!streaming) {
    if (hasErrors) {
      statusEl.classList.add('has-errors');
      statusEl.innerHTML = ERROR_SVG;
    } else {
      statusEl.innerHTML = CHECKMARK_SVG;
    }
  }

  summaryEl.appendChild(chevron);
  summaryEl.appendChild(labelEl);
  summaryEl.appendChild(statusEl);

  const contentEl = document.createElement('div');
  contentEl.className = 'claudian-tool-group-content';

  wrapperEl.appendChild(summaryEl);
  wrapperEl.appendChild(contentEl);

  // Insert wrapper into DOM
  if (insertBefore !== undefined) {
    parentEl.insertBefore(wrapperEl, insertBefore);
  } else if (elements.length > 0 && elements[0].parentNode === parentEl) {
    parentEl.insertBefore(wrapperEl, elements[0]);
  } else {
    parentEl.appendChild(wrapperEl);
  }

  // Move elements into group content
  for (const el of elements) {
    contentEl.appendChild(el);
  }

  // Toggle handler
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

  return { wrapperEl, summaryEl, labelEl, statusEl, contentEl };
}

function updateGroupLabel(group: GroupWrapper): void {
  const elements = Array.from(group.contentEl.children);
  const { toolCount, thinkingCount, thinkingDuration, hasErrors } = countGroupStats(elements);
  const labelText = buildGroupLabel(toolCount, thinkingCount, thinkingDuration);
  group.labelEl.textContent = labelText;
  group.summaryEl.setAttribute('aria-label', labelText);

  // Update status icon
  group.statusEl.className = 'claudian-tool-group-status';
  if (hasErrors) {
    group.statusEl.classList.add('has-errors');
    group.statusEl.innerHTML = ERROR_SVG;
  } else {
    group.statusEl.innerHTML = CHECKMARK_SVG;
  }
}

/**
 * Post-processes a message content element to group consecutive tool calls
 * and thinking blocks into collapsible summary groups.
 *
 * Uses chain-breaker approach: groupable elements are accumulated into runs,
 * text blocks and chain-breakers (AskUserQuestion, footer, compact boundary)
 * close the current run. Text stays visible between groups.
 *
 * Call after all content blocks have been rendered (stored replay or stream end).
 */
export function groupToolBlocks(contentEl: HTMLElement | null): void {
  if (!contentEl) return;

  const children = Array.from(contentEl.children);
  if (children.length < MIN_GROUP_SIZE) return;

  interface Run { elements: Element[]; groupableCount: number }
  const runs: Run[] = [];
  let currentRun: Run | null = null;

  const closeRun = () => {
    if (currentRun && currentRun.groupableCount >= MIN_GROUP_SIZE) {
      runs.push(currentRun);
    }
    currentRun = null;
  };

  for (const child of children) {
    if (isChainBreaker(child)) {
      closeRun();
    } else if (isGroupableElement(child)) {
      if (!currentRun) {
        currentRun = { elements: [], groupableCount: 0 };
      }
      currentRun.elements.push(child);
      currentRun.groupableCount++;
    } else if (isTransparentElement(child) && currentRun) {
      // Absorb text blocks into active run (don't increment groupable count)
      currentRun.elements.push(child);
    } else {
      closeRun();
    }
  }
  closeRun();

  if (runs.length === 0) return;

  // Process runs in reverse to preserve DOM indices
  for (let r = runs.length - 1; r >= 0; r--) {
    createGroupWrapper(contentEl, runs[r].elements);
  }
}

// ============================================
// Progressive Streaming Group
// ============================================

export interface ActiveStreamGroup {
  pendingElements: HTMLElement[];
  pendingGroupableCount: number;
  wrapper: GroupWrapper | null;
  toolCount: number;
  thinkingCount: number;
  thinkingDuration: number;
  hasErrors: boolean;
}

export function integrateIntoStreamingGroup(
  el: HTMLElement,
  group: ActiveStreamGroup | null,
  parentEl: HTMLElement,
): ActiveStreamGroup | null {
  // Chain-breaker → finalize current group
  if (isChainBreaker(el)) {
    finalizeStreamingGroup(group, parentEl);
    return null;
  }

  // Not groupable and not transparent → finalize
  if (!isGroupableElement(el) && !isTransparentElement(el)) {
    finalizeStreamingGroup(group, parentEl);
    return null;
  }

  // Transparent element with no active group → ignore
  if (isTransparentElement(el) && !group) {
    return null;
  }

  // Transparent element with active group → absorb
  if (isTransparentElement(el) && group) {
    if (group.wrapper) {
      group.wrapper.contentEl.appendChild(el);
    } else {
      group.pendingElements.push(el);
    }
    return group;
  }

  // Groupable element
  if (!group) {
    // First groupable → create pending group (Phase 1)
    return {
      pendingElements: [el],
      pendingGroupableCount: 1,
      wrapper: null,
      toolCount: 0,
      thinkingCount: 0,
      thinkingDuration: 0,
      hasErrors: false,
    };
  }

  if (!group.wrapper) {
    // Second groupable (no wrapper yet) → create wrapper (Phase 2)
    group.pendingElements.push(el);
    group.pendingGroupableCount++;
    const wrapper = createGroupWrapper(
      parentEl,
      group.pendingElements,
      undefined,
      true,
    );
    group.wrapper = wrapper;
    group.pendingElements = [];
    updateGroupLabel(wrapper);
    return group;
  }

  // Subsequent groupable → append to existing wrapper
  group.wrapper.contentEl.appendChild(el);
  group.pendingGroupableCount++;
  updateGroupLabel(group.wrapper);
  return group;
}

export function finalizeStreamingGroup(
  group: ActiveStreamGroup | null,
  parentEl: HTMLElement,
): void {
  if (!group) return;

  if (!group.wrapper) {
    // Phase 1: no wrapper created → elements stay as-is in DOM
    return;
  }

  if (group.pendingGroupableCount < MIN_GROUP_SIZE) {
    // Not enough groupable items → unwrap
    const children = Array.from(group.wrapper.contentEl.children);
    const wrapperEl = group.wrapper.wrapperEl;
    for (const child of children) {
      parentEl.insertBefore(child, wrapperEl);
    }
    wrapperEl.remove();
    return;
  }

  // Finalize: remove streaming modifier, update label and status
  group.wrapper.wrapperEl.classList.remove('claudian-tool-group--streaming');
  updateGroupLabel(group.wrapper);
}
