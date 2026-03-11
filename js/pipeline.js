/**
 * pipeline.js — Pipeline view rendering
 */

import { extractBlockedTeam, extractDependencyIssues, extractDocUrl } from './markdown.js';
import { toggleDetail } from './detail.js';
import { hasWritePAT, getReadPAT } from './config.js';
import { teamColor, statusBadge } from './app.js';
import { fetchIssuesBatch } from './api.js';

export function renderPipeline(container, items, projectTitle) {
  const canDrag = hasWritePAT();

  container.innerHTML = `
    <div class="max-w-5xl mx-auto space-y-4">
      <div class="flex items-center justify-between mb-2">
        <div>
          <h1 class="text-2xl font-bold text-parchment" style="font-family:'Times New Roman',Times,serif;">${escapeHtml(projectTitle || 'Priority Pipeline')}</h1>
          <p class="text-sm text-muted mt-0.5" style="font-family:Arial,Helvetica,sans-serif;">
            ${items.length} journey${items.length !== 1 ? 's' : ''}
            ${canDrag ? '<span class="ml-2 text-xs text-coral font-medium">· Drag rows to reorder</span>' : ''}
          </p>
        </div>
      </div>

      <div class="hidden md:grid md:grid-cols-[1fr_minmax(5rem,auto)_8rem_9rem_6rem] gap-4 px-4 py-2 text-xs font-semibold text-muted uppercase tracking-wider" style="font-family:Arial,Helvetica,sans-serif;border-bottom:1px solid rgba(78,99,94,0.3);">
        <div>Journey</div>
        <div class="flex flex-col gap-0.5">
          <span>Deps</span>
          <div class="flex items-center gap-2 font-normal normal-case tracking-normal" style="color:#808C78;">
            <span class="flex items-center gap-1">
              <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#E46962;"></span>not tracked
            </span>
            <span class="flex items-center gap-1">
              <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#FA7B17;"></span>open
            </span>
            <span class="flex items-center gap-1">
              <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#6AAE7B;"></span>done
            </span>
          </div>
        </div>
        <div>Type</div>
        <div>Target Release</div>
        <div class="text-right">Status</div>
      </div>

      <div id="pipeline-list" class="space-y-1.5">
        ${items.map((item, index) => renderPipelineRow(item, index, canDrag)).join('')}
      </div>

      ${items.length === 0 ? `
        <div class="text-center py-16 text-muted" style="font-family:Arial,Helvetica,sans-serif;">
          <p class="text-4xl mb-4 opacity-40" style="font-family:'Times New Roman',Times,serif;">λ</p>
          <p class="text-sm">No issues found in this project</p>
        </div>
      ` : ''}
    </div>
  `;

  attachRowClickHandlers(items);
  loadAllPendingSummaries(items);
}

function renderPipelineRow(item, index, canDrag) {
  const issue = item.content;
  if (!issue) return '';

  const labels = issue.labels?.nodes || [];
  const blockedTeam = extractBlockedTeam(labels);
  const repo = issue.repository?.nameWithOwner || '';
  const rankLabel = String(index + 1).padStart(2, '0');

  // Journey type labels (user / developer / node operator)
  const typeLabels = labels.filter(l =>
    /^(user|developer|node operator)$/i.test(l.name.trim())
  );
  // Release labels (e.g. testnet v0.1)
  const releaseLabels = labels.filter(l =>
    /^testnet\b/i.test(l.name.trim())
  );

  // Use parchment text so dark label colours (e.g. forest #0E2618) stay readable
  const labelPill = (l) =>
    `<span class="inline-flex items-center px-1.5 py-px rounded text-xs"
           style="background:#${l.color}20;color:#E2E0C9;border:1px solid #${l.color}55;font-family:Arial,Helvetica,sans-serif;">
       ${escapeHtml(l.name)}
     </span>`;

  const metaLabelsHtml = typeLabels.map(labelPill).join('');
  const releaseHtml = releaseLabels.length
    ? releaseLabels.map(labelPill).join(' ')
    : `<span class="text-xs italic" style="color:#808C78;font-family:Arial,Helvetica,sans-serif;">—</span>`;

  const docUrl = extractDocUrl(issue.body || '');

  return `
    <div>
      <div
        id="row-${item.id}"
        data-item-id="${item.id}"
        data-index="${index}"
        data-repo="${escapeHtml(repo)}"
        data-issue="${issue.number}"
        draggable="${canDrag}"
        class="pipeline-row grid grid-cols-[1fr_6rem] md:grid-cols-[1fr_minmax(5rem,auto)_8rem_9rem_6rem] gap-4 items-center px-4 py-3 rounded cursor-pointer transition-all select-none ${canDrag ? 'draggable-row' : ''}"
        style="background:rgba(12,43,45,0.55);border:1px solid rgba(78,99,94,0.3);border-left:3px solid ${blockedTeam ? teamColor(blockedTeam, 0.7) : 'transparent'};"
        onmouseover="this.style.background='rgba(78,99,94,0.18)'"
        onmouseout="this.style.background='rgba(12,43,45,0.55)'"
      >
        <div class="min-w-0">
          <div class="flex items-baseline gap-2.5">
            ${canDrag
              ? `<span class="drag-handle flex-none" title="Drag to reorder">⠿</span>`
              : `<span class="rank-number flex-none">${rankLabel}</span>`
            }
            <span class="text-base font-semibold text-parchment leading-snug" style="font-family:'Times New Roman',Times,serif;">
              ${escapeHtml(issue.title)}
            </span>
          </div>
        </div>

        <!-- Dependencies dots column (desktop) -->
        <div id="pending-${item.id}" class="hidden md:flex items-center gap-1 flex-wrap"></div>

        <!-- Journey Type column (desktop) -->
        <div class="hidden md:flex items-center flex-wrap gap-1">
          ${metaLabelsHtml || `<span class="text-xs italic" style="color:#808C78;font-family:Arial,Helvetica,sans-serif;">—</span>`}
        </div>

        <!-- Target Release column (desktop) -->
        <div class="hidden md:flex items-center">
          ${releaseHtml}
        </div>

        <div class="flex items-center justify-end gap-2">
          ${docUrl ? `
            <a href="${escapeHtml(docUrl)}" target="_blank" rel="noopener"
               onclick="event.stopPropagation()"
               title="Open documentation"
               class="flex-none text-xs px-1.5 py-0.5 rounded transition-colors"
               style="border:1px solid rgba(78,99,94,0.4);color:#808C78;font-family:Arial,Helvetica,sans-serif;"
               onmouseover="this.style.borderColor='rgba(228,105,98,0.5)';this.style.color='#E46962'"
               onmouseout="this.style.borderColor='rgba(78,99,94,0.4)';this.style.color='#808C78'">
              Docs ↗
            </a>
          ` : ''}
          ${statusBadge(issue.state)}
          <svg id="chevron-${item.id}" class="w-4 h-4 text-muted transition-all flex-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>

      <div id="detail-${item.id}" class="hidden rounded-b overflow-hidden -mt-1 mx-0.5" style="border:1px solid rgba(78,99,94,0.3);border-top:none;"></div>
    </div>
  `;
}

