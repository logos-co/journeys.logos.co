/**
 * detail.js — Journey detail / drill-down view
 */

import { fetchIssuesBatch, addLabels, removeLabel, fetchIssue, updateIssueBody } from './api.js';
import { renderMarkdown, extractDependencyIssues, extractAllBlockedLabels, addDepToBody, extractDocUrl } from './markdown.js';
import { getConfig, getReadPAT, getWritePAT, hasPAT, hasWritePAT } from './config.js';
import { teamColor, statusBadge, showToast } from './app.js';
import { REPO_TEAMS } from './teams.js';

// Track open detail panels and their item references
const openDetails = new Set();
const itemRegistry = new Map(); // itemId → item (for body refresh after mutations)

export function getOpenCount() { return openDetails.size; }
export function getOpenIds() { return [...openDetails]; }
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
    await loadDependencies(itemId, item);
  }
  if (!skipSync) syncToggleLabel();
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

function renderDetailShell(item) {
  const issue = item.content;
  const canWrite = hasWritePAT();
  const docUrl = extractDocUrl(issue.body || '');

  return `
    <div class="detail-panel" style="border-top:1px solid rgba(78,99,94,0.2);background:rgba(221,222,216,0.6);">
      <div class="max-w-5xl mx-auto p-6 space-y-6">

        <!-- Header -->
        <div class="flex items-center justify-between gap-4">
          <div class="flex items-center gap-2 text-xs" style="color:#808C78;font-family:Arial,Helvetica,sans-serif;">
            <span>${issue.repository?.nameWithOwner || ''}</span>
            <span>·</span><span>#${issue.number}</span>
          </div>
          <div class="flex items-center gap-2">
          ${docUrl ? `
            <a href="${escapeHtml(docUrl)}" target="_blank" rel="noopener"
               class="flex-none flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded transition-colors"
               style="border:1px solid rgba(106,174,123,0.5);color:#6AAE7B;font-family:Arial,Helvetica,sans-serif;"
               onmouseover="this.style.borderColor='rgba(106,174,123,0.8)';this.style.background='rgba(106,174,123,0.1)'"
               onmouseout="this.style.borderColor='rgba(106,174,123,0.5)';this.style.background=''">
              <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Docs
            </a>
          ` : ''}
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
        </div>

        <!-- Assignees -->
        ${renderAssignees(issue)}

        <!-- Markdown body -->
        <div>
          <h3 class="text-xs font-semibold uppercase tracking-wider mb-3" style="color:#808C78;font-family:Arial,Helvetica,sans-serif;">Description</h3>
          <div class="markdown-body rounded p-5 overflow-x-auto" style="background:rgba(255,255,255,0.6);border:1px solid rgba(78,99,94,0.2);">
            ${renderMarkdown(issue.body)}
          </div>
        </div>

        <!-- Dependencies -->
        <div>
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-xs font-semibold uppercase tracking-wider" style="color:#808C78;font-family:Arial,Helvetica,sans-serif;">
              Dependencies
              <span id="dep-count-${item.id}" class="ml-2 font-normal normal-case"></span>
            </h3>
            ${canWrite ? renderAddDepButton(item) : ''}
          </div>
          <!-- Add dep form (hidden by default) -->
          ${canWrite ? renderAddDepForm(item) : ''}
          <div id="dep-list-${item.id}" class="space-y-2">
            <div class="flex items-center gap-2 text-muted text-sm py-2" style="font-family:Arial,Helvetica,sans-serif;">
              <svg class="w-4 h-4 animate-spin text-coral" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
              </svg>
              Loading…
            </div>
          </div>
        </div>

      </div>
    </div>
  `;
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
// Add dependency
// ---------------------------------------------------------------------------

function renderAddDepButton(item) {
  return `
    <button onclick="window._showAddDepForm('${item.id}')"
            id="add-dep-btn-${item.id}"
            class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs text-muted transition-colors"
            style="border:1px dashed rgba(78,99,94,0.4);font-family:Arial,Helvetica,sans-serif;"
            onmouseover="this.style.borderColor='rgba(228,105,98,0.5)';this.style.color='#E46962'"
            onmouseout="this.style.borderColor='rgba(78,99,94,0.4)';this.style.color='#808C78'">
      <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
      </svg>
      Add dependency
    </button>
  `;
}

function renderAddDepForm(item) {
  const repoWithOwner = escapeHtml(item.content?.repository?.nameWithOwner || '');
  const issueNumber = item.content?.number || 0;
  return `
    <div id="add-dep-form-${item.id}" style="display:none;" class="mb-3 p-4 rounded space-y-3">
      <div style="background:rgba(255,255,255,0.7);border:1px solid rgba(78,99,94,0.25);border-radius:8px;padding:1rem;">
        <div class="space-y-3">
          <div>
            <label class="block text-xs font-medium text-parchment mb-1" style="font-family:Arial,Helvetica,sans-serif;">
              Team <span class="text-coral">*</span>
            </label>
            <input id="add-dep-team-${item.id}" type="text" placeholder="e.g. docs"
                   class="logos-input w-full text-sm" />
          </div>
          <div>
            <label class="block text-xs font-medium text-parchment mb-1" style="font-family:Arial,Helvetica,sans-serif;">
              GitHub issue URL <span class="text-muted">(optional — leave blank to track as TODO)</span>
            </label>
            <input id="add-dep-url-${item.id}" type="url"
                   placeholder="https://github.com/owner/repo/issues/123"
                   class="logos-input w-full text-sm"
                   oninput="window._autoResolveDepTeam('${item.id}')" />
          </div>
          <div class="flex items-center gap-2">
            <button onclick="window._submitAddDep('${item.id}', '${repoWithOwner}', ${issueNumber})"
                    class="text-sm text-white px-3 py-1.5 rounded transition-colors" style="background:#E46962;font-family:Arial,Helvetica,sans-serif;"
                    onmouseover="this.style.background='#FA7B17'" onmouseout="this.style.background='#E46962'">
              Add
            </button>
            <button onclick="window._cancelAddDep('${item.id}')"
                    class="text-sm text-muted hover:text-parchment transition-colors" style="font-family:Arial,Helvetica,sans-serif;">
              Cancel
            </button>
          </div>
        </div>
      </div>
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
// Dependency loading
// ---------------------------------------------------------------------------

async function loadDependencies(itemId, item, bodyOverride) {
  const body = bodyOverride ?? item.content?.body ?? '';
  const listEl = document.getElementById(`dep-list-${itemId}`);
  const countEl = document.getElementById(`dep-count-${itemId}`);
  if (!listEl) return;

  const deps = extractDependencyIssues(body);
  if (countEl) countEl.textContent = deps.length ? `(${deps.length})` : '';

  if (!deps.length) {
    listEl.innerHTML = `<p class="text-sm italic" style="color:#808C78;font-family:Arial,Helvetica,sans-serif;">No dependencies listed. ${hasWritePAT() ? 'Use "Add dependency" to track one.' : ''}</p>`;
    return;
  }

  // Fetch only URL-based deps
  const urlDeps = deps.filter(d => d.url);
  const pat = getReadPAT();
  const refs = urlDeps.map(d => ({ owner: d.owner, repo: d.repo, number: d.number }));
  const results = urlDeps.length ? await fetchIssuesBatch(refs, pat) : [];

  // Build lookup: "owner/repo#number" → fetched issue
  const fetchedMap = new Map();
  urlDeps.forEach((d, i) => {
    fetchedMap.set(`${d.owner}/${d.repo}#${d.number}`, results[i]);
  });

  // Build per-team status entries
  const teamRows = [];
  for (const dep of deps) {
    const fetched = dep.url ? fetchedMap.get(`${dep.owner}/${dep.repo}#${dep.number}`) : null;
    let status, statusColor, issueRef = null;
    if (!dep.url) {
      status = 'not tracked';
      statusColor = '#808C78';
    } else if (fetched?.error) {
      status = 'error';
      statusColor = '#E46962';
      issueRef = { url: dep.url, label: `${dep.owner}/${dep.repo}#${dep.number}` };
    } else if (fetched?.issue?.state === 'open') {
      status = 'pending';
      statusColor = '#E46962';
      issueRef = { url: fetched.issue.html_url, label: escapeHtml(fetched.issue.title) };
    } else {
      status = 'done';
      statusColor = '#6AAE7B';
      issueRef = fetched?.issue ? { url: fetched.issue.html_url, label: escapeHtml(fetched.issue.title) } : null;
    }
    teamRows.push({ dep, status, statusColor, issueRef });
  }

  // Sort: pending first, then not-tracked, then done
  const statusOrder = { pending: 0, error: 0, 'not tracked': 1, done: 2 };
  teamRows.sort((a, b) => (statusOrder[a.status] ?? 1) - (statusOrder[b.status] ?? 1));

  listEl.innerHTML = teamRows.map(({ dep, status, statusColor, issueRef }) => `
    <div class="flex items-center gap-3 py-2 px-3 rounded"
         style="background:rgba(255,255,255,0.6);border:1px solid rgba(78,99,94,0.2);">
      <span class="text-xs font-semibold px-2 py-0.5 rounded flex-none"
            style="background:${teamColor(dep.team, 0.15)};color:${teamColor(dep.team, 0.9)};border:1px solid ${teamColor(dep.team, 0.3)};font-family:Arial,Helvetica,sans-serif;">
        ${escapeHtml(dep.team)}
      </span>
      <span class="flex-1 text-xs truncate" style="color:${statusColor};font-family:Arial,Helvetica,sans-serif;">
        ${issueRef
          ? `<a href="${issueRef.url}" target="_blank" rel="noopener" class="hover:underline">${issueRef.label}</a>`
          : '—'}
      </span>
      <span class="text-xs font-medium flex-none" style="color:${statusColor};font-family:Arial,Helvetica,sans-serif;">${status}</span>
    </div>
  `).join('');
}

