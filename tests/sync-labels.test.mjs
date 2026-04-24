// Tests for planLabelChanges — pure label-reconciliation logic, no network.
// The GitHub API wrappers (addLabels / removeLabel / createLabel) are
// intentionally not exercised here.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { planLabelChanges } from '../js/api.js';

// Helper — sort arrays in results for stable comparisons.
function plan(...args) {
  const r = planLabelChanges(...args);
  return { toAdd: [...r.toAdd].sort(), toRemove: [...r.toRemove].sort() };
}

// ─── No-op cases ──────────────────────────────────────────────────────────────

test('already in sync → empty plan', () => {
  const current = ['status:rnd-in-progress', 'blocked-by:rnd-zones', 'testnet v0.2', 'developer'];
  const result = plan(current, 'status:rnd-in-progress', ['blocked-by:rnd-zones']);
  assert.deepEqual(result, { toAdd: [], toRemove: [] });
});

test('already in sync (multiple blocked-by) → empty plan', () => {
  const current = ['status:rnd-in-progress', 'blocked-by:rnd-zones', 'blocked-by:legal'];
  const result = plan(current, 'status:rnd-in-progress', ['blocked-by:rnd-zones']);
  assert.deepEqual(result, { toAdd: [], toRemove: [] }, 'external blocker blocked-by:legal must be preserved');
});

// ─── Add missing lifecycle labels ─────────────────────────────────────────────

test('no labels present → add status + blocked-by', () => {
  const result = plan([], 'status:confirm-roadmap', ['blocked-by:rnd']);
  assert.deepEqual(result, {
    toAdd: ['blocked-by:rnd', 'status:confirm-roadmap'],
    toRemove: [],
  });
});

test('only unrelated labels present → add both lifecycle labels', () => {
  const result = plan(['testnet v0.1', 'gui user'], 'status:confirm-date', ['blocked-by:rnd-core']);
  assert.deepEqual(result, {
    toAdd: ['blocked-by:rnd-core', 'status:confirm-date'],
    toRemove: [],
  });
});

// ─── Remove stale lifecycle labels ────────────────────────────────────────────

test('wrong status:* label present → swap to desired', () => {
  const result = plan(
    ['status:confirm-roadmap', 'blocked-by:rnd'],
    'status:rnd-in-progress',
    ['blocked-by:rnd-core'],
  );
  assert.deepEqual(result, {
    toAdd:    ['blocked-by:rnd-core', 'status:rnd-in-progress'],
    toRemove: ['blocked-by:rnd', 'status:confirm-roadmap'],
  });
});

test('multiple status:* labels (bug state) → keep desired, remove others', () => {
  const result = plan(
    ['status:confirm-roadmap', 'status:rnd-in-progress', 'blocked-by:rnd-zones'],
    'status:rnd-in-progress',
    ['blocked-by:rnd-zones'],
  );
  assert.deepEqual(result, { toAdd: [], toRemove: ['status:confirm-roadmap'] });
});

test('stale lifecycle blocked-by:* is removed', () => {
  const result = plan(
    ['status:doc-packet-delivered', 'blocked-by:rnd-zones', 'blocked-by:docs'],
    'status:doc-packet-delivered',
    ['blocked-by:docs'],
  );
  assert.deepEqual(result, { toAdd: [], toRemove: ['blocked-by:rnd-zones'] });
});

// ─── Preserve external blockers ───────────────────────────────────────────────

test('external blocker blocked-by:<x> is never removed', () => {
  const result = plan(
    ['status:rnd-in-progress', 'blocked-by:rnd-zones', 'blocked-by:legal', 'blocked-by:security'],
    'status:doc-packet-delivered',
    ['blocked-by:docs'],
  );
  assert.ok(!result.toRemove.includes('blocked-by:legal'),    'external blocker must not be removed');
  assert.ok(!result.toRemove.includes('blocked-by:security'), 'external blocker must not be removed');
  assert.ok(result.toRemove.includes('blocked-by:rnd-zones'), 'stale lifecycle label must be removed');
  assert.ok(result.toAdd.includes('blocked-by:docs'));
});

