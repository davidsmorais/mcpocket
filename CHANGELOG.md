# Changelog

All notable changes to this project will be documented in this file.

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