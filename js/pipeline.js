/**
 * pipeline.js — Pipeline view rendering
 */

import { extractBlockedTeam, extractDependencyIssues, extractDocUrl, targetDateColor } from './markdown.js';
import { toggleDetail, expandAll, collapseAll, getOpenCount } from './detail.js';
import { hasWritePAT, getReadPAT } from './config.js';
import { teamColor, statusBadge } from './app.js';
import { fetchIssuesBatch } from './api.js';

// Active team filter — persists until project reload
let activeTeamFilter = new Set();

export function renderPipeline(container, items, projectTitle) {
  const canDrag = hasWritePAT();

  // Reset filter on each full project render
  activeTeamFilter.clear();

  // Split into open and closed; closed sorted by most recently closed first
  const openItems = items.filter(i => i.content?.state !== 'CLOSED');
  const closedItems = items
    .filter(i => i.content?.state === 'CLOSED')
    .sort((a, b) => (b.content.closedAt || '').localeCompare(a.content.closedAt || ''));

  // Collect unique team names across all items (from dep lines in body)
  const allTeams = collectAllTeams(items);

  const columnHeader = `
        <div class="hidden md:block pointer-events-none select-none">
          <div class="grid grid-cols-[1fr_8rem_9rem_10rem_2rem] gap-4 items-end px-4 py-1.5 text-xs font-semibold uppercase tracking-wider"
               style="color:#808C78;font-family:Arial,Helvetica,sans-serif;border:1px solid transparent;border-left:3px solid transparent;border-bottom:1px solid rgba(78,99,94,0.2);">
            <div>Journey</div>
            <div>Journey<br>Type</div>
            <div>Target<br>Release</div>
            <div>Deps</div>
            <div></div>
          </div>
        </div>`;

  container.innerHTML = `
    <div class="max-w-5xl mx-auto space-y-4">
      <div class="flex items-center justify-between mb-2">
        <div>
          <h1 class="text-2xl font-bold text-forest" style="font-family:'Times New Roman',Times,serif;">${escapeHtml(projectTitle || 'Priority Pipeline')}</h1>
          <p class="text-sm text-muted mt-0.5" style="font-family:Arial,Helvetica,sans-serif;">
            ${openItems.length} open journey${openItems.length !== 1 ? 's' : ''}
            ${canDrag ? '<span class="ml-2 text-xs text-coral font-medium">· Drag rows to reorder</span>' : ''}
          </p>
        </div>
        <div class="flex items-center gap-4">
          <button id="btn-toggle-all" class="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded transition-colors"
                  style="color:#808C78;border:1px solid rgba(78,99,94,0.3);font-family:Arial,Helvetica,sans-serif;"
                  onmouseover="this.style.background='rgba(78,99,94,0.1)'"
                  onmouseout="this.style.background=''">
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5"/>
            </svg>
            <span id="toggle-all-label">Expand All</span>
          </button>
          <div class="hidden md:flex items-center gap-3 text-xs" style="color:#808C78;font-family:Arial,Helvetica,sans-serif;">
            <span class="flex items-center gap-1"><span style="color:#FA7B17;font-size:11px;line-height:1;flex-shrink:0;">⚠</span>not tracked</span>
            <span class="flex items-center gap-1"><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#FA7B17;flex-shrink:0;"></span>open</span>
            <span class="flex items-center gap-1"><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#6AAE7B;flex-shrink:0;"></span>done</span>
          </div>
        </div>
      </div>

      ${allTeams.length > 0 ? renderFilterBar(allTeams) : ''}

      <div id="pipeline-list" class="space-y-1.5">
        ${columnHeader}
        ${openItems.map((item, index) => renderPipelineRow(item, index, canDrag)).join('')}
      </div>

      <div id="no-filter-match" class="hidden text-center py-8 text-muted" style="font-family:Arial,Helvetica,sans-serif;">
        <p class="text-sm">No journeys match the selected team filter</p>
      </div>

      ${openItems.length === 0 ? `
        <div class="text-center py-16 text-muted" style="font-family:Arial,Helvetica,sans-serif;">
          <p class="text-4xl mb-4 opacity-40" style="font-family:'Times New Roman',Times,serif;">λ</p>
          <p class="text-sm">No open journeys found</p>
        </div>
      ` : ''}

      ${closedItems.length > 0 ? `
        <div id="closed-section" class="mt-8">
          <h2 class="text-lg font-bold text-forest mb-1" style="font-family:'Times New Roman',Times,serif;">Completed</h2>
          <p class="text-sm text-muted mb-3" style="font-family:Arial,Helvetica,sans-serif;">${closedItems.length} closed journey${closedItems.length !== 1 ? 's' : ''}</p>
          <div id="closed-list" class="space-y-1.5" style="opacity:0.7;">
            ${columnHeader}
            ${closedItems.map((item, index) => renderPipelineRow(item, index, false)).join('')}
          </div>
        </div>
      ` : ''}
    </div>
  `;

  const allItems = [...openItems, ...closedItems];
  attachRowClickHandlers(allItems);
  attachToggleAllHandler(allItems);
  attachFilterHandlers(allItems);
  loadAllPendingSummaries(allItems);
}

