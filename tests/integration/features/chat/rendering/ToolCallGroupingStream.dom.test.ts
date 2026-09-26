/** @jest-environment jsdom */
import '@/providers';

import { within } from '@testing-library/dom';
import { MarkdownRenderer } from 'obsidian';

import type { ChatMessage } from '@/core/types';
import { StreamController } from '@/features/chat/controllers/StreamController';
import { MessageRenderer } from '@/features/chat/rendering/MessageRenderer';
import { STREAMING_TRAILING_VISIBLE } from '@/features/chat/rendering/toolCallGrouping';
import { SubagentManager } from '@/features/chat/services/SubagentManager';
import { ChatState } from '@/features/chat/state/ChatState';

HTMLElement.prototype.empty = function () { this.replaceChildren(); };
HTMLElement.prototype.addClass = function (...classes) { this.classList.add(...classes); };
HTMLElement.prototype.removeClass = function (...classes) { this.classList.remove(...classes); };

const TOOL_COUNT = 7;

function createRenderer(messagesEl: HTMLElement): MessageRenderer {
  const plugin = { app: {}, settings: { mediaFolder: '', showMessageTimestamps: false } } as any;
  return new MessageRenderer(
    plugin,
    { registerDomEvent: jest.fn(), register: jest.fn(), addChild: jest.fn() } as any,
    messagesEl,
  );
}

function visibleToolCalls(contentEl: HTMLElement): Element[] {
  return Array.from(contentEl.children).filter(child => child.classList.contains('claudian-tool-call'));
}

beforeEach(() => {
  document.body.replaceChildren();
  jest.mocked(MarkdownRenderer.render).mockImplementation(async (_app, markdown, el) => {
    (el as HTMLElement).createEl('p', { text: markdown });
  });
});

it('caps tool-only runs while streaming and keeps the groups through finalize and replay', async () => {
  const messagesEl = document.body.createDiv();
  const renderer = createRenderer(messagesEl);
  const state = new ChatState();
  const stream = new StreamController({
    plugin: { app: {}, settings: { mediaFolder: '', showMessageTimestamps: false } } as any,
    state,
    renderer,
    subagentManager: new SubagentManager(() => undefined),
    getMessagesEl: () => messagesEl,
    updateQueueIndicator: () => undefined,
  });
  const response: ChatMessage = { id: 'response', role: 'assistant', timestamp: 1, content: '', contentBlocks: [] };
  state.addMessage(response);
  const contentEl = renderer.addMessage(response).querySelector<HTMLElement>('.claudian-message-content')!;
  state.currentContentEl = contentEl;

  try {
    for (let i = 0; i < TOOL_COUNT; i++) {
      await stream.handleStreamChunk(
        { type: 'tool_use', id: `read-${i}`, name: 'Read', input: { file_path: `note-${i}.md` } },
        response,
      );
      await stream.handleStreamChunk({ type: 'tool_result', id: `read-${i}`, content: 'ok' }, response);
    }

    expect(visibleToolCalls(contentEl)).toHaveLength(STREAMING_TRAILING_VISIBLE);
    expect(within(contentEl).getByRole('button', { name: '3 tool calls' })).toBeTruthy();

    await stream.handleStreamChunk({ type: 'text', content: 'All notes read.' }, response);
    await stream.finalizeCurrentTextBlock(response);
    stream.hideThinkingIndicator();
    state.currentContentEl = null;
    response.durationSeconds = 5;
    renderer.finalizeResponse(response, state.messages, true);

    // Completed work collapses into the upstream history, which starts hidden.
    const history = contentEl.querySelector<HTMLElement>('.claudian-work-history')!;
    expect(history.hidden).toBe(true);
    expect(within(history).getByRole('button', { name: `${TOOL_COUNT} tool calls`, hidden: true })).toBeTruthy();
    expect(visibleToolCalls(contentEl)).toHaveLength(0);
    expect(within(contentEl).getByText('All notes read.').closest('.claudian-work-history')).toBeNull();

    const replayEl = document.body.createDiv();
    createRenderer(replayEl).renderStoredMessage(response, [response], 0);
    const replayHistory = replayEl.querySelector<HTMLElement>('.claudian-work-history')!;
    expect(within(replayHistory).getByRole('button', { name: `${TOOL_COUNT} tool calls`, hidden: true })).toBeTruthy();
  } finally {
    stream.dispose();
  }
});
