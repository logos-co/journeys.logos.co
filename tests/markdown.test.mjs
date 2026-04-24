// Unit tests for js/markdown.js — parsers, extractors, and date helper.
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  extractRnD, extractDocPacket, extractDocumentation, extractRedTeam,
  extractBlockingTeam, extractExternalBlockedLabels, extractDescription,
  parseJourneyDate,
  LIFECYCLE_BLOCKED_BY, RND_TEAMS, STATUS_PHASES,
} from '../js/markdown.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(join(__dirname, 'fixtures', name), 'utf8');

// ─── extractRnD ───────────────────────────────────────────────────────────────

test('extractRnD: all three fields populated', () => {
  const body = `## R&D
- team: zones
- milestone: https://roadmap.logos.co/x/y
- date: 15Mar26`;
  assert.deepEqual(extractRnD(body), {
    team: 'zones',
    milestones: ['https://roadmap.logos.co/x/y'],
    date: '15Mar26',
  });
});

test('extractRnD: multiple milestones collected in order', () => {
  const body = `## R&D
- team: core
- milestone: https://a
- milestone: https://b
- milestone: https://c
- date: 01Jan26`;
  assert.deepEqual(extractRnD(body).milestones, ['https://a', 'https://b', 'https://c']);
});

test('extractRnD: empty fields return null / empty array', () => {
  const body = `## R&D
- team:
- milestone:
- date:`;
  assert.deepEqual(extractRnD(body), { team: null, milestones: [], date: null });
});

test('extractRnD: trailing whitespace after values is stripped', () => {
  const body = `## R&D
- team: blockchain
- milestone:   \t
- date: 15Mar26   `;
  const parsed = extractRnD(body);
  assert.equal(parsed.team, 'blockchain');
  assert.equal(parsed.date, '15Mar26');
});

test('extractRnD: no ## R&D section at all', () => {
  assert.deepEqual(extractRnD('just a description'), { team: null, milestones: [], date: null });
});

// ─── extractDocPacket ─────────────────────────────────────────────────────────

test('extractDocPacket: returns link URL', () => {
  const body = `## Doc Packet
- link: https://github.com/logos-co/logos-docs/issues/42`;
  assert.equal(extractDocPacket(body), 'https://github.com/logos-co/logos-docs/issues/42');
});

test('extractDocPacket: empty link returns null', () => {
  const body = `## Doc Packet
- link:`;
  assert.equal(extractDocPacket(body), null);
});

test('extractDocPacket: missing section returns null', () => {
  assert.equal(extractDocPacket('## R&D\n- team: x'), null);
});

// ─── extractDocumentation ─────────────────────────────────────────────────────

test('extractDocumentation: tracking and pr both present', () => {
  const body = `## Documentation
- tracking: https://github.com/logos-co/logos-docs/issues/1
- pr: https://github.com/logos-co/logos-docs/pull/2`;
  assert.deepEqual(extractDocumentation(body), {
    tracking: 'https://github.com/logos-co/logos-docs/issues/1',
    pr:       'https://github.com/logos-co/logos-docs/pull/2',
  });
});

test('extractDocumentation: only tracking set', () => {
  const body = `## Documentation
- tracking: https://github.com/logos-co/logos-docs/issues/1
- pr:`;
  assert.deepEqual(extractDocumentation(body), {
    tracking: 'https://github.com/logos-co/logos-docs/issues/1',
    pr:       null,
  });
});

test('extractDocumentation: neither set returns both null', () => {
  const body = `## Documentation
- tracking:
- pr:`;
  assert.deepEqual(extractDocumentation(body), { tracking: null, pr: null });
});

test('extractDocumentation: empty ## Documentation section returns nulls', () => {
  const body = `## Documentation

## Red Team
- tracking:`;
  assert.deepEqual(extractDocumentation(body), { tracking: null, pr: null });
});

// ─── extractRedTeam ───────────────────────────────────────────────────────────

test('extractRedTeam: tracking URL parsed', () => {
  const body = `## Red Team
- tracking: https://github.com/logos-co/ecosystem/issues/5`;
  assert.deepEqual(extractRedTeam(body), { tracking: 'https://github.com/logos-co/ecosystem/issues/5' });
});

test('extractRedTeam: empty tracking returns null', () => {
  assert.deepEqual(extractRedTeam('## Red Team\n- tracking:'), { tracking: null });
});

// ─── extractBlockingTeam ──────────────────────────────────────────────────────

test('extractBlockingTeam: picks the first blocked-by:* label', () => {
  const labels = [
    { name: 'testnet v0.2' },
    { name: 'blocked-by:rnd-zones' },
    { name: 'blocked-by:legal' },
  ];
  assert.equal(extractBlockingTeam(labels), 'zones');
});

test('extractBlockingTeam: strips the rnd- prefix for team color mapping', () => {
  assert.equal(extractBlockingTeam([{ name: 'blocked-by:rnd-blockchain' }]), 'blockchain');
});

test('extractBlockingTeam: bare blocked-by:docs returns "docs"', () => {
  assert.equal(extractBlockingTeam([{ name: 'blocked-by:docs' }]), 'docs');
});

test('extractBlockingTeam: no blocked-by:* returns null', () => {
  assert.equal(extractBlockingTeam([{ name: 'testnet v0.1' }, { name: 'developer' }]), null);
});

