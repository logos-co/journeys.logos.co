/**
 * markdown.js — Markdown rendering and dependency parsing
 *
 * Expected dependency format in issue body:
 *
 *   ## Dependencies
 *   - team name: https://github.com/owner/repo/issues/123
 *   - team name: https://github.com/owner/repo/issues/123 15Mar26
 *   - team name: https://example.com/some-reference
 *   - team name: https://example.com/ref Completed
 *   - team name: Completed
 *   - team name: Completed 15Mar26
 *   - team name: TODO
 *   - team name: TODO 15Mar26
 *   - team name:
 *   - lez: https://github.com/logos-blockchain/logos-execution-zone/issues/45
 */

/**
 * Render markdown to HTML using marked.js (available from CDN as window.marked).
 */
export function renderMarkdown(text) {
  if (!text) return '<em class="text-muted" style="font-family:Arial,Helvetica,sans-serif;">No description provided.</em>';
  if (typeof marked === 'undefined') {
    return `<pre class="whitespace-pre-wrap text-sm text-warmgray">${escapeHtml(text)}</pre>`;
  }
  marked.setOptions({ breaks: true, gfm: true });
  return marked.parse(text);
}

/**
 * Extract the raw text of the ## Dependencies section from an issue body.
 * Returns empty string if no such section exists.
 */
