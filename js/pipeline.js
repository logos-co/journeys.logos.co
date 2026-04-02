/**
 * pipeline.js — Pipeline view rendering
 */

import {
  extractBlockedTeam, extractDocumentation,
  extractRnD, extractDocPacket, extractRedTeam,
  computeRnDState, computeDocsState, computeRedTeamState, computeActionLabels,
  newIssueBody, renderMarkdown,
} from './markdown.js';
import { toggleDetail, expandAll, collapseAll, getOpenCount } from './detail.js';
import { hasWritePAT, getReadPAT, getWritePAT, getConfig } from './config.js';
import { teamColor, statusBadge, showToast } from './app.js';
import { fetchRefsBatch, createIssue, addItemToProject, createLabel } from './api.js';

// Active filters — persist until project reload
let activeTeamFilter  = null; // null | team slug | 'unassigned'
let activeStateFilter = null; // null | 'action:rnd' | 'action:docs' | 'action:red-team' | 'mismatch'

// Global mismatch registry: itemId → { item, actualLabels, expectedActions }
const _mismatchedItems = new Map();

export function getMismatchCount() { return _mismatchedItems.size; }
export function getMismatchedItems() { return new Map(_mismatchedItems); }

export function updateMismatchEntry(itemId, entry) {
  if (entry) {
    _mismatchedItems.set(itemId, entry);
  } else {
    _mismatchedItems.delete(itemId);
  }
  document.dispatchEvent(new CustomEvent('mismatch-count-changed'));
}

// Project context (set during renderPipeline, used for create)
let _projectId = null;
let _projectOwner = null;
let _projectRepo = null;

