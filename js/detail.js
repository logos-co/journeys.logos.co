/**
 * detail.js — Journey detail / drill-down view
 */

import {
  addLabels, removeLabel, fetchIssue,
  updateIssueBody, createLabel, fetchRef, syncActionLabels,
} from './api.js';
import {
  renderMarkdown, extractAllBlockedLabels, extractDescription,
  extractRnD, extractDocPacket, extractDocumentation, extractRedTeam,
  computeRnDState, computeDocsState, computeRedTeamState, computeActionLabels,
  setRnDField, setDocPacketLink, setDocLink, setRedTeamTracking,
} from './markdown.js';
import { getReadPAT, getWritePAT, hasWritePAT } from './config.js';
import { teamColor, showToast } from './app.js';
import { renderStakeholderBadges } from './pipeline.js';

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
const RND_STATE_LABELS = {
  'to-be-confirmed':      'To Be Confirmed',
  'confirmed':            'Confirmed',
  'in-progress':          'In Progress',
  'doc-packet-delivered': 'Doc Packet Delivered',
};
const DOCS_STATE_LABELS = {
  'waiting':          'Waiting',
  'in-progress':      'In Progress',
  'ready-for-review': 'Ready for Review',
  'merged':           'Merged',
};
const REDTEAM_STATE_LABELS = {
  'waiting':     'Waiting',
  'in-progress': 'In Progress',
  'done':        'Done',
};
const RND_TEAMS = ['anon-comms', 'messaging', 'core', 'storage', 'blockchain', 'zones', 'devkit'];

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

