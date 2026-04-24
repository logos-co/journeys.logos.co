// Smoke tests for the HTML-building render functions.
// These don't assert exact markup — they assert no throw, non-empty output,
// and no unresolved `${…}` or literal `undefined` in the result. That's
// enough to catch rename typos like `${c}` vs `${color}`.
//
// Render functions are string-template factories with no DOM access, but
// they live in modules that transitively import config.js (localStorage).
// We shim localStorage before importing anything, which is why the imports
// are dynamic.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// ── Minimal browser-API shims so the modules can load in Node ───────────────
// config.js uses localStorage at call time; pipeline.js assigns window._* at
// module load time. Shimming both is enough — no JSDOM needed.
const _store = new Map();
globalThis.localStorage = {
  getItem:  (k) => _store.has(k) ? _store.get(k) : null,
  setItem:  (k, v) => _store.set(k, String(v)),
  removeItem: (k) => _store.delete(k),
  clear:    () => _store.clear(),
};
globalThis.window = globalThis;

// Dynamic imports so the shim is installed first.
const { renderStatusBadge, renderBlockedByColumn, STATUS_LABELS } = await import('../js/pipeline.js');
const { renderBlockedByBanner } = await import('../js/detail.js');
const { STATUS_PHASES, LIFECYCLE_BLOCKED_BY } = await import('../js/markdown.js');

/**
 * Common invariants for any HTML produced by our renderers.
 */
function assertWellFormed(html, label) {
  assert.ok(typeof html === 'string',        `${label}: not a string`);
  assert.ok(html.length > 0,                  `${label}: empty string`);
  assert.ok(!/\bundefined\b/.test(html),      `${label}: literal "undefined" in output:\n${html}`);
  assert.ok(!/\$\{[^}]*\}/.test(html),        `${label}: unresolved template expression in output:\n${html}`);
}

function escapeHtmlForAssert(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── renderStatusBadge: every lifecycle phase ────────────────────────────────

for (const phase of STATUS_PHASES) {
  test(`renderStatusBadge(${phase}) produces well-formed HTML`, () => {
    const html = renderStatusBadge(phase);
    assertWellFormed(html, `renderStatusBadge(${phase})`);
    assert.ok(html.includes(escapeHtmlForAssert(STATUS_LABELS[phase])), `missing human label: ${STATUS_LABELS[phase]}`);
  });
}

test('renderStatusBadge(unknown) falls back gracefully (no throw, no undefined)', () => {
  const html = renderStatusBadge('totally-made-up');
  assertWellFormed(html, 'renderStatusBadge(unknown)');
});

// ─── renderBlockedByColumn: each lifecycle blocked-by label + mismatch flag ──

for (const label of LIFECYCLE_BLOCKED_BY) {
  test(`renderBlockedByColumn([${label}]) produces well-formed HTML`, () => {
    const html = renderBlockedByColumn([label], false);
    assertWellFormed(html, `renderBlockedByColumn([${label}])`);
  });
}

test('renderBlockedByColumn([]) with mismatch=true renders warn only', () => {
  const html = renderBlockedByColumn([], true);
  assertWellFormed(html, 'renderBlockedByColumn([], true)');
  assert.ok(html.includes('⚠'), 'expected a warn glyph');
});

test('renderBlockedByColumn([]) with mismatch=false renders nothing meaningful', () => {
  const html = renderBlockedByColumn([], false);
  // Empty string is fine here (no pills, no warn).
  assert.equal(html, '');
});

test('renderBlockedByColumn(multiple labels) renders all pills', () => {
  const html = renderBlockedByColumn(['blocked-by:rnd-zones', 'blocked-by:legal'], false);
  assertWellFormed(html, 'renderBlockedByColumn(multiple)');
  assert.ok(html.includes('zones'));
  assert.ok(html.includes('legal'));
});

// ─── renderBlockedByBanner: every phase × blocked-by combination ─────────────

const bannerCases = [
  { status: 'confirm-roadmap',        blockedBy: ['blocked-by:rnd'],            mismatch: false },
  { status: 'confirm-roadmap',        blockedBy: ['blocked-by:rnd-zones'],      mismatch: false },
  { status: 'confirm-date',           blockedBy: ['blocked-by:rnd-blockchain'], mismatch: false },
  { status: 'rnd-in-progress',        blockedBy: ['blocked-by:rnd-core'],       mismatch: true  },
  { status: 'rnd-overdue',            blockedBy: ['blocked-by:rnd-core'],       mismatch: false },
  { status: 'waiting-for-doc-packet', blockedBy: ['blocked-by:rnd-zones'],      mismatch: false },
  { status: 'doc-packet-delivered',   blockedBy: ['blocked-by:docs'],           mismatch: false },
  { status: 'doc-ready-for-review',   blockedBy: ['blocked-by:red-team', 'blocked-by:rnd-core'], mismatch: false },
  { status: 'doc-merged',             blockedBy: ['blocked-by:red-team'],       mismatch: false },
  { status: 'completed',              blockedBy: [],                            mismatch: false },
];

for (const { status, blockedBy, mismatch } of bannerCases) {
  test(`renderBlockedByBanner(${status}, [${blockedBy.join(',')}]${mismatch ? ', mismatch' : ''})`, () => {
    const html = renderBlockedByBanner(status, blockedBy, mismatch);
    assertWellFormed(html, `renderBlockedByBanner(${status})`);
    assert.ok(html.includes(escapeHtmlForAssert(STATUS_LABELS[status])), `missing status label: ${STATUS_LABELS[status]}`);
    if (mismatch) assert.ok(html.includes('⚠'), 'expected ⚠ when mismatch=true');
  });
}

test('renderBlockedByBanner(completed, []) renders "nobody" placeholder', () => {
  const html = renderBlockedByBanner('completed', [], false);
  assertWellFormed(html, 'renderBlockedByBanner(completed)');
  assert.ok(html.toLowerCase().includes('nobody'), 'expected a "nobody" placeholder when no blockers');
});

test('renderBlockedByBanner handles external blocker mixed with lifecycle label', () => {
  const html = renderBlockedByBanner('rnd-in-progress', ['blocked-by:rnd-zones', 'blocked-by:legal'], false);
  assertWellFormed(html, 'renderBlockedByBanner(mixed)');
  assert.ok(html.includes('zones'));
  assert.ok(html.includes('legal'));
});
