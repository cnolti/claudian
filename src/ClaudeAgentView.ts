import { ItemView, WorkspaceLeaf, MarkdownRenderer, setIcon } from 'obsidian';
import type ClaudeAgentPlugin from './main';
import { VIEW_TYPE_CLAUDE_AGENT, ChatMessage, StreamChunk, ToolCallInfo } from './types';

export class ClaudeAgentView extends ItemView {
  private plugin: ClaudeAgentPlugin;
  private messages: ChatMessage[] = [];
  private messagesEl: HTMLElement;
  private inputEl: HTMLTextAreaElement;
  private isStreaming = false;
  private toolCallElements: Map<string, HTMLElement> = new Map();

  // For maintaining stream order
  private currentContentEl: HTMLElement | null = null;
  private currentTextEl: HTMLElement | null = null;
  private currentTextContent: string = '';

  constructor(leaf: WorkspaceLeaf, plugin: ClaudeAgentPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_CLAUDE_AGENT;
  }

  getDisplayText(): string {
    return 'Claude Agent';
  }

  getIcon(): string {
    return 'bot';
  }

  async onOpen() {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass('claude-agent-container');

    // Header
    const header = container.createDiv({ cls: 'claude-agent-header' });
    header.createEl('h4', { text: 'Claude Agent' });

    const clearBtn = header.createEl('button', { cls: 'claude-agent-clear-btn' });
    setIcon(clearBtn, 'trash');
    clearBtn.setAttribute('aria-label', 'Clear conversation');
    clearBtn.addEventListener('click', () => this.clearConversation());

    // Messages area
    this.messagesEl = container.createDiv({ cls: 'claude-agent-messages' });

    // Input area
    const inputContainer = container.createDiv({ cls: 'claude-agent-input-container' });

    this.inputEl = inputContainer.createEl('textarea', {
      cls: 'claude-agent-input',
      attr: {
        placeholder: 'Ask Claude anything... (Enter to send, Shift+Enter for newline)',
        rows: '3',
      },
    });

    const buttonContainer = inputContainer.createDiv({ cls: 'claude-agent-buttons' });

    const sendBtn = buttonContainer.createEl('button', {
      cls: 'claude-agent-send-btn mod-cta',
      text: 'Send',
    });

    // Event handlers
    sendBtn.addEventListener('click', () => this.sendMessage());

    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });

  }

  async onClose() {
    // Cleanup if needed
  }

  private async sendMessage() {
    const content = this.inputEl.value.trim();
    if (!content || this.isStreaming) return;

    this.inputEl.value = '';
    this.isStreaming = true;

    // Add user message
    this.addMessage({
      id: this.generateId(),
      role: 'user',
      content,
      timestamp: Date.now(),
    });

    // Create assistant message placeholder
    const assistantMsg: ChatMessage = {
      id: this.generateId(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [],
    };
    const msgEl = this.addMessage(assistantMsg);
    const contentEl = msgEl.querySelector('.claude-agent-message-content') as HTMLElement;

    // Reset streaming state
    this.toolCallElements.clear();
    this.currentContentEl = contentEl;
    this.currentTextEl = null;
    this.currentTextContent = '';

    try {
      for await (const chunk of this.plugin.agentService.query(content)) {
        await this.handleStreamChunk(chunk, assistantMsg);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.appendText(`\n\n**Error:** ${errorMsg}`);
    } finally {
      this.isStreaming = false;
      this.currentContentEl = null;
      this.currentTextEl = null;
      this.currentTextContent = '';
    }
  }

  private async handleStreamChunk(
    chunk: StreamChunk,
    msg: ChatMessage
  ) {
    switch (chunk.type) {
      case 'text':
        msg.content += chunk.content;
        await this.appendText(chunk.content);
        break;

      case 'tool_use':
        if (this.plugin.settings.showToolUse) {
          // Finalize current text block before adding tool
          this.finalizeCurrentTextBlock();

          const toolCall: ToolCallInfo = {
            id: chunk.id,
            name: chunk.name,
            input: chunk.input,
            status: 'running',
            isExpanded: false,
          };
          msg.toolCalls = msg.toolCalls || [];
          msg.toolCalls.push(toolCall);
          this.renderToolCall(this.currentContentEl!, toolCall);
        }
        break;

      case 'tool_result':
        if (this.plugin.settings.showToolUse) {
          const toolCall = msg.toolCalls?.find(tc => tc.id === chunk.id);
          if (toolCall) {
            toolCall.status = chunk.isError ? 'error' : 'completed';
            toolCall.result = chunk.content;
            this.updateToolCallResult(chunk.id, toolCall);
          }
        }
        break;

      case 'blocked':
        await this.appendText(`\n\n⚠️ **Blocked:** ${chunk.content}`);
        break;

      case 'error':
        await this.appendText(`\n\n❌ **Error:** ${chunk.content}`);
        break;

      case 'done':
        break;
    }

    // Auto-scroll to bottom
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  private async appendText(text: string) {
    if (!this.currentContentEl) return;

    // Create text block if needed
    if (!this.currentTextEl) {
      this.currentTextEl = this.currentContentEl.createDiv({ cls: 'claude-agent-text-block' });
      this.currentTextContent = '';
    }

    this.currentTextContent += text;
    await this.renderContent(this.currentTextEl, this.currentTextContent);
  }

  private finalizeCurrentTextBlock() {
    // Start fresh text block after tool call
    this.currentTextEl = null;
    this.currentTextContent = '';
  }

  private addMessage(msg: ChatMessage): HTMLElement {
    this.messages.push(msg);

    const msgEl = this.messagesEl.createDiv({
      cls: `claude-agent-message claude-agent-message-${msg.role}`,
    });

    const contentEl = msgEl.createDiv({ cls: 'claude-agent-message-content' });

    // For user messages, render content directly
    if (msg.role === 'user' && msg.content) {
      const textEl = contentEl.createDiv({ cls: 'claude-agent-text-block' });
      this.renderContent(textEl, msg.content);
    }
    // For assistant messages, content will be added dynamically during streaming

    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    return msgEl;
  }

  private addSystemMessage(content: string) {
    const msgEl = this.messagesEl.createDiv({
      cls: 'claude-agent-message claude-agent-message-system',
    });
    msgEl.setText(content);
  }

  private async renderContent(el: HTMLElement, markdown: string) {
    el.empty();
    await MarkdownRenderer.renderMarkdown(markdown, el, '', this);
  }

  private renderToolCall(parentEl: HTMLElement, toolCall: ToolCallInfo) {
    const toolEl = parentEl.createDiv({ cls: 'claude-agent-tool-call' });
    toolEl.dataset.toolId = toolCall.id;
    this.toolCallElements.set(toolCall.id, toolEl);

    // Header (clickable to expand/collapse)
    const header = toolEl.createDiv({ cls: 'claude-agent-tool-header' });

    // Chevron icon
    const chevron = header.createSpan({ cls: 'claude-agent-tool-chevron' });
    setIcon(chevron, 'chevron-right');

    // Tool icon
    const iconEl = header.createSpan({ cls: 'claude-agent-tool-icon' });
    this.setToolIcon(iconEl, toolCall.name);

    // Tool label
    const labelEl = header.createSpan({ cls: 'claude-agent-tool-label' });
    labelEl.setText(this.getToolLabel(toolCall.name, toolCall.input));

    // Status indicator
    const statusEl = header.createSpan({ cls: 'claude-agent-tool-status' });
    statusEl.addClass(`status-${toolCall.status}`);
    if (toolCall.status === 'running') {
      statusEl.createSpan({ cls: 'claude-agent-spinner' });
    }

    // Collapsible content
    const content = toolEl.createDiv({ cls: 'claude-agent-tool-content' });
    content.style.display = 'none';

    // Input parameters
    const inputSection = content.createDiv({ cls: 'claude-agent-tool-input' });
    inputSection.createDiv({ cls: 'claude-agent-tool-section-label', text: 'Input' });
    const inputCode = inputSection.createEl('pre', { cls: 'claude-agent-tool-code' });
    inputCode.setText(this.formatToolInput(toolCall.name, toolCall.input));

    // Result placeholder
    const resultSection = content.createDiv({ cls: 'claude-agent-tool-result' });
    resultSection.createDiv({ cls: 'claude-agent-tool-section-label', text: 'Result' });
    const resultCode = resultSection.createEl('pre', { cls: 'claude-agent-tool-code claude-agent-tool-result-code' });
    resultCode.setText('Running...');

    // Toggle expand/collapse on header click
    header.addEventListener('click', () => {
      toolCall.isExpanded = !toolCall.isExpanded;
      if (toolCall.isExpanded) {
        content.style.display = 'block';
        toolEl.addClass('expanded');
        setIcon(chevron, 'chevron-down');
      } else {
        content.style.display = 'none';
        toolEl.removeClass('expanded');
        setIcon(chevron, 'chevron-right');
      }
    });
  }

  private updateToolCallResult(toolId: string, toolCall: ToolCallInfo) {
    const toolEl = this.toolCallElements.get(toolId);
    if (!toolEl) return;

    // Update status indicator
    const statusEl = toolEl.querySelector('.claude-agent-tool-status');
    if (statusEl) {
      statusEl.className = 'claude-agent-tool-status';
      statusEl.addClass(`status-${toolCall.status}`);
      statusEl.empty();
      if (toolCall.status === 'completed') {
        setIcon(statusEl as HTMLElement, 'check');
      } else if (toolCall.status === 'error') {
        setIcon(statusEl as HTMLElement, 'x');
      }
    }

    // Update result content
    const resultCode = toolEl.querySelector('.claude-agent-tool-result-code');
    if (resultCode && toolCall.result) {
      const truncated = this.truncateResult(toolCall.result);
      resultCode.setText(truncated);
    }
  }

  private setToolIcon(el: HTMLElement, name: string) {
    const iconMap: Record<string, string> = {
      'Read': 'file-text',
      'Write': 'edit-3',
      'Edit': 'edit',
      'Bash': 'terminal',
      'Glob': 'folder-search',
      'Grep': 'search',
      'LS': 'list',
    };
    setIcon(el, iconMap[name] || 'wrench');
  }

  private getToolLabel(name: string, input: Record<string, unknown>): string {
    switch (name) {
      case 'Read':
        return `Read ${this.shortenPath(input.file_path as string) || 'file'}`;
      case 'Write':
        return `Write ${this.shortenPath(input.file_path as string) || 'file'}`;
      case 'Edit':
        return `Edit ${this.shortenPath(input.file_path as string) || 'file'}`;
      case 'Bash':
        const cmd = (input.command as string) || 'command';
        return `Bash: ${cmd.length > 40 ? cmd.substring(0, 40) + '...' : cmd}`;
      case 'Glob':
        return `Glob: ${input.pattern || 'files'}`;
      case 'Grep':
        return `Grep: ${input.pattern || 'pattern'}`;
      case 'LS':
        return `LS: ${this.shortenPath(input.path as string) || '.'}`;
      default:
        return name;
    }
  }

  private shortenPath(path: string | undefined): string {
    if (!path) return '';
    const parts = path.split('/');
    if (parts.length <= 3) return path;
    return '.../' + parts.slice(-2).join('/');
  }

  private formatToolInput(name: string, input: Record<string, unknown>): string {
    // Format nicely based on tool type
    switch (name) {
      case 'Read':
      case 'Write':
      case 'Edit':
        return input.file_path as string || JSON.stringify(input, null, 2);
      case 'Bash':
        return (input.command as string) || JSON.stringify(input, null, 2);
      case 'Glob':
      case 'Grep':
        return (input.pattern as string) || JSON.stringify(input, null, 2);
      default:
        return JSON.stringify(input, null, 2);
    }
  }

  private truncateResult(result: string, maxLines = 20, maxLength = 2000): string {
    if (result.length > maxLength) {
      result = result.substring(0, maxLength) + '\n... (truncated)';
    }
    const lines = result.split('\n');
    if (lines.length > maxLines) {
      return lines.slice(0, maxLines).join('\n') + `\n... (${lines.length - maxLines} more lines)`;
    }
    return result;
  }

  private clearConversation() {
    this.messages = [];
    this.messagesEl.empty();
    // Reset the Claude session so next message starts fresh
    this.plugin.agentService.resetSession();
    this.addSystemMessage('Conversation cleared. Ready for new messages.');
  }

  private generateId(): string {
    return `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}
