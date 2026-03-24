/**
 * pipeline.js — Pipeline view rendering
 */

import {
  extractBlockedTeam, extractDocumentation,
  extractRnD, extractDocPacket, extractRedTeam,
  computeRnDState, computeDocsState, computeRedTeamState, computeActionLabels,
  newIssueBody,
} from './markdown.js';
import { toggleDetail, expandAll, collapseAll, getOpenCount } from './detail.js';
import { hasWritePAT, getReadPAT, getWritePAT, getConfig } from './config.js';
import { teamColor, statusBadge, showToast } from './app.js';
import { fetchRefsBatch, createIssue, addItemToProject, createLabel } from './api.js';

// Active state filter — persists until project reload
let activeStateFilter = null; // null | 'action:rnd' | 'action:docs' | 'action:red-team'

// Project context (set during renderPipeline, used for create)
let _projectId = null;
let _projectOwner = null;
let _projectRepo = null;

export function renderPipeline(container, items, projectTitle, projectId) {
  const canDrag  = hasWritePAT();
  const canWrite = hasWritePAT();
  _projectId = projectId || null;

  // Derive owner/repo from first item
  const firstRepo = items.find(i => i.content?.repository)?.content?.repository?.nameWithOwner || '';
  const [owner, repo] = firstRepo.split('/');
  _projectOwner = owner || null;
  _projectRepo  = repo || null;

  // Reset filter on each full project render
  activeStateFilter = null;

  const openItems   = items.filter(i => i.content?.state !== 'CLOSED');
  const closedItems = items
    .filter(i => i.content?.state === 'CLOSED')
    .sort((a, b) => (b.content.closedAt || '').localeCompare(a.content.closedAt || ''));

  const columnHeader = `
    <div class="hidden md:block pointer-events-none select-none">
      <div class="grid grid-cols-[1fr_8rem_9rem_14rem_2rem] gap-4 items-end px-4 py-1.5 text-xs font-semibold uppercase tracking-wider"
           style="color:#808C78;font-family:Arial,Helvetica,sans-serif;border:1px solid transparent;border-left:3px solid transparent;border-bottom:1px solid rgba(78,99,94,0.2);">
        <div>Journey</div>
        <div>Journey<br>Type</div>
        <div>Target<br>Release</div>
        <div>Progress</div>
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

      ${renderFilterBar()}

      <div id="pipeline-list" class="space-y-1.5">
        ${columnHeader}
        ${openItems.map((item, index) => renderPipelineRow(item, index, canDrag)).join('')}
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
  attachNewJourneyHandler(projectId);
  loadAllStakeholderBadges(allItems);
}

// ---------------------------------------------------------------------------
// Filter bar (action-required pills)
// ---------------------------------------------------------------------------

function renderFilterBar() {
  const filters = [
    { key: 'action:rnd',       label: 'needs R&D',      color: '#3B7CB8' },
    { key: 'action:docs',      label: 'needs docs',     color: '#6AAE7B' },
    { key: 'action:red-team',  label: 'needs red team', color: '#E46962' },
    { key: 'mismatch',         label: '⚠ out of sync',  color: '#FA7B17' },
  ];
  const pills = filters.map(f => `
    <button class="filter-action-pill inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all"
            data-action="${escapeHtml(f.key)}"
            style="border:1px solid rgba(78,99,94,0.3);background:transparent;color:#808C78;font-family:Arial,Helvetica,sans-serif;cursor:pointer;">
      ${escapeHtml(f.label)}
    </button>`).join('');
  return `
    <div id="action-filter-bar" class="flex items-center gap-2 flex-wrap">
      <span class="text-xs flex-none" style="color:#808C78;font-family:Arial,Helvetica,sans-serif;">Filter:</span>
      ${pills}
    </div>`;
}

function applyFilter(allItems) {
  const noMatch = document.getElementById('no-filter-match');
  if (!activeStateFilter) {
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
    let matches;
    if (activeStateFilter === 'mismatch') {
      matches = wrapper.dataset.mismatch === 'true';
    } else {
      const labels = JSON.parse(wrapper.dataset.actionLabels || '[]');
      matches = labels.includes(activeStateFilter);
    }
    wrapper.classList.toggle('hidden', !matches);
    if (matches) visible++;
  }
  if (noMatch) noMatch.classList.toggle('hidden', visible > 0);
}

function attachFilterHandlers(allItems) {
  document.querySelectorAll('.filter-action-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.action;
      if (activeStateFilter === key) {
        activeStateFilter = null;
        btn.style.background = 'transparent';
        btn.style.color = '#808C78';
        btn.style.borderColor = 'rgba(78,99,94,0.3)';
      } else {
        // Deactivate all
        document.querySelectorAll('.filter-action-pill').forEach(b => {
          b.style.background = 'transparent';
          b.style.color = '#808C78';
          b.style.borderColor = 'rgba(78,99,94,0.3)';
        });
        activeStateFilter = key;
        const COLORS = { 'action:rnd': '#3B7CB8', 'action:docs': '#6AAE7B', 'action:red-team': '#E46962', 'mismatch': '#FA7B17' };
        const c = COLORS[key] || '#808C78';
        btn.style.background = c + '22';
        btn.style.color = c;
        btn.style.borderColor = c + '88';
      }
      applyFilter(allItems);
    });
  });
}

// ---------------------------------------------------------------------------
// Pipeline row
// ---------------------------------------------------------------------------

function renderPipelineRow(item, index, canDrag) {
  const issue = item.content;
  if (!issue) return '';

  const labels      = issue.labels?.nodes || [];
  const blockedTeam = extractBlockedTeam(labels);
  const repo        = issue.repository?.nameWithOwner || '';
  const rankLabel   = String(index + 1).padStart(2, '0');

  const actionLabels = labels.filter(l => l.name.startsWith('action:')).map(l => l.name);

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
         data-action-labels="${escapeHtml(JSON.stringify(actionLabels))}">
      <div
        id="row-${item.id}"
        data-item-id="${item.id}"
        data-index="${index}"
        data-repo="${escapeHtml(repo)}"
        data-issue="${issue.number}"
        draggable="${canDrag}"
        class="pipeline-row grid grid-cols-[1fr_auto] md:grid-cols-[1fr_8rem_9rem_14rem_2rem] gap-4 items-center px-4 py-3 rounded cursor-pointer transition-all select-none ${canDrag ? 'draggable-row' : ''}"
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

export function renderStakeholderBadges(rndTeam, rndState, docsLink, docsState, redTeamLink, redTeamState, actionLabels, mismatch) {
  const rndLabel = rndTeam || 'r&d';
  const rndColor = RND_COLORS[rndState] || '#808C78';
  const rndBg    = rndTeam ? teamColor(rndTeam, 0.15) : 'rgba(255,255,255,0.7)';
  const rndBorder= rndTeam ? teamColor(rndTeam, 0.35) : 'rgba(78,99,94,0.25)';
  const rndText  = rndTeam ? teamColor(rndTeam, 0.9)  : '#4E635E';
  const rndBadge = `<span class="inline-flex items-center gap-1 px-1.5 py-px rounded text-xs font-medium"
    style="background:${rndBg};border:1px solid ${rndBorder};color:${rndText};font-family:Arial,Helvetica,sans-serif;white-space:nowrap;"
    title="R&D: ${escapeHtml(rndState)}">
    ${dot(rndColor)} ${escapeHtml(rndLabel)}
  </span>`;
  const docsBadge   = stakeholderBadge('docs',     DOCS_COLORS[docsState]            || '#808C78', docsLink,     `docs: ${docsState}`);
  const rtBadge     = stakeholderBadge('red team', REDTEAM_COLORS[redTeamState]       || '#808C78', redTeamLink,  `red team: ${redTeamState}`);

  const pills = actionLabels.map(l => {
    const c = ACTION_LABEL_COLORS[l] || '#808C78';
    return `<span class="inline-flex items-center px-1.5 py-px rounded text-xs font-medium"
      style="background:${c}22;color:${c};border:1px solid ${c}50;font-family:Arial,Helvetica,sans-serif;white-space:nowrap;">
      ${escapeHtml(l.replace('action:', ''))}
    </span>`;
  }).join('');

  const warnHtml = mismatch
    ? `<span title="Action labels out of sync with issue state" style="color:#FA7B17;font-size:12px;cursor:help;">⚠</span>`
    : '';

  return rndBadge + docsBadge + rtBadge + (pills ? `<span class="flex items-center gap-1">${pills}</span>` : '') + warnHtml;
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
    const docsState  = computeDocsState(docsLink, docsRef);
    const redTeamState = computeRedTeamState(redTeamLink, rtRef);

    // Corruption detection: compare actual action labels vs expected
    const expectedActions = computeActionLabels(rndState, docsState, redTeamState);
    const mismatch = JSON.stringify([...actionLabels].sort()) !== JSON.stringify([...expectedActions].sort());

    const el = document.getElementById(`pending-${item.id}`);
    if (el) el.innerHTML = renderStakeholderBadges(
      rnd.team, rndState, docsLink, docsState, redTeamLink, redTeamState, actionLabels, mismatch
    );

    // Update filter wrapper with current action labels and mismatch flag
    const wrapper = document.getElementById(`filter-item-${item.id}`);
    if (wrapper) {
      wrapper.dataset.actionLabels = JSON.stringify(actionLabels);
      wrapper.dataset.mismatch = mismatch ? 'true' : 'false';
    }
  }
}

// ---------------------------------------------------------------------------
// New Journey modal
// ---------------------------------------------------------------------------

const RND_TEAMS   = ['anon-comms', 'messaging', 'core', 'storage', 'blockchain', 'lez', 'devkit'];
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
