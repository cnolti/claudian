# Obsidian Claude Agent

An Obsidian plugin that embeds Claude Code as a sidebar chat interface. Your vault becomes Claude's working directory, giving it full agentic capabilities: file read/write, bash commands, and multi-step workflows.

## Features

- **Sidebar chat interface**: Talk to Claude without leaving Obsidian
- **Full Claude Code capabilities**: Read, write, edit files, run bash commands
- **Vault-aware**: Claude operates with your vault as the working directory
- **Streaming responses**: See Claude's responses in real-time
- **Tool call visualization**: Collapsible UI showing tool inputs and results (like Claude Code CLI)
- **Session persistence**: Conversation context maintained within a session
- **Safety blocklist**: Optionally block dangerous commands

## Requirements

- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed (the SDK uses it internally)
- Obsidian v1.0.0+
- Desktop only (macOS, Linux, Windows via WSL)

## Installation

### From source (development)

1. Clone this repository into your vault's plugins folder:
   ```bash
   cd /path/to/vault/.obsidian/plugins
   git clone https://github.com/yourusername/obsidian-claude-agent.git
   cd obsidian-claude-agent
   ```

2. Install dependencies and build:
   ```bash
   npm install
   npm run build
   ```

3. Enable the plugin in Obsidian:
   - Settings → Community plugins → Enable "Claude Agent"

### Development

```bash
# Watch mode (auto-rebuild on changes)
npm run dev

# Production build
npm run build
```

## Usage

1. Click the bot icon in the ribbon (left sidebar) to open Claude Agent
2. Type your message and press Enter to send (Shift+Enter for newline)
3. Claude can read, write, and edit files in your vault
4. Click on tool call headers to expand and see inputs/results

### Example prompts

- "List all notes in this vault"
- "Create a new note called 'Ideas' with a template for brainstorming"
- "Find all notes tagged #project and summarize them"
- "Organize my daily notes into monthly folders"

## Configuration

### Settings

- **Enable command blocklist**: Block dangerous bash commands (default: on)
- **Blocked commands**: Patterns to block (supports regex)
- **Show tool usage**: Display file operations in chat

### Default blocklist

- `rm -rf`
- `rm -r /`
- `chmod 777`
- `chmod -R 777`
- `mkfs`
- `dd if=`
- `> /dev/sd`

## Architecture

```
src/
├── main.ts               # Plugin entry point
├── ClaudeAgentView.ts    # Sidebar chat UI with tool call display
├── ClaudeAgentService.ts # Claude Agent SDK wrapper
├── ClaudeAgentSettings.ts # Settings tab
├── systemPrompt.ts       # System prompt for Claude
└── types.ts              # Type definitions
```

## Roadmap

- [x] Session persistence within sessions (via SDK resume)
- [ ] Session persistence across plugin restarts
- [ ] Context menu: "Ask Claude about this file"
- [ ] Open files that Claude edits
- [ ] Chat history export
- [ ] Model selection

## License

MIT

## Acknowledgments

- [Obsidian](https://obsidian.md) for the plugin API
- [Anthropic](https://anthropic.com) for Claude and the [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk)
