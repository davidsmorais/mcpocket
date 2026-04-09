<p align="center">
  <img src="https://img.shields.io/npm/v/mcpocket?color=blue&label=npm" alt="npm version" />
  <img src="https://img.shields.io/node/v/mcpocket" alt="node version" />
  <img src="https://img.shields.io/github/license/davidsmorais/carry-on" alt="license" />
</p>

<p align="center">
  <img src="./logo.png" alt="mcpocket logo" width="200" />
</p>

# mcpocket

> Your AI setup. Every pocket. ✨

**mcpocket** syncs your Claude Code agents, skills, plugins, and MCP server configurations across machines — so your full AI loadout follows you everywhere, like magic.

---

## The Problem

You install 8 MCP servers, configure your Claude Code plugins, and build up a library of agents on your Linux workstation. Then you switch to your Windows laptop and… nothing. You start from scratch. Again.

**mcpocket** fixes that with two commands: `push` from your source machine, `pull` on any other.

## Features

- **Multi-client sync** — Claude Desktop, Claude Code, and OpenCode configs in one shot
- **Two storage backends** — private GitHub repo (full git history) or lightweight GitHub Gist
- **End-to-end encryption** — all secrets (API keys, tokens in MCP `env` vars) are encrypted with AES-256-GCM using a passphrase you choose
- **Cross-platform paths** — Windows ↔ Linux ↔ macOS paths round-trip seamlessly
- **Additive pull** — pulling merges remote servers into your local config without overwriting anything
- **De-duplicated file sync** — push/pull mirror synced files so stale agent, skill, and plugin files don't pile up
- **Zero dependencies on external services** — only GitHub and Git

---

## Install

```bash
npm install -g mcpocket
```

Or with pnpm / yarn:

```bash
pnpm add -g mcpocket
# or
yarn global add mcpocket
```

## Quick Start

```bash
# 1. Initialize (once per machine)
mcpocket init

# 2. Push your setup to the cloud
mcpocket push

# 3. Pull on a new machine
mcpocket pull

# 4. Clean up stale synced files if needed
mcpocket de-dupe

# 5. Check sync status
mcpocket status
```

---

## Commands

### `mcpocket init`

Interactive setup wizard. Links your GitHub account, chooses a storage backend, and creates the remote pocket.

```
$ mcpocket init

  ✦ First, let's link your GitHub account.
  Required scopes: repo (full control of private repositories)

  🔑 GitHub token: ****

  ✦ Authenticated as davidsmorais — nice to meet you!

  ✦ Where should mcpocket store your config?
      [1] GitHub repo  (private repo, full git history)
      [2] GitHub gist  (lighter, no git clone needed)

  Pick one [1/2]: 1
```

**Storage options:**

| Option | Backend | Requires Git? | History |
|---|---|---|---|
| `1` — Repo | Private `mcpocket-sync` repo | Yes | Full git log |
| `2` — Gist | Private GitHub Gist | No | Gist revisions |