// ─── Legacy action:* removal ──────────────────────────────────────────────────

test('legacy action:rnd on issue is removed', () => {
  const result = plan(
    ['action:rnd', 'testnet v0.2'],
    'status:confirm-roadmap',
    ['blocked-by:rnd'],
  );
  assert.ok(result.toRemove.includes('action:rnd'));
  assert.ok(result.toAdd.includes('status:confirm-roadmap'));
  assert.ok(result.toAdd.includes('blocked-by:rnd'));
});

test('all three legacy action:* labels removed at once', () => {
  const result = plan(
    ['action:rnd', 'action:docs', 'action:red-team', 'status:completed'],
    'status:completed',
    [],
  );
  assert.deepEqual(result.toRemove.sort(), ['action:docs', 'action:red-team', 'action:rnd']);
  assert.deepEqual(result.toAdd, []);
});

// ─── Legacy blocked:<team> → blocked-by:<team> migration ──────────────────────

test('blocked:legal migrated to blocked-by:legal', () => {
  const result = plan(
    ['blocked:legal', 'status:confirm-roadmap', 'blocked-by:rnd'],
    'status:confirm-roadmap',
    ['blocked-by:rnd'],
  );
  assert.ok(result.toAdd.includes('blocked-by:legal'));
  assert.ok(result.toRemove.includes('blocked:legal'));
});

test('blocked:legal migrates, does not reappear in both sets (de-dupe)', () => {
  const result = planLabelChanges(
    ['blocked:legal'],
    'status:confirm-roadmap',
    ['blocked-by:rnd'],
  );
  assert.ok(!result.toRemove.includes('blocked-by:legal'));
  assert.ok(!result.toAdd.includes('blocked:legal'));
});

test('blocked-by:legal already present → do not re-add during migration', () => {
  const result = plan(
    ['blocked:legal', 'blocked-by:legal', 'status:confirm-roadmap', 'blocked-by:rnd'],
    'status:confirm-roadmap',
    ['blocked-by:rnd'],
  );
  // The old label is still removed, but we don't duplicate the add.
  assert.ok(result.toRemove.includes('blocked:legal'));
  const addsOfLegal = result.toAdd.filter(l => l === 'blocked-by:legal');
  assert.equal(addsOfLegal.length, 0, 'should not re-add when target already exists');
});

// ─── De-dup invariant ─────────────────────────────────────────────────────────

test('no label appears in both toAdd and toRemove', () => {
  const result = plan(
    ['action:rnd', 'blocked:zones', 'status:confirm-roadmap', 'blocked-by:rnd'],
    'status:rnd-in-progress',
    ['blocked-by:rnd-zones'],
  );
  const overlap = result.toAdd.filter(l => result.toRemove.includes(l));
  assert.deepEqual(overlap, []);
});

// ─── End-to-end combinations ──────────────────────────────────────────────────

test('full migration: legacy action:* + blocked:<team> + stale status → fresh state', () => {
  const current = [
    'action:rnd',            // legacy — remove
    'blocked:legal',         // legacy — migrate
    'status:confirm-roadmap',// stale — remove
    'blocked-by:rnd',        // stale generic rnd — remove (replaced by rnd-zones)
    'testnet v0.2',          // unrelated — keep
  ];
  const result = plan(current, 'status:rnd-in-progress', ['blocked-by:rnd-zones']);
  assert.deepEqual(result, {
    toAdd: ['blocked-by:legal', 'blocked-by:rnd-zones', 'status:rnd-in-progress'],
    toRemove: ['action:rnd', 'blocked-by:rnd', 'blocked:legal', 'status:confirm-roadmap'],
  });
});

test('completed status → no blocked-by labels desired, stale ones removed', () => {
  const result = plan(
    ['status:doc-merged', 'blocked-by:red-team', 'testnet v0.3'],
    'status:completed',
    [],
  );
  assert.deepEqual(result, {
    toAdd:    ['status:completed'],
    toRemove: ['blocked-by:red-team', 'status:doc-merged'],
  });
});
