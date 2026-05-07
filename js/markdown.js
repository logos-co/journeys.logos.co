/**
 * markdown.js — Markdown rendering and 3-stakeholder issue parsing
 */

/**
 * Render markdown to HTML using marked.js (available from CDN as window.marked).
 */
// Configure marked once at module load (not per-call)
if (typeof marked !== 'undefined') marked.setOptions({ breaks: true, gfm: true });

export function renderMarkdown(text) {
  if (!text) return '<em class="text-muted" style="font-family:Arial,Helvetica,sans-serif;">No description provided.</em>';
  if (typeof marked === 'undefined') {
    return `<pre class="whitespace-pre-wrap text-sm text-warmgray">${escapeHtml(text)}</pre>`;
  }
  return marked.parse(text);
}

// Lifecycle R&D team slugs — kept in sync with the dropdown in pipeline.js/detail.js.
export const RND_TEAMS = ['anon-comms','messaging','core','storage','blockchain','zones','smart-contract','devkit'];

// Lifecycle-managed blocked-by:* labels (auto-synced by the app).
// Any other blocked-by:* label is treated as a manual "external blocker".
export const LIFECYCLE_BLOCKED_BY = [
  'blocked-by:rnd',
  ...RND_TEAMS.map(t => `blocked-by:rnd-${t}`),
  'blocked-by:docs',
  'blocked-by:red-team',
];

export const STATUS_PHASES = [
  'confirm-roadmap', 'confirm-date', 'rnd-in-progress', 'rnd-overdue',
  'waiting-for-doc-packet', 'doc-packet-delivered', 'doc-ready-for-review',
  'doc-merged', 'completed',
];

/**
 * Return the primary team blocking progress (from the first blocked-by:* label).
 * Used for row border color and secondary UI signals.
 */
export function extractBlockingTeam(labels) {
  if (!labels || !labels.length) return null;
  for (const label of labels) {
    const m = label.name.match(/^blocked-by:(.+)$/i);
    if (m) {
      // Strip the "rnd-" prefix so team color mapping works for "blocked-by:rnd-zones" → "zones".
      return m[1].replace(/^rnd-/, '').trim();
    }
  }
  return null;
}

/**
 * Return manual "external blocker" labels — any blocked-by:* that is NOT
 * managed by the lifecycle.
 */
export function extractExternalBlockedLabels(labels) {
  if (!labels || !labels.length) return [];
  return labels
    .filter(l => /^blocked-by:/i.test(l.name))
    .filter(l => !LIFECYCLE_BLOCKED_BY.includes(l.name))
    .map(l => ({
      name: l.name,
      team: l.name.replace(/^blocked-by:/i, '').trim(),
      color: l.color,
    }));
}

// ─── 3-Stakeholder model: section parsing ────────────────────────────────────

// Regex caches — avoid recompiling the same patterns hundreds of times per render
const _sectionReCache = new Map();
const _fieldReCache   = new Map();
const _fieldAllReCache = new Map();

