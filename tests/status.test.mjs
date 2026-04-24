// Lifecycle status computation + label derivation.
// Parser-level cases live in markdown.test.mjs; this file drives the state
// machine end-to-end via parsed bodies.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  extractRnD, extractDocPacket, extractDocumentation, extractRedTeam,
  computeStatus, computeDesiredLabels,
} from '../js/markdown.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(join(__dirname, 'fixtures', name), 'utf8');

function statusFor(body, { docsPrRef = null, redTeamRef = null, allMilestonesDone = false, today } = {}) {
  const rnd = extractRnD(body);
  const docPacketLink = extractDocPacket(body);
  const { pr: docsPr } = extractDocumentation(body);
  const { tracking: redTeamLink } = extractRedTeam(body);
  return computeStatus({ rnd, docPacketLink, docsPr, docsPrRef, redTeamLink, redTeamRef, allMilestonesDone, today });
}

function labelsFor(body, opts = {}) {
  const status = statusFor(body, opts);
  const rnd = extractRnD(body);
  return { status, ...computeDesiredLabels(status, rnd.team) };
}

// Fixed "today" so date-based tests don't drift.
const today = new Date(2026, 5, 1); // 2026-06-01

// ─── Phase-by-phase via hand-written bodies ───────────────────────────────────

const empty = `## R&D
- team:
- milestone:
- date:

## Doc Packet
- link:

## Documentation
- tracking:
- pr:

## Red Team
- tracking:`;

const teamOnly = empty.replace('- team:', '- team: zones');

const teamAndMilestone = `## R&D
- team: blockchain
- milestone: https://roadmap.logos.co/x/y
- date:

## Doc Packet
- link:

## Documentation
- tracking:
- pr:

## Red Team
- tracking:`;

const pastDate = `## R&D
- team: core
- milestone: https://roadmap.logos.co/x/y
- date: 15Jan20

## Doc Packet
- link:

## Documentation
- tracking:
- pr:

## Red Team
- tracking:`;

const futureDate = pastDate.replace('15Jan20', '15Dec99');

const docPacketOnly = `## R&D
- team: core
- milestone: https://roadmap.logos.co/x/y
- date: 15Jan99

## Doc Packet
- link: https://github.com/logos-co/logos-docs/issues/1

## Documentation
- tracking:
- pr:

## Red Team
- tracking:`;

const docPrOpen = `## R&D
- team: core
- milestone: https://roadmap.logos.co/x/y
- date: 15Jan99

## Doc Packet
- link: https://github.com/logos-co/logos-docs/issues/1

## Documentation
- tracking: https://github.com/logos-co/logos-docs/issues/2
- pr: https://github.com/logos-co/logos-docs/pull/3

## Red Team
- tracking: https://github.com/logos-co/ecosystem/issues/10`;

test('empty body → confirm-roadmap, blocked-by:rnd', () => {
  const { status, blockedBy } = labelsFor(empty, { today });
  assert.equal(status, 'status:confirm-roadmap');
  assert.deepEqual(blockedBy, ['blocked-by:rnd']);
});

test('team set but no milestone → confirm-roadmap, blocked-by:rnd-<team>', () => {
  const { status, blockedBy } = labelsFor(teamOnly, { today });
  assert.equal(status, 'status:confirm-roadmap');
  assert.deepEqual(blockedBy, ['blocked-by:rnd-zones']);
});

test('team + milestone but no date → confirm-date', () => {
  const { status, blockedBy } = labelsFor(teamAndMilestone, { today });
  assert.equal(status, 'status:confirm-date');
  assert.deepEqual(blockedBy, ['blocked-by:rnd-blockchain']);
});

test('date in future → rnd-in-progress', () => {
  const { status, blockedBy } = labelsFor(futureDate, { today });
  assert.equal(status, 'status:rnd-in-progress');
  assert.deepEqual(blockedBy, ['blocked-by:rnd-core']);
});