export function renderPipeline(container, items, projectTitle, projectId) {
  const canWrite = hasWritePAT();
  _projectId = projectId || null;

  // Derive owner/repo from first item
  const firstRepo = items.find(i => i.content?.repository)?.content?.repository?.nameWithOwner || '';
  const [owner, repo] = firstRepo.split('/');
  _projectOwner = owner || null;
  _projectRepo  = repo || null;

  // Restore filters from URL params (or reset if absent)
  const _urlParams  = new URLSearchParams(window.location.search);
  activeTeamFilter  = _urlParams.get('team')   || null;
  activeStateFilter = _urlParams.get('action') || null;

  const canDrag  = hasWritePAT() && !activeTeamFilter && !activeStateFilter;

  const openItems   = items.filter(i => i.content?.state !== 'CLOSED');
  const closedItems = items
    .filter(i => i.content?.state === 'CLOSED')
    .sort((a, b) => (b.content.closedAt || '').localeCompare(a.content.closedAt || ''));

  const columnHeader = `
    <div class="hidden md:block pointer-events-none select-none">
      <div class="grid grid-cols-[1fr_8rem_9rem_12rem_9rem_2rem] gap-4 items-end px-4 py-1.5 text-xs font-semibold uppercase tracking-wider"
           style="color:#808C78;font-family:Arial,Helvetica,sans-serif;border:1px solid transparent;border-left:3px solid transparent;border-bottom:1px solid rgba(78,99,94,0.2);">
        <div>Journey</div>
        <div>Journey<br>Type</div>
        <div>Target<br>Release</div>
        <div>Progress</div>
        <div>Action<br>Needed From</div>
        <div></div>
      </div>
    </div>`;

  container.innerHTML = `
    <div class="max-w-5xl mx-auto space-y-4">

      <!-- Instructions panel -->
      <div style="border:1px solid rgba(78,99,94,0.25);border-radius:8px;background:rgba(221,222,216,0.35);">
        <button id="btn-instructions-toggle"
                onclick="window._toggleInstructions()"
                class="w-full flex items-center justify-between px-4 py-3 text-left"
                style="font-family:Arial,Helvetica,sans-serif;">
          <span class="text-xs font-semibold uppercase tracking-wider" style="color:#808C78;">Instructions</span>
          <svg id="instructions-chevron" class="w-4 h-4 transition-transform" style="color:#808C78;" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        <div id="instructions-content" class="hidden px-6 pb-6 markdown-body overflow-x-auto"
             style="border-top:1px solid rgba(78,99,94,0.15);padding-top:1.25rem;">
          <p class="text-xs" style="color:#808C78;font-family:Arial,Helvetica,sans-serif;">Loading…</p>
        </div>
      </div>

      <div class="flex items-center justify-between mb-2">
        <div>
          <h1 class="text-2xl font-bold text-forest" style="font-family:'Times New Roman',Times,serif;">${escapeHtml(projectTitle || 'Priority Pipeline')}</h1>
          <p class="text-sm text-muted mt-0.5" style="font-family:Arial,Helvetica,sans-serif;">
            ${openItems.length} open journey${openItems.length !== 1 ? 's' : ''}
            ${canWrite ? `<span id="drag-hint" class="ml-2 text-xs text-coral font-medium${canDrag ? '' : ' hidden'}">· Drag rows to reorder</span>` : ''}
          </p>
        </div>
        <div class="flex items-center gap-3">
          ${canWrite ? `
            <button id="btn-new-journey"
                    class="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded transition-colors"
                    style="background:#E46962;color:#fff;font-family:Arial,Helvetica,sans-serif;border:1px solid #E46962;"
                    onmouseover="this.style.background='#FA7B17';this.style.borderColor='#FA7B17'"
                    onmouseout="this.style.background='#E46962';this.style.borderColor='#E46962'">
              <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              New Journey
            </button>
          ` : ''}
          <button id="btn-toggle-all" class="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded transition-colors"
                  style="color:#808C78;border:1px solid rgba(78,99,94,0.3);font-family:Arial,Helvetica,sans-serif;"
                  onmouseover="this.style.background='rgba(78,99,94,0.1)'"
                  onmouseout="this.style.background=''">
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5"/>
            </svg>
            <span id="toggle-all-label">Expand All</span>
          </button>
        </div>
      </div>

      ${renderFilterBar(openItems)}

      <div id="pipeline-list" class="space-y-1.5">
        ${columnHeader}
        ${openItems.map((item, index) => renderPipelineRow(item, index, canDrag, canWrite)).join('')}
      </div>

      <div id="no-filter-match" class="hidden text-center py-8 text-muted" style="font-family:Arial,Helvetica,sans-serif;">
        <p class="text-sm">No journeys match the selected filter</p>
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

    ${renderNewJourneyModal()}
  `;

  const allItems = [...openItems, ...closedItems];
  attachRowClickHandlers(allItems);
  attachToggleAllHandler(allItems);
  attachFilterHandlers(allItems);
  // Activate pills and apply filter if restored from URL
  if (activeTeamFilter) {
    const btn = document.querySelector(`.filter-team-pill[data-team="${CSS.escape(activeTeamFilter)}"]`);
    if (btn) teamPillActivate(btn);
  }
  if (activeStateFilter) {
    const btn = document.querySelector(`.filter-action-pill[data-action="${CSS.escape(activeStateFilter)}"]`);
    if (btn) pillActivate(btn, ACTION_PILL_COLORS[activeStateFilter] || '#808C78');
  }
  if (activeTeamFilter || activeStateFilter) applyFilter(allItems);
  attachNewJourneyHandler(projectId);
  loadAllStakeholderBadges(allItems);
  loadInstructions();
}

function loadInstructions() {
  const content = document.getElementById('instructions-content');
  if (!content) return;

  const usageText = `## Usage

For Logos R&D Leads.

1. Go to https://journeys.logos.co or run locally with \`npx serve .\`.
2. Follow instructions to enter GitHub PAT Token.
3. **Filter by team**: Click on your team in the "Team:" line.
4. **Filter by action needed**: use the filter bar at the top to show only journeys where your team has an open action: \`action:rnd\`.
5. **Expand a journey**: click any row to open the detail panel. It shows the full workflow state for R&D, Doc Packet, Documentation, and Red Team.
6. **Enable editing**: click the **Edit** button in the header. Once active, the button shows **Editing** in coral.
7. **Fill in missing information**: with editing enabled, each workflow section shows an input field. Paste the relevant URL or value and press Enter (or click ✓) to save directly to the GitHub issue.

> **Settings** (gear icon): change the owner, project number, or token at any time.

### Missing Information for R&D Logos Lead

As a first step, Logos R&D Leads need to:

1. Verify their journeys are correct, with the right target release.
2. Ensure there are no missing journeys. Click "+ New Journey" to add a journey in **Editing** mode.
3. Expand a journey (start from the top).
   1. If the software is already delivered, jump to "doc packet" and fill in the GitHub issue template.
   2. For software yet to be done, start with the "R&D" section, and enter a link to the milestone. Once known, enter the date.`;

  content.innerHTML = renderMarkdown(usageText) +
    `<p class="mt-4 text-xs" style="font-family:Arial,Helvetica,sans-serif;color:#808C78;">
      <a href="https://github.com/logos-co/journeys.logos.co#readme" target="_blank" rel="noopener"
         style="color:#E46962;text-decoration:underline;text-underline-offset:2px;">More information →</a>
    </p>`;
}