// ---------------------------------------------------------------------------
// Dep row renderers
// ---------------------------------------------------------------------------

function renderDepTodo(dep) {
  return `
    <div class="flex items-center gap-3 p-3 rounded"
         style="background:rgba(14,38,24,0.35);border:1px solid rgba(78,99,94,0.2);opacity:0.75;">
      <svg class="w-4 h-4 text-muted flex-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
        <circle cx="12" cy="12" r="10"/><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l2.5 2.5"/>
      </svg>
      <span class="text-sm text-muted italic flex-1" style="font-family:Arial,Helvetica,sans-serif;">No issue linked yet</span>
      <span class="text-xs text-muted font-medium" style="font-family:Arial,Helvetica,sans-serif;">not tracked</span>
    </div>
  `;
}

function renderDepIssue(dep, issue) {
  const isOpen = issue.state === 'open';
  const assignees = issue.assignees || [];
  const labels = issue.labels || [];

  return `
    <div class="flex items-start gap-3 p-3 rounded transition-colors"
         style="background:rgba(14,38,24,0.5);border:1px solid ${isOpen ? 'rgba(78,99,94,0.35)' : 'rgba(78,99,94,0.2)'};${!isOpen ? 'opacity:0.7;' : ''}"
         onmouseover="this.style.borderColor='rgba(78,99,94,0.6)'" onmouseout="this.style.borderColor='${isOpen ? 'rgba(78,99,94,0.35)' : 'rgba(78,99,94,0.2)'}'">
      <div class="flex-none pt-0.5">
        ${isOpen
          ? `<svg class="w-4 h-4 text-coral" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3"/></svg>`
          : `<svg class="w-4 h-4 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>`
        }
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <a href="${issue.html_url}" target="_blank" rel="noopener"
               class="text-sm font-medium text-parchment transition-colors leading-snug block truncate" style="font-family:'Times New Roman',Times,serif;"
               onmouseover="this.style.color='#E46962'" onmouseout="this.style.color='#E2E0C9'">
              ${escapeHtml(issue.title)}
            </a>
            <div class="text-xs text-muted mt-0.5" style="font-family:Arial,Helvetica,sans-serif;">
              ${dep.owner}/${dep.repo}#${dep.number}
            </div>
          </div>
          ${assignees.length ? `
            <div class="flex-none flex items-center gap-1">
              ${assignees.slice(0, 3).map(a => `
                <img src="${a.avatar_url}&s=20" alt="${escapeHtml(a.login)}" title="${escapeHtml(a.login)}"
                     class="w-5 h-5 rounded-full" style="border:1px solid rgba(78,99,94,0.5);" />
              `).join('')}
            </div>
          ` : ''}
        </div>
        ${labels.length ? `
          <div class="flex flex-wrap gap-1.5 mt-2">
            ${labels.map(l => `
              <span class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium"
                    style="background:#${l.color}22;color:#${l.color};border:1px solid #${l.color}44;font-family:Arial,Helvetica,sans-serif;">
                ${escapeHtml(l.name)}
              </span>
            `).join('')}
          </div>
        ` : ''}
      </div>
      <div class="flex-none text-xs font-medium pt-0.5" style="color:${isOpen ? '#E46962' : '#808C78'};font-family:Arial,Helvetica,sans-serif;">
        ${isOpen ? 'pending' : 'done'}
      </div>
    </div>
  `;
}

function renderDepError(dep, error) {
  return `
    <div class="flex items-center gap-3 p-3 rounded opacity-60"
         style="background:rgba(14,38,24,0.4);border:1px solid rgba(78,99,94,0.25);">
      <svg class="w-4 h-4 text-coral flex-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
      </svg>
      <div class="flex-1 min-w-0">
        <div class="text-sm text-parchment" style="font-family:'Times New Roman',Times,serif;">${dep.owner}/${dep.repo}#${dep.number}</div>
        <div class="text-xs mt-0.5" style="color:#E46962;font-family:Arial,Helvetica,sans-serif;">${escapeHtml(error.message)}</div>
      </div>
      <a href="https://github.com/${dep.owner}/${dep.repo}/issues/${dep.number}" target="_blank" rel="noopener"
         class="text-xs text-muted hover:text-parchment transition-colors" style="font-family:Arial,Helvetica,sans-serif;">View →</a>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Global handlers (called from onclick attributes in rendered HTML)
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

  // -- Add dependency: show form --
  window._showAddDepForm = (itemId) => {
    document.getElementById(`add-dep-btn-${itemId}`)?.style.setProperty('display', 'none');
    const form = document.getElementById(`add-dep-form-${itemId}`);
    if (form) form.style.display = 'block';
    document.getElementById(`add-dep-team-${itemId}`)?.focus();
  };

  window._cancelAddDep = (itemId) => {
    const btn = document.getElementById(`add-dep-btn-${itemId}`);
    const form = document.getElementById(`add-dep-form-${itemId}`);
    if (btn) btn.style.display = '';
    if (form) form.style.display = 'none';
    const teamInput = document.getElementById(`add-dep-team-${itemId}`);
    const urlInput  = document.getElementById(`add-dep-url-${itemId}`);
    if (teamInput) teamInput.value = '';
    if (urlInput)  urlInput.value  = '';
  };

  // -- Add dependency: auto-resolve team from URL --
  window._autoResolveDepTeam = (itemId) => {
    const urlInput  = document.getElementById(`add-dep-url-${itemId}`);
    const teamInput = document.getElementById(`add-dep-team-${itemId}`);
    if (!urlInput || !teamInput || teamInput.value.trim()) return;
    const m = urlInput.value.match(/https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/issues\/\d+/);
    if (m) {
      const resolved = REPO_TEAMS[`${m[1]}/${m[2]}`];
      if (resolved) teamInput.value = resolved;
    }
  };

  // -- Add dependency: submit --
  window._submitAddDep = async (itemId, repoWithOwner, issueNumber) => {
    const team = document.getElementById(`add-dep-team-${itemId}`)?.value.trim();
    const url  = document.getElementById(`add-dep-url-${itemId}`)?.value.trim() || '';

    if (!team) { showToast('error', 'Team name is required'); return; }

    if (url) {
      const validUrl = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/\d+$/.test(url);
      if (!validUrl) { showToast('error', 'Invalid GitHub issue URL'); return; }
    }

    const pat = getWritePAT();
    if (!pat) { showToast('error', 'Write token required'); return; }

    const [owner, repo] = (repoWithOwner || '').split('/');
    if (!owner || !repo || !issueNumber) { showToast('error', 'Could not determine issue repository'); return; }

    try {
      const currentIssue = await fetchIssue(owner, repo, issueNumber, pat);
      const newBody = addDepToBody(currentIssue.body || '', team, url || null);
      await updateIssueBody(owner, repo, issueNumber, newBody, pat);

      // Update cached body
      const item = itemRegistry.get(itemId);
      if (item?.content) item.content.body = newBody;

      showToast('success', `Added dependency: ${team}`);
      window._cancelAddDep(itemId);
      const itemOrFallback = item || { content: { body: newBody } };
      await loadDependencies(itemId, itemOrFallback);
      refreshRowDepBadges(itemId, itemOrFallback);
    } catch (err) {
      showToast('error', `Failed to add dependency: ${err.message}`);
    }
  };
}