test('date in past, milestones not all done → rnd-overdue', () => {
  const { status } = labelsFor(pastDate, { today });
  assert.equal(status, 'status:rnd-overdue');
});

test('all milestones done → waiting-for-doc-packet (regardless of date)', () => {
  const { status, blockedBy } = labelsFor(pastDate, { today, allMilestonesDone: true });
  assert.equal(status, 'status:waiting-for-doc-packet');
  assert.deepEqual(blockedBy, ['blocked-by:rnd-core']);
});

test('doc packet set, no doc PR → doc-packet-delivered, blocked-by:docs', () => {
  const { status, blockedBy } = labelsFor(docPacketOnly, { today });
  assert.equal(status, 'status:doc-packet-delivered');
  assert.deepEqual(blockedBy, ['blocked-by:docs']);
});

test('doc PR open → doc-ready-for-review, blocked-by:red-team + blocked-by:rnd-<team>', () => {
  const { status, blockedBy } = labelsFor(docPrOpen, { docsPrRef: { state: 'open' }, today });
  assert.equal(status, 'status:doc-ready-for-review');
  assert.deepEqual(blockedBy.sort(), ['blocked-by:red-team', 'blocked-by:rnd-core']);
});

test('doc PR merged + red team tracking still open → doc-merged', () => {
  const { status, blockedBy } = labelsFor(docPrOpen, {
    docsPrRef: { state: 'merged' },
    redTeamRef: { type: 'issue', state: 'open' },
    today,
  });
  assert.equal(status, 'status:doc-merged');
  assert.deepEqual(blockedBy, ['blocked-by:red-team']);
});

test('doc PR merged + red team tracking closed → completed', () => {
  const { status, blockedBy } = labelsFor(docPrOpen, {
    docsPrRef: { state: 'merged' },
    redTeamRef: { type: 'issue', state: 'closed' },
    today,
  });
  assert.equal(status, 'status:completed');
  assert.deepEqual(blockedBy, []);
});

test('doc PR merged + no red team tracking → completed', () => {
  const noRT = docPrOpen.replace(/## Red Team\n- tracking:.*$/m, '## Red Team\n- tracking:');
  const { status, blockedBy } = labelsFor(noRT, { docsPrRef: { state: 'merged' }, today });
  assert.equal(status, 'status:completed');
  assert.deepEqual(blockedBy, []);
});

test('unknown team name → blocked-by:rnd (generic fallback)', () => {
  const body = teamOnly.replace('- team: zones', '- team: made-up-team');
  const { blockedBy } = labelsFor(body, { today });
  assert.deepEqual(blockedBy, ['blocked-by:rnd']);
});

// ─── Regression tests keyed to real issues ────────────────────────────────────

test('regression #31: doc packet + open doc PR with empty milestones → doc-ready-for-review', () => {
  // #31 has `- milestone:` empty — downstream phases must take precedence over
  // the R&D validity guard, otherwise the status collapses back to confirm-roadmap.
  const body = fixture('issue-31.md');
  const { status, blockedBy } = labelsFor(body, { docsPrRef: { state: 'open' }, today });
  assert.equal(status, 'status:doc-ready-for-review',
    'downstream phases must win over R&D validity checks');
  assert.deepEqual(blockedBy.sort(), ['blocked-by:red-team', 'blocked-by:rnd-core']);
});

test('fixture issue-7: doc packet link present, no doc PR → doc-packet-delivered', () => {
  const body = fixture('issue-7.md');
  const { status, blockedBy } = labelsFor(body, { today });
  assert.equal(status, 'status:doc-packet-delivered');
  assert.deepEqual(blockedBy, ['blocked-by:docs']);
});

test('fixture issue-47: doc packet link present, no doc PR → doc-packet-delivered', () => {
  const body = fixture('issue-47.md');
  const { status, blockedBy } = labelsFor(body, { today });
  assert.equal(status, 'status:doc-packet-delivered');
  assert.deepEqual(blockedBy, ['blocked-by:docs']);
});
