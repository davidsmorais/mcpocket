# Graph Report - /home/david/dev/mcpocket  (2026-05-08)

## Corpus Check
- 51 files · ~126,275 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 337 nodes · 869 edges · 12 communities detected
- Extraction: 68% EXTRACTED · 32% INFERRED · 0% AMBIGUOUS · INFERRED: 281 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]

## God Nodes (most connected - your core abstractions)
1. `pushCommand()` - 32 edges
2. `dedupeCommand()` - 25 edges
3. `initCommand()` - 21 edges
4. `getClaudeHomeDir()` - 19 edges
5. `pullCommand()` - 17 edges
6. `statusCommand()` - 17 edges
7. `setCommand()` - 16 edges
8. `remoteCleanup()` - 16 edges
9. `localCleanup()` - 15 edges
10. `section()` - 13 edges

## Surprising Connections (you probably didn't know these)
- `die()` --calls--> `oops()`  [INFERRED]
  /home/david/dev/mcpocket/src/cli.ts → /home/david/dev/mcpocket/src/utils/sparkle.ts
- `getGeminiAgencySkillsDir()` --calls--> `getGeminiSkillSourceDirs()`  [INFERRED]
  /home/david/dev/mcpocket/src/utils/paths.ts → /home/david/dev/mcpocket/src/sync/skills.ts
- `initProjectCommand()` --calls--> `projectConfigExists()`  [INFERRED]
  /home/david/dev/mcpocket/src/commands/init.ts → /home/david/dev/mcpocket/src/sync/project.ts
- `initProjectCommand()` --calls--> `writeProjectConfig()`  [INFERRED]
  /home/david/dev/mcpocket/src/commands/init.ts → /home/david/dev/mcpocket/src/sync/project.ts
- `pushCommand()` --calls--> `readProjectConfig()`  [INFERRED]
  /home/david/dev/mcpocket/src/commands/push.ts → /home/david/dev/mcpocket/src/sync/project.ts

## Communities

### Community 0 - "Community 0"
Cohesion: 0.07
Nodes (41): getConfigPath(), readAntigravityMcpServers(), writeAntigravityMcpServers(), getSettingsPath(), readClaudeCodeMcpServers(), readClaudeCodeSettings(), writeClaudeCodeMcpServers(), getConfigPath() (+33 more)

### Community 1 - "Community 1"
Cohesion: 0.08
Nodes (40): chooseDestinations(), pickEntriesToPull(), buildItems(), discoverGlobalInventory(), discoverProjectInventory(), projectPocketBase(), projectSources(), shouldSkipDir() (+32 more)

### Community 2 - "Community 2"
Cohesion: 0.11
Nodes (38): configExists(), getLocalRepoDir(), readConfig(), resolveToken(), writeConfig(), dedupeCommand(), getGhToken(), getGhUsername() (+30 more)

### Community 3 - "Community 3"
Cohesion: 0.1
Nodes (37): availableOverrides(), categoryDirName(), globalAgentsDirFor(), globalSkillsDirFor(), projectDirFor(), proposeDestination(), relWithinCategory(), globalSources() (+29 more)

### Community 4 - "Community 4"
Cohesion: 0.13
Nodes (28): buildPocketItems(), cleanupCommand(), collectFiles(), computeFilesToKeep(), deleteFiles(), deletePocketItemFiles(), formatItemLabel(), globToRegex() (+20 more)

### Community 5 - "Community 5"
Cohesion: 0.15
Nodes (17): buildRoutingMap(), deriveDisplayName(), detectProject(), detectProvider(), detectToolType(), buildHtml(), esc(), openRoutingUi() (+9 more)

### Community 6 - "Community 6"
Cohesion: 0.17
Nodes (17): applyAgentsFromRepo(), clearAgentsFromRepo(), countManagedFiles(), findDuplicateAgents(), getAgentProviderTarget(), listAgentNamesInDir(), listFlatAgentNames(), listLocalAgentNames() (+9 more)

### Community 7 - "Community 7"
Cohesion: 0.16
Nodes (19): decrypt(), decryptEnv(), decryptStringMap(), encrypt(), encryptEnv(), encryptStringMap(), isEncrypted(), buildPortableConfig() (+11 more)

### Community 8 - "Community 8"
Cohesion: 0.29
Nodes (9): collectSourceFiles(), firstPathSegment(), listFiles(), mirrorDirectory(), mirrorFileMapToDir(), normalizeRelPath(), pruneDirectoryTopLevel(), removeEmptyDirs() (+1 more)

### Community 9 - "Community 9"
Cohesion: 0.39
Nodes (7): relPosix(), scanDirFiles(), scanDirFilesInclusiveHidden(), scanPocketTree(), buildTreeFromPaths(), printTree(), renderPocketTree()

### Community 10 - "Community 10"
Cohesion: 0.25
Nodes (5): collectProjectFiles(), discoverProjectFiles(), projectConfigExists(), readProjectConfig(), writeProjectConfig()

### Community 11 - "Community 11"
Cohesion: 0.38
Nodes (3): promptForItemSelection(), promptForProviderSelectionCLI(), promptForTwoStepSelection()

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `dedupeCommand()` connect `Community 2` to `Community 8`, `Community 3`, `Community 4`, `Community 6`?**
  _High betweenness centrality (0.063) - this node is a cross-community bridge._
- **Why does `pushCommand()` connect `Community 1` to `Community 2`, `Community 10`, `Community 4`, `Community 7`?**
  _High betweenness centrality (0.061) - this node is a cross-community bridge._
- **Why does `getClaudeHomeDir()` connect `Community 3` to `Community 0`, `Community 2`, `Community 6`?**
  _High betweenness centrality (0.030) - this node is a cross-community bridge._
- **Are the 29 inferred relationships involving `pushCommand()` (e.g. with `readConfig()` and `getLocalRepoDir()`) actually correct?**
  _`pushCommand()` has 29 INFERRED edges - model-reasoned connections that need verification._
- **Are the 24 inferred relationships involving `dedupeCommand()` (e.g. with `readConfig()` and `getLocalRepoDir()`) actually correct?**
  _`dedupeCommand()` has 24 INFERRED edges - model-reasoned connections that need verification._
- **Are the 19 inferred relationships involving `initCommand()` (e.g. with `section()` and `configExists()`) actually correct?**
  _`initCommand()` has 19 INFERRED edges - model-reasoned connections that need verification._
- **Are the 18 inferred relationships involving `getClaudeHomeDir()` (e.g. with `listLocalSkillNames()` and `writeSkillsToRepo()`) actually correct?**
  _`getClaudeHomeDir()` has 18 INFERRED edges - model-reasoned connections that need verification._