// ---------------------------------------------------------------------------
// Refresh helpers
// ---------------------------------------------------------------------------

async function refreshBlockedLabels(itemId, owner, repo, issueNumber, pat) {
  try {
    const freshIssue = await fetchIssue(owner, repo, issueNumber, pat);
    const blockedLabels = (freshIssue.labels || [])
      .filter(l => /^blocked:/i.test(l.name))
      .map(l => ({ name: l.name, team: l.name.replace(/^blocked:/i, '').trim(), color: l.color }));

    const container = document.getElementById(`blocked-labels-${itemId}`);
    if (!container) return;

    const canWrite = hasWritePAT();
    const fakeItem = { id: itemId, content: { repository: { nameWithOwner: `${owner}/${repo}` }, number: issueNumber } };
    container.innerHTML =
      renderBlockedLabels(blockedLabels, fakeItem, canWrite) +
      (canWrite ? renderAddLabelButton(fakeItem) : '');

    // Update row badge
    const row = document.querySelector(`[data-item-id="${itemId}"]`);
    if (row) {
      const badge = row.querySelector('[data-team-badge]');
      if (badge) {
        const newTeam = blockedLabels[0]?.team || null;
        if (newTeam) {
          badge.textContent = newTeam;
          badge.style.background = teamColor(newTeam, 0.15);
          badge.style.borderColor = teamColor(newTeam, 0.4);
          badge.style.color = teamColor(newTeam, 1);
        } else {
          badge.textContent = 'none';
          badge.style.background = 'rgba(12,43,45,0.5)';
          badge.style.borderColor = 'rgba(78,99,94,0.3)';
          badge.style.color = '#808C78';
        }
      }
    }
  } catch (err) {
    console.warn('Failed to refresh labels:', err);
  }
}

