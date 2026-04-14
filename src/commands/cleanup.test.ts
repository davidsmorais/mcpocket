/**
 * Unit tests for cleanup command core logic.
 * Run with: npm test
 *
 * Uses Node.js built-in test runner (requires Node >= 18).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { matchesGlob, computeFilesToKeep, listPocketFiles } from './cleanup.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// ── matchesGlob ───────────────────────────────────────────────────────────────

describe('matchesGlob', () => {
  it('matches exact relative path', () => {
    assert.ok(matchesGlob('agents/my-agent.md', 'agents/my-agent.md'));
  });

  it('does not match a different file in same directory', () => {
    assert.ok(!matchesGlob('agents/other.md', 'agents/my-agent.md'));
  });

  it('matches wildcard * within a segment', () => {
    assert.ok(matchesGlob('agents/my-agent.md', 'agents/*.md'));
    assert.ok(!matchesGlob('skills/my-skill.md', 'agents/*.md'));
  });

  it('matches ** across segments', () => {
    assert.ok(matchesGlob('agents/sub/deep.md', 'agents/**'));
    assert.ok(matchesGlob('skills/nested/file.js', '**/*.js'));
  });

  it('matches trailing slash as directory prefix', () => {
    assert.ok(matchesGlob('agents/foo.md', 'agents/'));
    assert.ok(matchesGlob('agents/sub/bar.md', 'agents/'));
    assert.ok(!matchesGlob('skills/foo.md', 'agents/'));
  });

  it('matches basename-only pattern against basename and full path', () => {
    assert.ok(matchesGlob('agents/foo.md', '*.md'));
    assert.ok(matchesGlob('foo.md', '*.md'));
    assert.ok(!matchesGlob('agents/foo.ts', '*.md'));
  });

  it('matches exact top-level file', () => {
    assert.ok(matchesGlob('mcp-config.json', 'mcp-config.json'));
    assert.ok(!matchesGlob('other.json', 'mcp-config.json'));
  });
});

// ── computeFilesToKeep ────────────────────────────────────────────────────────

const SAMPLE_FILES = [
  'mcp-config.json',
  'agents/agent1.md',
  'agents/agent2.md',
  'skills/skill1.js',
  'skills/nested/util.js',
  'plugins/installed_plugins.json',
];

describe('computeFilesToKeep', () => {
  it('returns all files when no patterns are given', () => {
    const kept = computeFilesToKeep(SAMPLE_FILES);
    assert.deepEqual(kept, SAMPLE_FILES);
  });

  it('applies include whitelist — only matching files are kept', () => {
    const kept = computeFilesToKeep(SAMPLE_FILES, ['agents/']);
    assert.deepEqual(kept, ['agents/agent1.md', 'agents/agent2.md']);
  });

  it('applies exclude blacklist — matching files are removed', () => {
    const kept = computeFilesToKeep(SAMPLE_FILES, undefined, ['agents/']);
    assert.ok(!kept.includes('agents/agent1.md'));
    assert.ok(!kept.includes('agents/agent2.md'));
    assert.ok(kept.includes('mcp-config.json'));
  });

  it('combines include and exclude: include narrows, exclude removes from result', () => {
    // Include skills/, then exclude the nested sub-directory
    const kept = computeFilesToKeep(SAMPLE_FILES, ['skills/'], ['skills/nested/**']);
    assert.deepEqual(kept, ['skills/skill1.js']);
  });

  it('exclude is applied after include — file matching both is removed', () => {
    // Include agents/*.md, exclude a specific agent
    const kept = computeFilesToKeep(SAMPLE_FILES, ['agents/'], ['agents/agent2.md']);
    assert.deepEqual(kept, ['agents/agent1.md']);
  });

  it('handles empty include array as "no filter"', () => {
    const kept = computeFilesToKeep(SAMPLE_FILES, []);
    assert.deepEqual(kept, SAMPLE_FILES);
  });

  it('handles empty exclude array as "remove nothing"', () => {
    const kept = computeFilesToKeep(SAMPLE_FILES, undefined, []);
    assert.deepEqual(kept, SAMPLE_FILES);
  });

  it('include with no matches keeps nothing', () => {
    const kept = computeFilesToKeep(SAMPLE_FILES, ['nonexistent/']);
    assert.deepEqual(kept, []);
  });

  it('exclude matching all files keeps nothing', () => {
    const kept = computeFilesToKeep(SAMPLE_FILES, undefined, ['**']);
    assert.deepEqual(kept, []);
  });
});

// ── listPocketFiles ───────────────────────────────────────────────────────────

describe('listPocketFiles', () => {
  it('returns empty array for a non-existent directory', () => {
    const nonExistent = path.join(os.tmpdir(), '__nonexistent_mcpocket_test__');
    const result = listPocketFiles(nonExistent);
    assert.deepEqual(result, []);
  });

  it('lists files recursively, excluding .git', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpocket-cleanup-test-'));
    try {
      fs.mkdirSync(path.join(tmpDir, '.git'));
      fs.writeFileSync(path.join(tmpDir, '.git', 'config'), '');
      fs.mkdirSync(path.join(tmpDir, 'agents'));
      fs.writeFileSync(path.join(tmpDir, 'agents', 'foo.md'), '');
      fs.writeFileSync(path.join(tmpDir, 'mcp-config.json'), '{}');

      const files = listPocketFiles(tmpDir);
      assert.ok(files.includes('agents/foo.md'), 'should include agents/foo.md');
      assert.ok(files.includes('mcp-config.json'), 'should include mcp-config.json');
      assert.ok(!files.some((f) => f.startsWith('.git')), 'should exclude .git');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns sorted results', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpocket-cleanup-test-'));
    try {
      fs.writeFileSync(path.join(tmpDir, 'b.md'), '');
      fs.writeFileSync(path.join(tmpDir, 'a.md'), '');
      const files = listPocketFiles(tmpDir);
      assert.deepEqual(files, ['a.md', 'b.md']);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
