/**
 * Unit tests for pocket de-duplication logic.
 * Run with: npm test
 *
 * Uses Node.js built-in test runner (requires Node >= 18).
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { prunePocketDir, MANAGED_POCKET_TOP_LEVEL } from './pocket.js';

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpocket-pocket-test-'));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

// ── prunePocketDir ───────────────────────────────────────────────────────────────

describe('prunePocketDir', () => {
  it('returns 0 for non-existent directory', () => {
    const result = prunePocketDir(path.join(os.tmpdir(), '__nonexistent_mcpocket__'));
    assert.strictEqual(result, 0);
  });

  it('removes unmanaged top-level directories', () => {
    fs.mkdirSync(path.join(tempDir, 'agents'));
    fs.mkdirSync(path.join(tempDir, 'skills'));
    fs.mkdirSync(path.join(tempDir, 'stale-dir-1'));
    fs.mkdirSync(path.join(tempDir, 'stale-dir-2'));

    const removed = prunePocketDir(tempDir);

    assert.strictEqual(removed, 2);
    assert.ok(fs.existsSync(path.join(tempDir, 'agents')));
    assert.ok(fs.existsSync(path.join(tempDir, 'skills')));
    assert.ok(!fs.existsSync(path.join(tempDir, 'stale-dir-1')));
    assert.ok(!fs.existsSync(path.join(tempDir, 'stale-dir-2')));
  });

  it('keeps managed directories from MANAGED_POCKET_TOP_LEVEL', () => {
    for (const name of MANAGED_POCKET_TOP_LEVEL) {
      if (name === '.git') {
        continue;
      }
      fs.mkdirSync(path.join(tempDir, name), { recursive: true });
    }

    const removed = prunePocketDir(tempDir);

    assert.strictEqual(removed, 0);
    for (const name of MANAGED_POCKET_TOP_LEVEL) {
      if (name === '.git') continue;
      assert.ok(fs.existsSync(path.join(tempDir, name)), `Should keep ${name}`);
    }
  });

  it('removes unmanaged files at top level', () => {
    fs.writeFileSync(path.join(tempDir, 'mcp-config.json'), '{}');
    fs.writeFileSync(path.join(tempDir, 'random-file.txt'), 'data');
    fs.writeFileSync(path.join(tempDir, 'stale.log'), 'log');

    const removed = prunePocketDir(tempDir);

    assert.strictEqual(removed, 2);
    assert.ok(fs.existsSync(path.join(tempDir, 'mcp-config.json')));
    assert.ok(!fs.existsSync(path.join(tempDir, 'random-file.txt')));
    assert.ok(!fs.existsSync(path.join(tempDir, 'stale.log')));
  });

  it('only removes top-level entries, not nested', () => {
    fs.mkdirSync(path.join(tempDir, 'agents'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'agents/subdir'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'agents/agent.md'), 'agent');
    fs.writeFileSync(path.join(tempDir, 'agents/nested-stale'), 'should stay');
    fs.mkdirSync(path.join(tempDir, 'stale-dir'), { recursive: true });

    prunePocketDir(tempDir);

    assert.ok(fs.existsSync(path.join(tempDir, 'agents/agent.md')));
    assert.ok(fs.existsSync(path.join(tempDir, 'agents/subdir')));
    assert.ok(!fs.existsSync(path.join(tempDir, 'stale-dir')));
  });

  it('returns count of removed entries', () => {
    fs.mkdirSync(path.join(tempDir, 'dir1'));
    fs.mkdirSync(path.join(tempDir, 'dir2'));
    fs.mkdirSync(path.join(tempDir, 'dir3'));
    fs.writeFileSync(path.join(tempDir, 'file1.txt'), '1');
    fs.writeFileSync(path.join(tempDir, 'file2.txt'), '2');

    const removed = prunePocketDir(tempDir);

    assert.strictEqual(removed, 5);
  });
});