window._toggleInstructions = () => {
  const content  = document.getElementById('instructions-content');
  const chevron  = document.getElementById('instructions-chevron');
  if (!content) return;
  const isHidden = content.classList.toggle('hidden');
  if (chevron) chevron.style.transform = isHidden ? '' : 'rotate(180deg)';
};

// ---------------------------------------------------------------------------
// Filter bar (action-required pills)
// ---------------------------------------------------------------------------

function renderFilterBar(openItems = []) {
  // Collect distinct R&D team slugs from open items
  const teamSet = new Set();
  let hasUnassigned = false;
  for (const item of openItems) {
    const rnd = extractRnD(item.content?.body || '');
    if (rnd.team) teamSet.add(rnd.team);
    else hasUnassigned = true;
  }

  const pill = (cls, dataAttr, label) => `
    <button class="${cls} inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all"
            ${dataAttr}
            style="border:1px solid rgba(78,99,94,0.3);background:transparent;color:#808C78;font-family:Arial,Helvetica,sans-serif;cursor:pointer;">
      ${escapeHtml(label)}
    </button>`;

  const teamPill = (team) => {
    const c = teamColor(team, 1);
    return `<button class="filter-team-pill inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all"
            data-team="${escapeHtml(team)}" data-team-color="${escapeHtml(c)}"
            style="border:1px solid ${teamColor(team, 0.25)};background:${teamColor(team, 0.06)};color:${teamColor(team, 0.55)};font-family:Arial,Helvetica,sans-serif;cursor:pointer;">
      ${escapeHtml(team)}
    </button>`;
  };

  const teamRow = (teamSet.size > 0 || hasUnassigned) ? `
    <div id="team-filter-bar" class="flex items-center gap-2 flex-wrap">
      <span class="text-xs flex-none" style="color:#808C78;font-family:Arial,Helvetica,sans-serif;">Team:</span>
      ${[...teamSet].sort().map(t => teamPill(t)).join('')}
      ${hasUnassigned ? pill('filter-team-pill', 'data-team="unassigned"', 'unassigned') : ''}
    </div>` : '';

  const actionFilters = [
    { key: 'action:rnd',      label: 'needs R&D'      },
    { key: 'action:docs',     label: 'needs docs'     },
    { key: 'action:red-team', label: 'needs red team' },
    { key: 'mismatch',        label: '⚠ out of sync'  },
  ];
  const actionRow = `
    <div id="action-filter-bar" class="flex items-center gap-2 flex-wrap">
      <span class="text-xs flex-none" style="color:#808C78;font-family:Arial,Helvetica,sans-serif;">Action:</span>
      ${actionFilters.map(f => pill('filter-action-pill', `data-action="${escapeHtml(f.key)}"`, f.label)).join('')}
    </div>`;

  return `<div id="filter-bar" class="space-y-1.5">${teamRow}${actionRow}</div>`;
}