async function loadWorkflowSections(itemId, item, bodyOverride) {
  const body      = bodyOverride ?? item.content?.body ?? '';
  const issue     = item.content;
  const canWrite  = hasWritePAT();
  const pat       = getReadPAT();

  const rnd            = extractRnD(body);
  const docPacketContent = extractDocPacket(body);
  const { link: docsLink }       = extractDocumentation(body);
  const { tracking: redTeamLink } = extractRedTeam(body);

  // Fetch docs + redteam refs in parallel
  const [docsRef, rtRef] = await Promise.all([
    docsLink     ? fetchRef(docsLink,     pat) : Promise.resolve(null),
    redTeamLink  ? fetchRef(redTeamLink,  pat) : Promise.resolve(null),
  ]);

  const rndState     = computeRnDState(rnd, docPacketContent);
  const docsState    = computeDocsState(docsLink, docsRef);
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
    itemId, rnd, rndState, docPacketContent,
    docsLink, docsRef, docsState,
    redTeamLink, rtRef, redTeamState,
    repoWithOwner, issueNumber, canWrite
  );

  attachWorkflowHandlers(itemId, repoWithOwner, issueNumber);

  // Auto-sync labels in write mode if mismatch detected
  if (mismatch && canWrite) {
    const writePat = getWritePAT();
    const [owner, repo] = repoWithOwner.split('/');
    if (writePat && owner && repo && issueNumber) {
      try {
        const { added, removed } = await syncActionLabels(owner, repo, issueNumber, actualLabels, expectedActions, writePat);
        // Update cached labels on the item so the reload sees the fixed state
        if (item?.content?.labels?.nodes) {
          item.content.labels.nodes = item.content.labels.nodes
            .filter(l => !removed.includes(l.name))
            .concat(added.map(name => ({ name, color: 'E46962' })));
        }
        // Reload the panel (same pattern as other saves)
        await loadWorkflowSections(itemId, item, body);
      } catch (err) {
        console.warn('Auto-sync labels failed:', err);
      }
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

  const canWrite = hasWritePAT();
  const warnHtml = mismatch ? `
    <span class="text-xs" style="color:#FA7B17;font-family:Arial,Helvetica,sans-serif;">
      ⚠ Action labels out of sync${canWrite ? ' — fixing…' : ''}
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
  itemId, rnd, rndState, docPacketContent,
  docsLink, docsRef, docsState,
  redTeamLink, rtRef, redTeamState,
  repoWithOwner, issueNumber, canWrite
) {
  const sections = [];

  // ── R&D Section (always shown) ──
  sections.push(renderRnDSection(itemId, rnd, rndState, repoWithOwner, issueNumber, canWrite));

  // ── Doc Packet Section (always shown) ──
  sections.push(renderDocPacketSection(itemId, docPacketContent, rndState, canWrite));

  // ── Documentation Section (shown when rndState = doc-packet-delivered OR link exists) ──
  if (rndState === 'doc-packet-delivered' || docsLink) {
    sections.push(renderDocumentationSection(itemId, docsLink, docsRef, docsState, repoWithOwner, issueNumber, canWrite));
  }

  // ── Red Team Section (shown when docsState = ready-for-review OR tracking exists) ──
  if (docsState === 'ready-for-review' || redTeamLink) {
    sections.push(renderRedTeamSection(itemId, redTeamLink, rtRef, redTeamState, repoWithOwner, issueNumber, canWrite));
  }

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
    milestoneHtml = `<span class="flex-1 flex items-center gap-1 min-w-0">
      <input id="rnd-milestone-${itemId}" type="text"
             value="${escapeHtml(rnd.milestone || '')}"
             placeholder="https://roadmap.logos.co/{team}/roadmap/..."
             data-original="${escapeHtml(rnd.milestone || '')}"
             class="logos-input text-xs flex-1 min-w-0 py-0.5"
             onfocus="this.style.borderColor='#E46962'"
             onblur="this.style.borderColor=''" />
      <button id="rnd-milestone-save-${itemId}" class="hidden text-xs px-1.5 py-0.5 rounded transition-colors flex-none"
              style="background:#E46962;color:#fff;font-family:Arial,Helvetica,sans-serif;"
              onmouseover="this.style.background='#FA7B17'" onmouseout="this.style.background='#E46962'">✓</button>
    </span>`;
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
    milestoneHtml = rnd.milestone
      ? `<a href="${escapeHtml(rnd.milestone)}" target="_blank" rel="noopener"
             class="text-xs truncate hover:underline" style="color:#3B7CB8;font-family:Arial,Helvetica,sans-serif;"
             onclick="event.stopPropagation()">
           ${escapeHtml(rnd.milestone.replace(/^https?:\/\//, ''))}
         </a>`
      : `<span class="text-xs italic" style="color:#808C78;font-family:Arial,Helvetica,sans-serif;">not set</span>`;
    dateHtml = rnd.date
      ? `<span class="text-xs font-medium" style="color:#4E635E;font-family:Arial,Helvetica,sans-serif;">${escapeHtml(rnd.date)}</span>`
      : `<span class="text-xs italic" style="color:#808C78;font-family:Arial,Helvetica,sans-serif;">not set</span>`;
  }

  const body = `
    <div class="space-y-2">
      ${fieldRow('Team', teamHtml)}
      ${fieldRow('Milestone', milestoneHtml)}
      ${fieldRow('Date', dateHtml)}
    </div>`;

  return sectionCard('R&D', stateBadgeHtml(stateLabel, color), body);
}

function renderDocPacketSection(itemId, docPacketContent, rndState, canWrite, issueUrl) {
  const isDelivered = !!docPacketContent;

  let linkHtml;
  if (isDelivered) {
    const title = docPacketContent.replace(/^https?:\/\//, '');
    linkHtml = `<a href="${escapeHtml(docPacketContent)}" target="_blank" rel="noopener"
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
             value="${escapeHtml(docPacketContent || '')}"
             placeholder="https://github.com/logos-co/logos-docs/issues/..."
             data-original="${escapeHtml(docPacketContent || '')}"
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

function renderDocumentationSection(itemId, docsLink, docsRef, docsState, repoWithOwner, issueNumber, canWrite) {
  const color = DOCS_COLORS[docsState] || '#808C78';
  const stateLabel = DOCS_STATE_LABELS[docsState] || docsState;

  let linkHtml;
  if (docsLink) {
    const title = docsRef?.title || docsLink.replace(/^https?:\/\//, '');
    linkHtml = `<a href="${escapeHtml(docsLink)}" target="_blank" rel="noopener"
       class="text-xs truncate hover:underline" style="color:#3B7CB8;font-family:Arial,Helvetica,sans-serif;"
       onclick="event.stopPropagation()">
      ${escapeHtml(title)}
    </a>`;
  } else {
    linkHtml = `<span class="text-xs italic" style="color:#808C78;font-family:Arial,Helvetica,sans-serif;">no link</span>`;
  }

  let editHtml = '';
  if (canWrite) {
    editHtml = `<span class="flex items-center gap-1 mt-2">
      <input id="docs-link-${itemId}" type="text"
             value="${escapeHtml(docsLink || '')}"
             placeholder="https://github.com/logos-co/logos-docs/..."
             data-original="${escapeHtml(docsLink || '')}"
             class="logos-input text-xs flex-1 min-w-0 py-0.5"
             onfocus="this.style.borderColor='#E46962'"
             onblur="this.style.borderColor=''" />
      <button id="docs-link-save-${itemId}" class="hidden text-xs px-1.5 py-0.5 rounded transition-colors flex-none"
              style="background:#E46962;color:#fff;font-family:Arial,Helvetica,sans-serif;"
              onmouseover="this.style.background='#FA7B17'" onmouseout="this.style.background='#E46962'">✓</button>
    </span>`;
  }

  const body = `<div class="space-y-1">
    ${fieldRow('Link', linkHtml)}
    ${editHtml}
  </div>`;

  return sectionCard('Documentation', stateBadgeHtml(stateLabel, color), body);
}

function renderRedTeamSection(itemId, redTeamLink, rtRef, redTeamState, repoWithOwner, issueNumber, canWrite) {
  const color = REDTEAM_COLORS[redTeamState] || '#808C78';
  const stateLabel = REDTEAM_STATE_LABELS[redTeamState] || redTeamState;

  let linkHtml;
  if (redTeamLink) {
    const title = rtRef?.title || redTeamLink.replace(/^https?:\/\//, '');
    linkHtml = `<a href="${escapeHtml(redTeamLink)}" target="_blank" rel="noopener"
       class="text-xs truncate hover:underline" style="color:#3B7CB8;font-family:Arial,Helvetica,sans-serif;"
       onclick="event.stopPropagation()">
      ${escapeHtml(title)}
    </a>`;
  } else {
    linkHtml = `<span class="text-xs italic" style="color:#808C78;font-family:Arial,Helvetica,sans-serif;">no tracking issue</span>`;
  }

  let editHtml = '';
  if (canWrite) {
    editHtml = `<span class="flex items-center gap-1 mt-2">
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
  }

  const body = `<div class="space-y-1">
    ${fieldRow('Tracking', linkHtml)}
    ${editHtml}
  </div>`;

  return sectionCard('Red Team', stateBadgeHtml(stateLabel, color), body);
}

// ---------------------------------------------------------------------------
// Inline edit handlers for workflow sections
// ---------------------------------------------------------------------------

function attachWorkflowHandlers(itemId, repoWithOwner, issueNumber) {
  // Milestone input: show save button on change
  const milestoneInput = document.getElementById(`rnd-milestone-${itemId}`);
  const milestoneSave  = document.getElementById(`rnd-milestone-save-${itemId}`);
  if (milestoneInput && milestoneSave) {
    const showSave = () => {
      if (milestoneInput.value.trim() !== milestoneInput.dataset.original)
        milestoneSave.classList.remove('hidden');
      else
        milestoneSave.classList.add('hidden');
    };
    milestoneInput.addEventListener('input', showSave);
    milestoneInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); milestoneSave.click(); }
      if (e.key === 'Escape') { milestoneInput.value = milestoneInput.dataset.original; milestoneSave.classList.add('hidden'); milestoneInput.blur(); }
    });
    milestoneSave.addEventListener('click', () =>
      window._saveRnDField(itemId, repoWithOwner, issueNumber, 'milestone', milestoneInput.value.trim())
    );
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

  // Docs link input
  const docsInput = document.getElementById(`docs-link-${itemId}`);
  const docsSave  = document.getElementById(`docs-link-save-${itemId}`);
  if (docsInput && docsSave) {
    const showSave = () => {
      if (docsInput.value.trim() !== docsInput.dataset.original)
        docsSave.classList.remove('hidden');
      else
        docsSave.classList.add('hidden');
    };
    docsInput.addEventListener('input', showSave);
    docsInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); docsSave.click(); }
      if (e.key === 'Escape') { docsInput.value = docsInput.dataset.original; docsSave.classList.add('hidden'); docsInput.blur(); }
    });
    docsSave.addEventListener('click', () =>
      window._saveDocLink(itemId, repoWithOwner, issueNumber, docsInput.value.trim())
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
    if (!pat) { showToast('error', 'Write token required to modify labels'); return; }

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
    if (!pat) { showToast('error', 'Write token required'); return; }

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
    if (field === 'date' && value && !/^\d{2}(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\d{2}$/i.test(value)) {
      showToast('error', 'Invalid date — use DDMMMYY (e.g. 15Mar26)');
      return;
    }
    if (field === 'milestone' && value && !/^https?:\/\/\S+$/.test(value)) {
      showToast('error', 'Invalid URL');
      return;
    }

    const pat = getWritePAT();
    if (!pat) { showToast('error', 'Write token required'); return; }

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

  // -- Documentation link save --
  window._saveDocPacketLink = async (itemId, repoWithOwner, issueNumber, value) => {
    if (value && !/^https?:\/\/\S+$/.test(value)) {
      showToast('error', 'Invalid URL');
      return;
    }

    const pat = getWritePAT();
    if (!pat) { showToast('error', 'Write token required'); return; }

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

  window._saveDocLink = async (itemId, repoWithOwner, issueNumber, value) => {
    if (value && !/^https?:\/\/\S+$/.test(value)) {
      showToast('error', 'Invalid URL');
      return;
    }

    const pat = getWritePAT();
    if (!pat) { showToast('error', 'Write token required'); return; }

    const [owner, repo] = (repoWithOwner || '').split('/');
    if (!owner || !repo || !issueNumber) { showToast('error', 'Could not determine issue'); return; }

    try {
      const item = itemRegistry.get(itemId);
      const currentBody = item?.content?.body ?? (await fetchIssue(owner, repo, issueNumber, pat)).body ?? '';
      const newBody = setDocLink(currentBody, value || null);
      await updateIssueBody(owner, repo, issueNumber, newBody, pat);
      if (item?.content) item.content.body = newBody;
      showToast('success', 'Saved documentation link');
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
    if (!pat) { showToast('error', 'Write token required'); return; }

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

async function refreshRowStakeholderBadges(itemId, item, body, docsRef, rtRef) {
  const rnd            = extractRnD(body);
  const docPacketContent = extractDocPacket(body);
  const { link: docsLink }       = extractDocumentation(body);
  const { tracking: redTeamLink } = extractRedTeam(body);
  const pat = getReadPAT();

  const [freshDocsRef, freshRtRef] = await Promise.all([
    docsLink    ? fetchRef(docsLink,    pat) : Promise.resolve(null),
    redTeamLink ? fetchRef(redTeamLink, pat) : Promise.resolve(null),
  ]);

  const rndState     = computeRnDState(rnd, docPacketContent);
  const docsState    = computeDocsState(docsLink, freshDocsRef);
  const redTeamState = computeRedTeamState(redTeamLink, freshRtRef);

  const labels = (item.content?.labels?.nodes || []).map(l => l.name);
  const actionLabels = labels.filter(l => l.startsWith('action:'));
  const expectedActions = computeActionLabels(rndState, docsState, redTeamState);
  const mismatch = JSON.stringify([...actionLabels].sort()) !== JSON.stringify([...expectedActions].sort());

  const el = document.getElementById(`pending-${itemId}`);
  if (el) {
    el.innerHTML = renderStakeholderBadges(
      rnd.team, rndState, docsLink, docsState, redTeamLink, redTeamState,
      actionLabels, mismatch
    );
  }

  // Update filter wrapper
  const wrapper = document.getElementById(`filter-item-${itemId}`);
  if (wrapper) wrapper.dataset.actionLabels = JSON.stringify(actionLabels);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
