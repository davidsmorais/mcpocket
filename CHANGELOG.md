# Changelog

All notable changes to this project will be documented in this file.

## [0.6.13] - 2026-04-22

### Added
- New `-e, --exclude` flag for push and pull commands to open a browser UI to select items to EXCLUDE from sync (inverse of the default include filter UI).

### Fixed
- Interactive multi-select now uses viewport-based rendering for large lists, with PageUp/PageDown, Home/End, and g/s shortcuts to toggle all agents/skills.

## [0.6.9] - 2026-04-22

### Added
- Provider-aware repo listing for agents and skills in the pull command, enabling interactive and filter UIs to show which provider each item comes from.

## [0.6.7] - 2026-04-22

### Fixed
- OpenCode MCP config now writes to `mcpServers` (top-level) instead of `mcp.servers`, matching the schema at `https://opencode.ai/config.json`.

## [0.6.0] - 2026-04-21

### Added
- Agents are now collected from `~/.copilot/agents/` in addition to `~/.claude/agents/` on push. Files from both sources are merged; Claude wins on conflict.
- Skills are now collected from `~/.gemini/extensions/agency-agents/skills/` in addition to `~/.claude/skills/` on push. Files from both sources are merged; Claude wins on conflict.
- Copilot CLI MCP config now also reads from `~/.copilot/mcp-config.json` on push (VS Code config takes precedence on conflict).
- New path helpers for Copilot and Gemini home directories and agent/skill locations.

## [0.5.0] - 2026-04-15

### Added
- Project mode: track and sync project-level AI config files (CLAUDE.md, .cursorrules, etc.) with `mcpocket init --project`, `push --project`, and `pull --project`.
- When preparing a pocket for gist storage, managed agents and skills are removed and the plugins folder is pruned to avoid leaving stale files.

## [0.4.0] - 2026-04-12

### Added
- `mcpocket cleanup` command: interactively remove files from your pocket or use pattern-based rules via `cleanupInclude`/`cleanupExclude` in config.
- `mcpocket status` command: diff local vs remote MCP servers.

## [0.3.0] - 2026-04-10

### Added
- `mcpocket init` now asks if you have an existing pocket to connect to.
- Paste a gist URL (`https://gist.github.com/user/id`) or raw gist ID to link an existing gist.
- Paste a repo URL (`https://github.com/owner/repo`) or `owner/repo` to link an existing repo.
- New `resolveGistInfo` and `resolveRepoInfo` helpers that validate and resolve existing remotes.

## [0.2.0] - 2026-04-09

### Added
- GitHub Gist storage as an alternative backend for syncing configuration.
- A `de-dupe` command to clean up stale synced agents, skills, and plugins.
- Multi-provider push and pull targeting with provider-specific CLI flags.

### Changed
- Push and pull now mirror synced agent and skill files to prevent stale duplicates from accumulating.
- Sync logic was cleaned up to better handle provider-scoped MCP configuration flows.
- Internal imports were updated to use the `node:` prefix consistently.

### Fixed
- README package assets and branding were aligned with the published `mcpocket` package.
- Error messages and package metadata were updated to reflect the `mcpocket` name.

## [0.1.1] - 2026-04-09

### Changed
- Renamed the package to `mcpocket` for npm publishing.
- Refreshed package branding and metadata for the npm release.

## [0.1.0] - 2026-04-09

### Added
- Initial release of `carry-on`, including encrypted MCP configuration sync across supported clients.