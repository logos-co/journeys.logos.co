/**
 * detail.js — Journey detail / drill-down view
 */

import {
  addLabels, removeLabel, fetchIssue,
  updateIssueBody, createLabel, fetchRef, fetchMilestoneProgress,
  fetchClosingPR,
} from './api.js';
import {
  renderMarkdown, extractAllBlockedLabels, extractDescription,
  extractRnD, extractDocPacket, extractDocumentation, extractRedTeam,
  computeRnDState, computeDocsState, computeRedTeamState, computeActionLabels,
  setRnDField, setRnDMilestones, setDocPacketLink, setDocTracking, setDocPr, setRedTeamTracking,
} from './markdown.js';
import { getReadPAT, getWritePAT, hasWritePAT } from './config.js';
import { teamColor, showToast } from './app.js';

// Track open detail panels and their item references
const openDetails  = new Set();
const itemRegistry = new Map(); // itemId → item

export function getOpenCount()  { return openDetails.size; }
export function getOpenIds()    { return [...openDetails]; }
export function clearOpenState() { openDetails.clear(); }

function syncToggleLabel() {
  const label = document.getElementById('toggle-all-label');
  if (label) label.textContent = openDetails.size > 0 ? 'Collapse All' : 'Expand All';
}

export async function expandAll(items) {
  for (const item of items) {
    if (!openDetails.has(item.id)) await toggleDetail(item.id, item, true);
  }
  syncToggleLabel();
}

export function collapseAll() {
  for (const itemId of [...openDetails]) {
    const panel = document.getElementById(`detail-${itemId}`);
    if (panel) { panel.innerHTML = ''; panel.classList.add('hidden'); }
    const chevron = document.getElementById(`chevron-${itemId}`);
    if (chevron) chevron.classList.remove('rotate-180');
  }
  openDetails.clear();
  syncToggleLabel();
}