function applyFilter(allItems) {
  const noMatch   = document.getElementById('no-filter-match');
  const anyFilter = activeTeamFilter || activeStateFilter;

  // Toggle drag hint
  const dragHint = document.getElementById('drag-hint');
  if (dragHint) dragHint.classList.toggle('hidden', !!anyFilter);

  // Toggle drag: disable when any filter active
  document.querySelectorAll('#pipeline-list .pipeline-row').forEach(el => {
    const handle = el.querySelector('.drag-handle');
    const rank   = el.querySelector('.rank-number');
    if (anyFilter) {
      if (el.getAttribute('draggable') === 'true') {
        el.setAttribute('draggable', 'false');
        el.dataset.dragDisabled = 'true';
        el.classList.remove('draggable-row');
      }
      if (handle) handle.classList.add('hidden');
      if (rank)   rank.classList.remove('hidden');
    } else if (el.dataset.dragDisabled) {
      el.setAttribute('draggable', 'true');
      el.classList.add('draggable-row');
      delete el.dataset.dragDisabled;
      if (handle) handle.classList.remove('hidden');
      if (rank)   rank.classList.add('hidden');
    }
  });

  if (!anyFilter) {
    for (const item of allItems) {
      document.getElementById(`filter-item-${item.id}`)?.classList.remove('hidden');
    }
    if (noMatch) noMatch.classList.add('hidden');
    return;
  }

  let visible = 0;
  for (const item of allItems) {
    const wrapper = document.getElementById(`filter-item-${item.id}`);
    if (!wrapper) continue;

    let matchesTeam = true;
    if (activeTeamFilter) {
      const slug = wrapper.dataset.rndTeam || '';
      matchesTeam = activeTeamFilter === 'unassigned' ? !slug : slug === activeTeamFilter;
    }

    let matchesAction = true;
    if (activeStateFilter) {
      if (activeStateFilter === 'mismatch') {
        matchesAction = wrapper.dataset.mismatch === 'true';
      } else {
        const labels = JSON.parse(wrapper.dataset.actionLabels || '[]');
        matchesAction = labels.includes(activeStateFilter);
      }
    }

    const matches = matchesTeam && matchesAction;
    wrapper.classList.toggle('hidden', !matches);
    if (matches) visible++;
  }
  if (noMatch) noMatch.classList.toggle('hidden', visible > 0);
}

function syncFiltersToUrl() {
  const params = new URLSearchParams();
  if (activeTeamFilter)  params.set('team',   activeTeamFilter);
  if (activeStateFilter) params.set('action', activeStateFilter);
  const qs = params.toString();
  history.replaceState(null, '', qs ? '?' + qs : window.location.pathname);
}

const ACTION_PILL_COLORS = {
  'action:rnd': '#3B7CB8', 'action:docs': '#6AAE7B', 'action:red-team': '#E46962', 'mismatch': '#FA7B17',
};

function pillReset(btn) {
  btn.style.background   = 'transparent';
  btn.style.color        = '#808C78';
  btn.style.borderColor  = 'rgba(78,99,94,0.3)';
}

function teamPillReset(btn) {
  const team = btn.dataset.team;
  if (!team || team === 'unassigned') { pillReset(btn); return; }
  btn.style.background  = teamColor(team, 0.06);
  btn.style.color       = teamColor(team, 0.55);
  btn.style.borderColor = teamColor(team, 0.25);
}

function pillActivate(btn, color) {
  btn.style.background  = color + '22';
  btn.style.color       = color;
  btn.style.borderColor = color + '88';
}

function teamPillActivate(btn) {
  const team = btn.dataset.team;
  if (!team || team === 'unassigned') { pillActivate(btn, '#4E635E'); return; }
  btn.style.background  = teamColor(team, 0.2);
  btn.style.color       = teamColor(team, 1);
  btn.style.borderColor = teamColor(team, 0.7);
}

function attachFilterHandlers(allItems) {
  // Action pills
  document.querySelectorAll('.filter-action-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.action;
      if (activeStateFilter === key) {
        activeStateFilter = null;
        pillReset(btn);
      } else {
        document.querySelectorAll('.filter-action-pill').forEach(pillReset);
        activeStateFilter = key;
        pillActivate(btn, ACTION_PILL_COLORS[key] || '#808C78');
      }
      applyFilter(allItems);
      syncFiltersToUrl();
    });
  });

  // Team pills
  document.querySelectorAll('.filter-team-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      const team = btn.dataset.team;
      if (activeTeamFilter === team) {
        activeTeamFilter = null;
        teamPillReset(btn);
      } else {
        document.querySelectorAll('.filter-team-pill').forEach(teamPillReset);
        activeTeamFilter = team;
        teamPillActivate(btn);
      }
      applyFilter(allItems);
      syncFiltersToUrl();
    });
  });
}