function collectAllTeams(items) {
  const seen = new Set();
  for (const item of items) {
    const deps = extractDependencyIssues(item.content?.body || '');
    for (const dep of deps) {
      if (dep.team) seen.add(dep.team);
    }
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

function renderFilterBar(teams) {
  const pills = teams.map(team => {
    const color = teamColor(team, 1);
    const bg = teamColor(team, 0.12);
    return `<button
      class="filter-team-pill inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all"
      data-team="${escapeHtml(team)}"
      style="border:1px solid rgba(78,99,94,0.3);background:transparent;color:#808C78;font-family:Arial,Helvetica,sans-serif;cursor:pointer;"
      title="Filter by ${escapeHtml(team)}"
    >
      <span class="w-2 h-2 rounded-full flex-none" style="background:${color};"></span>
      ${escapeHtml(team)}
    </button>`;
  }).join('');

  return `
    <div id="team-filter-bar" class="flex items-center gap-2 flex-wrap">
      <span class="text-xs flex-none" style="color:#808C78;font-family:Arial,Helvetica,sans-serif;">Deps:</span>
      ${pills}
    </div>`;
}

function applyTeamFilter(allItems) {
  const noMatch = document.getElementById('no-filter-match');
  if (activeTeamFilter.size === 0) {
    // Show everything
    for (const item of allItems) {
      const wrapper = document.getElementById(`filter-item-${item.id}`);
      if (wrapper) wrapper.classList.remove('hidden');
    }
    if (noMatch) noMatch.classList.add('hidden');
    return;
  }

  let visibleCount = 0;
  for (const item of allItems) {
    const wrapper = document.getElementById(`filter-item-${item.id}`);
    if (!wrapper) continue;
    const itemTeams = JSON.parse(wrapper.dataset.depTeams || '[]');
    const matches = itemTeams.some(t => activeTeamFilter.has(t));
    wrapper.classList.toggle('hidden', !matches);
    if (matches) visibleCount++;
  }
  if (noMatch) noMatch.classList.toggle('hidden', visibleCount > 0);
}

function attachFilterHandlers(allItems) {
  document.querySelectorAll('.filter-team-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      const team = btn.dataset.team;
      if (activeTeamFilter.has(team)) {
        activeTeamFilter.delete(team);
        btn.style.background = 'transparent';
        btn.style.color = '#808C78';
        btn.style.borderColor = 'rgba(78,99,94,0.3)';
      } else {
        activeTeamFilter.add(team);
        const color = teamColor(team, 1);
        const bg = teamColor(team, 0.15);
        btn.style.background = bg;
        btn.style.color = color;
        btn.style.borderColor = teamColor(team, 0.5);
      }
      applyTeamFilter(allItems);
    });
  });
}

