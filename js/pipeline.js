/**
 * pipeline.js — Pipeline view rendering
 */

import { extractBlockedTeam } from './markdown.js';
import { toggleDetail } from './detail.js';
import { hasPAT } from './config.js';
import { teamColor, statusBadge } from './app.js';

/**
 * Render the full pipeline list into the given container element.
 * @param {HTMLElement} container
 * @param {Array} items - project item nodes
 * @param {string} projectTitle
 */
export function renderPipeline(container, items, projectTitle) {
  const canDrag = hasPAT();

  container.innerHTML = `
    <div class="max-w-5xl mx-auto space-y-4">
      <!-- Pipeline header -->
      <div class="flex items-center justify-between mb-2">
        <div>
          <h1 class="text-2xl font-bold text-parchment" style="font-family:'Times New Roman',Times,serif;">${escapeHtml(projectTitle || 'Priority Pipeline')}</h1>
          <p class="text-sm text-muted mt-0.5" style="font-family:Arial,Helvetica,sans-serif;">
            ${items.length} journey${items.length !== 1 ? 's' : ''}
            ${canDrag ? '<span class="ml-2 text-xs text-coral font-medium">· Drag rows to reorder</span>' : ''}
          </p>
        </div>
      </div>

      <!-- Column headers -->
      <div class="hidden md:grid grid-cols-[2.5rem_1fr_10rem_9rem_6rem] gap-4 px-4 py-2 text-xs font-semibold text-muted uppercase tracking-wider" style="font-family:Arial,Helvetica,sans-serif;border-bottom:1px solid rgba(78,99,94,0.3);">
        <div>#</div>
        <div>Journey</div>
        <div>Repository</div>
        <div>Blocking Team</div>
        <div class="text-right">Status</div>
      </div>

      <!-- Pipeline rows -->
      <div id="pipeline-list" class="space-y-1.5">
        ${items.map((item, index) => renderPipelineRow(item, index, canDrag)).join('')}
      </div>

      ${items.length === 0 ? `
        <div class="text-center py-16 text-muted" style="font-family:Arial,Helvetica,sans-serif;">
          <p class="text-4xl mb-4 text-sage opacity-40" style="font-family:'Times New Roman',Times,serif;">λ</p>
          <p class="text-sm">No issues found in this project</p>
        </div>
      ` : ''}
    </div>
  `;

  // Attach click handlers for row expand
  attachRowClickHandlers(items);

}

function renderPipelineRow(item, index, canDrag) {
  const issue = item.content;
  if (!issue) return '';

  const blockedTeam = extractBlockedTeam(issue.labels?.nodes || []);
  const repo = issue.repository?.nameWithOwner || '';
  const rankLabel = String(index + 1).padStart(2, '0');

  const teamBadgeHtml = blockedTeam
    ? `<span data-team-badge
            class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border"
            style="background:${teamColor(blockedTeam, 0.15)};border-color:${teamColor(blockedTeam, 0.4)};color:${teamColor(blockedTeam, 1)};font-family:Arial,Helvetica,sans-serif;">
         ${escapeHtml(blockedTeam)}
       </span>`
    : `<span data-team-badge class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium" style="background:rgba(12,43,45,0.5);color:#808C78;border:1px solid rgba(78,99,94,0.3);font-family:Arial,Helvetica,sans-serif;">
         unblocked
       </span>`;

  return `
    <div>
      <!-- Row -->
      <div
        id="row-${item.id}"
        data-item-id="${item.id}"
        data-index="${index}"
        data-repo="${escapeHtml(repo)}"
        data-issue="${issue.number}"
        data-draggable="${canDrag}"
        draggable="${canDrag}"
        class="pipeline-row grid grid-cols-[2.5rem_1fr] md:grid-cols-[2.5rem_1fr_10rem_9rem_6rem] gap-4 items-center px-4 py-3 rounded
               cursor-pointer transition-all group select-none
               ${canDrag ? 'draggable-row' : ''}"
        style="background:rgba(12,43,45,0.55);border:1px solid rgba(78,99,94,0.3);border-left:3px solid ${blockedTeam ? teamColor(blockedTeam, 0.7) : 'transparent'};"
        onmouseover="this.style.background='rgba(78,99,94,0.18)'"
        onmouseout="this.style.background='rgba(12,43,45,0.55)'"
      >
        <!-- Rank / drag handle -->
        <div class="flex items-center justify-center">
          ${canDrag
            ? `<span class="drag-handle" title="Drag to reorder">⠿</span>`
            : `<span class="rank-number">${rankLabel}</span>`
          }
        </div>

        <!-- Title + labels -->
        <div class="min-w-0 flex items-center gap-2">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="text-sm font-medium text-parchment truncate leading-snug" style="font-family:'Times New Roman',Times,serif;">
                ${escapeHtml(issue.title)}
              </span>
            </div>
            <!-- Mobile: repo + team shown under title -->
            <div class="md:hidden flex items-center gap-2 mt-1 text-xs text-muted flex-wrap" style="font-family:Arial,Helvetica,sans-serif;">
              <span class="font-mono">${escapeHtml(repo)}</span>
              <span>·</span>
              ${teamBadgeHtml}
              <span>·</span>
              ${statusBadge(issue.state)}
            </div>
          </div>
        </div>

        <!-- Repo (desktop) -->
        <div class="hidden md:block min-w-0">
          <span class="text-xs font-mono text-muted truncate block">${escapeHtml(repo)}</span>
        </div>

        <!-- Team (desktop) -->
        <div class="hidden md:flex items-center">
          ${teamBadgeHtml}
        </div>

        <!-- Status (desktop) + Chevron -->
        <div class="hidden md:flex items-center justify-end gap-2">
          ${statusBadge(issue.state)}
          <svg id="chevron-${item.id}" class="w-4 h-4 text-muted transition-all flex-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>

      <!-- Detail panel (initially hidden) -->
      <div id="detail-${item.id}" class="hidden rounded-b overflow-hidden -mt-1 mx-0.5" style="border:1px solid rgba(78,99,94,0.3);border-top:none;">
      </div>
    </div>
  `;
}

function attachRowClickHandlers(items) {
  items.forEach(item => {
    const row = document.getElementById(`row-${item.id}`);
    if (!row) return;

    row.addEventListener('click', (e) => {
      // Don't trigger if clicking inside a link or button within the row
      if (e.target.closest('a, button')) return;
      toggleDetail(item.id, item);
    });
  });
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