function extractSection(body, heading) {
  if (!body) return '';
  let re = _sectionReCache.get(heading);
  if (!re) {
    const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    re = new RegExp(`^#{1,3}\\s+${escaped}[ \\t]*\\r?\\n`, 'm');
    _sectionReCache.set(heading, re);
  }
  const m = body.match(re);
  if (!m) return '';
  const start = m.index + m[0].length;
  const rest = body.slice(start);
  const next = rest.match(/^#{1,3}\s/m);
  return next ? rest.slice(0, next.index) : rest;
}

function getField(section, field) {
  let re = _fieldReCache.get(field);
  if (!re) {
    const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    re = new RegExp(`^-[ \\t]+${escaped}:[ \\t]*(.+?)[ \\t]*$`, 'm');
    _fieldReCache.set(field, re);
  }
  const m = section.match(re);
  if (!m) return null;
  const trimmed = m[1].trim();
  return trimmed === '' ? null : trimmed;
}

function getFieldAll(section, field) {
  let re = _fieldAllReCache.get(field);
  if (!re) {
    const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    re = new RegExp(`^-[ \\t]+${escaped}:[ \\t]*(.+?)[ \\t]*$`, 'gm');
    _fieldAllReCache.set(field, re);
  }
  re.lastIndex = 0; // reset for global regex reuse
  const results = [];
  let m;
  while ((m = re.exec(section)) !== null) {
    const val = m[1].trim();
    if (val) results.push(val);
  }
  return results;
}

/** Parse ## R&D section → { team, milestones, date } */
export function extractRnD(body) {
  const section = extractSection(body, 'R&D');
  return {
    team:       getField(section, 'team'),
    milestones: getFieldAll(section, 'milestone'),
    date:       getField(section, 'date'),
  };
}

/** Parse ## Doc Packet section — returns the issue URL if a - link: field is present, else null */
export function extractDocPacket(body) {
  const content = extractSection(body, 'Doc Packet').trim();
  const linkM = content.match(/^-[ \t]+link:[ \t]*(\S+)/m);
  return linkM ? linkM[1] : null;
}

/**
 * Parse ## Documentation section.
 * `- tracking: URL` (logos-co/logos-docs issue) and `- pr: URL` (doc PR).
 */
export function extractDocumentation(body) {
  const section = extractSection(body, 'Documentation');
  const trackingM = section.match(/^-[ \t]+tracking:[ \t]*(\S+)/m);
  const prM = section.match(/^-[ \t]+pr:[ \t]*(\S+)/m);
  return { tracking: trackingM ? trackingM[1] : null, pr: prM ? prM[1] : null };
}

/** Parse ## Red Team section → { tracking } */
export function extractRedTeam(body) {
  const section = extractSection(body, 'Red Team');
  const m = section.match(/^-[ \t]+tracking:[ \t]*(\S+)/m);
  return { tracking: m ? m[1] : null };
}

// ─── Flat lifecycle: status computation ───────────────────────────────────────

/** Parse a journey date in DDMmmYY form (e.g. "15Mar26"). Returns Date or null. */
export function parseJourneyDate(s) {
  if (!s) return null;
  const m = s.match(/^(\d{2})(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(\d{2})$/i);
  if (!m) return null;
  const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  return new Date(2000 + parseInt(m[3], 10), months.indexOf(m[2].toLowerCase()), parseInt(m[1], 10));
}

function isOverdue(dateStr, today) {
  const d = parseJourneyDate(dateStr);
  if (!d) return false;
  const t = today instanceof Date ? today : new Date();
  const todayMidnight = new Date(t.getFullYear(), t.getMonth(), t.getDate());
  return d < todayMidnight;
}

/**
 * Compute the single flat lifecycle status for a journey.
 *
 * @param {Object}   input
 * @param {Object}   input.rnd                 - { team, milestones:string[], date }
 * @param {?string}  input.docPacketLink
 * @param {?string}  input.docsPr              - doc PR URL, if set
 * @param {?Object}  input.docsPrRef           - resolved PR ref { state: 'open'|'merged'|... }
 * @param {?string}  input.redTeamLink         - red team tracking URL, if set
 * @param {?Object}  input.redTeamRef          - resolved ref { type, state }
 * @param {boolean} [input.allMilestonesDone]  - all roadmap milestones closed
 * @param {Date}    [input.today]              - injection seam for overdue tests
 * @returns {'confirm-roadmap'|'confirm-date'|'rnd-in-progress'|'rnd-overdue'|'waiting-for-doc-packet'|'doc-packet-delivered'|'doc-ready-for-review'|'doc-merged'|'completed'}
 */
export function computeStatus({ rnd, docPacketLink, docsPr, docsPrRef, redTeamLink, redTeamRef, allMilestonesDone = false, today, issueClosed = false }) {
  // A closed GitHub issue is the user's explicit "done" signal — short-circuit to completed.
  if (issueClosed) return 'completed';
  // Downstream phases take precedence: if a doc PR is set, R&D and doc-packet are by definition done.
  if (docsPr) {
    if (docsPrRef?.state === 'merged') {
      if (redTeamLink && redTeamRef && redTeamRef.type === 'issue' && redTeamRef.state !== 'closed') return 'doc-merged';
      return 'completed';
    }
    return 'doc-ready-for-review';
  }
  if (docPacketLink) return 'doc-packet-delivered';
  // Pre-doc-packet R&D phases.
  const r = rnd || {};
  if (!r.team || !r.milestones || r.milestones.length === 0) return 'confirm-roadmap';
  if (!r.date) return 'confirm-date';
  if (allMilestonesDone) return 'waiting-for-doc-packet';
  if (isOverdue(r.date, today)) return 'rnd-overdue';
  return 'rnd-in-progress';
}

/**
 * Derive the full set of auto-managed labels from a status + rnd team.
 * @returns {{ status: string, blockedBy: string[] }}
 */
export function computeDesiredLabels(status, rndTeam) {
  const labelStatus = `status:${status}`;
  const blockedBy = [];
  if (['confirm-roadmap','confirm-date','rnd-in-progress','rnd-overdue','waiting-for-doc-packet'].includes(status)) {
    blockedBy.push(rndTeam && RND_TEAMS.includes(rndTeam) ? `blocked-by:rnd-${rndTeam}` : 'blocked-by:rnd');
  } else if (status === 'doc-packet-delivered') {
    blockedBy.push('blocked-by:docs');
  } else if (status === 'doc-ready-for-review') {
    // Doc PR needs review from BOTH R&D (the SME) and Red Team before docs can merge.
    blockedBy.push('blocked-by:red-team');
    blockedBy.push(rndTeam && RND_TEAMS.includes(rndTeam) ? `blocked-by:rnd-${rndTeam}` : 'blocked-by:rnd');
  } else if (status === 'doc-merged') {
    blockedBy.push('blocked-by:red-team');
  }
  return { status: labelStatus, blockedBy };
}

/** All repo-level status:* label names (for ensure-create). */
export const STATUS_LABEL_NAMES = STATUS_PHASES.map(p => `status:${p}`);

/** All repo-level lifecycle label names (status + blocked-by). */
export const LIFECYCLE_LABEL_NAMES = [...STATUS_LABEL_NAMES, ...LIFECYCLE_BLOCKED_BY];

// ─── 3-Stakeholder model: body update helpers ─────────────────────────────────

function upsertSectionField(body, heading, field, value) {
  const escapedH = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const headingRe = new RegExp(`^(#{1,3}\\s+${escapedH}[ \\t]*\\r?\\n)`, 'm');
  const headingMatch = body.match(headingRe);

  const isEmpty = value == null || value === '';
  const writtenValue = isEmpty ? '' : ` ${value}`;

  if (!headingMatch) {
    if (isEmpty) return body;
    return `${(body || '').trimEnd()}\n\n## ${heading}\n- ${field}:${writtenValue}\n`;
  }
  const startIdx = headingMatch.index + headingMatch[0].length;
  const rest = body.slice(startIdx);
  const nextHeading = rest.match(/^#{1,3}\s/m);
  const sectionEnd = nextHeading ? nextHeading.index : rest.length;
  const section = rest.slice(0, sectionEnd);

  const escapedF = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // [ \t]* — match zero or more spaces so we can re-match previously-cleared fields
  const fieldRe = new RegExp(`^(-[ \\t]+${escapedF}:)[ \\t]*.*$`, 'mi');
  const updated = fieldRe.test(section)
    ? section.replace(fieldRe, `$1${writtenValue}`)
    : isEmpty ? section
    : section.trimEnd() + `\n- ${field}:${writtenValue}\n`;

  return body.slice(0, startIdx) + updated + body.slice(startIdx + sectionEnd);
}

/** Update team/date in ## R&D section. */
export function setRnDField(body, field, value) {
  return upsertSectionField(body, 'R&D', field, value);
}

/** Replace all `- milestone:` lines in ## R&D with the given array. */
export function setRnDMilestones(body, milestones) {
  const headingRe = /^(#{1,3}\s+R&D[ \t]*\r?\n)/m;
  const headingMatch = body ? body.match(headingRe) : null;

  const milestoneLines = milestones.length > 0
    ? milestones.map(u => `- milestone: ${u}`).join('\n')
    : '- milestone:';

  if (!headingMatch) {
    const block = `- team:\n${milestoneLines}\n- date:\n`;
    return `${(body || '').trimEnd()}\n\n## R&D\n${block}`;
  }

  const startIdx = headingMatch.index + headingMatch[0].length;
  const rest = body.slice(startIdx);
  const nextHeading = rest.match(/^#{1,3}\s/m);
  const sectionEnd = nextHeading ? nextHeading.index : rest.length;
  const section = rest.slice(0, sectionEnd);

  // Remove all existing milestone lines
  const cleaned = section.replace(/^-[ \t]+milestone:[ \t]*.*\n?/gm, '');

  // Insert milestones before the date line, or at end of section
  const dateLineRe = /^-[ \t]+date:/m;
  let updated;
  if (dateLineRe.test(cleaned)) {
    updated = cleaned.replace(dateLineRe, milestoneLines + '\n- date:');
  } else {
    updated = cleaned.trimEnd() + '\n' + milestoneLines + '\n';
  }

  return body.slice(0, startIdx) + updated + body.slice(startIdx + sectionEnd);
}

/** Update ## Doc Packet link field. */
export function setDocPacketLink(body, link) {
  return upsertSectionField(body, 'Doc Packet', 'link', link);
}

/** Update ## Documentation tracking field. */
export function setDocTracking(body, tracking) {
  return upsertSectionField(body, 'Documentation', 'tracking', tracking);
}

/** Update ## Documentation pr field. */
export function setDocPr(body, pr) {
  return upsertSectionField(body, 'Documentation', 'pr', pr);
}

/** Update ## Red Team tracking field. */
export function setRedTeamTracking(body, link) {
  return upsertSectionField(body, 'Red Team', 'tracking', link);
}

/** Return a new journey issue body template. */
export function newIssueBody(team = '') {
  return `## R&D
- team:${team ? ' ' + team : ''}
- milestone:${' '}
- date:${' '}

## Doc Packet
- link:${' '}

## Documentation
- tracking:${' '}
- pr:${' '}

## Red Team
- tracking:${' '}
`;
}

/** Extract the description part of a body (content before the first ## R&D / ## Doc Packet / ## Documentation / ## Red Team heading). */
export function extractDescription(body) {
  if (!body) return '';
  const m = body.match(/^#{1,3}\s+(R&D|Doc Packet|Documentation|Red Team)\b/m);
  return m ? body.slice(0, m.index).trim() : body.trim();
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