function renderPipelineRow(item, index, canDrag) {
  const issue = item.content;
  if (!issue) return '';

  const labels = issue.labels?.nodes || [];
  const blockedTeam = extractBlockedTeam(labels);
  const repo = issue.repository?.nameWithOwner || '';
  const rankLabel = String(index + 1).padStart(2, '0');

  // Collect dep team names for this item (used by filter)
  const depTeams = extractDependencyIssues(issue.body || '').map(d => d.team).filter(Boolean);

  // Journey type labels (gui user / developer / node operator)
  const typeLabels = labels.filter(l =>
    /^(gui user|developer|node operator)$/i.test(l.name.trim())
  );
  // Release labels (e.g. testnet v0.1)
  const releaseLabels = labels.filter(l =>
    /^testnet\b/i.test(l.name.trim())
  );

  // Override journey-type label colours so gui user / developer / node operator are distinct
  const JOURNEY_COLORS = { 'gui user': 'D94F45', 'developer': '3B7CB8', 'node operator': 'C4912C' };
  // Override release label colours so v0.1 / v0.2 are visually distinct
  const RELEASE_COLORS = { 'testnet v0.1': '4E635E', 'testnet v0.2': '3B7CB8', 'testnet unscheduled': '808C78' };

  const labelPill = (l) => {
    const key = l.name.trim().toLowerCase();
    const raw = JOURNEY_COLORS[key] || RELEASE_COLORS[key] || l.color;
    const textColor = raw === l.color && l.color.toLowerCase() === '0e2618' ? '4E635E' : raw;
    return `<span class="inline-flex items-center px-1.5 py-px rounded text-xs font-medium"
           style="background:#${raw}18;color:#${textColor};border:1px solid #${raw}50;font-family:Arial,Helvetica,sans-serif;">
       ${escapeHtml(l.name)}
     </span>`;
  };

  const metaLabelsHtml = typeLabels.map(labelPill).join('');
  const releaseHtml = releaseLabels.length
    ? releaseLabels.map(labelPill).join(' ')
    : `<span class="text-xs italic" style="color:#808C78;font-family:Arial,Helvetica,sans-serif;">—</span>`;

  const docUrl = extractDocUrl(issue.body || '');

  return `
    <div id="filter-item-${item.id}" data-dep-teams="${escapeHtml(JSON.stringify([...new Set(depTeams)]))}">
      <div
        id="row-${item.id}"
        data-item-id="${item.id}"
        data-index="${index}"
        data-repo="${escapeHtml(repo)}"
        data-issue="${issue.number}"
        draggable="${canDrag}"
        class="pipeline-row grid grid-cols-[1fr_auto] md:grid-cols-[1fr_8rem_9rem_10rem_2rem] gap-4 items-center px-4 py-3 rounded cursor-pointer transition-all select-none ${canDrag ? 'draggable-row' : ''}"
        style="background:rgba(255,255,255,0.75);border:1px solid rgba(78,99,94,0.2);border-left:3px solid ${blockedTeam ? teamColor(blockedTeam, 0.6) : 'transparent'};"
        onmouseover="this.style.background='rgba(78,99,94,0.1)'"
        onmouseout="this.style.background='rgba(255,255,255,0.75)'"
      >
        <div class="min-w-0">
          <div class="flex items-baseline gap-2.5">
            ${canDrag
              ? `<span class="drag-handle flex-none" title="Drag to reorder">⠿</span>`
              : `<span class="rank-number flex-none">${rankLabel}</span>`
            }
            <span class="flex-1 min-w-0 text-base font-semibold leading-snug" style="font-family:'Times New Roman',Times,serif;color:#0E2618;">
              ${escapeHtml(issue.title)}
              <a href="${issue.url}" target="_blank" rel="noopener" onclick="event.stopPropagation()"
                 class="text-xs font-normal transition-colors" style="color:#808C78;font-family:Arial,Helvetica,sans-serif;text-decoration:none;"
                 onmouseover="this.style.color='#E46962'" onmouseout="this.style.color='#808C78'">#${issue.number}</a>
            </span>
            ${docUrl ? `
              <a href="${escapeHtml(docUrl)}" target="_blank" rel="noopener"
                 onclick="event.stopPropagation()"
                 title="Open documentation"
                 class="flex-none text-xs px-1.5 py-0.5 rounded transition-colors self-center"
                 style="border:1px solid rgba(106,174,123,0.45);color:#6AAE7B;font-family:Arial,Helvetica,sans-serif;"
                 onmouseover="this.style.borderColor='rgba(106,174,123,0.8)';this.style.background='rgba(106,174,123,0.1)'"
                 onmouseout="this.style.borderColor='rgba(106,174,123,0.45)';this.style.background=''">
                Docs ↗
              </a>
            ` : ''}
            <span id="doc-warn-${item.id}" class="flex-none self-center hidden"
                  title="Docs issue is closed but no documentation linked"
                  style="color:#FA7B17;font-size:14px;line-height:1;cursor:help;">⚠</span>
          </div>
        </div>

        <!-- Journey Type column (desktop) -->
        <div class="hidden md:flex items-center flex-wrap gap-1">
          ${metaLabelsHtml || `<span class="text-xs italic" style="color:#808C78;font-family:Arial,Helvetica,sans-serif;">—</span>`}
        </div>

        <!-- Target Release column (desktop) -->
        <div class="hidden md:flex items-center">
          ${releaseHtml}
        </div>

        <!-- Dependencies dots column (desktop) -->
        <div id="pending-${item.id}" class="hidden md:flex items-center gap-1 flex-wrap"></div>

        <div class="flex items-center justify-end">
          <svg id="chevron-${item.id}" class="w-4 h-4 transition-all flex-none" style="color:#808C78;" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
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

    const ghDeps      = deps.filter(d => d.url && d.owner && !d.completed && !d.pending); // GitHub issues — fetchable
    const refDeps     = deps.filter(d => d.url && !d.owner && !d.completed && !d.pending); // Non-GitHub URLs, not completed
    const doneDeps    = deps.filter(d => d.completed);                                      // Explicitly completed
    const dateDeps    = deps.filter(d => !d.url && !d.completed && !d.pending && d.targetDate); // Tracked by date only
    const todoDeps    = deps.filter(d => !d.url && !d.completed && !d.pending && !d.targetDate); // Truly untracked
    const pendingKwDeps = deps.filter(d => d.pending && !d.completed);                      // Explicit Pending keyword — red

    // Simpler: track indices per item
    const startIdx = allRefs.length;
    ghDeps.forEach(d => allRefs.push({ owner: d.owner, repo: d.repo, number: d.number }));

    itemDepMap.set(item.id, { todoDeps, doneDeps, refDeps, dateDeps, ghDeps, pendingKwDeps, startIdx });
  }

  const results = allRefs.length ? await fetchIssuesBatch(allRefs, pat) : [];

  for (const item of items) {
    const entry = itemDepMap.get(item.id);
    if (!entry) continue;

    // team → {notTracked, pending, pendingKw, done}
    const teamCounts = new Map();

    const ensure = (team) => {
      if (!teamCounts.has(team)) teamCounts.set(team, { notTracked: 0, pending: 0, pendingKw: 0, done: 0, url: null, targetDate: null });
      return teamCounts.get(team);
    };

    for (const dep of entry.todoDeps) {
      ensure(dep.team).notTracked++;
    }
    for (const dep of entry.doneDeps) {
      const c = ensure(dep.team);
      c.done++;
      if (!c.url && dep.url) c.url = dep.url;
      if (dep.targetDate && !c.targetDate) c.targetDate = dep.targetDate;
    }
    for (const dep of entry.dateDeps) {
      const c = ensure(dep.team);
      c.pending++;
      if (dep.targetDate && !c.targetDate) c.targetDate = dep.targetDate;
    }
    for (const dep of entry.refDeps) {
      const c = ensure(dep.team);
      if (!c.url) c.url = dep.url;
      if (dep.targetDate && !c.targetDate) c.targetDate = dep.targetDate;
      c.pending++;  // non-GitHub refs treated as pending (no way to check state)
    }
    for (const dep of entry.pendingKwDeps) {
      const c = ensure(dep.team);
      if (dep.url && !c.url) c.url = dep.url;
      if (dep.targetDate && !c.targetDate) c.targetDate = dep.targetDate;
      c.pending++;
      c.pendingKw++;
    }
    for (let i = 0; i < entry.ghDeps.length; i++) {
      const dep = entry.ghDeps[i];
      const result = results[entry.startIdx + i];
      const counts = ensure(dep.team);
      if (!counts.url) counts.url = dep.url;
      if (dep.targetDate && !counts.targetDate) counts.targetDate = dep.targetDate;
      if (result?.error || result?.issue?.state === 'open') {
        counts.pending++;
      } else {
        counts.done++;
      }
    }

    const el = document.getElementById(`pending-${item.id}`);
    if (el) el.innerHTML = renderDepDots(teamCounts);

    // Show doc warning only when: docs dep has a tracked issue, that issue is closed, and no doc URL exists
    const docUrl = extractDocUrl(item.content?.body || '');
    if (!docUrl) {
      let docsIssueClosed = false;
      for (let i = 0; i < entry.ghDeps.length; i++) {
        const dep = entry.ghDeps[i];
        if (dep.team.toLowerCase() === 'docs') {
          const result = results[entry.startIdx + i];
          if (result?.issue?.state === 'closed') {
            docsIssueClosed = true;
          }
        }
      }
      const warnEl = document.getElementById(`doc-warn-${item.id}`);
      if (warnEl && docsIssueClosed) {
        warnEl.classList.remove('hidden');
      }
    }
  }
}

// Dep dot colours: red = not tracked, orange = open/pending, green = closed/done
const DEP_COLORS = { notTracked: '#E46962', pending: '#FA7B17', done: '#6AAE7B' };

function renderDepDots(teamCounts) {
  if (!teamCounts.size) return '';

  return [...teamCounts.entries()].map(([team, { notTracked, pending, pendingKw, done, url, targetDate }]) => {
    let color, statusText;
    if (pendingKw > 0)       { color = DEP_COLORS.pending;    statusText = 'pending'; }
    else if (pending > 0)    { color = DEP_COLORS.pending;    statusText = 'pending'; }
    else if (notTracked > 0) { color = DEP_COLORS.notTracked; statusText = 'not tracked'; }
    else                     { color = DEP_COLORS.done;       statusText = 'done'; }

    const indicator = statusText === 'not tracked'
      ? `<span style="color:#FA7B17;font-size:11px;line-height:1;flex-shrink:0;">⚠</span>`
      : `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${color};flex-shrink:0;"></span>`;

    const dateColor = targetDate ? targetDateColor(targetDate) : null;
    const dateHtml = targetDate
      ? `<span style="font-size:10px;${dateColor ? `color:${dateColor};font-weight:600;` : 'color:#808C78;'}">${escapeHtml(targetDate)}</span>`
      : '';

    const tag = url ? 'a' : 'span';
    const linkAttrs = url ? `href="${escapeHtml(url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()"` : '';

    return `<${tag} ${linkAttrs} title="${escapeHtml(team)}: ${statusText}${targetDate ? ' — due ' + targetDate : ''}"
                  class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs transition-colors"
                  style="background:rgba(255,255,255,0.7);border:1px solid rgba(78,99,94,0.25);font-family:Arial,Helvetica,sans-serif;color:#4E635E;white-space:nowrap;${url ? 'cursor:pointer;text-decoration:none;' : ''}"
                  ${url ? `onmouseover="this.style.background='rgba(78,99,94,0.1)'" onmouseout="this.style.background='rgba(255,255,255,0.7)'"` : ''}>
              ${indicator}
              ${escapeHtml(team)}
              ${dateHtml}
            </${tag}>`;
  }).join('');
}

function attachToggleAllHandler(items) {
  const btn = document.getElementById('btn-toggle-all');
  const label = document.getElementById('toggle-all-label');
  if (!btn || !label) return;

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    if (getOpenCount() > 0) {
      collapseAll();
      label.textContent = 'Expand All';
    } else {
      label.textContent = 'Expanding...';
      await expandAll(items);
      label.textContent = 'Collapse All';
    }
    btn.disabled = false;
  });
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