export async function toggleDetail(itemId, item, skipSync = false) {
  const panel = document.getElementById(`detail-${itemId}`);
  if (!panel) return;

  if (openDetails.has(itemId)) {
    openDetails.delete(itemId);
    panel.innerHTML = '';
    panel.classList.add('hidden');
    const chevron = document.getElementById(`chevron-${itemId}`);
    if (chevron) chevron.classList.remove('rotate-180');
  } else {
    openDetails.add(itemId);
    itemRegistry.set(itemId, item);
    panel.classList.remove('hidden');
    const chevron = document.getElementById(`chevron-${itemId}`);
    if (chevron) chevron.classList.add('rotate-180');
    panel.innerHTML = renderDetailShell(item);
    await loadWorkflowSections(itemId, item);
  }
  if (!skipSync) syncToggleLabel();
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

function renderDetailShell(item) {
  const issue = item.content;
  const canWrite = hasWritePAT();
  const description = extractDescription(issue.body || '');

  return `
    <div class="detail-panel" style="border-top:1px solid rgba(78,99,94,0.2);background:rgba(221,222,216,0.6);">
      <div class="max-w-5xl mx-auto p-6 space-y-6">

        <!-- Header -->
        <div class="flex items-center justify-between gap-4">
          <div class="flex items-center gap-2 flex-1 min-w-0">
            <div class="flex items-center gap-2 text-xs flex-none" style="color:#808C78;font-family:Arial,Helvetica,sans-serif;">
              <span>${issue.repository?.nameWithOwner || ''}</span>
              <span>·</span><span>#${issue.number}</span>
            </div>
            <button
              title="Copy journey name"
              data-copy="${escapeHtml(issue.title)}"
              onclick="navigator.clipboard.writeText(this.dataset.copy).then(()=>{ const el=this; el.style.color='#6AAE7B'; setTimeout(()=>el.style.color='',1200); })"
              class="flex-none flex items-center gap-1 text-xs transition-colors px-1.5 py-0.5 rounded"
              style="color:#808C78;font-family:Arial,Helvetica,sans-serif;border:1px solid rgba(78,99,94,0.3);background:none;cursor:pointer;"
              onmouseover="this.style.borderColor='rgba(228,105,98,0.5)';this.style.color='#E46962'"
              onmouseout="this.style.borderColor='rgba(78,99,94,0.3)';this.style.color='#808C78'"
            >
              <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              Copy name
            </button>
          </div>
          <a href="${issue.url}" target="_blank" rel="noopener"
             class="flex-none flex items-center gap-1.5 text-xs text-muted transition-colors px-2.5 py-1.5 rounded"
             style="border:1px solid rgba(78,99,94,0.4);font-family:Arial,Helvetica,sans-serif;"
             onmouseover="this.style.borderColor='rgba(228,105,98,0.5)';this.style.color='#E46962'"
             onmouseout="this.style.borderColor='rgba(78,99,94,0.4)';this.style.color='#808C78'">
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
            View on GitHub
          </a>
        </div>

        <!-- Action banner (filled async) -->
        <div id="action-banner-${item.id}"></div>

        <!-- Assignees -->
        ${renderAssignees(issue)}

        <!-- Description -->
        ${description ? `
          <div>
            <h3 class="text-xs font-semibold uppercase tracking-wider mb-3" style="color:#808C78;font-family:Arial,Helvetica,sans-serif;">Description</h3>
            <div class="markdown-body rounded p-5 overflow-x-auto" style="background:rgba(255,255,255,0.6);border:1px solid rgba(78,99,94,0.2);">
              ${renderMarkdown(description)}
            </div>
          </div>
        ` : ''}

        <!-- Workflow sections (R&D / Doc Packet / Documentation / Red Team) -->
        <div id="workflow-${item.id}">
          <div class="flex items-center gap-2 text-muted text-sm py-2" style="font-family:Arial,Helvetica,sans-serif;">
            <svg class="w-4 h-4 animate-spin text-coral" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            Loading…
          </div>
        </div>

        <!-- Blocked labels -->
        <div>
          <div class="flex items-center gap-2 mb-2">
            <h3 class="text-xs font-semibold uppercase tracking-wider" style="color:#808C78;font-family:Arial,Helvetica,sans-serif;">Blocked by</h3>
            ${canWrite ? renderAddLabelButton(item) : ''}
          </div>
          <div id="blocked-labels-${item.id}" class="flex flex-wrap gap-2">
            ${renderBlockedLabels(
              extractAllBlockedLabels(issue.labels?.nodes || []),
              item, canWrite
            )}
          </div>
        </div>

      </div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Workflow sections
// ---------------------------------------------------------------------------

const RND_COLORS = {
  'to-be-confirmed':      '#E46962',
  'confirmed':            '#6AAE7B',
  'in-progress':          '#FA7B17',
  'pending-doc-packet':   '#34befc',
  'doc-packet-delivered': '#6AAE7B',
};
const DOCS_COLORS = {
  'waiting':          '#808C78',
  'in-progress':      '#FA7B17',
  'merged':           '#6AAE7B',
};
const REDTEAM_COLORS = {
  'waiting':     '#808C78',
  'in-progress': '#FA7B17',
  'done':        '#6AAE7B',
};
const RND_STATE_LABELS = {
  'to-be-confirmed':      'To Be Confirmed',
  'confirmed':            'Confirmed',
  'in-progress':          'In Progress',
  'pending-doc-packet':   'Pending Doc Packet',
  'doc-packet-delivered': 'Doc Packet Delivered',
};
const DOCS_STATE_LABELS = {
  'waiting':          'Waiting',
  'in-progress':      'In Progress',
  'merged':           'Merged',
};
const REDTEAM_STATE_LABELS = {
  'waiting':     'Waiting',
  'in-progress': 'In Progress',
  'done':        'Done',
};
const RND_TEAMS = ['anon-comms', 'messaging', 'core', 'storage', 'blockchain', 'zones', 'smart-contract', 'devkit'];

function issueStatusBadge(ref) {
  if (!ref || ref.state === 'error') return '';
  const color = ref.state === 'open' ? '#6AAE7B' : '#808C78';
  const label = ref.state === 'open' ? 'Open' : 'Closed';
  return `<span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs flex-none"
    style="background:${color}22;color:${color};border:1px solid ${color}44;font-family:Arial,Helvetica,sans-serif;">
    <span style="display:inline-block;width:5px;height:5px;border-radius:50%;background:${color};"></span>
    ${label}
  </span>`;
}

function stateBadgeHtml(label, color) {
  return `<span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium"
    style="background:${color}22;color:${color};border:1px solid ${color}55;font-family:Arial,Helvetica,sans-serif;">
    <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${color};"></span>
    ${escapeHtml(label)}
  </span>`;
}

function sectionCard(heading, stateHtml, bodyHtml) {
  return `
    <div class="rounded p-4 space-y-3" style="background:rgba(255,255,255,0.6);border:1px solid rgba(78,99,94,0.2);">
      <div class="flex items-center gap-2">
        <h4 class="text-xs font-semibold uppercase tracking-wider" style="color:#808C78;font-family:Arial,Helvetica,sans-serif;">${escapeHtml(heading)}</h4>
        ${stateHtml}
      </div>
      ${bodyHtml}
    </div>`;
}

function fieldRow(label, valueHtml) {
  return `<div class="flex items-center gap-2">
    <span class="text-xs w-20 flex-none" style="color:#808C78;font-family:Arial,Helvetica,sans-serif;">${escapeHtml(label)}</span>
    ${valueHtml}
  </div>`;
}

async function loadWorkflowSections(itemId, item, bodyOverride, preloadedRefs = null) {
  const body      = bodyOverride ?? item.content?.body ?? '';
  const issue     = item.content;
  const canWrite  = hasWritePAT();
  const pat       = getReadPAT();

  const rnd            = extractRnD(body);
  const docPacketLink  = extractDocPacket(body);
  const { tracking: docsTracking, pr: docsPr } = extractDocumentation(body);
  const { tracking: redTeamLink } = extractRedTeam(body);

  // Fetch refs — reuse preloaded refs (recursive call after label sync) or pipeline cache.
  const cache = item?._refCache;
  const [rtRef, docsTrackingRef, docsPrRef] = preloadedRefs ?? await Promise.all([
    redTeamLink ? (cache?.redTeamLink === redTeamLink ? Promise.resolve(cache.rtRef) : fetchRef(redTeamLink, pat)) : Promise.resolve(null),
    docsTracking ? fetchRef(docsTracking, pat) : Promise.resolve(null),
    docsPr      ? (cache?.docsPr      === docsPr      ? Promise.resolve(cache.docsPrRef) : fetchRef(docsPr,      pat)) : Promise.resolve(null),
  ]);

  const rndState     = computeRnDState(rnd, docPacketLink);
  const docsState    = computeDocsState(docsPr, docsPrRef);
  const redTeamState = computeRedTeamState(redTeamLink, rtRef);
  const expectedActions = computeActionLabels(rndState, docsState, redTeamState);

  const actualLabels  = (issue.labels?.nodes || []).map(l => l.name);
  const actualActions = actualLabels.filter(l => l.startsWith('action:'));
  const mismatch = JSON.stringify([...expectedActions].sort()) !== JSON.stringify([...actualActions].sort());

  const repoWithOwner = issue.repository?.nameWithOwner || '';
  const issueNumber   = issue.number || 0;

  // Render action banner
  const bannerEl = document.getElementById(`action-banner-${itemId}`);
  if (bannerEl) {
    bannerEl.innerHTML = renderActionBanner(actualActions, expectedActions, mismatch, itemId, repoWithOwner, issueNumber);
  }

  // Render workflow sections
  const workflowEl = document.getElementById(`workflow-${itemId}`);
  if (!workflowEl) return;

  workflowEl.innerHTML = renderWorkflowSections(
    itemId, rnd, rndState, docPacketLink,
    docsState, docsTracking, docsTrackingRef, docsPr, docsPrRef,
    redTeamLink, rtRef, redTeamState,
    repoWithOwner, issueNumber, canWrite
  );

  attachWorkflowHandlers(itemId, repoWithOwner, issueNumber);

  // Async-load milestone progress indicators and recompute R&D state if all done
  loadMilestoneProgress(itemId, rnd, docPacketLink, pat);

  // Async-fetch closing PR suggestion when we have a tracking issue but no pr yet.
  // Show in both edit and view modes; Confirm requires a write PAT (handled in _saveDocPr).
  if (docsTracking && !docsPr) {
    loadDocPrSuggestion(itemId, repoWithOwner, issueNumber, docsTracking, pat);
  }
}

async function loadDocPrSuggestion(itemId, repoWithOwner, issueNumber, trackingUrl, pat) {
  const slot = document.getElementById(`docs-pr-suggest-${itemId}`);
  if (!slot) return;
  const result = await fetchClosingPR(trackingUrl, pat);
  if (!result || !result.url) return;
  // If user populated the input in the meantime (edit mode), skip
  const input = document.getElementById(`docs-pr-${itemId}`);
  if (input && input.value.trim()) return;
  const safeUrl = escapeHtml(result.url);
  const repoSafe = escapeHtml(repoWithOwner);
  const num = parseInt(issueNumber, 10) || 0;
  const action = hasWritePAT()
    ? `<button class="text-xs px-1.5 py-0.5 rounded transition-colors flex-none"
              style="background:#E46962;color:#fff;"
              onmouseover="this.style.background='#FA7B17'" onmouseout="this.style.background='#E46962'"
              onclick="window._saveDocPr('${itemId}','${repoSafe}',${num},'${safeUrl}')">Confirm</button>`
    : `<span class="text-xs italic" style="color:#808C78;">Switch to edit mode to confirm this link</span>`;
  slot.innerHTML = `<div class="flex items-center gap-2 mt-1 text-xs" style="font-family:Arial,Helvetica,sans-serif;color:#5C6B65;">
    <span>Suggested:</span>
    <a href="${safeUrl}" target="_blank" rel="noopener" class="truncate hover:underline" style="color:#3B7CB8;" onclick="event.stopPropagation()">${safeUrl}</a>
    ${action}
  </div>`;
  // Hide the "no doc PR" fallback in view mode since we now have a suggestion.
  const empty = document.getElementById(`docs-pr-empty-${itemId}`);
  if (empty) empty.style.display = 'none';
}

async function loadMilestoneProgress(itemId, rnd, docPacketLink, pat) {
  // Fetch all milestones in parallel instead of sequentially
  const results = await Promise.all(
    rnd.milestones.map(url =>
      url.startsWith('https://roadmap.logos.co/')
        ? fetchMilestoneProgress(url, pat)
        : Promise.resolve(null)
    )
  );

  // Apply DOM updates
  for (let idx = 0; idx < results.length; idx++) {
    const progress = results[idx];
    const el = document.getElementById(`ms-progress-${itemId}-${idx}`);
    if (!el || !progress) continue;
    const cb = el.querySelector('.ms-checkbox');
    if (cb) {
      cb.innerHTML = progress.done
        ? `<span style="width:0.85rem;height:0.85rem;display:inline-flex;align-items:center;justify-content:center;border-radius:2px;background:#6AAE7B;color:#fff;font-size:0.6rem;flex-shrink:0;">✓</span>`
        : `<span style="width:0.85rem;height:0.85rem;display:inline-flex;align-items:center;justify-content:center;border-radius:2px;border:1.5px solid #b0b0b0;flex-shrink:0;"></span>`;
    }
    if (progress.done) {
      const link = el.querySelector('a');
      if (link) link.style.textDecoration = 'line-through';
    }
  }

  // Recompute R&D state if all roadmap milestones are done
  const roadmapResults = results.filter(r => r !== null);
  if (roadmapResults.length > 0 && roadmapResults.every(r => r.done)) {
    const newState = computeRnDState(rnd, docPacketLink, true);
    const badgeEl = document.getElementById(`rnd-state-badge-${itemId}`);
    if (badgeEl) {
      const color = RND_COLORS[newState] || '#808C78';
      const label = RND_STATE_LABELS[newState] || newState;
      badgeEl.innerHTML = stateBadgeHtml(label, color);
    }
  }
}

function renderActionBanner(actualActions, expectedActions, mismatch, itemId, repoWithOwner, issueNumber) {
  const ACTION_COLORS = {
    'action:rnd':      '#3B7CB8',
    'action:docs':     '#6AAE7B',
    'action:red-team': '#E46962',
  };
  const labels = mismatch ? expectedActions : actualActions;
  if (!mismatch && labels.length === 0) return '';

  const pills = labels.map(l => {
    const c = ACTION_COLORS[l] || '#808C78';
    return `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
      style="background:${c}22;color:${c};border:1px solid ${c}55;font-family:Arial,Helvetica,sans-serif;">
      ${escapeHtml(l)}
    </span>`;
  }).join('');

  const warnHtml = mismatch ? `
    <span class="text-xs" style="color:#FA7B17;font-family:Arial,Helvetica,sans-serif;">
      ⚠ Action labels out of sync
    </span>` : '';

  return `
    <div class="flex items-center gap-2 flex-wrap px-3 py-2 rounded"
         style="background:rgba(255,255,255,0.5);border:1px solid rgba(78,99,94,0.2);">
      <span class="text-xs font-medium flex-none" style="color:#808C78;font-family:Arial,Helvetica,sans-serif;">Action required:</span>
      ${pills || `<span class="text-xs italic" style="color:#808C78;font-family:Arial,Helvetica,sans-serif;">none</span>`}
      ${warnHtml}
    </div>`;
}

function renderWorkflowSections(
  itemId, rnd, rndState, docPacketLink,
  docsState, docsTracking, docsTrackingRef, docsPr, docsPrRef,
  redTeamLink, rtRef, redTeamState,
  repoWithOwner, issueNumber, canWrite
) {
  const sections = [];

  // ── R&D Section (always shown) ──
  sections.push(renderRnDSection(itemId, rnd, rndState, repoWithOwner, issueNumber, canWrite));

  // ── Doc Packet Section (always shown) ──
  sections.push(renderDocPacketSection(itemId, docPacketLink, rndState, canWrite));

  // ── Documentation Section (always shown) ──
  sections.push(renderDocumentationSection(itemId, docsState, docsTracking, docsTrackingRef, docsPr, docsPrRef, repoWithOwner, issueNumber, canWrite));

  // ── Red Team Section (always shown) ──
  sections.push(renderRedTeamSection(itemId, redTeamLink, rtRef, redTeamState, repoWithOwner, issueNumber, canWrite));

  return `<div class="space-y-3">${sections.join('')}</div>`;
}

function renderRnDSection(itemId, rnd, rndState, repoWithOwner, issueNumber, canWrite) {
  const color = RND_COLORS[rndState] || '#808C78';
  const stateLabel = RND_STATE_LABELS[rndState] || rndState;

  let teamHtml, milestoneHtml, dateHtml;

  if (canWrite) {
    const teamOptions = RND_TEAMS.map(t =>
      `<option value="${t}" ${rnd.team === t ? 'selected' : ''}>${t}</option>`
    ).join('');
    teamHtml = `
      <select id="rnd-team-${itemId}"
              class="logos-input text-xs py-0.5 pr-6"
              style="min-width:8rem;"
              onchange="window._saveRnDField('${itemId}', '${escapeHtml(repoWithOwner)}', ${issueNumber}, 'team', this.value)">
        <option value="">— select team —</option>
        ${teamOptions}
      </select>`;
    const milestoneItems = rnd.milestones.map((url, idx) =>
      `<div id="ms-progress-${itemId}-${idx}" class="flex items-center gap-1.5 min-w-0">
        <span class="ms-checkbox flex-none"></span>
        <a href="${escapeHtml(url)}" target="_blank" rel="noopener"
           class="text-xs truncate hover:underline flex-1 min-w-0" style="color:#3B7CB8;font-family:Arial,Helvetica,sans-serif;"
           onclick="event.stopPropagation()">
          ${escapeHtml(url.replace(/^https?:\/\//, ''))}
        </a>
        <button class="text-xs px-1 py-0.5 rounded transition-colors flex-none"
                style="color:#E46962;font-family:Arial,Helvetica,sans-serif;cursor:pointer;"
                title="Remove milestone"
                onclick="event.stopPropagation();window._removeRnDMilestone('${escapeHtml(itemId)}', '${escapeHtml(repoWithOwner)}', ${issueNumber}, ${idx})">✕</button>
      </div>`
    ).join('');
    milestoneHtml = `<div class="flex-1 min-w-0 space-y-1">
      ${milestoneItems}
      <div class="flex items-center gap-1 min-w-0">
        <input id="rnd-milestone-add-${itemId}" type="text"
               placeholder="https://roadmap.logos.co/..."
               class="logos-input text-xs flex-1 min-w-0 py-0.5"
               onfocus="this.style.borderColor='#E46962'"
               onblur="this.style.borderColor=''" />
        <button class="text-xs px-1.5 py-0.5 rounded transition-colors flex-none"
                style="background:#E46962;color:#fff;font-family:Arial,Helvetica,sans-serif;cursor:pointer;"
                onmouseover="this.style.background='#FA7B17'" onmouseout="this.style.background='#E46962'"
                title="Add milestone"
                onclick="event.stopPropagation();window._addRnDMilestone('${escapeHtml(itemId)}', '${escapeHtml(repoWithOwner)}', ${issueNumber})">+</button>
      </div>
    </div>`;
    dateHtml = `<span class="flex items-center gap-1">
      <input id="rnd-date-${itemId}" type="text"
             value="${escapeHtml(rnd.date || '')}"
             placeholder="15Mar26"
             data-original="${escapeHtml(rnd.date || '')}"
             class="logos-input text-xs py-0.5"
             style="width:6rem;"
             onfocus="this.style.borderColor='#E46962'"
             onblur="this.style.borderColor=''" />
      <button id="rnd-date-save-${itemId}" class="hidden text-xs px-1.5 py-0.5 rounded transition-colors"
              style="background:#E46962;color:#fff;font-family:Arial,Helvetica,sans-serif;"
              onmouseover="this.style.background='#FA7B17'" onmouseout="this.style.background='#E46962'">✓</button>
    </span>`;
  } else {
    teamHtml = rnd.team
      ? `<span class="text-xs font-medium px-2 py-0.5 rounded"
             style="background:${teamColor(rnd.team, 0.15)};color:${teamColor(rnd.team, 0.9)};border:1px solid ${teamColor(rnd.team, 0.3)};font-family:Arial,Helvetica,sans-serif;">
           ${escapeHtml(rnd.team)}
         </span>`
      : `<span class="text-xs italic" style="color:#808C78;font-family:Arial,Helvetica,sans-serif;">not set</span>`;
    milestoneHtml = rnd.milestones.length > 0
      ? `<div class="flex-1 min-w-0 space-y-1">${rnd.milestones.map((url, idx) =>
          `<div id="ms-progress-${itemId}-${idx}" class="flex items-center gap-1.5 min-w-0">
            <span class="ms-checkbox flex-none"></span>
            <a href="${escapeHtml(url)}" target="_blank" rel="noopener"
                class="text-xs truncate hover:underline flex-1 min-w-0" style="color:#3B7CB8;font-family:Arial,Helvetica,sans-serif;"
                onclick="event.stopPropagation()">
              ${escapeHtml(url.replace(/^https?:\/\//, ''))}
            </a>
          </div>`
        ).join('')}</div>`
      : `<span class="text-xs italic" style="color:#808C78;font-family:Arial,Helvetica,sans-serif;">not set</span>`;
    dateHtml = rnd.date
      ? `<span class="text-xs font-medium" style="color:#4E635E;font-family:Arial,Helvetica,sans-serif;">${escapeHtml(rnd.date)}</span>`
      : `<span class="text-xs italic" style="color:#808C78;font-family:Arial,Helvetica,sans-serif;">not set</span>`;
  }

  const body = `
    <div class="space-y-2">
      ${fieldRow('Team', teamHtml)}
      <div class="flex items-start gap-2">
        <span class="text-xs w-20 flex-none pt-0.5" style="color:#808C78;font-family:Arial,Helvetica,sans-serif;">${rnd.milestones.length > 1 ? 'Milestones' : 'Milestone'}</span>
        ${milestoneHtml}
      </div>
      ${fieldRow('Date', dateHtml)}
    </div>`;

  const badge = `<span id="rnd-state-badge-${itemId}">${stateBadgeHtml(stateLabel, color)}</span>`;
  return sectionCard('R&D', badge, body);
}

function renderDocPacketSection(itemId, docPacketLink, rndState, canWrite, issueUrl) {
  const isDelivered = !!docPacketLink;

  let linkHtml;
  if (isDelivered) {
    const title = docPacketLink.replace(/^https?:\/\//, '');
    linkHtml = `<a href="${escapeHtml(docPacketLink)}" target="_blank" rel="noopener"
       class="text-xs truncate hover:underline" style="color:#3B7CB8;font-family:Arial,Helvetica,sans-serif;"
       onclick="event.stopPropagation()">${escapeHtml(title)}</a>`;
  } else {
    linkHtml = `<span class="text-xs italic" style="color:#808C78;font-family:Arial,Helvetica,sans-serif;">
      No link yet. Open an issue using the
      <a href="https://github.com/logos-co/logos-docs/issues/new?template=doc-packet.yml"
         target="_blank" rel="noopener" class="underline not-italic" style="color:#3B7CB8;">doc packet template</a>,
      fill it in, then paste the URL below.
    </span>`;
  }

  let editHtml = '';
  if (canWrite) {
    editHtml = `<span class="flex items-center gap-1 mt-2">
      <input id="docpacket-link-${itemId}" type="text"
             value="${escapeHtml(docPacketLink || '')}"
             placeholder="https://github.com/logos-co/logos-docs/issues/..."
             data-original="${escapeHtml(docPacketLink || '')}"
             class="logos-input text-xs flex-1 min-w-0 py-0.5"
             onfocus="this.style.borderColor='#E46962'"
             onblur="this.style.borderColor=''" />
      <button id="docpacket-link-save-${itemId}" class="hidden text-xs px-1.5 py-0.5 rounded transition-colors flex-none"
              style="background:#E46962;color:#fff;font-family:Arial,Helvetica,sans-serif;"
              onmouseover="this.style.background='#FA7B17'" onmouseout="this.style.background='#E46962'">✓</button>
    </span>`;
  }

  const stateHtml = isDelivered
    ? stateBadgeHtml('Delivered', '#6AAE7B')
    : stateBadgeHtml('Waiting for R&D', '#808C78');

  const body = `<div class="space-y-1">
    ${fieldRow('Link', linkHtml)}
    ${editHtml}
  </div>`;

  return sectionCard('Doc Packet', stateHtml, body);
}

function renderDocumentationSection(itemId, docsState, docsTracking, docsTrackingRef, docsPr, docsPrRef, repoWithOwner, issueNumber, canWrite) {
  const color = DOCS_COLORS[docsState] || '#808C78';
  const stateLabel = DOCS_STATE_LABELS[docsState] || docsState;

  let trackingHtml, prHtml;

  if (canWrite) {
    trackingHtml = `<span class="flex-1 flex items-center gap-1 min-w-0">
      <input id="docs-tracking-${itemId}" type="text"
             value="${escapeHtml(docsTracking || '')}"
             placeholder="https://github.com/logos-co/logos-docs/issues/..."
             data-original="${escapeHtml(docsTracking || '')}"
             class="logos-input text-xs flex-1 min-w-0 py-0.5"
             onfocus="this.style.borderColor='#E46962'"
             onblur="this.style.borderColor=''" />
      <button id="docs-tracking-save-${itemId}" class="hidden text-xs px-1.5 py-0.5 rounded transition-colors flex-none"
              style="background:#E46962;color:#fff;font-family:Arial,Helvetica,sans-serif;"
              onmouseover="this.style.background='#FA7B17'" onmouseout="this.style.background='#E46962'">✓</button>
    </span>`;
    prHtml = `<span class="flex-1 flex flex-col gap-1 min-w-0">
      <span class="flex items-center gap-1 min-w-0">
        <input id="docs-pr-${itemId}" type="text"
               value="${escapeHtml(docsPr || '')}"
               placeholder="https://github.com/logos-co/logos-docs/pull/..."
               data-original="${escapeHtml(docsPr || '')}"
               class="logos-input text-xs flex-1 min-w-0 py-0.5"
               onfocus="this.style.borderColor='#E46962'"
               onblur="this.style.borderColor=''" />
        <button id="docs-pr-save-${itemId}" class="hidden text-xs px-1.5 py-0.5 rounded transition-colors flex-none"
                style="background:#E46962;color:#fff;font-family:Arial,Helvetica,sans-serif;"
                onmouseover="this.style.background='#FA7B17'" onmouseout="this.style.background='#E46962'">✓</button>
      </span>
      <span id="docs-pr-suggest-${itemId}"></span>
    </span>`;
  } else {
    if (docsTracking) {
      const title = docsTrackingRef?.title || docsTracking.replace(/^https?:\/\//, '');
      trackingHtml = `<span class="flex items-center gap-2 min-w-0">
        <a href="${escapeHtml(docsTracking)}" target="_blank" rel="noopener"
           class="text-xs truncate hover:underline" style="color:#3B7CB8;font-family:Arial,Helvetica,sans-serif;"
           onclick="event.stopPropagation()">${escapeHtml(title)}</a>
        ${issueStatusBadge(docsTrackingRef)}
      </span>`;
    } else {
      trackingHtml = `<span class="text-xs italic" style="color:#808C78;font-family:Arial,Helvetica,sans-serif;">no tracking issue</span>`;
    }
    if (docsPr) {
      const title = docsPrRef?.title || docsPr.replace(/^https?:\/\//, '');
      prHtml = `<span class="flex items-center gap-2 min-w-0">
        <a href="${escapeHtml(docsPr)}" target="_blank" rel="noopener"
           class="text-xs truncate hover:underline" style="color:#3B7CB8;font-family:Arial,Helvetica,sans-serif;"
           onclick="event.stopPropagation()">${escapeHtml(title)}</a>
        ${issueStatusBadge(docsPrRef)}
      </span>`;
    } else {
      // Empty pr field: leave a slot for the auto-suggestion to populate, with a fallback "no doc PR".
      prHtml = `<span class="flex-1 flex flex-col gap-1 min-w-0">
        <span id="docs-pr-empty-${itemId}" class="text-xs italic" style="color:#808C78;font-family:Arial,Helvetica,sans-serif;">no doc PR</span>
        <span id="docs-pr-suggest-${itemId}"></span>
      </span>`;
    }
  }

  const body = `<div class="space-y-2">
    ${fieldRow('Tracking issue', trackingHtml)}
    ${fieldRow('Doc PR', prHtml)}
  </div>`;

  return sectionCard('Documentation', stateBadgeHtml(stateLabel, color), body);
}

function renderRedTeamSection(itemId, redTeamLink, rtRef, redTeamState, repoWithOwner, issueNumber, canWrite) {
  const color = REDTEAM_COLORS[redTeamState] || '#808C78';
  const stateLabel = REDTEAM_STATE_LABELS[redTeamState] || redTeamState;

  let linkHtml;
  if (canWrite) {
    linkHtml = `<span class="flex-1 flex items-center gap-1 min-w-0">
      <input id="redteam-link-${itemId}" type="text"
             value="${escapeHtml(redTeamLink || '')}"
             placeholder="https://github.com/logos-co/journeys.logos.co/..."
             data-original="${escapeHtml(redTeamLink || '')}"
             class="logos-input text-xs flex-1 min-w-0 py-0.5"
             onfocus="this.style.borderColor='#E46962'"
             onblur="this.style.borderColor=''" />
      <button id="redteam-link-save-${itemId}" class="hidden text-xs px-1.5 py-0.5 rounded transition-colors flex-none"
              style="background:#E46962;color:#fff;font-family:Arial,Helvetica,sans-serif;"
              onmouseover="this.style.background='#FA7B17'" onmouseout="this.style.background='#E46962'">✓</button>
    </span>`;
  } else if (redTeamLink) {
    const title = rtRef?.title || redTeamLink.replace(/^https?:\/\//, '');
    linkHtml = `<a href="${escapeHtml(redTeamLink)}" target="_blank" rel="noopener"
       class="text-xs truncate hover:underline" style="color:#3B7CB8;font-family:Arial,Helvetica,sans-serif;"
       onclick="event.stopPropagation()">${escapeHtml(title)}</a>`;
  } else {
    linkHtml = `<span class="text-xs italic" style="color:#808C78;font-family:Arial,Helvetica,sans-serif;">no tracking issue</span>`;
  }

  const body = `<div class="space-y-2">
    ${fieldRow('Tracking issue', linkHtml)}
  </div>`;

  return sectionCard('Red Team', stateBadgeHtml(stateLabel, color), body);
}

// ---------------------------------------------------------------------------
// Inline edit handlers for workflow sections
// ---------------------------------------------------------------------------

function attachWorkflowHandlers(itemId, repoWithOwner, issueNumber) {
  // Milestone add input: Enter to add
  const milestoneAddInput = document.getElementById(`rnd-milestone-add-${itemId}`);
  if (milestoneAddInput) {
    milestoneAddInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        window._addRnDMilestone(itemId, repoWithOwner, issueNumber);
      }
      if (e.key === 'Escape') {
        milestoneAddInput.value = '';
        milestoneAddInput.blur();
      }
    });
  }

  // Date input: show save button on change
  const dateInput = document.getElementById(`rnd-date-${itemId}`);
  const dateSave  = document.getElementById(`rnd-date-save-${itemId}`);
  if (dateInput && dateSave) {
    const showSave = () => {
      if (dateInput.value.trim() !== dateInput.dataset.original)
        dateSave.classList.remove('hidden');
      else
        dateSave.classList.add('hidden');
    };
    dateInput.addEventListener('input', showSave);
    dateInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); dateSave.click(); }
      if (e.key === 'Escape') { dateInput.value = dateInput.dataset.original; dateSave.classList.add('hidden'); dateInput.blur(); }
    });
    dateSave.addEventListener('click', () =>
      window._saveRnDField(itemId, repoWithOwner, issueNumber, 'date', dateInput.value.trim())
    );
  }

  // Doc packet link input
  const dpInput = document.getElementById(`docpacket-link-${itemId}`);
  const dpSave  = document.getElementById(`docpacket-link-save-${itemId}`);
  if (dpInput && dpSave) {
    const showSave = () => {
      if (dpInput.value.trim() !== dpInput.dataset.original)
        dpSave.classList.remove('hidden');
      else
        dpSave.classList.add('hidden');
    };
    dpInput.addEventListener('input', showSave);
    dpInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); dpSave.click(); }
      if (e.key === 'Escape') { dpInput.value = dpInput.dataset.original; dpSave.classList.add('hidden'); dpInput.blur(); }
    });
    dpSave.addEventListener('click', () =>
      window._saveDocPacketLink(itemId, repoWithOwner, issueNumber, dpInput.value.trim())
    );
  }

  // Docs tracking input
  const docsTrackingInput = document.getElementById(`docs-tracking-${itemId}`);
  const docsTrackingSave  = document.getElementById(`docs-tracking-save-${itemId}`);
  if (docsTrackingInput && docsTrackingSave) {
    const showSave = () => {
      if (docsTrackingInput.value.trim() !== docsTrackingInput.dataset.original)
        docsTrackingSave.classList.remove('hidden');
      else
        docsTrackingSave.classList.add('hidden');
    };
    docsTrackingInput.addEventListener('input', showSave);
    docsTrackingInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); docsTrackingSave.click(); }
      if (e.key === 'Escape') { docsTrackingInput.value = docsTrackingInput.dataset.original; docsTrackingSave.classList.add('hidden'); docsTrackingInput.blur(); }
    });
    docsTrackingSave.addEventListener('click', () =>
      window._saveDocTracking(itemId, repoWithOwner, issueNumber, docsTrackingInput.value.trim())
    );
  }

  // Docs PR input
  const docsPrInput = document.getElementById(`docs-pr-${itemId}`);
  const docsPrSave  = document.getElementById(`docs-pr-save-${itemId}`);
  if (docsPrInput && docsPrSave) {
    const showSave = () => {
      if (docsPrInput.value.trim() !== docsPrInput.dataset.original)
        docsPrSave.classList.remove('hidden');
      else
        docsPrSave.classList.add('hidden');
    };
    docsPrInput.addEventListener('input', showSave);
    docsPrInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); docsPrSave.click(); }
      if (e.key === 'Escape') { docsPrInput.value = docsPrInput.dataset.original; docsPrSave.classList.add('hidden'); docsPrInput.blur(); }
    });
    docsPrSave.addEventListener('click', () =>
      window._saveDocPr(itemId, repoWithOwner, issueNumber, docsPrInput.value.trim())
    );
  }

  // Red team tracking input
  const rtInput = document.getElementById(`redteam-link-${itemId}`);
  const rtSave  = document.getElementById(`redteam-link-save-${itemId}`);
  if (rtInput && rtSave) {
    const showSave = () => {
      if (rtInput.value.trim() !== rtInput.dataset.original)
        rtSave.classList.remove('hidden');
      else
        rtSave.classList.add('hidden');
    };
    rtInput.addEventListener('input', showSave);
    rtInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); rtSave.click(); }
      if (e.key === 'Escape') { rtInput.value = rtInput.dataset.original; rtSave.classList.add('hidden'); rtInput.blur(); }
    });
    rtSave.addEventListener('click', () =>
      window._saveRedTeamTracking(itemId, repoWithOwner, issueNumber, rtInput.value.trim())
    );
  }
}

// ---------------------------------------------------------------------------
// Blocked labels
// ---------------------------------------------------------------------------

function renderBlockedLabels(blockedLabels, item, canWrite) {
  if (!blockedLabels.length) {
    return `<span class="text-xs text-muted italic" style="font-family:Arial,Helvetica,sans-serif;">None</span>`;
  }
  return blockedLabels.map(bl => `
    <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium border"
          style="background:${teamColor(bl.team, 0.15)};border-color:${teamColor(bl.team, 0.4)};color:${teamColor(bl.team, 1)};font-family:Arial,Helvetica,sans-serif;">
      ${escapeHtml(bl.team)}
      ${canWrite ? `
        <button onclick="window._removeBlockedLabel('${item.id}', '${escapeHtml(bl.name)}')" title="Remove" class="ml-0.5 hover:opacity-75 transition-opacity">
          <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      ` : ''}
    </span>
  `).join('');
}

function renderAddLabelButton(item) {
  return `
    <button onclick="window._showAddLabelForm('${item.id}')"
            id="add-label-btn-${item.id}"
            class="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium text-muted transition-colors"
            style="border:1px dashed rgba(78,99,94,0.5);font-family:Arial,Helvetica,sans-serif;"
            onmouseover="this.style.borderColor='rgba(228,105,98,0.6)';this.style.color='#E46962'"
            onmouseout="this.style.borderColor='rgba(78,99,94,0.5)';this.style.color='#808C78'">
      <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
      </svg>
      Add blocked:* label
    </button>
    <div id="add-label-form-${item.id}" class="hidden items-center gap-2" style="display:none">
      <input id="add-label-input-${item.id}" type="text" placeholder="team-name" class="logos-input text-xs w-36 py-1" />
      <button onclick="window._submitAddLabel('${item.id}', '${escapeHtml(item.content?.repository?.nameWithOwner || '')}', ${item.content?.number || 0})"
              class="text-xs text-white px-2.5 py-1 rounded transition-colors" style="background:#E46962;"
              onmouseover="this.style.background='#FA7B17'" onmouseout="this.style.background='#E46962'">Add</button>
      <button onclick="window._cancelAddLabel('${item.id}')" class="text-xs text-muted hover:text-parchment transition-colors">Cancel</button>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Assignees
// ---------------------------------------------------------------------------

function renderAssignees(issue) {
  const assignees = issue.assignees?.nodes || [];
  if (!assignees.length) return '';
  return `
    <div class="flex items-center gap-3">
      <span class="text-xs font-medium w-24 flex-none" style="color:#808C78;font-family:Arial,Helvetica,sans-serif;">Assignees</span>
      <div class="flex items-center gap-2">
        ${assignees.map(a => `
          <a href="https://github.com/${a.login}" target="_blank" rel="noopener"
             class="flex items-center gap-1.5 text-xs text-muted hover:text-parchment transition-colors" style="font-family:Arial,Helvetica,sans-serif;">
            <img src="${a.avatarUrl}&s=32" alt="${escapeHtml(a.login)}" class="w-5 h-5 rounded-full" />
            ${escapeHtml(a.login)}
          </a>
        `).join('')}
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Global handlers
// ---------------------------------------------------------------------------

export function registerLabelHandlers() {

  // -- Blocked label: remove --
  window._removeBlockedLabel = async (itemId, labelName) => {
    const pat = getWritePAT();
    if (!pat) { showToast('error', 'Switch to edit mode to modify labels'); return; }

    const row = document.querySelector(`[data-item-id="${itemId}"]`);
    if (!row) return;
    const [owner, repo] = (row.dataset.repo || '').split('/');
    const issueNumber = parseInt(row.dataset.issue || '0', 10);
    if (!owner || !repo || !issueNumber) return;

    try {
      await removeLabel(owner, repo, issueNumber, labelName, pat);
      showToast('success', `Removed label "${labelName}"`);
      await refreshBlockedLabels(itemId, owner, repo, issueNumber, pat);
    } catch (err) {
      showToast('error', `Failed to remove label: ${err.message}`);
    }
  };

  // -- Blocked label: show form --
  window._showAddLabelForm = (itemId) => {
    document.getElementById(`add-label-btn-${itemId}`)?.style.setProperty('display', 'none');
    const form = document.getElementById(`add-label-form-${itemId}`);
    if (form) form.style.display = 'flex';
    const input = document.getElementById(`add-label-input-${itemId}`);
    if (input) {
      input.focus();
      input.onkeydown = (e) => {
        if (e.key === 'Enter') {
          const row = document.querySelector(`[data-item-id="${itemId}"]`);
          if (!row) return;
          window._submitAddLabel(itemId, row.dataset.repo, parseInt(row.dataset.issue || '0', 10));
        }
        if (e.key === 'Escape') window._cancelAddLabel(itemId);
      };
    }
  };

  window._cancelAddLabel = (itemId) => {
    const btn = document.getElementById(`add-label-btn-${itemId}`);
    const form = document.getElementById(`add-label-form-${itemId}`);
    if (btn) btn.style.display = '';
    if (form) form.style.display = 'none';
  };

  // -- Blocked label: submit --
  window._submitAddLabel = async (itemId, repoWithOwner, issueNumber) => {
    const input = document.getElementById(`add-label-input-${itemId}`);
    const teamName = input?.value.trim();
    if (!teamName) return;

    const pat = getWritePAT();
    if (!pat) { showToast('error', 'Switch to edit mode to save changes'); return; }

    const [owner, repo] = (repoWithOwner || '').split('/');
    if (!owner || !repo || !issueNumber) { showToast('error', 'Could not determine issue repository'); return; }

    try {
      await addLabels(owner, repo, issueNumber, [`blocked:${teamName}`], pat);
      showToast('success', `Added label "blocked:${teamName}"`);
      window._cancelAddLabel(itemId);
      await refreshBlockedLabels(itemId, owner, repo, issueNumber, pat);
    } catch (err) {
      showToast('error', `Failed: ${err.message}`);
    }
  };

  // -- R&D field save (team / milestone / date) --
  window._saveRnDField = async (itemId, repoWithOwner, issueNumber, field, value) => {
    if (field === 'milestone') return; // Use _addRnDMilestone / _removeRnDMilestone
    if (field === 'date' && value && !/^\d{2}(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\d{2}$/i.test(value)) {
      showToast('error', 'Invalid date — use DDMMMYY (e.g. 15Mar26)');
      return;
    }

    const pat = getWritePAT();
    if (!pat) { showToast('error', 'Switch to edit mode to save changes'); return; }

    const [owner, repo] = (repoWithOwner || '').split('/');
    if (!owner || !repo || !issueNumber) { showToast('error', 'Could not determine issue'); return; }

    try {
      const item = itemRegistry.get(itemId);
      const currentBody = item?.content?.body ?? (await fetchIssue(owner, repo, issueNumber, pat)).body ?? '';
      const newBody = setRnDField(currentBody, field, value || null);
      await updateIssueBody(owner, repo, issueNumber, newBody, pat);
      if (item?.content) item.content.body = newBody;
      showToast('success', `Saved R&D ${field}`);
      await loadWorkflowSections(itemId, item || { content: { body: newBody, repository: { nameWithOwner: repoWithOwner }, number: issueNumber, labels: { nodes: [] } } }, newBody);
    } catch (err) {
      showToast('error', `Failed to save: ${err.message}`);
    }
  };

  window._addRnDMilestone = async (itemId, repoWithOwner, issueNumber) => {
    const input = document.getElementById(`rnd-milestone-add-${itemId}`);
    const url = input?.value.trim();
    if (!url) return;
    if (!/^https?:\/\/\S+$/.test(url)) {
      showToast('error', 'Invalid URL');
      return;
    }

    const pat = getWritePAT();
    if (!pat) { showToast('error', 'Switch to edit mode to save changes'); return; }

    const [owner, repo] = (repoWithOwner || '').split('/');
    if (!owner || !repo || !issueNumber) { showToast('error', 'Could not determine issue'); return; }

    // Visual feedback: disable input, show saving state
    input.disabled = true;
    input.style.opacity = '0.5';
    const addBtn = input.nextElementSibling;
    if (addBtn) { addBtn.disabled = true; addBtn.textContent = '…'; }

    try {
      const item = itemRegistry.get(itemId);
      const currentBody = item?.content?.body ?? (await fetchIssue(owner, repo, issueNumber, pat)).body ?? '';
      const rnd = extractRnD(currentBody);
      const newBody = setRnDMilestones(currentBody, [...rnd.milestones, url]);
      await updateIssueBody(owner, repo, issueNumber, newBody, pat);
      if (item?.content) item.content.body = newBody;
      showToast('success', 'Added milestone');
      await loadWorkflowSections(itemId, item || { content: { body: newBody, repository: { nameWithOwner: repoWithOwner }, number: issueNumber, labels: { nodes: [] } } }, newBody);
    } catch (err) {
      showToast('error', `Failed to save: ${err.message}`);
      if (input) { input.disabled = false; input.style.opacity = ''; }
      if (addBtn) { addBtn.disabled = false; addBtn.textContent = '+'; }
    }
  };

  window._removeRnDMilestone = async (itemId, repoWithOwner, issueNumber, idx) => {
    const pat = getWritePAT();
    if (!pat) { showToast('error', 'Switch to edit mode to save changes'); return; }

    const [owner, repo] = (repoWithOwner || '').split('/');
    if (!owner || !repo || !issueNumber) { showToast('error', 'Could not determine issue'); return; }

    // Visual feedback: fade out the milestone row being removed
    const container = document.getElementById(`rnd-milestone-add-${itemId}`)?.closest('.space-y-1');
    const row = container?.children[idx];
    if (row) { row.style.opacity = '0.4'; row.style.pointerEvents = 'none'; }

    try {
      const item = itemRegistry.get(itemId);
      const currentBody = item?.content?.body ?? (await fetchIssue(owner, repo, issueNumber, pat)).body ?? '';
      const rnd = extractRnD(currentBody);
      const newBody = setRnDMilestones(currentBody, rnd.milestones.filter((_, i) => i !== idx));
      await updateIssueBody(owner, repo, issueNumber, newBody, pat);
      if (item?.content) item.content.body = newBody;
      showToast('success', 'Removed milestone');
      await loadWorkflowSections(itemId, item || { content: { body: newBody, repository: { nameWithOwner: repoWithOwner }, number: issueNumber, labels: { nodes: [] } } }, newBody);
    } catch (err) {
      showToast('error', `Failed to save: ${err.message}`);
      if (row) { row.style.opacity = ''; row.style.pointerEvents = ''; }
    }
  };

  // -- Documentation link save --
  window._saveDocPacketLink = async (itemId, repoWithOwner, issueNumber, value) => {
    if (value && !/^https?:\/\/\S+$/.test(value)) {
      showToast('error', 'Invalid URL');
      return;
    }

    const pat = getWritePAT();
    if (!pat) { showToast('error', 'Switch to edit mode to save changes'); return; }

    const [owner, repo] = (repoWithOwner || '').split('/');
    if (!owner || !repo || !issueNumber) { showToast('error', 'Could not determine issue'); return; }

    try {
      const item = itemRegistry.get(itemId);
      const currentBody = item?.content?.body ?? (await fetchIssue(owner, repo, issueNumber, pat)).body ?? '';
      const newBody = setDocPacketLink(currentBody, value || null);
      await updateIssueBody(owner, repo, issueNumber, newBody, pat);
      if (item?.content) item.content.body = newBody;
      showToast('success', 'Saved doc packet link');
      await loadWorkflowSections(itemId, item || { content: { body: newBody, repository: { nameWithOwner: repoWithOwner }, number: issueNumber, labels: { nodes: [] } } }, newBody);
    } catch (err) {
      showToast('error', `Failed to save: ${err.message}`);
    }
  };

  // -- Documentation tracking save --
  window._saveDocTracking = async (itemId, repoWithOwner, issueNumber, value) => {
    if (value && !/^https?:\/\/github\.com\/logos-co\/logos-docs\/issues\/\d+$/.test(value)) {
      showToast('error', 'Must be a logos-co/logos-docs issue URL');
      return;
    }

    const pat = getWritePAT();
    if (!pat) { showToast('error', 'Switch to edit mode to save changes'); return; }

    const [owner, repo] = (repoWithOwner || '').split('/');
    if (!owner || !repo || !issueNumber) { showToast('error', 'Could not determine issue'); return; }

    try {
      const item = itemRegistry.get(itemId);
      const currentBody = item?.content?.body ?? (await fetchIssue(owner, repo, issueNumber, pat)).body ?? '';
      const newBody = setDocTracking(currentBody, value || null);
      await updateIssueBody(owner, repo, issueNumber, newBody, pat);
      if (item?.content) item.content.body = newBody;
      showToast('success', 'Saved documentation tracking issue');
      await loadWorkflowSections(itemId, item || { content: { body: newBody, repository: { nameWithOwner: repoWithOwner }, number: issueNumber, labels: { nodes: [] } } }, newBody);
    } catch (err) {
      showToast('error', `Failed to save: ${err.message}`);
    }
  };

  // -- Documentation PR save --
  window._saveDocPr = async (itemId, repoWithOwner, issueNumber, value) => {
    if (value && !/^https?:\/\/github\.com\/logos-co\/logos-docs\/pull\/\d+$/.test(value)) {
      showToast('error', 'Must be a logos-co/logos-docs PR URL');
      return;
    }

    const pat = getWritePAT();
    if (!pat) { showToast('error', 'Switch to edit mode to save changes'); return; }

    const [owner, repo] = (repoWithOwner || '').split('/');
    if (!owner || !repo || !issueNumber) { showToast('error', 'Could not determine issue'); return; }

    try {
      const item = itemRegistry.get(itemId);
      const currentBody = item?.content?.body ?? (await fetchIssue(owner, repo, issueNumber, pat)).body ?? '';
      const newBody = setDocPr(currentBody, value || null);
      await updateIssueBody(owner, repo, issueNumber, newBody, pat);
      if (item?.content) item.content.body = newBody;
      showToast('success', 'Saved doc PR');
      await loadWorkflowSections(itemId, item || { content: { body: newBody, repository: { nameWithOwner: repoWithOwner }, number: issueNumber, labels: { nodes: [] } } }, newBody);
    } catch (err) {
      showToast('error', `Failed to save: ${err.message}`);
    }
  };

  // -- Red team tracking save --
  window._saveRedTeamTracking = async (itemId, repoWithOwner, issueNumber, value) => {
    if (value && !/^https?:\/\/\S+$/.test(value)) {
      showToast('error', 'Invalid URL');
      return;
    }

    const pat = getWritePAT();
    if (!pat) { showToast('error', 'Switch to edit mode to save changes'); return; }

    const [owner, repo] = (repoWithOwner || '').split('/');
    if (!owner || !repo || !issueNumber) { showToast('error', 'Could not determine issue'); return; }

    try {
      const item = itemRegistry.get(itemId);
      const currentBody = item?.content?.body ?? (await fetchIssue(owner, repo, issueNumber, pat)).body ?? '';
      const newBody = setRedTeamTracking(currentBody, value || null);
      await updateIssueBody(owner, repo, issueNumber, newBody, pat);
      if (item?.content) item.content.body = newBody;
      showToast('success', 'Saved red team tracking');
      await loadWorkflowSections(itemId, item || { content: { body: newBody, repository: { nameWithOwner: repoWithOwner }, number: issueNumber, labels: { nodes: [] } } }, newBody);
    } catch (err) {
      showToast('error', `Failed to save: ${err.message}`);
    }
  };
}

// ---------------------------------------------------------------------------
// Refresh helpers
// ---------------------------------------------------------------------------

async function refreshBlockedLabels(itemId, owner, repo, issueNumber, pat) {
  try {
    const freshIssue = await fetchIssue(owner, repo, issueNumber, pat);
    const blockedLabels = extractAllBlockedLabels((freshIssue.labels || []).map(l => l.name));

    const container = document.getElementById(`blocked-labels-${itemId}`);
    if (!container) return;

    const canWrite = hasWritePAT();
    const fakeItem = { id: itemId, content: { repository: { nameWithOwner: `${owner}/${repo}` }, number: issueNumber } };
    container.innerHTML = renderBlockedLabels(blockedLabels, fakeItem, canWrite) +
      (canWrite ? renderAddLabelButton(fakeItem) : '');
  } catch (err) {
    console.warn('Failed to refresh labels:', err);
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
