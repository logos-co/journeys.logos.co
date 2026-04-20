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

/**
 * Extract blocked:* label from an array of label nodes.
 */
export function extractBlockedTeam(labels) {
  if (!labels || !labels.length) return null;
  for (const label of labels) {
    const m = label.name.match(/^blocked:(.+)$/i);
    if (m) return m[1].trim();
  }
  return null;
}

/**
 * Get all blocked:* labels from an array of label nodes.
 */
export function extractAllBlockedLabels(labels) {
  if (!labels || !labels.length) return [];
  return labels
    .filter(l => /^blocked:/i.test(l.name))
    .map(l => ({
      name: l.name,
      team: l.name.replace(/^blocked:/i, '').trim(),
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
  return m ? m[1].trim() : null;
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

// ─── 3-Stakeholder model: state computation ───────────────────────────────────

/** @returns {'to-be-confirmed'|'confirmed'|'in-progress'|'pending-doc-packet'|'doc-packet-delivered'} */
export function computeRnDState(rnd, docPacketLink, allMilestonesDone = false) {
  if (docPacketLink) return 'doc-packet-delivered';
  if (!rnd.team || rnd.milestones.length === 0) return 'to-be-confirmed';
  if (allMilestonesDone) return 'pending-doc-packet';
  if (!rnd.date) return 'confirmed';
  return 'in-progress';
}

/**
 * @param {string|null} pr    - doc PR URL
 * @param {{ state: string }|null} [prRef] - resolved PR ref (state: 'open'|'merged'|...)
 * @returns {'waiting'|'in-progress'|'merged'}
 */
export function computeDocsState(pr, prRef = null) {
  if (!pr) return 'waiting';
  return prRef?.state === 'merged' ? 'merged' : 'in-progress';
}

/**
 * @param {string|null} tracking
 * @param {{ type: string, state: string }|null} ref
 * @returns {'waiting'|'in-progress'|'done'}
 */
export function computeRedTeamState(tracking, ref) {
  if (!tracking) return 'waiting';
  if (!ref || ref.state === 'error') return 'in-progress';
  if (ref.type === 'issue') return ref.state === 'closed' ? 'done' : 'in-progress';
  return 'done'; // non-issue URL = done
}

/** Compute which action:* labels should be present given current states. */
export function computeActionLabels(rndState, docsState, redTeamState) {
  const labels = [];
  if (rndState !== 'doc-packet-delivered') labels.push('action:rnd');
  if (rndState === 'doc-packet-delivered' && docsState !== 'merged') labels.push('action:docs');
  if (docsState === 'in-progress' && redTeamState !== 'done') labels.push('action:red-team');
  return labels;
}

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
