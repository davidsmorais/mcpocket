```markdown
# mcpocket Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill introduces the core development patterns and conventions used in the `mcpocket` TypeScript codebase. You'll learn how to structure files, write imports and exports, follow commit message conventions, and understand the project's approach to testing. This guide will help you contribute code that aligns with the project's established style and workflows.

## Coding Conventions

### File Naming
- Use **camelCase** for file names.
  - Example: `userProfile.ts`, `dataManager.ts`

### Import Style
- Use **relative imports** for referencing modules within the project.
  - Example:
    ```typescript
    import { fetchData } from './apiClient';
    ```

### Export Style
- Use **named exports** instead of default exports.
  - Example:
    ```typescript
    // In dataManager.ts
    export function saveData(data: any) { ... }
    export const DATA_LIMIT = 100;

    // In another file
    import { saveData, DATA_LIMIT } from './dataManager';
    ```

### Commit Messages
- Use the `feat` prefix for new features.
- Commit messages are concise, averaging around 23 characters.
  - Example: `feat: add user login`

## Workflows

_No automated workflows detected in this repository._

## Testing Patterns

- **Test Framework:** Not explicitly detected.
- **Test File Pattern:** All test files follow the `*.test.*` naming convention.
  - Example: `userProfile.test.ts`
- **Test Location:** Tests are typically located alongside the files they test or in a dedicated test directory.

#### Example Test File
```typescript
// userProfile.test.ts
import { getUserProfile } from './userProfile';

describe('getUserProfile', () => {
  it('returns user data for valid ID', () => {
    // test implementation
  });
});
```

## Commands
| Command | Purpose |
|---------|---------|
| /test   | Run all test files matching `*.test.*` |
| /lint   | Lint the codebase according to project conventions |
| /commit | Make a commit following the `feat` prefix and concise message style |
```
