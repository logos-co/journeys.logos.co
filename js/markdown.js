/**
 * markdown.js — Markdown rendering and dependency parsing
 *
 * Expected dependency format in issue body:
 *
 *   ## Dependencies
 *   - team name: https://github.com/owner/repo/issues/123
 *   - docs: TODO
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
 *   url: string|null,       — GitHub issue URL, or null if TODO
 *   owner: string|null,
 *   repo: string|null,
 *   number: number|null,
 * }>
 */
export function extractDependencyIssues(body) {
  const section = extractDepsSection(body);
  if (!section) return [];

  const deps = [];
  // Match lines like:  - team name: VALUE
  const lineRe = /^-[ \t]+([^:\r\n]+):[ \t]+(.+)$/gm;
  let m;
  while ((m = lineRe.exec(section)) !== null) {
    const team = m[1].trim();
    const value = m[2].trim();

    if (!team) continue;

    if (value.toUpperCase() === 'TODO') {
      deps.push({ team, url: null, owner: null, repo: null, number: null });
    } else {
      const urlM = value.match(/https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/issues\/(\d+)/);
      if (urlM) {
        deps.push({
          team,
          url: value,
          owner: urlM[1],
          repo: urlM[2],
          number: parseInt(urlM[3], 10),
        });
      }
      // Lines with unrecognised values are silently skipped
    }
  }
  return deps;
}

/**
 * Add a dependency entry to the issue body.
 * Appends under existing ## Dependencies section, or creates the section.
 *
 * @param {string} body        — current issue body
 * @param {string} team        — team name
 * @param {string|null} url    — GitHub issue URL or null → writes "TODO"
 * @returns {string} updated body
 */
export function addDepToBody(body, team, url) {
  const line = `- ${team}: ${url || 'TODO'}`;
  const sectionRe = /(^#{1,3}\s+Dependencies[ \t]*\r?\n)([\s\S]*?)(?=\n#{1,3}\s|$)/m;

  if (sectionRe.test(body)) {
    return body.replace(sectionRe, (_, header, content) =>
      `${header}${content.trimEnd()}\n${line}\n`
    );
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

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
