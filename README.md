# mcpocket

> Your AI setup. Every pocket. ✨

`mcpocket` syncs your Claude Code agents, skills, plugins, and MCP server configurations across machines — so your full AI loadout follows you everywhere, like magic.

## The Problem

You install 8 MCP servers, configure your Claude Code plugins, and build up a library of agents on your Linux machine. Then you switch to Windows and have nothing. `mcpocket` fixes that with two commands.

## Install

```bash
npm install -g mcpocket
```

## Usage

### 1. Initialize (once per machine)

```bash
mcpocket init
```

Connects to GitHub, creates a private `mcpocket-sync` repo, and clones it locally. Requires a [GitHub personal access token](https://github.com/settings/tokens/new) with `repo` scope.

### 2. Push your setup

```bash
mcpocket push
```

Reads MCP configs, plugin manifests, agents, and skills from your current machine. Encrypts any secrets (API keys in MCP env vars) with a passphrase you choose, then commits and pushes to your private GitHub repo.

### 3. Pull on a new machine

```bash
mcpocket pull
```

Pulls your config from GitHub, decrypts secrets with your passphrase, and writes everything to:
- **Claude Desktop** — `claude_desktop_config.json`
- **Claude Code** — `~/.claude/settings.json`
- **OpenCode** — `~/.config/opencode/config.json`

Then restart Claude Desktop to apply MCP changes.

### Check sync status

```bash
mcpocket status
```

Shows which MCP servers, plugins, agents, and skills are synced vs. local-only vs. remote-only.

## What Gets Synced

| What | Where |
|---|---|
| MCP server configs | All clients — Claude Desktop, Claude Code, OpenCode |
| Plugin manifests | `installed_plugins.json`, `blocklist.json`, `known_marketplaces.json` |
| Agents | `~/.claude/agents/**/*.md` |
| Skills | `~/.claude/skills/**` (excluding `node_modules`) |

**Never synced:** `.credentials.json`, `plugins/cache/`, sessions, telemetry.

## Security

- Secrets (MCP `env` vars) are encrypted with AES-256-GCM before upload
- Your passphrase is never stored anywhere
- Config repo is always private
- GitHub token is stored in `~/.mcpocket/config.json` (chmod 600 on Linux/Mac)

## Path Handling

`mcpocket` normalizes paths on push (`/home/user/...` → `~/...`) and expands them for the current platform on pull. Windows and Linux absolute paths round-trip correctly.

## Requirements

- Node.js 18+
- Git (must be in PATH)
- A GitHub account

## License

MIT
