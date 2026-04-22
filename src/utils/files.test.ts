/**
 * Unit tests for file mirroring utilities.
 * Run with: npm test
 *
 * Uses Node.js built-in test runner (requires Node >= 18).
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { mirrorDirectory, mirrorFileMapToDir, pruneDirectoryTopLevel } from './files.js';

let sourceDir: string;
let destDir: string;
let tempDir: string;

beforeEach(() => {
  sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpocket-mirror-src-'));
  destDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpocket-mirror-dst-'));
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpocket-prune-'));
});

afterEach(() => {
  fs.rmSync(sourceDir, { recursive: true, force: true });
  fs.rmSync(destDir, { recursive: true, force: true });
});

// ── mirrorDirectory ───────────────────────────────────────────────────────────────

describe('mirrorDirectory', () => {
  it('mirrors files from source to dest', () => {
    fs.writeFileSync(path.join(sourceDir, 'a.txt'), 'a content');
    fs.writeFileSync(path.join(sourceDir, 'b.txt'), 'b content');

    const result = mirrorDirectory(sourceDir, destDir);

    assert.strictEqual(result.synced, 2);
    assert.strictEqual(result.removed, 0);
    assert.strictEqual(fs.readFileSync(path.join(destDir, 'a.txt'), 'utf8'), 'a content');
    assert.strictEqual(fs.readFileSync(path.join(destDir, 'b.txt'), 'utf8'), 'b content');
  });

  it('mirrors nested directories', () => {
    fs.mkdirSync(path.join(sourceDir, 'subdir'), { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'subdir/nested.txt'), 'nested');

    mirrorDirectory(sourceDir, destDir);

    assert.ok(fs.existsSync(path.join(destDir, 'subdir/nested.txt')));
  });

  it('removes files from dest not in source', () => {
    fs.writeFileSync(path.join(sourceDir, 'new.txt'), 'new');
    fs.writeFileSync(path.join(destDir, 'old.txt'), 'old');

    const result = mirrorDirectory(sourceDir, destDir);

    assert.strictEqual(result.removed, 1);
    assert.ok(!fs.existsSync(path.join(destDir, 'old.txt')));
  });

  it('respects includeFile filter', () => {
    fs.writeFileSync(path.join(sourceDir, 'include.txt'), 'include');
    fs.writeFileSync(path.join(sourceDir, 'exclude.txt'), 'exclude');

    mirrorDirectory(sourceDir, destDir, {
      includeFile: (relPath) => !relPath.includes('exclude'),
    });

    assert.ok(fs.existsSync(path.join(destDir, 'include.txt')));
    assert.ok(!fs.existsSync(path.join(destDir, 'exclude.txt')));
  });

  it('respects includeDirectory filter', () => {
    fs.mkdirSync(path.join(sourceDir, 'keepdir'));
    fs.mkdirSync(path.join(sourceDir, 'skipdir'));
    fs.writeFileSync(path.join(sourceDir, 'keepdir/file.txt'), 'keep');
    fs.writeFileSync(path.join(sourceDir, 'skipdir/file.txt'), 'skip');

    mirrorDirectory(sourceDir, destDir, {
      includeDirectory: (relPath) => !relPath.includes('skipdir'),
    });

    assert.ok(fs.existsSync(path.join(destDir, 'keepdir/file.txt')));
    assert.ok(!fs.existsSync(path.join(destDir, 'skipdir')));
  });

  it('handles empty source directory', () => {
    const result = mirrorDirectory(sourceDir, destDir);

    assert.strictEqual(result.synced, 0);
    assert.strictEqual(result.removed, 0);
  });

  it('handles non-existent source directory', () => {
    const nonExistent = path.join(os.tmpdir(), '__nonexistent_mcpocket_src__');
    const result = mirrorDirectory(nonExistent, destDir);

    assert.strictEqual(result.synced, 0);
    assert.strictEqual(result.removed, 0);
  });

  it('updates existing files', () => {
    fs.writeFileSync(path.join(sourceDir, 'file.txt'), 'updated');
    fs.writeFileSync(path.join(destDir, 'file.txt'), 'original');

    mirrorDirectory(sourceDir, destDir);

    assert.strictEqual(fs.readFileSync(path.join(destDir, 'file.txt'), 'utf8'), 'updated');
  });
});

// ── mirrorFileMapToDir ────────────────────────────────────────────────────────

describe('mirrorFileMapToDir', () => {
  it('writes files from a map to directory', () => {
    const files = {
      'a.txt': 'content a',
      'sub/b.txt': 'content b',
    };

    const result = mirrorFileMapToDir(destDir, files);

    assert.strictEqual(result.synced, 2);
    assert.ok(fs.existsSync(path.join(destDir, 'a.txt')));
    assert.ok(fs.existsSync(path.join(destDir, 'sub/b.txt')));
  });

  it('removes files not in the map', () => {
    fs.writeFileSync(path.join(destDir, 'stale.txt'), 'stale');

    const result = mirrorFileMapToDir(destDir, { 'new.txt': 'new' });

    assert.strictEqual(result.removed, 1);
    assert.ok(!fs.existsSync(path.join(destDir, 'stale.txt')));
  });

  it('respects protectedTopLevelNames', () => {
    fs.mkdirSync(path.join(destDir, 'protected'));
    fs.writeFileSync(path.join(destDir, 'protected/file.txt'), 'protected');
    fs.writeFileSync(path.join(destDir, 'unprotected.txt'), 'to be removed');

    const result = mirrorFileMapToDir(destDir, {}, { protectedTopLevelNames: new Set(['protected']) });

    assert.strictEqual(result.removed, 1);
    assert.ok(fs.existsSync(path.join(destDir, 'protected/file.txt')));
  });

  it('handles empty file map', () => {
    const result = mirrorFileMapToDir(destDir, {});

    assert.strictEqual(result.synced, 0);
  });

  it('normalizes path separators', () => {
    const files = {
      'sub/dir/file.txt': 'content',
    };

    mirrorFileMapToDir(destDir, files);

    assert.ok(fs.existsSync(path.join(destDir, 'sub/dir/file.txt')));
  });
});

// ── pruneDirectoryTopLevel ─────────────────────────────────────────────────────

describe('pruneDirectoryTopLevel', () => {
  it('returns 0 for non-existent directory', () => {
    const nonExistent = path.join(os.tmpdir(), '__nonexistent_mcpocket__');
    const result = pruneDirectoryTopLevel(nonExistent, new Set(['keep']));
    assert.strictEqual(result, 0);
  });

  it('removes top-level entries not in keep set', () => {
    fs.mkdirSync(path.join(tempDir, 'keep1'));
    fs.mkdirSync(path.join(tempDir, 'remove1'));
    fs.writeFileSync(path.join(tempDir, 'keep2'), '');
    fs.writeFileSync(path.join(tempDir, 'remove2'), '');

    const keepSet = new Set(['keep1', 'keep2']);
    const removed = pruneDirectoryTopLevel(tempDir, keepSet);

    assert.strictEqual(removed, 2);
    assert.ok(fs.existsSync(path.join(tempDir, 'keep1')));
    assert.ok(fs.existsSync(path.join(tempDir, 'keep2')));
    assert.ok(!fs.existsSync(path.join(tempDir, 'remove1')));
    assert.ok(!fs.existsSync(path.join(tempDir, 'remove2')));
  });

  it('keeps all entries when all are in keep set', () => {
    fs.mkdirSync(path.join(tempDir, 'dir1'));
    fs.writeFileSync(path.join(tempDir, 'file1'), '');

    const keepSet = new Set(['dir1', 'file1']);
    const removed = pruneDirectoryTopLevel(tempDir, keepSet);

    assert.strictEqual(removed, 0);
  });

  it('handles empty keep set', () => {
    fs.mkdirSync(path.join(tempDir, 'anything'));
    fs.writeFileSync(path.join(tempDir, 'anything.txt'), '');

    const removed = pruneDirectoryTopLevel(tempDir, new Set());

    assert.strictEqual(removed, 2);
    assert.ok(!fs.existsSync(path.join(tempDir, 'anything')));
  });
});