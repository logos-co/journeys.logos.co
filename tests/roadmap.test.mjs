// Tests for the pure roadmap-parsing helpers in js/api.js.
// No network calls — fetchMilestoneProgress itself is not exercised.
// The fixture `roadmap-blockchain.md` is a real capture of
// logos-co/roadmap:content/blockchain/roadmap/index.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { milestoneUrlToPaths, parseMilestoneProgress } from '../js/api.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(join(__dirname, 'fixtures', name), 'utf8');

// ─── milestoneUrlToPaths ──────────────────────────────────────────────────────

test('milestoneUrlToPaths: typical blockchain roadmap URL', () => {
  assert.deepEqual(
    milestoneUrlToPaths('https://roadmap.logos.co/blockchain/roadmap/blockchain_cryptarchia'),
    { parentPath: 'content/blockchain/roadmap/index.md', slug: 'blockchain_cryptarchia' },
  );
});

test('milestoneUrlToPaths: trailing slash is tolerated', () => {
  assert.deepEqual(
    milestoneUrlToPaths('https://roadmap.logos.co/blockchain/roadmap/lez_resilience/'),
    { parentPath: 'content/blockchain/roadmap/index.md', slug: 'lez_resilience' },
  );
});

test('milestoneUrlToPaths: deeper path (area/section/slug)', () => {
  assert.deepEqual(
    milestoneUrlToPaths('https://roadmap.logos.co/zones/v2/roadmap/zones_shard'),
    { parentPath: 'content/zones/v2/roadmap/index.md', slug: 'zones_shard' },
  );
});

test('milestoneUrlToPaths: too-shallow path returns null', () => {
  assert.equal(milestoneUrlToPaths('https://roadmap.logos.co/only-one'), null);
});

test('milestoneUrlToPaths: non-roadmap URL returns null', () => {
  assert.equal(milestoneUrlToPaths('https://github.com/foo/bar'), null);
  assert.equal(milestoneUrlToPaths('https://example.com/roadmap/x/y'), null);
});

test('milestoneUrlToPaths: empty / null input returns null', () => {
  assert.equal(milestoneUrlToPaths(''),   null);
  assert.equal(milestoneUrlToPaths(null), null);
});

// ─── parseMilestoneProgress (hand-written minimal markdown) ───────────────────

const miniParent = `## Testnet v0.1

- [x] [First Thing](./thing_one.md)
- [ ] [Second Thing](./thing_two.md)

## Testnet v0.2

- [ ] [Dotted Slug](./area.with.dots.md)
`;

test('parseMilestoneProgress: checked box → done=true, title captured', () => {
  assert.deepEqual(parseMilestoneProgress(miniParent, 'thing_one'), {
    title: 'First Thing',
    done: true,
  });
});

test('parseMilestoneProgress: unchecked box → done=false', () => {
  assert.deepEqual(parseMilestoneProgress(miniParent, 'thing_two'), {
    title: 'Second Thing',
    done: false,
  });
});

test('parseMilestoneProgress: slug with regex metachars (dots) is escaped', () => {
  // Ensure `.` in the slug doesn't match arbitrary chars.
  assert.deepEqual(parseMilestoneProgress(miniParent, 'area.with.dots'), {
    title: 'Dotted Slug',
    done: false,
  });
});

test('parseMilestoneProgress: unknown slug returns null', () => {
  assert.equal(parseMilestoneProgress(miniParent, 'missing_slug'), null);
});

test('parseMilestoneProgress: empty content returns null', () => {
  assert.equal(parseMilestoneProgress('', 'anything'), null);
  assert.equal(parseMilestoneProgress(null, 'anything'), null);
});

test('parseMilestoneProgress: empty slug returns null', () => {
  assert.equal(parseMilestoneProgress(miniParent, ''), null);
});

// ─── Real roadmap fixture ─────────────────────────────────────────────────────

const roadmap = fixture('roadmap-blockchain.md');

test('roadmap fixture: blockchain_cryptarchia is done', () => {
  assert.deepEqual(parseMilestoneProgress(roadmap, 'blockchain_cryptarchia'), {
    title: 'Blockchain Cryptarchia Implementation',
    done: true,
  });
});

test('roadmap fixture: blockchain_sdp is done', () => {
  const r = parseMilestoneProgress(roadmap, 'blockchain_sdp');
  assert.ok(r, 'should find blockchain_sdp');
  assert.equal(r.done, true);
});

test('roadmap fixture: slug that looks similar but does not exist returns null', () => {
  assert.equal(parseMilestoneProgress(roadmap, 'blockchain_cryptarchia_v2'), null);
});

test('roadmap fixture: slug for not-yet-started milestone parses as unchecked', () => {
  // Scan the fixture for any `- [ ]` line and assert that the corresponding
  // slug parses with done=false. This keeps the test robust against roadmap
  // edits that toggle specific boxes.
  const uncheckedLine = roadmap.split('\n').find(l => /^\s*- \[ \]/.test(l));
  if (!uncheckedLine) return; // fixture has none right now; skip gracefully
  const m = uncheckedLine.match(/\]\(\.\/([^)]+)\.md\)/);
  assert.ok(m, `could not extract slug from: ${uncheckedLine}`);
  const parsed = parseMilestoneProgress(roadmap, m[1]);
  assert.ok(parsed, `expected to parse slug ${m[1]}`);
  assert.equal(parsed.done, false);
});

// ─── End-to-end composition: URL → paths → parsed result ──────────────────────

test('end-to-end: real URL → paths → fixture parse', () => {
  const url = 'https://roadmap.logos.co/blockchain/roadmap/blockchain_cryptarchia';
  const paths = milestoneUrlToPaths(url);
  assert.equal(paths.parentPath, 'content/blockchain/roadmap/index.md');
  const parsed = parseMilestoneProgress(roadmap, paths.slug);
  assert.equal(parsed.done, true);
});