// ---------------------------------------------------------------------------
// Pipeline row
// ---------------------------------------------------------------------------

function renderPipelineRow(item, index, canDrag, canWrite = false) {
  const issue = item.content;
  if (!issue) return '';

  const labels      = issue.labels?.nodes || [];
  const blockedTeam = extractBlockedTeam(labels);
  const repo        = issue.repository?.nameWithOwner || '';
  const rankLabel   = String(index + 1).padStart(2, '0');

  const actionLabels = labels.filter(l => l.name.startsWith('action:')).map(l => l.name);
  const rnd          = extractRnD(issue.body || '');
  const rndTeamSlug  = rnd.team || '';

  const typeLabels    = labels.filter(l => /^(gui user|developer|node operator)$/i.test(l.name.trim()));
  const releaseLabels = labels.filter(l => /^testnet\b/i.test(l.name.trim()));

  const JOURNEY_COLORS = { 'gui user': 'D94F45', 'developer': '3B7CB8', 'node operator': 'C4912C' };
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
  const releaseHtml    = releaseLabels.length
    ? releaseLabels.map(labelPill).join(' ')
    : `<span class="text-xs italic" style="color:#808C78;font-family:Arial,Helvetica,sans-serif;">—</span>`;

  const { link: docUrl } = extractDocumentation(issue.body || '');

  return `
    <div id="filter-item-${item.id}"
         data-action-labels="${escapeHtml(JSON.stringify(actionLabels))}"
         data-rnd-team="${escapeHtml(rndTeamSlug)}">
      <div
        id="row-${item.id}"
        data-item-id="${item.id}"
        data-index="${index}"
        data-repo="${escapeHtml(repo)}"
        data-issue="${issue.number}"
        draggable="${canDrag}"
        class="pipeline-row grid grid-cols-[1fr_auto] md:grid-cols-[1fr_8rem_9rem_12rem_9rem_2rem] gap-4 items-center px-4 py-3 rounded cursor-pointer transition-all select-none ${canDrag ? 'draggable-row' : ''}"
        style="background:rgba(255,255,255,0.75);border:1px solid rgba(78,99,94,0.2);border-left:3px solid ${blockedTeam ? teamColor(blockedTeam, 0.6) : 'transparent'};"
        onmouseover="this.style.background='rgba(78,99,94,0.1)'"
        onmouseout="this.style.background='rgba(255,255,255,0.75)'"
      >
        <div class="min-w-0">
          <div class="flex items-baseline gap-2.5">
            ${canWrite
              ? `<span class="drag-handle flex-none${canDrag ? '' : ' hidden'}" title="Drag to reorder">⠿</span>
                 <span class="rank-number flex-none${canDrag ? ' hidden' : ''}">${rankLabel}</span>`
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

        <!-- Stakeholder progress column (desktop) -->
        <div id="pending-${item.id}" class="hidden md:flex items-center gap-1 flex-wrap"></div>

        <!-- Action needed from column (desktop) -->
        <div id="action-${item.id}" class="hidden md:flex items-center gap-1 flex-wrap"></div>

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

// ---------------------------------------------------------------------------
// Stakeholder badges (async — loads after render)
// ---------------------------------------------------------------------------

const RND_COLORS = {
  'to-be-confirmed':      '#E46962',
  'confirmed':            '#FA7B17',
  'in-progress':          '#FA7B17',
  'doc-packet-delivered': '#6AAE7B',
};
const DOCS_COLORS = {
  'waiting':          '#808C78',
  'in-progress':      '#FA7B17',
  'ready-for-review': '#34befc',
  'merged':           '#6AAE7B',
};
const REDTEAM_COLORS = {
  'waiting':     '#808C78',
  'in-progress': '#FA7B17',
  'done':        '#6AAE7B',
};
const ACTION_LABEL_COLORS = {
  'action:rnd':      '#3B7CB8',
  'action:docs':     '#6AAE7B',
  'action:red-team': '#E46962',
};

function dot(color) {
  return `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${color};flex-shrink:0;margin-top:1px;"></span>`;
}

