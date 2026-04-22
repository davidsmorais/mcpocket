/**
 * Unit tests for directory detection and project configuration.
 * Run with: npm test
 *
 * Uses Node.js built-in test runner (requires Node >= 18).
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  projectConfigExists,
  readProjectConfig,
  writeProjectConfig,
  discoverProjectFiles,
  copyProjectFilesToPocket,
  copyProjectFilesFromPocket,
  PROJECT_CONFIG_FILENAME,
} from './project.js';

let originalCwd: string;
let tempDir: string;

beforeEach(() => {
  originalCwd = process.cwd();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpocket-project-test-'));
  process.chdir(tempDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

// ── projectConfigExists ───────────────────────────────────────────────────────

describe('projectConfigExists', () => {
  it('returns false when config file does not exist', () => {
    assert.strictEqual(projectConfigExists(), false);
  });

  it('returns true when config file exists', () => {
    fs.writeFileSync(path.join(tempDir, PROJECT_CONFIG_FILENAME), '{}');
    assert.strictEqual(projectConfigExists(), true);
  });
});

// ── readProjectConfig / writeProjectConfig ────────────────────────────────────────

describe('readProjectConfig and writeProjectConfig', () => {
  it('round-trips a project config', () => {
    const original: { projectName: string; files: string[] } = {
      projectName: 'my-project',
      files: ['CLAUDE.md', '.cursorrules'],
    };

    writeProjectConfig(original);
    const read = readProjectConfig();

    assert.deepStrictEqual(read, original);
  });

  it('throws when reading non-existent config', () => {
    assert.throws(() => {
      readProjectConfig();
    }, /No project config found/);
  });

  it('overwrites existing config', () => {
    writeProjectConfig({ projectName: 'first', files: ['a.md'] });
    writeProjectConfig({ projectName: 'second', files: ['b.md'] });

    const read = readProjectConfig();
    assert.strictEqual(read.projectName, 'second');
    assert.deepStrictEqual(read.files, ['b.md']);
  });
});

// ── discoverProjectFiles ───────────────────────────────────────────────────────────────

describe('discoverProjectFiles', () => {
  it('returns empty array when no known AI files exist', () => {
    const files = discoverProjectFiles();
    assert.deepStrictEqual(files, []);
  });

  it('finds known top-level AI config files', () => {
    fs.writeFileSync('CLAUDE.md', '# Hello');
    fs.writeFileSync('.cursorrules', 'rules');

    const files = discoverProjectFiles();
    assert.ok(files.includes('CLAUDE.md'));
    assert.ok(files.includes('.cursorrules'));
  });

  it('excludes hidden files and directories', () => {
    fs.writeFileSync('.hidden', 'hidden');

    const files = discoverProjectFiles();
    assert.ok(!files.some((f) => f.includes('.hidden')));
  });

  it('excludes node_modules', () => {
    fs.mkdirSync('node_modules/my-package', { recursive: true });
    fs.writeFileSync('node_modules/my-package/index.js', 'require()');

    const files = discoverProjectFiles();
    assert.ok(!files.some((f) => f.includes('node_modules')));
  });

  it('excludes .git', () => {
    fs.mkdirSync('.git', { recursive: true });
    fs.writeFileSync('.git/config', 'git config');

    const files = discoverProjectFiles();
    assert.ok(!files.some((f) => f.includes('.git')));
  });

  it('returns sorted results', () => {
    fs.writeFileSync('AGENTS.md', '# Agents');
    fs.writeFileSync('GEMINI.md', '# Gemini');

    const files = discoverProjectFiles();
    assert.deepStrictEqual(files, ['AGENTS.md', 'GEMINI.md']);
  });
});

// ── copyProjectFilesToPocket ────────────────────────────────────────────────────

describe('copyProjectFilesToPocket', () => {
  let pocketDir: string;

  beforeEach(() => {
    pocketDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpocket-pocket-'));
  });

  afterEach(() => {
    fs.rmSync(pocketDir, { recursive: true, force: true });
  });

  it('copies files into pocket directory with project prefix', () => {
    fs.writeFileSync('CLAUDE.md', '# My project');

    const copied = copyProjectFilesToPocket('my-project', ['CLAUDE.md'], pocketDir);

    assert.deepStrictEqual(copied, ['my-project/CLAUDE.md']);
    const destContent = fs.readFileSync(path.join(pocketDir, 'my-project/CLAUDE.md'), 'utf8');
    assert.strictEqual(destContent, '# My project');
  });

  it('skips files that do not exist', () => {
    const copied = copyProjectFilesToPocket('my-project', ['nonexistent.md'], pocketDir);

    assert.deepStrictEqual(copied, []);
  });

  it('creates nested directories in pocket', () => {
    fs.mkdirSync('.claude/agents', { recursive: true });
    fs.writeFileSync('.claude/agents/test.md', 'agent');

    const copied = copyProjectFilesToPocket('proj', ['.claude/agents/test.md'], pocketDir);

    assert.strictEqual(copied.length, 1);
    assert.ok(copied[0].startsWith('proj'));
  });

  it('copies multiple files', () => {
    fs.writeFileSync('CLAUDE.md', '# Claude');
    fs.writeFileSync('.cursorrules', 'rules');

    const copied = copyProjectFilesToPocket('proj', ['CLAUDE.md', '.cursorrules'], pocketDir);

    assert.strictEqual(copied.length, 2);
    assert.ok(copied.includes('proj/CLAUDE.md'));
    assert.ok(copied.includes('proj/.cursorrules'));
  });
});

// ── copyProjectFilesFromPocket ──────────────────────────────────────────────

describe('copyProjectFilesFromPocket', () => {
  let pocketDir: string;

  beforeEach(() => {
    pocketDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpocket-pocket-'));
  });

  afterEach(() => {
    fs.rmSync(pocketDir, { recursive: true, force: true });
  });

  it('copies files from pocket to current directory', () => {
    fs.mkdirSync(path.join(pocketDir, 'my-project'), { recursive: true });
    fs.writeFileSync(path.join(pocketDir, 'my-project/CLAUDE.md'), '# Project');

    const count = copyProjectFilesFromPocket('my-project', ['my-project/CLAUDE.md'], pocketDir);

    assert.strictEqual(count, 1);
    assert.ok(fs.existsSync('CLAUDE.md'));
    assert.strictEqual(fs.readFileSync('CLAUDE.md', 'utf8'), '# Project');
  });

  it('handles both forward slash and OS-specific separators', () => {
    fs.mkdirSync(path.join(pocketDir, 'my-project'), { recursive: true });
    fs.writeFileSync(path.join(pocketDir, 'my-project/CLAUDE.md'), '# Separators test');

    // Test with path.join format (on Unix /, on Windows \)
    const pocketRelPath = path.join('my-project', 'CLAUDE.md');
    copyProjectFilesFromPocket('my-project', [pocketRelPath], pocketDir);

    assert.ok(fs.existsSync('CLAUDE.md'));
  });

  it('skips files that do not exist in pocket', () => {
    const count = copyProjectFilesFromPocket('my-project', ['missing.md'], pocketDir);

    assert.strictEqual(count, 0);
  });

  it('creates nested directories locally', () => {
    fs.mkdirSync(path.join(pocketDir, 'proj/.claude/agents'), { recursive: true });
    fs.writeFileSync(path.join(pocketDir, 'proj/.claude/agents/test.md'), 'nested');

    const count = copyProjectFilesFromPocket('proj', ['proj/.claude/agents/test.md'], pocketDir);

    assert.strictEqual(count, 1);
    assert.ok(fs.existsSync('.claude/agents/test.md'));
  });
});