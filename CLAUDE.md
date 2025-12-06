# CLAUDE.md

## Project Overview

Obsidian Claude Agent - An Obsidian plugin that embeds Claude Code as a sidebar chat interface. The vault directory becomes Claude's working directory, giving it full agentic capabilities: file read/write, bash commands, and multi-step workflows.

**Core Principle**: "Claude Code in a sidebar" - the full Claude Code experience embedded in Obsidian.

## Architecture

```
src/
├── main.ts               # Plugin entry point, registers view and settings
├── ClaudeAgentView.ts    # Sidebar chat UI (ItemView), handles streaming display
├── ClaudeAgentService.ts # Claude Agent SDK wrapper, transforms SDK messages
├── ClaudeAgentSettings.ts # Settings tab
├── systemPrompt.ts       # System prompt for Claude agent
└── types.ts              # Shared type definitions (StreamChunk, ToolCallInfo, etc.)
```

## Key Technologies

- **Claude Agent SDK**: `@anthropic-ai/claude-agent-sdk` for Claude integration
- **Obsidian API**: Plugin framework, ItemView for sidebar, MarkdownRenderer
- **Build**: esbuild with TypeScript
- **Target**: Desktop only (macOS, Linux, Windows via WSL)

## Commands

```bash
# Development (watch mode)
npm run dev

# Production build
npm run build

# Install dependencies
npm install
```

## Key Implementation Patterns

### Claude Agent SDK Usage
```typescript
import { query, type Options } from '@anthropic-ai/claude-agent-sdk';

const options: Options = {
  cwd: vaultPath,
  permissionMode: 'bypassPermissions',
  allowDangerouslySkipPermissions: true,
  model: 'claude-haiku-4-5',
  allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'LS'],
  abortController: this.abortController,
  pathToClaudeCodeExecutable: '/path/to/claude',
  resume: sessionId, // Optional: resume previous session
};

const response = query({ prompt, options });
for await (const message of response) {
  // Handle streaming messages
}
```

### Obsidian View Registration
```typescript
this.registerView(VIEW_TYPE_CLAUDE_AGENT, (leaf) => new ClaudeAgentView(leaf, this));
```

### Vault Path Access
```typescript
const vaultPath = this.app.vault.adapter.basePath;
```

### Markdown Rendering
```typescript
await MarkdownRenderer.renderMarkdown(markdown, container, sourcePath, component);
```

## SDK Message Types

| Type | Description |
|------|-------------|
| `system` | Session initialization (subtype: 'init' includes session_id), status updates |
| `assistant` | Claude's response containing content blocks (text and/or tool_use) |
| `user` | User messages, also contains tool results via `tool_use_result` field |
| `stream_event` | Streaming deltas (content_block_start, content_block_delta) |
| `result` | Terminal message indicating completion |
| `error` | Error messages |

### Content Block Types (inside assistant.message.content)
- `text` - Text content with `text` field
- `tool_use` - Tool invocation with `id`, `name`, and `input` fields

### Tool Result Location (inside user messages)
- `user.tool_use_result` - The result of tool execution
- `user.parent_tool_use_id` - Links result to the original tool_use

## Settings Structure

```typescript
interface ClaudeAgentSettings {
  enableBlocklist: boolean;      // Block dangerous commands
  blockedCommands: string[];     // Regex patterns to block
  showToolUse: boolean;          // Show file operations in chat
}
```

## Default Blocked Commands

- `rm -rf`
- `rm -r /`
- `chmod 777`
- `chmod -R 777`
- `mkfs`
- `dd if=`
- `> /dev/sd`

## File Outputs

- `main.js` - Bundled plugin code
- `styles.css` - Plugin styles
- `manifest.json` - Obsidian plugin manifest

## External Dependencies

- User must have Claude Code CLI installed (SDK uses it internally via `pathToClaudeCodeExecutable`)
- Obsidian v1.0.0+

## CSS Class Conventions

### Layout
- `.claude-agent-container` - Main container
- `.claude-agent-header` - Header with title and clear button
- `.claude-agent-messages` - Messages scroll area
- `.claude-agent-input-container` - Input area wrapper
- `.claude-agent-input` - Textarea input
- `.claude-agent-send-btn` - Send button

### Messages
- `.claude-agent-message` - Individual message
- `.claude-agent-message-user` - User message styling
- `.claude-agent-message-assistant` - Assistant message styling
- `.claude-agent-message-system` - System message styling
- `.claude-agent-message-content` - Message content wrapper
- `.claude-agent-text-block` - Text block within message (maintains stream order)

### Tool Calls
- `.claude-agent-tool-call` - Tool call container (collapsible)
- `.claude-agent-tool-header` - Clickable header with tool info
- `.claude-agent-tool-chevron` - Expand/collapse chevron icon
- `.claude-agent-tool-icon` - Tool type icon
- `.claude-agent-tool-label` - Tool name and summary
- `.claude-agent-tool-status` - Status indicator (running/completed/error)
- `.claude-agent-spinner` - Loading spinner animation
- `.claude-agent-tool-content` - Collapsible content area
- `.claude-agent-tool-input` - Input parameters section
- `.claude-agent-tool-result` - Result output section
- `.claude-agent-tool-code` - Code/output display