function stakeholderBadge(label, color, url, tooltip) {
  const tag   = url ? 'a' : 'span';
  const attrs = url ? `href="${escapeHtml(url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()"` : '';
  return `<${tag} ${attrs}
    class="inline-flex items-center gap-1 px-1.5 py-px rounded text-xs transition-colors"
    style="background:rgba(255,255,255,0.7);border:1px solid rgba(78,99,94,0.25);font-family:Arial,Helvetica,sans-serif;color:#4E635E;white-space:nowrap;${url ? 'text-decoration:none;cursor:pointer;' : ''}"
    title="${escapeHtml(tooltip)}"
    ${url ? `onmouseover="this.style.background='rgba(78,99,94,0.1)'" onmouseout="this.style.background='rgba(255,255,255,0.7)'"` : ''}>
    ${dot(color)} ${escapeHtml(label)}
  </${tag}>`;
}

export function renderStakeholderBadges(rndTeam, rndState, docsLink, docsState, redTeamLink, redTeamState) {
  const rndColor = RND_COLORS[rndState] || '#808C78';
  const rndBadge = stakeholderBadge('r&d', rndColor, null, `R&D: ${rndTeam || 'unassigned'} — ${rndState}`);
  const docsBadge   = stakeholderBadge('docs',     DOCS_COLORS[docsState]            || '#808C78', docsLink,     `docs: ${docsState}`);
  const rtBadge     = stakeholderBadge('red team', REDTEAM_COLORS[redTeamState]       || '#808C78', redTeamLink,  `red team: ${redTeamState}`);

  return rndBadge + docsBadge + rtBadge;
}

export function renderActionColumn(rndTeam, actionLabels, mismatch) {
  const ACTION_TEAM_MAP = {
    'action:rnd':      rndTeam || 'r&d',
    'action:docs':     'docs',
    'action:red-team': 'red team',
  };

  const teams = actionLabels.map(l => {
    const name = ACTION_TEAM_MAP[l] || l.replace('action:', '');
    const bg    = teamColor(name, 0.12);
    const text  = teamColor(name, 0.85);
    const border = teamColor(name, 0.35);
    return `<span class="inline-flex items-center px-1.5 py-px rounded text-xs font-medium"
      style="background:${bg};color:${text};border:1px solid ${border};font-family:Arial,Helvetica,sans-serif;white-space:nowrap;">
      ${escapeHtml(name)}
    </span>`;
  }).join('');

  const warnHtml = mismatch
    ? `<span title="Action labels out of sync with issue state" style="color:#FA7B17;font-size:12px;cursor:help;">⚠</span>`
    : '';

  return teams + warnHtml;
}

