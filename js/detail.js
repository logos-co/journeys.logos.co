/**
 * detail.js — Journey detail / drill-down view rendering
 */

import { fetchIssuesBatch, addLabels, removeLabel, fetchIssue } from './api.js';
import { renderMarkdown, extractDependencyIssues, extractAllBlockedLabels } from './markdown.js';
import { getConfig, hasPAT } from './config.js';
import { teamColor, statusBadge, showToast } from './app.js';

// Track open detail panels
const openDetails = new Set();

/**
 * Toggle the detail panel for a journey item.
 * @param {string} itemId - project item id
 * @param {Object} item - project item node
 */
export async function toggleDetail(itemId, item) {
  const panel = document.getElementById(`detail-${itemId}`);
  if (!panel) return;

  if (openDetails.has(itemId)) {
    closeDetail(itemId, panel);
  } else {
    openDetails.add(itemId);
    await openDetail(itemId, item, panel);
  }
}

function closeDetail(itemId, panel) {
  openDetails.delete(itemId);
  panel.innerHTML = '';
  panel.classList.add('hidden');

  // Rotate chevron back
  const chevron = document.getElementById(`chevron-${itemId}`);
  if (chevron) chevron.classList.remove('rotate-180');
}

async function openDetail(itemId, item, panel) {
  const issue = item.content;
  if (!issue) return;

  panel.classList.remove('hidden');

  // Rotate chevron
  const chevron = document.getElementById(`chevron-${itemId}`);
  if (chevron) chevron.classList.add('rotate-180');

  // Render initial shell with markdown body
  panel.innerHTML = renderDetailShell(item);

  // Load deps
  await loadDependencies(itemId, item, panel);
}

function renderDetailShell(item) {
  const issue = item.content;
  const canEdit = hasPAT();
  const blockedLabels = extractAllBlockedLabels(issue.labels?.nodes || []);

  return `
    <div class="detail-panel" style="border-top:1px solid rgba(78,99,94,0.3);background:rgba(12,43,45,0.4);">
      <div class="max-w-5xl mx-auto p-6 space-y-6">

        <!-- Header row -->
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2 text-xs text-muted mb-1.5" style="font-family:Arial,Helvetica,sans-serif;">
              <span>${issue.repository?.nameWithOwner || ''}</span>
              <span>·</span>
              <span>#${issue.number}</span>
              <span>·</span>
              ${statusBadge(issue.state)}
            </div>
            <h2 class="text-xl font-bold text-parchment leading-snug" style="font-family:'Times New Roman',Times,serif;">${escapeHtml(issue.title)}</h2>
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

        <!-- Blocked labels section -->
        <div class="flex items-start gap-3">
          <span class="text-xs font-medium text-muted pt-1 w-24 flex-none" style="font-family:Arial,Helvetica,sans-serif;">Blocking team</span>
          <div id="blocked-labels-${item.id}" class="flex flex-wrap gap-2">
            ${renderBlockedLabels(blockedLabels, item, canEdit)}
            ${canEdit ? renderAddLabelButton(item) : ''}
          </div>
        </div>

        <!-- Assignees -->
        ${renderAssignees(issue)}

        <!-- Markdown body -->
        <div>
          <h3 class="text-xs font-semibold text-muted uppercase tracking-wider mb-3" style="font-family:Arial,Helvetica,sans-serif;">Description</h3>
          <div class="markdown-body rounded p-5 overflow-x-auto" style="background:rgba(14,38,24,0.6);border:1px solid rgba(78,99,94,0.3);">
            ${renderMarkdown(issue.body)}
          </div>
        </div>

        <!-- Dependency issues -->
        <div>
          <h3 class="text-xs font-semibold text-muted uppercase tracking-wider mb-3" style="font-family:Arial,Helvetica,sans-serif;">
            Linked Issues
            <span id="dep-count-${item.id}" class="ml-2 text-xs font-normal text-muted/60"></span>
          </h3>
          <div id="dep-list-${item.id}" class="space-y-2">
            <div class="flex items-center gap-2 text-muted text-sm py-2" style="font-family:Arial,Helvetica,sans-serif;">
              <svg class="w-4 h-4 animate-spin text-coral" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
              </svg>
              Loading linked issues…
            </div>
          </div>
        </div>

      </div>
    </div>
  `;
}