/**
 * Fetch dep issues for all items in the background and populate pending badges.
 * Handles all three states: not tracked (TODO), pending (open), done (closed).
 */
async function loadAllPendingSummaries(items) {
  const pat = getReadPAT();

  // Collect URL-based deps across all items
  const allRefs = [];
  const itemDepMap = new Map();

  for (const item of items) {
    const deps = extractDependencyIssues(item.content?.body || '');
    if (!deps.length) continue;

    const urlDeps  = deps.filter(d => d.url);
    const todoDeps = deps.filter(d => !d.url);
    const urlIndices = urlDeps.map(() => allRefs.length + urlDeps.indexOf(urlDeps[urlDeps.indexOf(urlDeps.find(x => !allRefs.includes(x)))]));

    // Simpler: track indices per item
    const startIdx = allRefs.length;
    urlDeps.forEach(d => allRefs.push({ owner: d.owner, repo: d.repo, number: d.number }));

    itemDepMap.set(item.id, { todoDeps, urlDeps, startIdx });
  }

  const results = allRefs.length ? await fetchIssuesBatch(allRefs, pat) : [];

  for (const item of items) {
    const entry = itemDepMap.get(item.id);
    if (!entry) continue;

    // team → {notTracked, pending, done}
    const teamCounts = new Map();

    const ensure = (team) => {
      if (!teamCounts.has(team)) teamCounts.set(team, { notTracked: 0, pending: 0, done: 0 });
      return teamCounts.get(team);
    };

    for (const dep of entry.todoDeps) {
      ensure(dep.team).notTracked++;
    }
    for (let i = 0; i < entry.urlDeps.length; i++) {
      const dep = entry.urlDeps[i];
      const result = results[entry.startIdx + i];
      const counts = ensure(dep.team);
      if (result?.error || result?.issue?.state === 'open') {
        counts.pending++;
      } else {
        counts.done++;
      }
    }

    const el = document.getElementById(`pending-${item.id}`);
    if (el) el.innerHTML = renderDepDots(teamCounts);
  }
}

// Dep dot colours: red = not tracked, orange = open/pending, green = closed/done
const DEP_COLORS = { notTracked: '#E46962', pending: '#FA7B17', done: '#6AAE7B' };

function renderDepDots(teamCounts) {
  if (!teamCounts.size) return '';

  return [...teamCounts.entries()].map(([team, { notTracked, pending, done }]) => {
    let color, statusText;
    if (pending > 0)         { color = DEP_COLORS.pending;    statusText = 'pending'; }
    else if (notTracked > 0) { color = DEP_COLORS.notTracked; statusText = 'not tracked'; }
    else                     { color = DEP_COLORS.done;       statusText = 'done'; }

    return `<span title="${escapeHtml(team)}: ${statusText}"
                  class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs"
                  style="background:rgba(14,38,24,0.5);border:1px solid rgba(78,99,94,0.3);font-family:Arial,Helvetica,sans-serif;color:#DDDED8;white-space:nowrap;">
              <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${color};flex-shrink:0;"></span>
              ${escapeHtml(team)}
            </span>`;
  }).join('');
}

function attachRowClickHandlers(items) {
  items.forEach(item => {
    const row = document.getElementById(`row-${item.id}`);
    if (!row) return;
    row.addEventListener('click', (e) => {
      if (e.target.closest('a, button')) return;
      toggleDetail(item.id, item);
    });
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
