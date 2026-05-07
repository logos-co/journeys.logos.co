/**
 * pipeline.js — Pipeline view rendering
 */

import {
  extractBlockingTeam, extractDocumentation,
  extractRnD, extractDocPacket, extractRedTeam,
  computeStatus, computeDesiredLabels, LIFECYCLE_BLOCKED_BY, RND_TEAMS,
  newIssueBody, renderMarkdown,
} from './markdown.js';
import { toggleDetail, expandAll, collapseAll, getOpenCount } from './detail.js';
import { hasWritePAT, getReadPAT, getWritePAT, getConfig } from './config.js';
import { teamColor, statusBadge, showToast } from './app.js';
import { fetchRefsBatch, createIssue, addItemToProject, fetchMilestoneProgress, ensureLifecycleLabels } from './api.js';

// Active filters — persist until project reload
let activeTeamFilter  = null; // null | team slug | 'unassigned'
let activeStateFilter = null; // null | 'blocked-by:<...>' | 'mismatch'
let activeTypeFilter  = null; // null | 'gui-user' | 'developer' | 'node-operator' | 'untagged'

// Persona type labels — single source of truth.
const TYPE_DEFS = [
  { slug: 'gui-user',      label: 'gui user',      color: '#D94F45' },
  { slug: 'developer',     label: 'developer',     color: '#3B7CB8' },
  { slug: 'node-operator', label: 'node operator', color: '#C4912C' },
];
const UNTAGGED_COLOR = '#808C78';
const TYPE_LABEL_TO_SLUG = Object.fromEntries(TYPE_DEFS.map(d => [d.label, d.slug]));
const TYPE_SLUGS         = new Set([...TYPE_DEFS.map(d => d.slug), 'untagged']);
const TYPE_COLOR         = (slug) => slug === 'untagged' ? UNTAGGED_COLOR : (TYPE_DEFS.find(d => d.slug === slug)?.color ?? UNTAGGED_COLOR);

// Global mismatch registry: itemId → { item, actualLabels, desiredStatus, desiredBlockedBy }
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