async function loadAllStakeholderBadges(items) {
  const pat = getReadPAT();

  // Collect all links to fetch
  const linksToFetch = [];
  const itemLinkMap  = new Map();

  for (const item of items) {
    const body = item.content?.body || '';
    const { link: docsLink }       = extractDocumentation(body);
    const { tracking: redTeamLink } = extractRedTeam(body);

    const docsIdx = docsLink ? linksToFetch.length : -1;
    if (docsLink) linksToFetch.push(docsLink);

    const rtIdx = redTeamLink ? linksToFetch.length : -1;
    if (redTeamLink) linksToFetch.push(redTeamLink);

    itemLinkMap.set(item.id, { docsIdx, rtIdx });
  }

  const refResults = linksToFetch.length ? await fetchRefsBatch(linksToFetch, pat) : [];

  _mismatchedItems.clear();

  for (const item of items) {
    const body = item.content?.body || '';
    const rnd              = extractRnD(body);
    const docPacketContent = extractDocPacket(body);
    const { link: docsLink }        = extractDocumentation(body);
    const { tracking: redTeamLink } = extractRedTeam(body);
    const labels       = item.content?.labels?.nodes || [];
    const actionLabels = labels.filter(l => l.name.startsWith('action:')).map(l => l.name);

    const rndState     = computeRnDState(rnd, docPacketContent);
    const { docsIdx, rtIdx } = itemLinkMap.get(item.id) || {};
    const docsRef    = docsIdx >= 0 ? refResults[docsIdx] : null;
    const rtRef      = rtIdx   >= 0 ? refResults[rtIdx]   : null;
    item._refCache   = { docsLink, docsRef, redTeamLink, rtRef };
    const docsState  = computeDocsState(docsLink, docsRef);
    const redTeamState = computeRedTeamState(redTeamLink, rtRef);

    // Corruption detection: compare actual action labels vs expected
    const expectedActions = computeActionLabels(rndState, docsState, redTeamState);
    const allLabels = labels.map(l => l.name);
    const mismatch = JSON.stringify([...actionLabels].sort()) !== JSON.stringify([...expectedActions].sort());

    if (mismatch) {
      _mismatchedItems.set(item.id, { item, actualLabels: allLabels, expectedActions });
    }

    const el = document.getElementById(`pending-${item.id}`);
    if (el) el.innerHTML = renderStakeholderBadges(
      rnd.team, rndState, docsLink, docsState, redTeamLink, redTeamState
    );

    const actionEl = document.getElementById(`action-${item.id}`);
    if (actionEl) actionEl.innerHTML = renderActionColumn(rnd.team, actionLabels, mismatch);

    // Update filter wrapper with current action labels and mismatch flag
    const wrapper = document.getElementById(`filter-item-${item.id}`);
    if (wrapper) {
      wrapper.dataset.actionLabels = JSON.stringify(actionLabels);
      wrapper.dataset.mismatch = mismatch ? 'true' : 'false';
    }
  }

  // Notify header to update fix-labels button state
  document.dispatchEvent(new CustomEvent('mismatch-count-changed'));
}

// ---------------------------------------------------------------------------
// New Journey modal
// ---------------------------------------------------------------------------

const RND_TEAMS   = ['anon-comms', 'messaging', 'core', 'storage', 'blockchain', 'zones', 'devkit'];
const JOURNEY_TYPES = [
  { name: 'developer',     label: 'Developer',      color: '3B7CB8' },
  { name: 'gui user',      label: 'GUI User',        color: 'D94F45' },
  { name: 'node operator', label: 'Node Operator',   color: 'C4912C' },
];
const RELEASES = ['testnet v0.1', 'testnet v0.2', 'testnet v0.3', 'testnet unscheduled'];