function renderBlockedLabels(blockedLabels, item, canEdit) {
  if (!blockedLabels.length) {
    return `<span class="text-xs text-muted italic" style="font-family:Arial,Helvetica,sans-serif;">No blocking team assigned</span>`;
  }
  return blockedLabels.map(bl => `
    <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium border"
          style="background:${teamColor(bl.team, 0.15)};border-color:${teamColor(bl.team, 0.4)};color:${teamColor(bl.team, 1)};font-family:Arial,Helvetica,sans-serif;">
      ${escapeHtml(bl.team)}
      ${canEdit ? `
        <button onclick="window._removeBlockedLabel('${item.id}', '${escapeHtml(bl.name)}')"
                title="Remove label"
                class="ml-0.5 hover:opacity-75 transition-opacity">
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
      <input id="add-label-input-${item.id}"
             type="text"
             placeholder="team-name"
             class="logos-input text-xs w-36 py-1"
      />
      <button onclick="window._submitAddLabel('${item.id}', '${escapeHtml(item.content?.repository?.nameWithOwner || '')}', ${item.content?.number || 0})"
              class="text-xs text-white px-2.5 py-1 rounded transition-colors" style="background:#E46962;font-family:Arial,Helvetica,sans-serif;"
              onmouseover="this.style.background='#FA7B17'" onmouseout="this.style.background='#E46962'">
        Add
      </button>
      <button onclick="window._cancelAddLabel('${item.id}')" class="text-xs text-muted hover:text-parchment transition-colors" style="font-family:Arial,Helvetica,sans-serif;">
        Cancel
      </button>
    </div>
  `;
}

function renderAssignees(issue) {
  const assignees = issue.assignees?.nodes || [];
  if (!assignees.length) return '';
  return `
    <div class="flex items-center gap-3">
      <span class="text-xs font-medium text-muted w-24 flex-none" style="font-family:Arial,Helvetica,sans-serif;">Assignees</span>
      <div class="flex items-center gap-2">
        ${assignees.map(a => `
          <a href="https://github.com/${a.login}" target="_blank" rel="noopener"
             title="${escapeHtml(a.login)}"
             class="flex items-center gap-1.5 text-xs text-muted hover:text-parchment transition-colors" style="font-family:Arial,Helvetica,sans-serif;">
            <img src="${a.avatarUrl}&s=32" alt="${escapeHtml(a.login)}"
                 class="w-5 h-5 rounded-full" style="ring:1px solid rgba(78,99,94,0.5);" />
            ${escapeHtml(a.login)}
          </a>
        `).join('')}
      </div>
    </div>
  `;
}

async function loadDependencies(itemId, item, panel) {
  const issue = item.content;
  if (!issue || !issue.body) {
    const el = document.getElementById(`dep-list-${item.id}`);
    if (el) el.innerHTML = '<p class="text-sm text-muted italic" style="font-family:Arial,Helvetica,sans-serif;">No linked issues found in description.</p>';
    return;
  }

  const deps = extractDependencyIssues(issue.body);
  const countEl = document.getElementById(`dep-count-${item.id}`);
  if (countEl) countEl.textContent = deps.length ? `(${deps.length})` : '';

  const listEl = document.getElementById(`dep-list-${item.id}`);
  if (!listEl) return;

  if (deps.length === 0) {
    listEl.innerHTML = '<p class="text-sm text-muted italic" style="font-family:Arial,Helvetica,sans-serif;">No linked issues found in description.</p>';
    return;
  }

  const { pat } = getConfig();
  const refs = deps.map(d => ({ owner: d.owner, repo: d.repo, number: d.number }));
  const results = await fetchIssuesBatch(refs, pat);

  // Merge with dep metadata
  const enriched = results.map((r, i) => ({
    dep: deps[i],
    issue: r.issue,
    error: r.error,
  }));

  listEl.innerHTML = enriched.map(({ dep, issue, error }) => {
    if (error) {
      return renderDepError(dep, error);
    }
    return renderDepIssue(dep, issue);
  }).join('');
}

function renderDepIssue(dep, issue) {
  const isOpen = issue.state === 'open';
  const assignees = issue.assignees || [];
  const labels = issue.labels || [];
  const blockedTeam = labels.find(l => /^blocked:/i.test(l.name));

  return `
    <div class="flex items-start gap-3 p-3 rounded transition-colors"
         style="background:rgba(14,38,24,0.5);border:1px solid ${isOpen ? 'rgba(78,99,94,0.35)' : 'rgba(78,99,94,0.2)'};${!isOpen ? 'opacity:0.7;' : ''}"
         onmouseover="this.style.borderColor='rgba(78,99,94,0.6)'" onmouseout="this.style.borderColor='${isOpen ? 'rgba(78,99,94,0.35)' : 'rgba(78,99,94,0.2)'}'">
      <!-- Status dot -->
      <div class="flex-none pt-0.5">
        ${isOpen
          ? `<svg class="w-4 h-4 text-coral" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
               <circle cx="12" cy="12" r="10" /><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3" />
             </svg>`
          : `<svg class="w-4 h-4 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
               <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
             </svg>`
        }
      </div>

      <!-- Content -->
      <div class="flex-1 min-w-0">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <a href="${issue.html_url}" target="_blank" rel="noopener"
               class="text-sm font-medium text-parchment transition-colors leading-snug block truncate" style="font-family:'Times New Roman',Times,serif;"
               onmouseover="this.style.color='#E46962'" onmouseout="this.style.color='#E2E0C9'">
              ${escapeHtml(issue.title)}
            </a>
            <div class="flex items-center gap-2 mt-1 text-xs text-muted" style="font-family:Arial,Helvetica,sans-serif;">
              <span>${dep.owner}/${dep.repo}#${dep.number}</span>
              ${blockedTeam ? `
                <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs"
                      style="background:${teamColor(blockedTeam.name.replace(/^blocked:/i,'').trim(), 0.15)};color:${teamColor(blockedTeam.name.replace(/^blocked:/i,'').trim(), 1)};font-family:Arial,Helvetica,sans-serif;">
                  ${escapeHtml(blockedTeam.name)}
                </span>
              ` : ''}
            </div>
          </div>
          <!-- Assignees -->
          ${assignees.length ? `
            <div class="flex-none flex items-center gap-1">
              ${assignees.slice(0, 3).map(a => `
                <img src="${a.avatar_url}&s=20" alt="${escapeHtml(a.login)}" title="${escapeHtml(a.login)}"
                     class="w-5 h-5 rounded-full" style="border:1px solid rgba(78,99,94,0.5);" />
              `).join('')}
            </div>
          ` : ''}
        </div>

        <!-- Labels -->
        ${labels.length ? `
          <div class="flex flex-wrap gap-1.5 mt-2">
            ${labels.map(l => `
              <span class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium" style="font-family:Arial,Helvetica,sans-serif;"
                    style="background:#${l.color}22;color:#${l.color};border:1px solid #${l.color}44">
                ${escapeHtml(l.name)}
              </span>
            `).join('')}
          </div>
        ` : ''}
      </div>

      <!-- Checkbox status -->
      <div class="flex-none text-xs font-medium pt-0.5" style="color:${dep.checked ? '#E46962' : '#808C78'};font-family:Arial,Helvetica,sans-serif;">
        ${dep.checked ? '✓ done' : '○ open'}
      </div>
    </div>
  `;
}

function renderDepError(dep, error) {
  return `
    <div class="flex items-center gap-3 p-3 rounded opacity-60" style="background:rgba(14,38,24,0.4);border:1px solid rgba(78,99,94,0.25);">
      <svg class="w-4 h-4 text-coral flex-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
      <div class="flex-1 min-w-0">
        <div class="text-sm text-parchment" style="font-family:'Times New Roman',Times,serif;">${dep.owner}/${dep.repo}#${dep.number}</div>
        <div class="text-xs text-coral/80 mt-0.5" style="font-family:Arial,Helvetica,sans-serif;">${escapeHtml(error.message)}</div>
      </div>
      <a href="https://github.com/${dep.owner}/${dep.repo}/issues/${dep.number}"
         target="_blank" rel="noopener"
         class="text-xs text-muted hover:text-parchment transition-colors" style="font-family:Arial,Helvetica,sans-serif;">
        View →
      </a>
    </div>
  `;
}

/**
 * Register global handlers for inline label actions.
 * These are called from onclick attributes inside rendered HTML.
 */
export function registerLabelHandlers() {
  window._removeBlockedLabel = async (itemId, labelName) => {
    const config = getConfig();
    if (!config.pat) {
      showToast('error', 'PAT required to modify labels');
      return;
    }

    // Find the item's repo and number from rendered data
    const row = document.querySelector(`[data-item-id="${itemId}"]`);
    if (!row) return;
    const repoWithOwner = row.dataset.repo || '';
    const issueNumber = parseInt(row.dataset.issue || '0', 10);
    if (!repoWithOwner || !issueNumber) return;

    const [owner, repo] = repoWithOwner.split('/');

    try {
      await removeLabel(owner, repo, issueNumber, labelName, config.pat);
      showToast('success', `Removed label "${labelName}"`);
      // Refresh the label section
      await refreshBlockedLabels(itemId, owner, repo, issueNumber, config.pat);
    } catch (err) {
      showToast('error', `Failed to remove label: ${err.message}`);
    }
  };

  window._showAddLabelForm = (itemId) => {
    const btn = document.getElementById(`add-label-btn-${itemId}`);
    const form = document.getElementById(`add-label-form-${itemId}`);
    if (btn) btn.style.display = 'none';
    if (form) form.style.display = 'flex';
    const input = document.getElementById(`add-label-input-${itemId}`);
    if (input) {
      input.focus();
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const row = document.querySelector(`[data-item-id="${itemId}"]`);
          if (!row) return;
          const repoWithOwner = row.dataset.repo || '';
          const issueNumber = parseInt(row.dataset.issue || '0', 10);
          window._submitAddLabel(itemId, repoWithOwner, issueNumber);
        }
        if (e.key === 'Escape') window._cancelAddLabel(itemId);
      });
    }
  };

  window._cancelAddLabel = (itemId) => {
    const btn = document.getElementById(`add-label-btn-${itemId}`);
    const form = document.getElementById(`add-label-form-${itemId}`);
    if (btn) btn.style.display = '';
    if (form) form.style.display = 'none';
  };

  window._submitAddLabel = async (itemId, repoWithOwner, issueNumber) => {
    const input = document.getElementById(`add-label-input-${itemId}`);
    if (!input) return;
    const teamName = input.value.trim();
    if (!teamName) return;

    const config = getConfig();
    if (!config.pat) {
      showToast('error', 'PAT required to modify labels');
      return;
    }

    const labelName = `blocked:${teamName}`;
    const [owner, repo] = repoWithOwner.split('/');
    if (!owner || !repo || !issueNumber) {
      showToast('error', 'Could not determine issue repository');
      return;
    }

    try {
      await addLabels(owner, repo, issueNumber, [labelName], config.pat);
      showToast('success', `Added label "${labelName}"`);
      window._cancelAddLabel(itemId);
      await refreshBlockedLabels(itemId, owner, repo, issueNumber, config.pat);
    } catch (err) {
      showToast('error', `Failed to add label: ${err.message}. The label may not exist in the repo yet.`);
    }
  };
}

async function refreshBlockedLabels(itemId, owner, repo, issueNumber, pat) {
  try {
    const freshIssue = await fetchIssue(owner, repo, issueNumber, pat);
    const labels = freshIssue.labels || [];
    const blockedLabels = labels
      .filter(l => /^blocked:/i.test(l.name))
      .map(l => ({
        name: l.name,
        team: l.name.replace(/^blocked:/i, '').trim(),
        color: l.color,
      }));

    const container = document.getElementById(`blocked-labels-${itemId}`);
    if (!container) return;

    const canEdit = hasPAT();

    // Build a fake item for the render helpers
    const fakeItem = { id: itemId, content: { repository: { nameWithOwner: `${owner}/${repo}` }, number: issueNumber } };
    container.innerHTML =
      renderBlockedLabels(blockedLabels, fakeItem, canEdit) +
      (canEdit ? renderAddLabelButton(fakeItem) : '');

    // Update the row's team badge too
    const row = document.querySelector(`[data-item-id="${itemId}"]`);
    if (row) {
      const teamBadge = row.querySelector('[data-team-badge]');
      if (teamBadge) {
        const newTeam = blockedLabels[0]?.team || null;
        if (newTeam) {
          teamBadge.textContent = newTeam;
          teamBadge.style.background = teamColor(newTeam, 0.15);
          teamBadge.style.borderColor = teamColor(newTeam, 0.4);
          teamBadge.style.color = teamColor(newTeam, 1);
        } else {
          teamBadge.textContent = 'unblocked';
          teamBadge.style.background = 'rgba(12,43,45,0.5)';
          teamBadge.style.borderColor = 'rgba(78,99,94,0.3)';
          teamBadge.style.color = '#808C78';
        }
      }
    }
  } catch (err) {
    // Silent fail on refresh
    console.warn('Failed to refresh labels:', err);
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