Requires a [GitHub personal access token](https://github.com/settings/tokens/new) with **`repo`** scope (for repo mode) or **`gist`** scope (for gist mode).

### `mcpocket push`

Reads MCP configs, plugin manifests, agents, and skills from the current machine. Encrypts secrets with a passphrase you choose, then uploads to your private pocket.

```bash
mcpocket push
```

- In **repo mode**: commits and pushes to your private GitHub repo.
- In **gist mode**: uploads files to your private GitHub Gist (directory structure is flattened with `__` separators).

### `mcpocket pull`

Downloads your config from the remote pocket, decrypts secrets with your passphrase, and writes everything to the appropriate client config files:

```bash
mcpocket pull
```

| Client | Config file |
|---|---|
| Claude Desktop | `claude_desktop_config.json` |
| Claude Code | `~/.claude/settings.json` |
| OpenCode | `~/.config/opencode/config.json` |

Pull is **additive** — it adds servers that exist remotely but not locally, without overwriting your existing local config. Restart Claude Desktop after pulling to apply MCP changes.

For synced files, pull also removes stale agent and skill files that were previously synced but no longer exist in your pocket.

### `mcpocket de-dupe`

Refreshes the pocket, mirrors the current synced files, removes stale duplicates on both sides, and writes the cleaned result back to your configured backend.

```bash
mcpocket de-dupe
```

Use this if you already have duplicate or renamed agent/skill/plugin files from earlier syncs. In normal use, `push` and `pull` now keep these folders de-duplicated automatically.

### `mcpocket status`

Shows a diff of what's synced, what's local-only, and what's remote-only:

```bash
mcpocket status
```

```
  ── MCP Servers ──

    Synced:
      ✓ filesystem
      ✓ github

    Local only (run push):
      ↑ sqlite

    In pocket, not here (run pull):
      ↓ postgres
```

---

## What Gets Synced

| Category | Source | Details |
|---|---|---|
| MCP server configs | Claude Desktop, Claude Code, OpenCode | Merged across all clients |
| Plugin manifests | `~/.claude/plugins/` | `installed_plugins.json`, `blocklist.json`, `known_marketplaces.json` |
| Agents | `~/.claude/agents/` | All `*.md` files, recursively |
| Skills | `~/.claude/skills/` | All files, recursively (excluding `node_modules`) |

### Never Synced

- `.credentials.json`
- `plugins/cache/`
- Sessions and telemetry data
- Your GitHub token (stays in local `~/.mcpocket/config.json`)

---

## Security

| Concern | How mcpocket handles it |
|---|---|
| API keys & tokens | Encrypted with **AES-256-GCM** (via `scrypt` key derivation) before leaving your machine |
| Passphrase storage | **Never stored** — you enter it on every push/pull |
| Remote storage | Always **private** (private repo or secret gist) |
| Local config | `~/.mcpocket/config.json` is `chmod 600` on Linux/macOS |
| Git auth | Token is injected at runtime into HTTPS URLs, never persisted in git config |
| Error output | Git errors are sanitized to strip tokens before display |

### Encryption Format

Encrypted values are stored as:

```
ENCRYPTED:<iv_hex>:<salt_hex>:<authTag_hex>:<ciphertext_hex>
```

Each value uses a unique random salt and IV, so identical plaintext values produce different ciphertexts.

---

## Path Handling

mcpocket normalizes paths for portability:

| Direction | Transformation |
|---|---|
| Push | `/home/user/...` or `C:\Users\user\...` → `~/...` |
| Pull | `~/...` → platform-native absolute path |
| Commands | `.cmd` / `.exe` extensions stripped on push, restored on pull (Windows) |

This means a config pushed from Linux works on Windows and vice versa.

---

## Configuration

mcpocket stores its own config at `~/.mcpocket/config.json`:

```jsonc
{
  "githubToken": "ghp_...",
  "storageType": "repo",       // "repo" or "gist"
  // Repo mode:
  "repoFullName": "user/mcpocket-sync",
  "repoCloneUrl": "https://github.com/user/mcpocket-sync.git",
  "repoHtmlUrl": "https://github.com/user/mcpocket-sync",
  // Gist mode:
  "gistId": "abc123...",
  "gistUrl": "https://gist.github.com/abc123..."
}
```

The local repo clone (used as a staging area) lives at `~/.mcpocket/repo/`.

---

## Requirements

- **Node.js** 18+
- **Git** in PATH (repo mode only — gist mode doesn't need git)
- A **GitHub account** with a personal access token

---

## Project Structure

```
src/
  cli.ts              # Entry point, Commander setup
  config.ts           # Config read/write, storage type definitions
  clients/
    claude-desktop.ts  # Claude Desktop config reader/writer
    claude-code.ts     # Claude Code settings reader/writer
    opencode.ts        # OpenCode config reader/writer
    types.ts           # Shared MCP server type definitions
  commands/
    init.ts            # Interactive setup wizard
    push.ts            # Push local config to remote
    pull.ts            # Pull remote config to local
    status.ts          # Diff local vs. remote
  storage/
    github.ts          # GitHub repo CRUD + git operations
    gist.ts            # GitHub Gist CRUD + file flattening
  sync/
    agents.ts          # Agent file sync logic
    mcp.ts             # MCP server merge, pack/unpack, encrypt/decrypt
    plugins.ts         # Plugin manifest sync logic
    skills.ts          # Skills file sync logic
  utils/
    crypto.ts          # AES-256-GCM encrypt/decrypt helpers
    paths.ts           # Cross-platform path normalization
    prompt.ts          # Interactive CLI input helpers
    sparkle.ts         # CLI banners, spinners, and personality
```

---

## Troubleshooting

### "mcpocket is not initialized"

Run `mcpocket init` first to set up your GitHub connection and storage backend.

### "Decryption failed — wrong passphrase"

The passphrase you entered doesn't match the one used during `mcpocket push`. Passphrases are never stored — you need to remember the one you used.

### Push says "Nothing changed"

Your local config matches what's already in the remote pocket. No commit/upload needed.

### MCP servers not appearing after pull

Restart Claude Desktop to reload MCP server configurations. Claude Code and OpenCode pick up changes automatically.

### Git errors on push/pull (repo mode)

Make sure `git` is installed and in your PATH. If you see auth errors, your GitHub token may have expired — run `mcpocket init` to re-authenticate.

---

## Contributing

Contributions are welcome! Please open an issue or submit a pull request on [GitHub](https://github.com/davidsmorais/carry-on).

```bash
git clone https://github.com/davidsmorais/carry-on.git
cd carry-on
pnpm install
pnpm build
```

---

## Author

**David Morais** — [david@davidmorais.com](mailto:david@davidmorais.com)

- GitHub: [@davidsmorais](https://github.com/davidsmorais)

## License

[MIT](LICENSE) © David Morais