// ---------------------------------------------------------------------------
// Refresh row dep badges after a mutation (e.g. Add dependency)
// ---------------------------------------------------------------------------

async function refreshRowDepBadges(itemId, item) {
  const body = item.content?.body || '';
  const deps = extractDependencyIssues(body);
  const pat = getReadPAT();

  const urlDeps = deps.filter(d => d.url);
  const todoDeps = deps.filter(d => !d.url);
  const refs = urlDeps.map(d => ({ owner: d.owner, repo: d.repo, number: d.number }));
  const results = refs.length ? await fetchIssuesBatch(refs, pat) : [];

  const teamCounts = new Map();
  const ensure = (team) => {
    if (!teamCounts.has(team)) teamCounts.set(team, { notTracked: 0, pending: 0, done: 0, url: null });
    return teamCounts.get(team);
  };
  for (const dep of todoDeps) ensure(dep.team).notTracked++;
  for (let i = 0; i < urlDeps.length; i++) {
    const dep = urlDeps[i];
    const result = results[i];
    const counts = ensure(dep.team);
    if (!counts.url) counts.url = dep.url;
    if (result?.error || result?.issue?.state === 'open') counts.pending++;
    else counts.done++;
  }

  const el = document.getElementById(`pending-${itemId}`);
  if (!el) return;

  el.innerHTML = [...teamCounts.entries()].map(([team, { notTracked, pending, done, url }]) => {
    let statusText;
    if (pending > 0) statusText = 'pending';
    else if (notTracked > 0) statusText = 'not tracked';
    else statusText = 'done';

    const color = statusText === 'pending' ? '#FA7B17' : statusText === 'not tracked' ? '#E46962' : '#6AAE7B';
    const indicator = statusText === 'not tracked'
      ? `<span style="color:#FA7B17;font-size:11px;line-height:1;flex-shrink:0;">⚠</span>`
      : `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${color};flex-shrink:0;"></span>`;
    const tag = url ? 'a' : 'span';
    const linkAttrs = url ? `href="${escapeHtml(url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()"` : '';
    return `<${tag} ${linkAttrs} title="${escapeHtml(team)}: ${statusText}"
              class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs transition-colors"
              style="background:rgba(255,255,255,0.7);border:1px solid rgba(78,99,94,0.25);font-family:Arial,Helvetica,sans-serif;color:#4E635E;white-space:nowrap;${url ? 'cursor:pointer;text-decoration:none;' : ''}"
              ${url ? `onmouseover="this.style.background='rgba(78,99,94,0.1)'" onmouseout="this.style.background='rgba(255,255,255,0.7)'"` : ''}>
          ${indicator} ${escapeHtml(team)}
        </${tag}>`;
  }).join('');
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