test('extractBlockingTeam: legacy blocked:<team> is NOT recognized (migrated away)', () => {
  assert.equal(extractBlockingTeam([{ name: 'blocked:legal' }]), null);
});

// ─── extractExternalBlockedLabels ─────────────────────────────────────────────

test('extractExternalBlockedLabels: filters out lifecycle-managed labels', () => {
  const labels = [
    { name: 'blocked-by:rnd-zones',  color: '3B7CB8' }, // lifecycle, excluded
    { name: 'blocked-by:docs',       color: '6AAE7B' }, // lifecycle, excluded
    { name: 'blocked-by:red-team',   color: 'E46962' }, // lifecycle, excluded
    { name: 'blocked-by:legal',      color: '808C78' }, // external, kept
    { name: 'blocked-by:security',   color: '808C78' }, // external, kept
  ];
  const external = extractExternalBlockedLabels(labels);
  assert.equal(external.length, 2);
  assert.deepEqual(external.map(l => l.team), ['legal', 'security']);
});

test('extractExternalBlockedLabels: empty array when no blocked-by:* labels', () => {
  assert.deepEqual(extractExternalBlockedLabels([{ name: 'testnet v0.1' }]), []);
});

// ─── extractDescription ───────────────────────────────────────────────────────

test('extractDescription: returns content before the first ## section heading', () => {
  const body = `Some prose.

## R&D
- team: x`;
  assert.equal(extractDescription(body), 'Some prose.');
});

test('extractDescription: trims trailing whitespace', () => {
  assert.equal(extractDescription('line\n\n\n## R&D\n'), 'line');
});

test('extractDescription: body with no known heading returns entire body', () => {
  assert.equal(extractDescription('just words\n'), 'just words');
});

// ─── parseJourneyDate ─────────────────────────────────────────────────────────

test('parseJourneyDate: valid DDMmmYY string', () => {
  const d = parseJourneyDate('15Mar26');
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 2);   // 0-indexed March
  assert.equal(d.getDate(), 15);
});

test('parseJourneyDate: case-insensitive month name', () => {
  const d = parseJourneyDate('01jan20');
  assert.equal(d.getFullYear(), 2020);
  assert.equal(d.getMonth(), 0);
});

test('parseJourneyDate: invalid string returns null', () => {
  assert.equal(parseJourneyDate('2026-03-15'), null);
  assert.equal(parseJourneyDate(''),           null);
  assert.equal(parseJourneyDate(null),         null);
  assert.equal(parseJourneyDate('15Marr26'),   null);
});

// ─── Exported constants ───────────────────────────────────────────────────────

test('RND_TEAMS is the expected set', () => {
  assert.deepEqual(RND_TEAMS.sort(), [
    'anon-comms','blockchain','core','devkit','messaging','smart-contract','storage','zones',
  ]);
});

test('LIFECYCLE_BLOCKED_BY covers all rnd teams + docs + red-team + generic rnd', () => {
  assert.ok(LIFECYCLE_BLOCKED_BY.includes('blocked-by:rnd'));
  assert.ok(LIFECYCLE_BLOCKED_BY.includes('blocked-by:docs'));
  assert.ok(LIFECYCLE_BLOCKED_BY.includes('blocked-by:red-team'));
  for (const t of RND_TEAMS) {
    assert.ok(LIFECYCLE_BLOCKED_BY.includes(`blocked-by:rnd-${t}`), `missing blocked-by:rnd-${t}`);
  }
});

test('STATUS_PHASES covers the full lifecycle', () => {
  assert.deepEqual(STATUS_PHASES, [
    'confirm-roadmap', 'confirm-date', 'rnd-in-progress', 'rnd-overdue',
    'waiting-for-doc-packet', 'doc-packet-delivered', 'doc-ready-for-review',
    'doc-merged', 'completed',
  ]);
});

// ─── Real-body fixtures ───────────────────────────────────────────────────────

test('fixture issue-31: parses team, empty milestones, doc packet, doc PR', () => {
  const body = fixture('issue-31.md');
  const rnd = extractRnD(body);
  assert.equal(rnd.team, 'core');
  assert.deepEqual(rnd.milestones, []);
  assert.equal(rnd.date, null);
  assert.equal(extractDocPacket(body), 'https://github.com/logos-co/logos-docs/issues/219');
  const { tracking, pr } = extractDocumentation(body);
  assert.equal(tracking, 'https://github.com/logos-co/logos-docs/issues/220');
  assert.equal(pr,       'https://github.com/logos-co/logos-docs/pull/227');
});

test('fixture issue-7: parses multiple milestones, doc packet, no doc PR', () => {
  const body = fixture('issue-7.md');
  const rnd = extractRnD(body);
  assert.equal(rnd.team, 'blockchain');
  assert.equal(rnd.milestones.length, 4);
  assert.ok(rnd.milestones[0].startsWith('https://roadmap.logos.co/'));
  assert.ok(extractDocPacket(body));
  assert.equal(extractDocumentation(body).pr, null);
});

test('fixture issue-47: trailing-space empty fields still parse as null/empty', () => {
  const body = fixture('issue-47.md');
  const rnd = extractRnD(body);
  assert.equal(rnd.team, 'blockchain');
  assert.deepEqual(rnd.milestones, []); // line is `- milestone: ` with trailing space
  assert.equal(rnd.date, null);
  assert.equal(extractDocumentation(body).tracking, null);
  assert.equal(extractDocumentation(body).pr,       null);
});
