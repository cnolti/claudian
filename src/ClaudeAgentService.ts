import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { query, type Options } from '@anthropic-ai/claude-agent-sdk';
import type ClaudeAgentPlugin from './main';
import { StreamChunk } from './types';
import { SYSTEM_PROMPT } from './systemPrompt';

export class ClaudeAgentService {
  private plugin: ClaudeAgentPlugin;
  private abortController: AbortController | null = null;
  private sessionId: string | null = null;
  private resolvedClaudePath: string | null = null;

  constructor(plugin: ClaudeAgentPlugin) {
    this.plugin = plugin;
  }

  /**
   * Find the claude CLI binary by checking common installation locations
   */
  private findClaudeCLI(): string | null {
    // Common installation locations
    const homeDir = os.homedir();
    const commonPaths = [
      path.join(homeDir, '.claude', 'local', 'claude'),
      path.join(homeDir, '.local', 'bin', 'claude'),
      '/usr/local/bin/claude',
      '/opt/homebrew/bin/claude',
      path.join(homeDir, 'bin', 'claude'),
    ];

    for (const p of commonPaths) {
      if (fs.existsSync(p)) {
        return p;
      }
    }

    return null;
  }

  /**
   * Send a query to Claude and stream the response
   */
  async *query(prompt: string): AsyncGenerator<StreamChunk> {
    // Get vault path
    const vaultPath = this.getVaultPath();
    if (!vaultPath) {
      yield { type: 'error', content: 'Could not determine vault path' };
      return;
    }

    // Find claude CLI - cache the result
    if (!this.resolvedClaudePath) {
      this.resolvedClaudePath = this.findClaudeCLI();
    }

    if (!this.resolvedClaudePath) {
      yield { type: 'error', content: 'Claude CLI not found. Please install Claude Code CLI.' };
      return;
    }

    // Create abort controller for cancellation
    this.abortController = new AbortController();

    try {
      yield* this.queryViaSDK(prompt, vaultPath);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      yield { type: 'error', content: msg };
    } finally {
      this.abortController = null;
    }
  }

  private async *queryViaSDK(prompt: string, cwd: string): AsyncGenerator<StreamChunk> {
    const options: Options = {
      cwd,
      systemPrompt: SYSTEM_PROMPT,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      model: 'claude-haiku-4-5',
      allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'LS'],
      abortController: this.abortController ?? undefined,
      pathToClaudeCodeExecutable: this.resolvedClaudePath!,
    };

    // Resume previous session if we have a session ID
    if (this.sessionId) {
      options.resume = this.sessionId;
    }

    try {
      const response = query({ prompt, options });

      for await (const message of response) {
        // Check for cancellation
        if (this.abortController?.signal.aborted) {
          await response.interrupt();
          break;
        }

        // transformSDKMessage now yields multiple chunks
        for (const chunk of this.transformSDKMessage(message)) {
          // Check blocklist for bash commands
          if (chunk.type === 'tool_use' && chunk.name === 'Bash') {
            const command = chunk.input?.command as string || '';
            if (this.shouldBlockCommand(command)) {
              yield { type: 'blocked', content: `Blocked command: ${command}` };
              continue;
            }
          }
          yield chunk;
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      yield { type: 'error', content: msg };
    }

    yield { type: 'done' };
  }

  /**
   * Transform SDK message to our StreamChunk format
   * Returns an array since one SDK message can contain multiple chunks
   * (e.g., assistant message with both text and tool_use blocks)
   *
   * SDK Message Types:
   * - 'system' - init, status, etc.
   * - 'assistant' - assistant response with content blocks (text, tool_use)
   * - 'user' - user messages, includes tool_use_result for tool outputs
   * - 'stream_event' - streaming deltas
   * - 'result' - final result
   */
  private *transformSDKMessage(message: any): Generator<StreamChunk> {
    switch (message.type) {
      case 'system':
        // Capture session ID from init message
        if (message.subtype === 'init' && message.session_id) {
          this.sessionId = message.session_id;
        }
        // Don't yield system messages to the UI
        break;

      case 'assistant':
        // Extract ALL content blocks - both text and tool_use
        if (message.message?.content && Array.isArray(message.message.content)) {
          for (const block of message.message.content) {
            if (block.type === 'text' && block.text) {
              yield { type: 'text', content: block.text };
            } else if (block.type === 'tool_use') {
              yield {
                type: 'tool_use',
                id: block.id || `tool-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                name: block.name,
                input: block.input || {},
              };
            }
          }
        }
        break;

      case 'user':
        // User messages can contain tool results
        if (message.tool_use_result !== undefined && message.parent_tool_use_id) {
          yield {
            type: 'tool_result',
            id: message.parent_tool_use_id,
            content: typeof message.tool_use_result === 'string'
              ? message.tool_use_result
              : JSON.stringify(message.tool_use_result, null, 2),
            isError: false,
          };
        }
        // Also check message.message.content for tool_result blocks
        if (message.message?.content && Array.isArray(message.message.content)) {
          for (const block of message.message.content) {
            if (block.type === 'tool_result') {
              yield {
                type: 'tool_result',
                id: block.tool_use_id || message.parent_tool_use_id || '',
                content: typeof block.content === 'string'
                  ? block.content
                  : JSON.stringify(block.content, null, 2),
                isError: block.is_error || false,
              };
            }
          }
        }
        break;

      case 'stream_event':
        // Handle streaming events for real-time updates
        const event = message.event;
        if (event?.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
          yield {
            type: 'tool_use',
            id: event.content_block.id || `tool-${Date.now()}`,
            name: event.content_block.name,
            input: event.content_block.input || {},
          };
        } else if (event?.type === 'content_block_start' && event.content_block?.type === 'text') {
          if (event.content_block.text) {
            yield { type: 'text', content: event.content_block.text };
          }
        } else if (event?.type === 'content_block_delta') {
          if (event.delta?.type === 'text_delta' && event.delta.text) {
            yield { type: 'text', content: event.delta.text };
          }
        }
        break;

      case 'result':
        // Final result - no text to extract, result is a string summary
        break;

      case 'error':
        if (message.error) {
          yield { type: 'error', content: message.error };
        }
        break;
    }
  }

  /**
   * Check if a bash command should be blocked
   */
  private shouldBlockCommand(command: string): boolean {
    if (!this.plugin.settings.enableBlocklist) {
      return false;
    }

    return this.plugin.settings.blockedCommands.some(pattern => {
      try {
        return new RegExp(pattern, 'i').test(command);
      } catch {
        // Invalid regex, try simple includes
        return command.toLowerCase().includes(pattern.toLowerCase());
      }
    });
  }

  /**
   * Get the vault's filesystem path
   */
  private getVaultPath(): string | null {
    const adapter = this.plugin.app.vault.adapter;
    if ('basePath' in adapter) {
      return (adapter as any).basePath;
    }
    return null;
  }

  /**
   * Cancel the current query
   */
  cancel() {
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  /**
   * Reset the conversation session
   * Call this when clearing the chat to start fresh
   */
  resetSession() {
    this.sessionId = null;
  }

  /**
   * Cleanup resources
   */
  cleanup() {
    this.cancel();
    this.resetSession();
  }
}