// ─── Parsed-section cache (avoids re-extracting the same body 2-5× per item) ─
function getParsedSections(item) {
  const body = item.content?.body || '';
  if (item._parsed && item._parsedBody === body) return item._parsed;
  item._parsedBody = body;
  item._parsed = {
    rnd:       extractRnD(body),
    docPacket: extractDocPacket(body),
    docs:      extractDocumentation(body),
    redTeam:   extractRedTeam(body),
  };
  return item._parsed;
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
  const _typeParam  = (_urlParams.get('type') || '').trim().toLowerCase();
  activeTypeFilter  = TYPE_SLUGS.has(_typeParam) ? _typeParam : null;

  const canDrag  = hasWritePAT() && !activeTeamFilter && !activeStateFilter && !activeTypeFilter;

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
        <div>Status</div>
        <div>Blocked<br>By</div>
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
    if (btn) pillActivate(btn, actionPillColor(activeStateFilter));
  }
  if (activeTypeFilter) {
    const btn = document.querySelector(`.filter-type-pill[data-type="${CSS.escape(activeTypeFilter)}"]`);
    if (btn) {
      typePillActivate(btn);
    } else {
      // Persona row didn't render (no journey on the board carries this slug).
      // Drop the orphan filter so it can't silently affect a later applyFilter().
      activeTypeFilter = null;
      syncFiltersToUrl();
    }
  }
  if (activeTeamFilter || activeStateFilter || activeTypeFilter) applyFilter(allItems);
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
4. **Filter by who's blocking**: use the "Blocked by" filter bar at the top to show only journeys where your team is blocking progress (e.g. \`blocked-by:rnd-zones\`).
5. **Expand a journey**: click any row to open the detail panel. It shows the R&D fields, Doc Packet link, Documentation tracking + PR, and Red Team tracking.
6. **Enable editing**: click the **Edit** button in the header. Once active, the button shows **Editing** in coral.
7. **Fill in missing information**: with editing enabled, each section shows an input field. Paste the relevant URL or value and press Enter (or click ✓) to save directly to the GitHub issue.
8. **Sync labels**: if the ⚠ Fix Labels button appears, click it to reconcile the \`status:*\` / \`blocked-by:*\` labels with the issue body.

> **Settings** (gear icon): change the owner, project number, or token at any time.

### Lifecycle phases and next steps

Each journey has exactly one \`status:*\` label plus one or more \`blocked-by:*\` labels, auto-managed from the issue body. The "Next step" column tells the blocking team what to do:

| Status                           | Next step (who does it)                                                                                                | Blocked by              |
|----------------------------------|------------------------------------------------------------------------------------------------------------------------|-------------------------|
| \`status:confirm-roadmap\`        | **R&D lead**: set \`- team:\` and a \`- milestone:\` URL in the body                                                    | \`blocked-by:rnd[-<team>]\` |
| \`status:confirm-date\`           | **R&D lead**: add \`- date:\` (DDMmmYY)                                                                                 | \`blocked-by:rnd-<team>\`   |
| \`status:rnd-in-progress\`        | **R&D**: deliver the roadmap milestones (auto-advances when all are ticked in [roadmap.logos.co](https://roadmap.logos.co)) | \`blocked-by:rnd-<team>\`   |
| \`status:rnd-overdue\`            | **R&D**: deliver the milestones — date passed, update the date or close them                                           | \`blocked-by:rnd-<team>\`   |
| \`status:waiting-for-doc-packet\` | **R&D**: file a doc packet issue from the [template](https://github.com/logos-co/logos-docs/issues/new?template=doc-packet.yml), paste URL into \`## Doc Packet - link:\` | \`blocked-by:rnd-<team>\` |
| \`status:doc-packet-delivered\`   | **Docs**: open a tracking issue (\`## Documentation - tracking:\`), write the doc, and once the PR is ready for review paste its URL into \`## Documentation - pr:\` | \`blocked-by:docs\`         |
| \`status:doc-ready-for-review\`   | **R&D and Red Team**: review the doc PR. **Docs**: merge the PR once both have approved                                | \`blocked-by:red-team\` + \`blocked-by:rnd-<team>\` |
| \`status:doc-merged\`             | **Red Team**: finish dogfooding, close \`## Red Team - tracking:\` when done                                            | \`blocked-by:red-team\`     |
| \`status:completed\`              | Nothing — journey is done                                                                                              | —                       |

### As a first step, Logos R&D Leads should:

1. Verify their journeys are correct, with the right target release.
2. Ensure there are no missing journeys. Click "+ New Journey" to add one in **Editing** mode.
3. Expand a journey (start from the top).
   1. If the software is already delivered, jump to "Doc Packet" and fill in the GitHub issue template.
   2. For software yet to be done, start with the "R&D" section: enter a milestone URL, then the estimated date.`;

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
  // Collect distinct R&D team slugs from open items (for the team-ownership row).
  const teamSet = new Set();
  let hasUnassigned = false;
  // Persona type slugs present on at least one open journey, plus whether any journey is untagged.
  const typeSet = new Set();
  let hasUntagged = false;
  for (const item of openItems) {
    const { rnd } = getParsedSections(item);
    if (rnd.team) teamSet.add(rnd.team);
    else hasUnassigned = true;

    const labels = item.content?.labels?.nodes || [];
    let foundType = false;
    for (const l of labels) {
      const slug = TYPE_LABEL_TO_SLUG[l.name.trim().toLowerCase()];
      if (slug) { typeSet.add(slug); foundType = true; }
    }
    if (!foundType) hasUntagged = true;
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

  // Persona row — single-select. Order: gui user, developer, node operator, untagged.
  const typePill = (slug, label) => {
    const c = TYPE_COLOR(slug);
    return `<button class="filter-type-pill inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all"
            data-type="${escapeHtml(slug)}"
            style="border:1px solid ${c}40;background:${c}10;color:${c};font-family:Arial,Helvetica,sans-serif;cursor:pointer;">
      ${escapeHtml(label)}
    </button>`;
  };
  const typeRow = (typeSet.size > 0 || hasUntagged) ? `
    <div id="type-filter-bar" class="flex items-center gap-2 flex-wrap">
      <span class="text-xs flex-none" style="color:#808C78;font-family:Arial,Helvetica,sans-serif;">Persona:</span>
      ${TYPE_DEFS.filter(d => typeSet.has(d.slug)).map(d => typePill(d.slug, d.label)).join('')}
      ${hasUntagged ? typePill('untagged', 'untagged') : ''}
    </div>` : '';

  // "Blocked by" filter pills — order: R&D (all) → docs → red team → per-team → unassigned → mismatch.
  const rndTeamsPresent = [...teamSet].sort();
  const blockedByFilters = [
    { key: 'blocked-by:rnd-*',    label: 'R&D'      },
    { key: 'blocked-by:docs',     label: 'docs'     },
    { key: 'blocked-by:red-team', label: 'red team' },
    ...rndTeamsPresent.map(t => ({ key: `blocked-by:rnd-${t}`, label: t })),
    ...(hasUnassigned ? [{ key: 'blocked-by:rnd', label: 'unassigned' }] : []),
    { key: 'mismatch',            label: '⚠ out of sync' },
  ];
  const actionRow = `
    <div id="action-filter-bar" class="flex items-center gap-2 flex-wrap">
      <span class="text-xs flex-none" style="color:#808C78;font-family:Arial,Helvetica,sans-serif;">Blocked by:</span>
      ${blockedByFilters.map(f => pill('filter-action-pill', `data-action="${escapeHtml(f.key)}"`, f.label)).join('')}
    </div>`;

  return `<div id="filter-bar" class="space-y-1.5">${typeRow}${teamRow}${actionRow}</div>`;
}

