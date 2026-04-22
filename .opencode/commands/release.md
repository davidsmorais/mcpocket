---
description: Commit changes, push to GitHub, bump patch version, update changelog, and publish to npm
agent: build
---

Commit all current changes, push to GitHub, bump the patch version in package.json, update CHANGELOG.md with the new version, and publish to the npm registry.

Follow these steps in order:

1. **Commit & Push**:
   - Stage all modified files (exclude `.claude/settings.local.json` and other local/session files)
   - Use `git add` then `git commit` with a concise message describing the changes
   - Push to the remote with `git push`

2. **Bump Version**:
   - Read the current version from `package.json`
   - Increment the patch version (e.g., `0.6.6` → `0.6.7`)
   - Update `package.json` with the new version

3. **Update Changelog**:
   - Read `CHANGELOG.md`
   - Insert a new version entry at the top (after the header) with today's date
   - Summarize the changes from the commit message

4. **Publish to npm**:
   - Run `npm publish` (or `pnpm publish` if the project uses pnpm)
   - Verify the publish succeeded

5. **Verify**:
   - Run `git status` to confirm working tree is clean
   - Run `git log -3 --oneline` to show the new commit
