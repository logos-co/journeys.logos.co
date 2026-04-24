/**
 * detail.js — Journey detail / drill-down view
 */

import {
  addLabels, removeLabel, fetchIssue,
  updateIssueBody, fetchRef, fetchMilestoneProgress,
} from './api.js';
import {
  renderMarkdown, extractExternalBlockedLabels, extractDescription,
  extractRnD, extractDocPacket, extractDocumentation, extractRedTeam,
  computeStatus, computeDesiredLabels, RND_TEAMS as MARKDOWN_RND_TEAMS,
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
            <h3 class="text-xs font-semibold uppercase tracking-wider" style="color:#808C78;font-family:Arial,Helvetica,sans-serif;">External blockers</h3>
            ${canWrite ? renderAddLabelButton(item) : ''}
          </div>
          <div id="blocked-labels-${item.id}" class="flex flex-wrap gap-2">
            ${renderBlockedLabels(
              extractExternalBlockedLabels(issue.labels?.nodes || []),
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

const STATUS_COLORS = {
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
const STATUS_LABELS = {
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
const RND_TEAMS = MARKDOWN_RND_TEAMS;

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

  const repoWithOwner = issue.repository?.nameWithOwner || '';
  const issueNumber   = issue.number || 0;

  // ── FAST PATH: render workflow fields immediately, without any network fetch.
  // Refs populate in the background below.
  const workflowEl = document.getElementById(`workflow-${itemId}`);
  if (!workflowEl) return;

  workflowEl.innerHTML = renderWorkflowSections(
    itemId, rnd, docPacketLink,
    docsTracking, /* docsTrackingRef */ null,
    docsPr,       /* docsPrRef */ null,
    redTeamLink,  /* rtRef */ null,
    repoWithOwner, issueNumber, canWrite
  );
  attachWorkflowHandlers(itemId, repoWithOwner, issueNumber);

  // Provisional banner from body-only state (no ref-dependent phases yet).
  const actualLabels = (issue.labels?.nodes || []).map(l => l.name);
  const provisionalStatus = computeStatus({
    rnd, docPacketLink, docsPr, docsPrRef: null, redTeamLink, redTeamRef: null,
    allMilestonesDone: false,
  });
  const provisionalDesired = computeDesiredLabels(provisionalStatus, rnd.team);
  const bannerEl = document.getElementById(`action-banner-${itemId}`);
  if (bannerEl) {
    bannerEl.innerHTML = renderBlockedByBanner(
      provisionalStatus, provisionalDesired.blockedBy,
      detailMismatch(actualLabels, provisionalDesired),
    );
  }

  // ── ASYNC PATH: fetch refs, then re-render the banner and the title badges.
  const refsP = preloadedRefs
    ? Promise.resolve(preloadedRefs)
    : Promise.all([
        redTeamLink  ? fetchRef(redTeamLink,  pat) : Promise.resolve(null),
        docsTracking ? fetchRef(docsTracking, pat) : Promise.resolve(null),
        docsPr       ? fetchRef(docsPr,       pat) : Promise.resolve(null),
      ]);
  refsP.then(([rtRef, docsTrackingRef, docsPrRef]) => {
    upgradeWorkflowWithRefs(itemId, {
      rnd, docPacketLink, docsTracking, docsTrackingRef,
      docsPr, docsPrRef, redTeamLink, rtRef,
      actualLabels, repoWithOwner, issueNumber, canWrite,
    });
    // Chain milestone-progress + all-done status upgrade onto the ref load.
    loadMilestoneProgress(itemId, item, rnd, docPacketLink, docsPr, docsPrRef, redTeamLink, rtRef, pat);
  });
}

function upgradeWorkflowWithRefs(itemId, ctx) {
  const {
    rnd, docPacketLink, docsTracking, docsTrackingRef,
    docsPr, docsPrRef, redTeamLink, rtRef,
    actualLabels, repoWithOwner, issueNumber, canWrite,
  } = ctx;

  const status  = computeStatus({
    rnd, docPacketLink, docsPr, docsPrRef, redTeamLink, redTeamRef: rtRef,
    allMilestonesDone: false,
  });
  const desired = computeDesiredLabels(status, rnd.team);
  const mismatch = detailMismatch(actualLabels, desired);

  const bannerEl = document.getElementById(`action-banner-${itemId}`);
  if (bannerEl) bannerEl.innerHTML = renderBlockedByBanner(status, desired.blockedBy, mismatch);

  // Re-render the workflow section so the doc tracking/PR rows pick up their
  // open/closed/merged pills (they were null on the fast path).
  const workflowEl = document.getElementById(`workflow-${itemId}`);
  if (workflowEl) {
    workflowEl.innerHTML = renderWorkflowSections(
      itemId, rnd, docPacketLink,
      docsTracking, docsTrackingRef, docsPr, docsPrRef,
      redTeamLink, rtRef,
      repoWithOwner, issueNumber, canWrite,
    );
    attachWorkflowHandlers(itemId, repoWithOwner, issueNumber);
  }
}

function detailMismatch(actualLabels, desired) {
  const statusLabels = actualLabels.filter(l => l.startsWith('status:'));
  if (statusLabels.length !== 1 || statusLabels[0] !== desired.status) return true;
  const actualBlocked = actualLabels.filter(l =>
    l === 'blocked-by:rnd' || l.startsWith('blocked-by:rnd-') ||
    l === 'blocked-by:docs' || l === 'blocked-by:red-team'
  ).sort();
  const wantBlocked = [...desired.blockedBy].sort();
  if (actualBlocked.length !== wantBlocked.length) return true;
  for (let i = 0; i < actualBlocked.length; i++) {
    if (actualBlocked[i] !== wantBlocked[i]) return true;
  }
  if (actualLabels.some(l => l.startsWith('action:'))) return true;
  if (actualLabels.some(l => /^blocked:/i.test(l) && !/^blocked-by:/i.test(l))) return true;
  return false;
}

async function loadMilestoneProgress(itemId, item, rnd, docPacketLink, docsPr, docsPrRef, redTeamLink, rtRef, pat) {
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

  // Recompute overall status if all roadmap milestones are done (→ waiting-for-doc-packet).
  const roadmapResults = results.filter(r => r !== null);
  if (roadmapResults.length > 0 && roadmapResults.every(r => r.done)) {
    const newStatus = computeStatus({
      rnd, docPacketLink, docsPr, docsPrRef, redTeamLink, redTeamRef: rtRef,
      allMilestonesDone: true,
    });
    // Re-render the whole banner so the status label, blocked-by pills,
    // and mismatch warning all reflect the new phase.
    const bannerEl = document.getElementById(`action-banner-${itemId}`);
    if (bannerEl) {
      const desired = computeDesiredLabels(newStatus, rnd.team);
      const actualLabels = (item?.content?.labels?.nodes || []).map(l => l.name);
      const mismatch = detailMismatch(actualLabels, desired);
      bannerEl.innerHTML = renderBlockedByBanner(newStatus, desired.blockedBy, mismatch);
    }
  }
}

export function renderBlockedByBanner(status, blockedByLabels, mismatch) {
  const BLOCKED_BY_COLORS = {
    'blocked-by:docs':     '#6AAE7B',
    'blocked-by:red-team': '#E46962',
  };
  const statusColor = STATUS_COLORS[status] || '#808C78';
  const statusLabel = STATUS_LABELS[status] || status;
  const statusPill = `<span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium"
      style="background:${statusColor}22;color:${statusColor};border:1px solid ${statusColor}55;font-family:Arial,Helvetica,sans-serif;">
      <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${statusColor};"></span>
      ${escapeHtml(statusLabel)}
    </span>`;

  const pills = blockedByLabels.map(l => {
    let color = BLOCKED_BY_COLORS[l];
    if (!color) {
      if (l === 'blocked-by:rnd' || l.startsWith('blocked-by:rnd-')) color = '#3B7CB8';
      else color = '#808C78';
    }
    let display;
    if (l === 'blocked-by:rnd')                  display = 'r&d';
    else if (l.startsWith('blocked-by:rnd-'))    display = l.slice('blocked-by:rnd-'.length);
    else                                         display = l.replace(/^blocked-by:/, '');
    return `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
      style="background:${color}22;color:${color};border:1px solid ${color}55;font-family:Arial,Helvetica,sans-serif;"
      title="${escapeHtml(l)}">
      ${escapeHtml(display)}
    </span>`;
  }).join('');

  const warnHtml = mismatch ? `
    <span class="text-xs" style="color:#FA7B17;font-family:Arial,Helvetica,sans-serif;">
      ⚠ Labels out of sync — click "Fix Labels"
    </span>` : '';

  return `
    <div class="flex items-center gap-2 flex-wrap px-3 py-2 rounded"
         style="background:rgba(255,255,255,0.5);border:1px solid rgba(78,99,94,0.2);">
      ${statusPill}
      <span class="text-xs font-medium flex-none" style="color:#808C78;font-family:Arial,Helvetica,sans-serif;">Blocked by:</span>
      ${pills || `<span class="text-xs italic" style="color:#808C78;font-family:Arial,Helvetica,sans-serif;">nobody</span>`}
      ${warnHtml}
    </div>`;
}

function renderWorkflowSections(
  itemId, rnd, docPacketLink,
  docsTracking, docsTrackingRef, docsPr, docsPrRef,
  redTeamLink, rtRef,
  repoWithOwner, issueNumber, canWrite
) {
  const sections = [];

  // ── R&D Section (always shown) ──
  sections.push(renderRnDSection(itemId, rnd, repoWithOwner, issueNumber, canWrite));

  // ── Doc Packet Section (always shown) ──
  sections.push(renderDocPacketSection(itemId, docPacketLink, canWrite));

  // ── Documentation Section (always shown) ──
  sections.push(renderDocumentationSection(itemId, docsTracking, docsTrackingRef, docsPr, docsPrRef, repoWithOwner, issueNumber, canWrite));

  // ── Red Team Section (always shown) ──
  sections.push(renderRedTeamSection(itemId, redTeamLink, rtRef, repoWithOwner, issueNumber, canWrite));

  return `<div class="space-y-3">${sections.join('')}</div>`;
}

function renderRnDSection(itemId, rnd, repoWithOwner, issueNumber, canWrite) {
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

  return sectionCard('R&D', '', body);
}

function renderDocPacketSection(itemId, docPacketLink, canWrite) {
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

  const body = `<div class="space-y-1">
    ${fieldRow('Link', linkHtml)}
    ${editHtml}
  </div>`;

  return sectionCard('Doc Packet', '', body);
}

function renderDocumentationSection(itemId, docsTracking, docsTrackingRef, docsPr, docsPrRef, repoWithOwner, issueNumber, canWrite) {
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
      <span class="text-xs italic" style="color:#808C78;font-family:Arial,Helvetica,sans-serif;">
        Add the doc PR URL here when it's ready for review.
      </span>
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
      prHtml = `<span class="text-xs italic" style="color:#808C78;font-family:Arial,Helvetica,sans-serif;">
        no doc PR — the docs team will add this when ready for review
      </span>`;
    }
  }

  const body = `<div class="space-y-2">
    ${fieldRow('Tracking issue', trackingHtml)}
    ${fieldRow('Doc PR', prHtml)}
  </div>`;

  return sectionCard('Documentation', '', body);
}

function renderRedTeamSection(itemId, redTeamLink, rtRef, repoWithOwner, issueNumber, canWrite) {
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

  return sectionCard('Red Team', '', body);
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
      Add external blocker
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
      await addLabels(owner, repo, issueNumber, [`blocked-by:${teamName}`], pat);
      showToast('success', `Added label "blocked-by:${teamName}"`);
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
    const blockedLabels = extractExternalBlockedLabels(freshIssue.labels || []);

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