function renderNewJourneyModal() {
  return `
    <div id="new-journey-overlay" class="hidden fixed inset-0 z-50 flex items-center justify-center"
         style="background:rgba(14,38,24,0.7);" onclick="if(event.target===this)window._closeNewJourney()">
      <div class="w-full max-w-lg mx-4 rounded-lg overflow-hidden shadow-xl"
           style="background:#F5F3EC;border:1px solid rgba(78,99,94,0.3);">
        <div class="px-6 py-4 flex items-center justify-between"
             style="background:#0C2B2D;border-bottom:1px solid rgba(255,255,255,0.1);">
          <h2 class="text-base font-semibold text-parchment" style="font-family:'Times New Roman',Times,serif;">New Journey</h2>
          <button onclick="window._closeNewJourney()" class="text-parchment opacity-60 hover:opacity-100 transition-opacity">
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>
        <div class="p-6 space-y-4">
          <div>
            <label class="block text-xs font-semibold uppercase tracking-wider mb-1.5" style="color:#808C78;font-family:Arial,Helvetica,sans-serif;">Title <span style="color:#E46962;">*</span></label>
            <input id="nj-title" type="text" placeholder="Journey title" class="logos-input w-full" />
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-xs font-semibold uppercase tracking-wider mb-1.5" style="color:#808C78;font-family:Arial,Helvetica,sans-serif;">Journey Type <span style="color:#E46962;">*</span></label>
              <select id="nj-type" class="logos-input w-full text-sm">
                ${JOURNEY_TYPES.map(t => `<option value="${t.name}">${t.label}</option>`).join('')}
              </select>
            </div>
            <div>
              <label class="block text-xs font-semibold uppercase tracking-wider mb-1.5" style="color:#808C78;font-family:Arial,Helvetica,sans-serif;">Target Release <span style="color:#E46962;">*</span></label>
              <select id="nj-release" class="logos-input w-full text-sm">
                ${RELEASES.map(r => `<option value="${r}">${r}</option>`).join('')}
              </select>
            </div>
          </div>
          <div>
            <label class="block text-xs font-semibold uppercase tracking-wider mb-1.5" style="color:#808C78;font-family:Arial,Helvetica,sans-serif;">R&D Owner Team <span style="color:#E46962;">*</span></label>
            <select id="nj-team" class="logos-input w-full text-sm">
              ${RND_TEAMS.map(t => `<option value="${t}">${t}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="block text-xs font-semibold uppercase tracking-wider mb-1.5" style="color:#808C78;font-family:Arial,Helvetica,sans-serif;">Milestone URL <span class="font-normal normal-case" style="color:#808C78;">(optional)</span></label>
            <input id="nj-milestone" type="text" placeholder="https://roadmap.logos.co/..." class="logos-input w-full text-sm" />
          </div>
        </div>
        <div class="px-6 py-4 flex items-center justify-end gap-3" style="border-top:1px solid rgba(78,99,94,0.15);">
          <button onclick="window._closeNewJourney()" class="text-sm text-muted hover:text-forest transition-colors" style="font-family:Arial,Helvetica,sans-serif;">Cancel</button>
          <button id="nj-submit" onclick="window._submitNewJourney()"
                  class="text-sm text-white px-4 py-1.5 rounded transition-colors"
                  style="background:#E46962;font-family:Arial,Helvetica,sans-serif;"
                  onmouseover="this.style.background='#FA7B17'" onmouseout="this.style.background='#E46962'">
            Create Journey
          </button>
        </div>
      </div>
    </div>`;
}

function attachNewJourneyHandler(projectId) {
  const btn = document.getElementById('btn-new-journey');
  if (btn) {
    btn.addEventListener('click', () => {
      document.getElementById('new-journey-overlay')?.classList.remove('hidden');
      document.getElementById('nj-title')?.focus();
    });
  }

  window._closeNewJourney = () => {
    document.getElementById('new-journey-overlay')?.classList.add('hidden');
    ['nj-title', 'nj-milestone'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
  };

  window._submitNewJourney = async () => {
    const title     = document.getElementById('nj-title')?.value.trim();
    const type      = document.getElementById('nj-type')?.value;
    const release   = document.getElementById('nj-release')?.value;
    const team      = document.getElementById('nj-team')?.value;
    const milestone = document.getElementById('nj-milestone')?.value.trim();

    if (!title) { showToast('error', 'Title is required'); return; }

    const pat = getWritePAT();
    if (!pat) { showToast('error', 'Write token required'); return; }
    if (!_projectOwner || !_projectRepo) { showToast('error', 'Could not determine repository'); return; }

    const submitBtn = document.getElementById('nj-submit');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Creating…'; }

    try {
      // Ensure action:rnd label exists
      await createLabel(_projectOwner, _projectRepo, 'action:rnd', 'E46962', pat);

      // Build body
      let body = newIssueBody(team);
      if (milestone) body = body.replace(/- milestone:[ ]*/, `- milestone: ${milestone}`);

      const labels = [type, release, 'action:rnd'];
      const issue  = await createIssue(_projectOwner, _projectRepo, title, body, labels, pat);

      if (projectId && issue.node_id) {
        await addItemToProject(projectId, issue.node_id, pat);
      }

      showToast('success', `Created #${issue.number}: ${title}`);
      window._closeNewJourney();

      // Reload after short delay to show new issue
      setTimeout(() => window.location.reload(), 1200);
    } catch (err) {
      showToast('error', `Failed to create: ${err.message}`);
    } finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Create Journey'; }
    }
  };
}

// ---------------------------------------------------------------------------
// Expand / Collapse all
// ---------------------------------------------------------------------------

function attachToggleAllHandler(items) {
  const btn   = document.getElementById('btn-toggle-all');
  const label = document.getElementById('toggle-all-label');
  if (!btn || !label) return;

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    if (getOpenCount() > 0) {
      collapseAll();
      label.textContent = 'Expand All';
    } else {
      label.textContent = 'Expanding…';
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