function applyFilter(allItems) {
  const noMatch   = document.getElementById('no-filter-match');
  const anyFilter = activeTeamFilter || activeStateFilter || activeTypeFilter;

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
      } else if (activeStateFilter === 'blocked-by:rnd-*') {
        const labels = JSON.parse(wrapper.dataset.actionLabels || '[]');
        matchesAction = labels.some(l => l === 'blocked-by:rnd' || l.startsWith('blocked-by:rnd-'));
      } else {
        const labels = JSON.parse(wrapper.dataset.actionLabels || '[]');
        matchesAction = labels.includes(activeStateFilter);
      }
    }

    let matchesType = true;
    if (activeTypeFilter) {
      const types = (wrapper.dataset.types || '').split(' ').filter(Boolean);
      matchesType = activeTypeFilter === 'untagged' ? types.length === 0 : types.includes(activeTypeFilter);
    }

    const matches = matchesTeam && matchesAction && matchesType;
    wrapper.classList.toggle('hidden', !matches);
    if (matches) visible++;
  }
  if (noMatch) noMatch.classList.toggle('hidden', visible > 0);
}

function syncFiltersToUrl() {
  const params = new URLSearchParams();
  if (activeTeamFilter)  params.set('team',   activeTeamFilter);
  if (activeStateFilter) params.set('action', activeStateFilter);
  if (activeTypeFilter)  params.set('type',   activeTypeFilter);
  const qs = params.toString();
  history.replaceState(null, '', qs ? '?' + qs : window.location.pathname);
}

function actionPillColor(key) {
  if (key === 'mismatch')               return '#FA7B17';
  if (key === 'blocked-by:docs')        return '#6AAE7B';
  if (key === 'blocked-by:red-team')    return '#E46962';
  if (key === 'blocked-by:rnd-*')       return '#3B7CB8';
  if (key === 'blocked-by:rnd')         return '#3B7CB8';
  if (key && key.startsWith('blocked-by:rnd-')) {
    const team = key.slice('blocked-by:rnd-'.length);
    return teamColor(team, 0.85);
  }
  return '#808C78';
}

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

function typePillReset(btn) {
  const c = TYPE_COLOR(btn.dataset.type);
  btn.style.background  = `${c}10`;
  btn.style.color       = c;
  btn.style.borderColor = `${c}40`;
}