function extractDepsSection(body) {
  if (!body) return '';
  const headingMatch = body.match(/^#{1,3}\s+Dependencies[ \t]*\r?\n/m);
  if (!headingMatch) return '';
  const startIdx = headingMatch.index + headingMatch[0].length;
  const rest = body.slice(startIdx);
  const nextHeading = rest.match(/^#{1,3}\s/m);
  return nextHeading ? rest.slice(0, nextHeading.index) : rest;
}

/**
 * Parse dependencies from an issue body.
 * Only reads from the ## Dependencies section.
 *
 * Returns Array<{
 *   team: string,
 *   url: string|null,       — URL (GitHub issue or any reference), or null
 *   owner: string|null,     — GitHub issue owner (null for non-GitHub URLs)
 *   repo: string|null,      — GitHub issue repo (null for non-GitHub URLs)
 *   number: number|null,    — GitHub issue number (null for non-GitHub URLs)
 *   completed: boolean,     — true if "Completed" flag is set
 *   pending: boolean,       — true if "Pending" flag is set (shows red)
 *   targetDate: string|null, — DDMMMYY date string, or null
 * }>
 */
export function extractDependencyIssues(body) {
  const section = extractDepsSection(body);
  if (!section) return [];

  const deps = [];
  // Match lines like:  - team name: VALUE  (value may be empty)
  const lineRe = /^-[ \t]+([^:\r\n]+):[ \t]*(.*?)$/gm;
  // DDMMMYY pattern, e.g. 15Mar26
  const dateRe = /\b(\d{2}(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\d{2})\s*$/i;
  // Completed flag at end of value (after URL or standalone)
  const completedRe = /\bCompleted\s*$/i;
  // Pending flag at end of value (after URL or standalone); overrides GitHub issue state
  const pendingRe = /\bPending\s*$/i;
  let m;
  while ((m = lineRe.exec(section)) !== null) {
    const team = m[1].trim();
    let value = (m[2] || '').trim();

    if (!team) continue;

    // 1. Extract optional trailing date
    const dateM = value.match(dateRe);
    const targetDate = dateM ? dateM[1] : null;
    if (dateM) value = value.slice(0, dateM.index).trim();

    // 2. Extract optional trailing "Completed" flag
    const completed = completedRe.test(value);
    if (completed) value = value.replace(completedRe, '').trim();

    // 3. Extract optional trailing "Pending" flag (only if not Completed)
    const pending = !completed && pendingRe.test(value);
    if (pending) value = value.replace(pendingRe, '').trim();

    // 4. Remaining value is URL or "TODO" or empty
    if (value.toUpperCase() === 'TODO' || value === '') {
      deps.push({ team, url: null, owner: null, repo: null, number: null, completed, pending, targetDate });
    } else {
      const ghM = value.match(/https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/issues\/(\d+)/);
      if (ghM) {
        deps.push({ team, url: value, owner: ghM[1], repo: ghM[2], number: parseInt(ghM[3], 10), completed, pending, targetDate });
      } else if (/^https?:\/\/\S+$/.test(value)) {
        deps.push({ team, url: value, owner: null, repo: null, number: null, completed, pending, targetDate });
      }
      // Lines with unrecognised values are silently skipped
    }
  }
  return deps;
}

/**
 * Parse a DDMMMYY string into a Date object. Returns null if invalid.
 */
export function parseDDMMMYY(str) {
  if (!str) return null;
  const m = str.match(/^(\d{2})(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(\d{2})$/i);
  if (!m) return null;
  const months = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
  const day = parseInt(m[1], 10);
  const month = months[m[2].toLowerCase()];
  const year = 2000 + parseInt(m[3], 10);
  if (month === undefined || day < 1 || day > 31) return null;
  return new Date(year, month, day);
}

/**
 * Return a CSS color for a target date:
 * - red (#E46962) if past delivery
 * - orange (#FA7B17) if within 7 days of delivery
 * - null otherwise (use default color)
 */
export function targetDateColor(dateStr) {
  const d = parseDDMMMYY(dateStr);
  if (!d) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const diff = d.getTime() - now.getTime();
  const days = diff / (1000 * 60 * 60 * 24);
  if (days < 0) return '#E46962';   // past due — red
  if (days <= 7) return '#FA7B17';  // within 1 week — orange
  return null;
}

/**
 * Update the URL/reference on a specific dependency line in the issue body.
 * Matches by team name (case-insensitive). Preserves any existing target date.
 *
 * @param {string} body     — current issue body
 * @param {string} team     — team name to match
 * @param {string} newUrl   — new URL to set
 * @returns {string} updated body
 */
export function setDepUrl(body, team, newUrl) {
  const headingMatch = body.match(/^(#{1,3}\s+Dependencies[ \t]*\r?\n)/m);
  if (!headingMatch) return body;

  const startIdx = headingMatch.index + headingMatch[0].length;
  const rest = body.slice(startIdx);
  const nextHeading = rest.match(/^#{1,3}\s/m);
  const sectionEnd = nextHeading ? nextHeading.index : rest.length;
  const section = rest.slice(0, sectionEnd);

  const dateRe = /\b(\d{2}(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\d{2})\s*$/i;
  const lines = section.split('\n');
  const updated = lines.map(line => {
    const m = line.match(/^(-[ \t]+[^:\r\n]+:)(.*)/);
    if (!m) return line;
    const teamName = m[1].replace(/^-[ \t]+/, '').replace(/:$/, '').trim();
    if (teamName.toLowerCase() !== team.toLowerCase()) return line;
    // Preserve existing date if any
    const existingVal = m[2].trim();
    const dateMatch = existingVal.match(dateRe);
    const dateSuffix = dateMatch ? ` ${dateMatch[1]}` : '';
    return `${m[1]} ${newUrl}${dateSuffix}`;
  });

  return body.slice(0, startIdx) + updated.join('\n') + body.slice(startIdx + sectionEnd);
}

/**
 * Update the target date on a specific dependency line in the issue body.
 * Matches by team name (case-insensitive). If newDate is null/empty, removes the date.
 *
 * @param {string} body     — current issue body
 * @param {string} team     — team name to match
 * @param {string|null} newDate — DDMMMYY string, or null to remove
 * @returns {string} updated body
 */
export function setDepDate(body, team, newDate) {
  const headingMatch = body.match(/^(#{1,3}\s+Dependencies[ \t]*\r?\n)/m);
  if (!headingMatch) return body;

  const startIdx = headingMatch.index + headingMatch[0].length;
  const rest = body.slice(startIdx);
  const nextHeading = rest.match(/^#{1,3}\s/m);
  const sectionEnd = nextHeading ? nextHeading.index : rest.length;
  const section = rest.slice(0, sectionEnd);

  const dateRe = /\s+\d{2}(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\d{2}\s*$/i;
  const lines = section.split('\n');
  const updated = lines.map(line => {
    const m = line.match(/^-[ \t]+([^:\r\n]+):/);
    if (!m || m[1].trim().toLowerCase() !== team.toLowerCase()) return line;
    // Strip existing date if present
    let cleaned = line.replace(dateRe, '');
    // Append new date
    if (newDate) cleaned = cleaned.trimEnd() + ' ' + newDate;
    return cleaned;
  });

  return body.slice(0, startIdx) + updated.join('\n') + body.slice(startIdx + sectionEnd);
}

/**
 * Add a dependency entry to the issue body.
 * Appends under existing ## Dependencies section, or creates the section.
 *
 * @param {string} body        — current issue body
 * @param {string} team        — team name
 * @param {string|null} url    — URL, "Completed", or null → writes "TODO"
 * @param {string|null} date   — optional target date in DDMMMYY format
 * @returns {string} updated body
 */
export function addDepToBody(body, team, url, date) {
  const dateSuffix = date ? ` ${date}` : '';
  const line = `- ${team}: ${url || 'TODO'}${dateSuffix}`;
  const section = extractDepsSection(body);

  if (section !== '') {
    // Collect existing dep lines and append the new one
    const depLines = section.split('\n').filter(l => /^-\s/.test(l));
    depLines.push(line);
    const newSection = depLines.join('\n') + '\n';

    // Replace old section content with cleaned-up version
    const headingMatch = body.match(/^(#{1,3}\s+Dependencies[ \t]*\r?\n)/m);
    const startIdx = headingMatch.index + headingMatch[0].length;
    const rest = body.slice(startIdx);
    const nextHeading = rest.match(/^#{1,3}\s/m);
    const endIdx = nextHeading ? startIdx + nextHeading.index : body.length;

    return body.slice(0, startIdx) + newSection + body.slice(endIdx);
  }
  return `${(body || '').trimEnd()}\n\n## Dependencies\n${line}\n`;
}

/**
 * Extract the documentation URL from a ## Documentation section in an issue body.
 * Returns the first URL found, or null.
 */
export function hasDocsDependency(body) {
  const deps = extractDependencyIssues(body);
  return deps.some(d => d.team.toLowerCase() === 'docs');
}

export function extractDocUrl(body) {
  if (!body) return null;
  const headingMatch = body.match(/^#{1,3}\s+Documentation[ \t]*\r?\n/m);
  if (!headingMatch) return null;
  const startIdx = headingMatch.index + headingMatch[0].length;
  const rest = body.slice(startIdx);
  const nextHeading = rest.match(/^#{1,3}\s/m);
  const section = nextHeading ? rest.slice(0, nextHeading.index) : rest;
  const urlMatch = section.match(/https?:\/\/\S+/);
  return urlMatch ? urlMatch[0].replace(/[)\].,;>]+$/, '') : null;
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

function extractSection(body, heading) {
  if (!body) return '';
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^#{1,3}\\s+${escaped}[ \\t]*\\r?\\n`, 'm');
  const m = body.match(re);
  if (!m) return '';
  const start = m.index + m[0].length;
  const rest = body.slice(start);
  const next = rest.match(/^#{1,3}\s/m);
  return next ? rest.slice(0, next.index) : rest;
}

function getField(section, field) {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = section.match(new RegExp(`^-[ \\t]+${escaped}:[ \\t]*(.+?)[ \\t]*$`, 'm'));
  return m ? m[1].trim() : null;
}

/** Parse ## R&D section → { team, milestone, date } */
export function extractRnD(body) {
  const section = extractSection(body, 'R&D');
  return {
    team:      getField(section, 'team'),
    milestone: getField(section, 'milestone'),
    date:      getField(section, 'date'),
  };
}

/** Parse ## Doc Packet section — returns content string if non-trivial, else null */
export function extractDocPacket(body) {
  const content = extractSection(body, 'Doc Packet').trim();
  return content.length > 150 ? content : null;
}

/**
 * Parse ## Documentation section for the link.
 * Looks for `- link: URL` first; falls back to bare URL (backward compat).
 */
export function extractDocumentation(body) {
  const section = extractSection(body, 'Documentation');
  const linkM = section.match(/^-[ \t]+link:[ \t]*(\S+)/m);
  if (linkM) return { link: linkM[1] };
  const urlM = section.match(/https?:\/\/\S+/);
  return { link: urlM ? urlM[0].replace(/[)\].,;>]+$/, '') : null };
}

/** Parse ## Red Team section → { tracking } */
export function extractRedTeam(body) {
  const section = extractSection(body, 'Red Team');
  const m = section.match(/^-[ \t]+tracking:[ \t]*(\S+)/m);
  return { tracking: m ? m[1] : null };
}

// ─── 3-Stakeholder model: state computation ───────────────────────────────────

/** @returns {'to-be-confirmed'|'confirmed'|'in-progress'|'doc-packet-delivered'} */
export function computeRnDState(rnd, docPacketContent) {
  if (docPacketContent) return 'doc-packet-delivered';
  if (!rnd.team || !rnd.milestone) return 'to-be-confirmed';
  if (!rnd.date) return 'confirmed';
  return 'in-progress';
}

/**
 * @param {string|null} link
 * @param {{ type: string, state: string }|null} ref
 * @returns {'waiting'|'in-progress'|'ready-for-review'|'merged'}
 */
export function computeDocsState(link, ref) {
  if (!link) return 'waiting';
  if (!ref || ref.state === 'error') return 'in-progress';
  if (ref.type === 'url') return 'merged';
  if (ref.type === 'pr') return ref.state === 'merged' ? 'merged' : ref.state === 'open' ? 'ready-for-review' : 'merged';
  // issue: closed issue means work moved on but link not updated — keep as in-progress
  return ref.state === 'open' ? 'in-progress' : 'in-progress';
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
  // action:rnd when: doc packet not delivered (covers migration case where docs may
  // already be merged but no doc packet was provided), OR docs ready-for-review (R&D review)
  if (rndState !== 'doc-packet-delivered' || docsState === 'ready-for-review') labels.push('action:rnd');
  if (rndState === 'doc-packet-delivered' && docsState !== 'merged') labels.push('action:docs');
  if (docsState === 'ready-for-review' && redTeamState !== 'done') labels.push('action:red-team');
  return labels;
}

// ─── 3-Stakeholder model: body update helpers ─────────────────────────────────

function upsertSectionField(body, heading, field, value) {
  const escapedH = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const headingRe = new RegExp(`^(#{1,3}\\s+${escapedH}[ \\t]*\\r?\\n)`, 'm');
  const headingMatch = body.match(headingRe);

  if (!headingMatch) {
    return `${(body || '').trimEnd()}\n\n## ${heading}\n- ${field}: ${value}\n`;
  }
  const startIdx = headingMatch.index + headingMatch[0].length;
  const rest = body.slice(startIdx);
  const nextHeading = rest.match(/^#{1,3}\s/m);
  const sectionEnd = nextHeading ? nextHeading.index : rest.length;
  const section = rest.slice(0, sectionEnd);

  const escapedF = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const fieldRe = new RegExp(`^(-[ \\t]+${escapedF}:)[ \\t].*$`, 'mi');
  const updated = fieldRe.test(section)
    ? section.replace(fieldRe, `$1 ${value}`)
    : section.trimEnd() + `\n- ${field}: ${value}\n`;

  return body.slice(0, startIdx) + updated + body.slice(startIdx + sectionEnd);
}

/** Update team/milestone/date in ## R&D section. */
export function setRnDField(body, field, value) {
  return upsertSectionField(body, 'R&D', field, value);
}

/** Update ## Documentation link field. */
export function setDocLink(body, link) {
  return upsertSectionField(body, 'Documentation', 'link', link);
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

## Documentation
- link:${' '}

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
