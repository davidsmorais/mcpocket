/**
 * Unit tests for item selection logic.
 * Run with: npm test
 *
 * Tests pure functions from item-select.ts module.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { type SyncItem, type SyncItemKind, hasMcpsInSelection, type ItemFilters } from './item-select.js';

describe('hasMcpsInSelection', () => {
  it('returns true when no filter and mcps exist', () => {
    const filters: ItemFilters = {};
    const available = ['server1', 'server2'];
    assert.strictEqual(hasMcpsInSelection(filters, available), true);
  });

  it('returns false when no filter and no mcps', () => {
    const filters: ItemFilters = {};
    const available: string[] = [];
    assert.strictEqual(hasMcpsInSelection(filters, available), false);
  });

  it('returns true when filter has items', () => {
    const filters: ItemFilters = { mcpNames: new Set(['server1']) };
    const available = ['server1'];
    assert.strictEqual(hasMcpsInSelection(filters, available), true);
  });

  it('returns false when filter set is empty', () => {
    const filters: ItemFilters = { mcpNames: new Set() };
    const available = ['server1'];
    assert.strictEqual(hasMcpsInSelection(filters, available), false);
  });

  it('handles undefined filter', () => {
    const filters: ItemFilters = { mcpNames: undefined };
    const available = ['server1'];
    assert.strictEqual(hasMcpsInSelection(filters, available), true);
  });
});

describe('ItemFilters structure', () => {
  it('accepts various filter combinations', () => {
    const filters: ItemFilters = {
      mcpNames: new Set(['mcp1']),
      agentNames: new Set(['agent1']),
      skillNames: new Set(['skill1']),
      pluginNames: new Set(['plugin1']),
      selectedProviders: new Set(['claude-code']),
    };

    assert.strictEqual(filters.mcpNames?.size, 1);
    assert.strictEqual(filters.agentNames?.size, 1);
    assert.strictEqual(filters.skillNames?.size, 1);
    assert.strictEqual(filters.pluginNames?.size, 1);
    assert.strictEqual(filters.selectedProviders?.size, 1);
  });

  it('allows optional undefined fields', () => {
    const filters: ItemFilters = {};

    assert.strictEqual(filters.mcpNames, undefined);
    assert.strictEqual(filters.agentNames, undefined);
    assert.strictEqual(filters.skillNames, undefined);
  });
});

describe('SyncItem type', () => {
  it('supports agent kind', () => {
    const item: SyncItem = { kind: 'agent', name: 'test-agent' };
    assert.strictEqual(item.kind, 'agent');
  });

  it('supports skill kind', () => {
    const item: SyncItem = { kind: 'skill', name: 'test-skill' };
    assert.strictEqual(item.kind, 'skill');
  });

  it('supports mcp kind', () => {
    const item: SyncItem = { kind: 'mcp', name: 'test-mcp' };
    assert.strictEqual(item.kind, 'mcp');
  });
});