function typePillActivate(btn) {
  const c = TYPE_COLOR(btn.dataset.type);
  btn.style.background  = `${c}33`;
  btn.style.color       = c;
  btn.style.borderColor = `${c}cc`;
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
        pillActivate(btn, actionPillColor(key));
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

  // Type pills — single-select
  document.querySelectorAll('.filter-type-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      const slug = btn.dataset.type;
      if (activeTypeFilter === slug) {
        activeTypeFilter = null;
        typePillReset(btn);
      } else {
        document.querySelectorAll('.filter-type-pill').forEach(typePillReset);
        activeTypeFilter = slug;
        typePillActivate(btn);
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
  const blockedTeam = extractBlockingTeam(labels);
  const repo        = issue.repository?.nameWithOwner || '';
  const rankLabel   = String(index + 1).padStart(2, '0');

  // Lifecycle blocked-by:* labels actually present on the issue (filters + mismatch use these).
  const blockedByLabels = labels
    .filter(l => LIFECYCLE_BLOCKED_BY.includes(l.name))
    .map(l => l.name);
  const { rnd, docs: parsedDocs } = getParsedSections(item);
  const rndTeamSlug  = rnd.team || '';

  const typeLabels    = labels.filter(l => /^(gui user|developer|node operator)$/i.test(l.name.trim()));
  const releaseLabels = labels.filter(l => /^testnet\b/i.test(l.name.trim()));
  const typeSlugs     = typeLabels.map(l => TYPE_LABEL_TO_SLUG[l.name.trim().toLowerCase()]).filter(Boolean);

  const JOURNEY_COLORS = { 'gui user': 'D94F45', 'developer': '3B7CB8', 'node operator': 'C4912C' };
  const RELEASE_COLORS = { 'testnet v0.1': '4E635E', 'testnet v0.2': '2E86AB', 'testnet v0.3': 'A25C28', 'testnet unscheduled': '808C78' };

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

  const docUrl = parsedDocs.pr;

  return `
    <div id="filter-item-${item.id}"
         data-action-labels="${escapeHtml(JSON.stringify(blockedByLabels))}"
         data-rnd-team="${escapeHtml(rndTeamSlug)}"
         data-types="${escapeHtml(typeSlugs.join(' '))}">
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

export const STATUS_COLORS = {
  'confirm-roadmap':        '#E46962',
  'confirm-date':           '#FA7B17',
  'rnd-in-progress':        '#FA7B17',
  'rnd-overdue':            '#E46962',
  'waiting-for-doc-packet': '#34BEFC',
  'doc-packet-delivered':   '#6AAE7B',
  'doc-ready-for-review':   '#FA7B17',
  'doc-merged':             '#6AAE7B',
  'completed':              '#4E635E',
};
export const STATUS_LABELS = {
  'confirm-roadmap':        'Confirm roadmap',
  'confirm-date':           'Confirm date',
  'rnd-in-progress':        'R&D in progress',
  'rnd-overdue':            'R&D overdue',
  'waiting-for-doc-packet': 'Waiting for doc packet',
  'doc-packet-delivered':   'Doc packet delivered',
  'doc-ready-for-review':   'Doc ready for review',
  'doc-merged':             'Doc merged',
  'completed':              'Completed',
};

function dot(color) {
  return `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${color};flex-shrink:0;margin-top:1px;"></span>`;
}

/** Single-pill status badge for the pipeline row. */
export function renderStatusBadge(status) {
  const color = STATUS_COLORS[status] || '#808C78';
  const label = STATUS_LABELS[status] || status;
  return `<span class="inline-flex items-center gap-1 px-1.5 py-px rounded text-xs"
    style="background:${color}1A;color:${color};border:1px solid ${color}55;font-family:Arial,Helvetica,sans-serif;white-space:nowrap;"
    title="${escapeHtml(label)}">
    ${dot(color)} ${escapeHtml(label)}
  </span>`;
}

/**
 * Render one pill per blocked-by:* label. R&D pills show the team name only (e.g. "zones").
 */
export function renderBlockedByColumn(blockedByLabels, mismatch) {
  const pillFor = (labelName) => {
    let team;
    if (labelName === 'blocked-by:rnd')              team = 'r&d';
    else if (labelName === 'blocked-by:docs')        team = 'docs';
    else if (labelName === 'blocked-by:red-team')    team = 'red team';
    else if (labelName.startsWith('blocked-by:rnd-'))team = labelName.slice('blocked-by:rnd-'.length);
    else                                             team = labelName.replace(/^blocked-by:/, '');
    const bg    = teamColor(team, 0.12);
    const text  = teamColor(team, 0.85);
    const border = teamColor(team, 0.35);
    return `<span class="inline-flex items-center px-1.5 py-px rounded text-xs font-medium"
      style="background:${bg};color:${text};border:1px solid ${border};font-family:Arial,Helvetica,sans-serif;white-space:nowrap;"
      title="${escapeHtml(labelName)}">
      ${escapeHtml(team)}
    </span>`;
  };
  const pills = blockedByLabels.map(pillFor).join('');
  const warnHtml = mismatch
    ? `<span title="Status labels out of sync with issue state" style="color:#FA7B17;font-size:12px;cursor:help;">⚠</span>`
    : '';
  return pills + warnHtml;
}

async function loadAllStakeholderBadges(items) {
  const pat = getReadPAT();

  // Single pass: collect links to fetch and cache parsed sections per item.
  // docsTracking is NOT prefetched (only used in the detail panel); the module-level
  // fetchRef cache in api.js makes its lazy fetch fast on repeat opens.
  const linksToFetch = [];
  const itemData     = new Map(); // itemId → { parsed, rtIdx, docsPrIdx }

  for (const item of items) {
    const parsed = getParsedSections(item);
    const docsPr      = parsed.docs.pr;
    const redTeamLink = parsed.redTeam.tracking;

    const rtIdx = redTeamLink ? linksToFetch.length : -1;
    if (redTeamLink) linksToFetch.push(redTeamLink);

    const docsPrIdx = docsPr ? linksToFetch.length : -1;
    if (docsPr) linksToFetch.push(docsPr);

    itemData.set(item.id, { parsed, rtIdx, docsPrIdx });
  }

  const refResults = linksToFetch.length ? await fetchRefsBatch(linksToFetch, pat) : [];

  _mismatchedItems.clear();

  for (const item of items) {
    const { parsed, rtIdx, docsPrIdx } = itemData.get(item.id);
    const { rnd, docPacket: docPacketLink, docs: { pr: docsPr }, redTeam: { tracking: redTeamLink } } = parsed;
    const labels    = item.content?.labels?.nodes || [];
    const allLabels = labels.map(l => l.name);

    const rtRef     = rtIdx     >= 0 ? refResults[rtIdx]     : null;
    const docsPrRef = docsPrIdx >= 0 ? refResults[docsPrIdx] : null;
    item._refCache  = { redTeamLink, rtRef, docsPr, docsPrRef };

    const issueClosed = String(item.content?.state || '').toUpperCase() === 'CLOSED';
    const status = computeStatus({
      rnd, docPacketLink, docsPr, docsPrRef, redTeamLink, redTeamRef: rtRef,
      allMilestonesDone: false, issueClosed,
    });
    const desired = computeDesiredLabels(status, rnd.team);

    const mismatch = computeLifecycleMismatch(allLabels, desired);
    if (mismatch) {
      _mismatchedItems.set(item.id, {
        item,
        actualLabels: allLabels,
        desiredStatus: desired.status,
        desiredBlockedBy: desired.blockedBy,
      });
    }

    const badgeEl = document.getElementById(`pending-${item.id}`);
    if (badgeEl) badgeEl.innerHTML = renderStatusBadge(status);

    const actionEl = document.getElementById(`action-${item.id}`);
    if (actionEl) actionEl.innerHTML = renderBlockedByColumn(desired.blockedBy, mismatch);

    // Store DESIRED lifecycle blocked-by:* labels so filters match what's rendered,
    // independent of whether the GitHub labels have been synced yet.
    const wrapper = document.getElementById(`filter-item-${item.id}`);
    if (wrapper) {
      wrapper.dataset.actionLabels = JSON.stringify(desired.blockedBy);
      wrapper.dataset.mismatch = mismatch ? 'true' : 'false';
    }
  }

  // Notify header to update fix-labels button state
  document.dispatchEvent(new CustomEvent('mismatch-count-changed'));

  // Async second pass: fetch milestone progress and upgrade rnd-in-progress → waiting-for-doc-packet
  loadMilestoneProgressForPipeline(items, pat);
}

/**
 * Return true if the issue's status:* / lifecycle blocked-by:* / legacy action:* / legacy blocked:*
 * labels don't match the desired set.
 */
function computeLifecycleMismatch(actualLabels, desired) {
  // Check exactly one status:* label and it matches desired.status
  const statusLabels = actualLabels.filter(l => l.startsWith('status:'));
  if (statusLabels.length !== 1 || statusLabels[0] !== desired.status) return true;

  // Check lifecycle blocked-by:* labels match desired set exactly.
  const actualBlocked = actualLabels.filter(l => LIFECYCLE_BLOCKED_BY.includes(l)).sort();
  const wantBlocked = [...desired.blockedBy].sort();
  if (actualBlocked.length !== wantBlocked.length) return true;
  for (let i = 0; i < actualBlocked.length; i++) {
    if (actualBlocked[i] !== wantBlocked[i]) return true;
  }

  // A completed journey must have no blocked-by:* at all (including non-lifecycle ones).
  if (desired.status === 'status:completed' &&
      actualLabels.some(l => l.startsWith('blocked-by:'))) {
    return true;
  }

  // Any legacy labels still present?
  if (actualLabels.some(l => l.startsWith('action:'))) return true;
  if (actualLabels.some(l => /^blocked:/i.test(l) && !/^blocked-by:/i.test(l))) return true;

  return false;
}

async function loadMilestoneProgressForPipeline(items, pat) {
  // Collect all unique roadmap milestone URLs so parent pages are fetched in parallel
  const allUrls = new Set();
  for (const item of items) {
    const { rnd } = getParsedSections(item);
    for (const url of rnd.milestones) {
      if (url.startsWith('https://roadmap.logos.co/')) allUrls.add(url);
    }
  }
  // Pre-fetch all in parallel (parent pages get cached)
  await Promise.all([...allUrls].map(url => fetchMilestoneProgress(url, pat)));

  // Now check each item
  for (const item of items) {
    const { rnd, docPacket: docPacketLink, docs, redTeam } = getParsedSections(item);
    const docsPr = docs.pr;
    const docsPrRef = item._refCache?.docsPrRef || null;
    const rtRef     = item._refCache?.rtRef     || null;

    const issueClosed = String(item.content?.state || '').toUpperCase() === 'CLOSED';
    // Only relevant pre-doc-packet (has team + milestones, no doc packet yet).
    const baseStatus = computeStatus({
      rnd, docPacketLink, docsPr, docsPrRef, redTeamLink: redTeam.tracking, redTeamRef: rtRef,
      allMilestonesDone: false, issueClosed,
    });
    if (!['rnd-in-progress','rnd-overdue','confirm-date'].includes(baseStatus)) continue;

    const roadmapMilestones = rnd.milestones.filter(u => u.startsWith('https://roadmap.logos.co/'));
    if (roadmapMilestones.length === 0) continue;

    const progressResults = await Promise.all(roadmapMilestones.map(u => fetchMilestoneProgress(u, pat)));
    const resolved = progressResults.filter(r => r !== null);
    if (resolved.length === 0 || !resolved.every(r => r.done)) continue;

    // All milestones done → upgrade to waiting-for-doc-packet
    const newStatus = computeStatus({
      rnd, docPacketLink, docsPr, docsPrRef, redTeamLink: redTeam.tracking, redTeamRef: rtRef,
      allMilestonesDone: true,
    });
    const el = document.getElementById(`pending-${item.id}`);
    if (el) el.innerHTML = renderStatusBadge(newStatus);

    // Update blocked-by and mismatch since status changed
    const desired = computeDesiredLabels(newStatus, rnd.team);
    const labels = item.content?.labels?.nodes?.map(l => l.name) || [];
    const mismatch = computeLifecycleMismatch(labels, desired);
    if (mismatch) {
      _mismatchedItems.set(item.id, {
        item,
        actualLabels: labels,
        desiredStatus: desired.status,
        desiredBlockedBy: desired.blockedBy,
      });
    } else {
      _mismatchedItems.delete(item.id);
    }
    const actionEl = document.getElementById(`action-${item.id}`);
    if (actionEl) actionEl.innerHTML = renderBlockedByColumn(desired.blockedBy, mismatch);

    // Keep the filter wrapper in sync with the upgraded status.
    const wrapper = document.getElementById(`filter-item-${item.id}`);
    if (wrapper) {
      wrapper.dataset.actionLabels = JSON.stringify(desired.blockedBy);
      wrapper.dataset.mismatch = mismatch ? 'true' : 'false';
    }
    document.dispatchEvent(new CustomEvent('mismatch-count-changed'));
  }
}

// ---------------------------------------------------------------------------
// New Journey modal
// ---------------------------------------------------------------------------

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
    if (!pat) { showToast('error', 'Switch to edit mode to save changes'); return; }
    if (!_projectOwner || !_projectRepo) { showToast('error', 'Could not determine repository'); return; }

    const submitBtn = document.getElementById('nj-submit');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Creating…'; }

    try {
      // Ensure all lifecycle labels exist in the repo (status:* + blocked-by:*).
      await ensureLifecycleLabels(_projectOwner, _projectRepo, pat);

      // Build body
      let body = newIssueBody(team);
      if (milestone) body = body.replace(/- milestone:[ ]*/, `- milestone: ${milestone}`);

      // Initial status: if a milestone URL was provided we're at confirm-date,
      // otherwise confirm-roadmap. Blocked-by is the team (or unassigned rnd).
      const initialStatus = milestone ? 'status:confirm-date' : 'status:confirm-roadmap';
      const initialBlockedBy = (team && RND_TEAMS.includes(team)) ? `blocked-by:rnd-${team}` : 'blocked-by:rnd';
      const labels = [type, release, initialStatus, initialBlockedBy];
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
