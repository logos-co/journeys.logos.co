/**
 * markdown.js — Markdown rendering and dependency issue extraction
 */

/**
 * Render markdown to HTML using marked.js (available from CDN as window.marked).
 * @param {string} text
 * @returns {string} HTML string
 */
export function renderMarkdown(text) {
  if (!text) return '<em class="text-slate-500">No description provided.</em>';
  if (typeof marked === 'undefined') {
    // Fallback: escape HTML and wrap in pre
    return `<pre class="whitespace-pre-wrap text-sm text-slate-300">${escapeHtml(text)}</pre>`;
  }

  // Configure marked for safe rendering
  marked.setOptions({
    breaks: true,
    gfm: true,
  });

  return marked.parse(text);
}

/**
 * Extract dependency issue references from a GitHub issue body.
 * Handles GitHub task-list syntax:
 *   - [ ] owner/repo#123
 *   - [x] owner/repo#123
 *   - [ ] https://github.com/owner/repo/issues/123
 *
 * @param {string} body - issue body text
 * @returns {Array<{checked: boolean, owner: string, repo: string, number: number, raw: string}>}
 */
export function extractDependencyIssues(body) {
  if (!body) return [];

  const deps = [];
  const seen = new Set();

  // Pattern 1: - [ ] owner/repo#123 or - [x] owner/repo#123
  const taskListRegex = /- \[([ xX])\] (?:https:\/\/github\.com\/)?([\w.-]+)\/([\w.-]+)#(\d+)/g;
  let match;
  while ((match = taskListRegex.exec(body)) !== null) {
    const checked = match[1].toLowerCase() === 'x';
    const owner = match[2];
    const repo = match[3];
    const number = parseInt(match[4], 10);
    const key = `${owner}/${repo}#${number}`;
    if (!seen.has(key)) {
      seen.add(key);
      deps.push({ checked, owner, repo, number, raw: match[0] });
    }
  }

  // Pattern 2: - [ ] https://github.com/owner/repo/issues/123
  const urlRegex = /- \[([ xX])\] https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/issues\/(\d+)/g;
  while ((match = urlRegex.exec(body)) !== null) {
    const checked = match[1].toLowerCase() === 'x';
    const owner = match[2];
    const repo = match[3];
    const number = parseInt(match[4], 10);
    const key = `${owner}/${repo}#${number}`;
    if (!seen.has(key)) {
      seen.add(key);
      deps.push({ checked, owner, repo, number, raw: match[0] });
    }
  }

  return deps;
}

/**
 * Extract blocked:* label from an array of label nodes.
 * @param {Array<{name: string, color: string}>} labels
 * @returns {string|null} team name (part after "blocked:") or null
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
 * @param {Array<{name: string, color: string}>} labels
 * @returns {Array<{name: string, team: string, color: string}>}
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
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
