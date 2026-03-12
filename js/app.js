/**
 * app.js — Main entry point, routing, state management
 */

import { getConfig, saveConfig, clearConfig, isConfigured, hasPAT, hasWritePAT, isAdminMode, toggleAdminMode, getReadPAT } from './config.js';
import { fetchProjectItems } from './api.js';
import { renderPipeline } from './pipeline.js';
import { registerLabelHandlers } from './detail.js';
import { initDrag } from './drag.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let state = {
  loading: false,
  error: null,
  projectId: null,
  projectTitle: '',
  items: [],
};

// ---------------------------------------------------------------------------
// Utility: Team colour from name (consistent hash → hue)
// ---------------------------------------------------------------------------

const TEAM_COLOR_OVERRIDES = { 'red team': [0, 70, 55] };

export function teamColor(teamName, alpha = 1) {
  if (!teamName) return `hsla(220, 15%, 40%, ${alpha})`;
  const override = TEAM_COLOR_OVERRIDES[teamName.toLowerCase()];
  if (override) return `hsla(${override[0]}, ${override[1]}%, ${override[2]}%, ${alpha})`;
  let hash = 0;
  for (let i = 0; i < teamName.length; i++) {
    hash = teamName.charCodeAt(i) + ((hash << 5) - hash);
    hash |= 0;
  }
  const hue = Math.abs(hash) % 360;
  // Avoid muddy yellow-green range for team colours; shift slightly
  const h = (hue + 30) % 360;
  return `hsla(${h}, 70%, 60%, ${alpha})`;
}

export function teamBgClass(teamName) {
  // Returns an inline style string for background
  return teamColor(teamName, 0.15);
}

export function statusBadge(issueState) {
  const s = (issueState || '').toUpperCase();
  if (s === 'OPEN') {
    return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium" style="background:rgba(228,105,98,0.12);color:#0E2618;border:1px solid rgba(228,105,98,0.4);font-family:Arial,Helvetica,sans-serif;">
      <span class="w-1.5 h-1.5 rounded-full inline-block" style="background:#E46962;"></span>open
    </span>`;
  }
  return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium" style="background:rgba(78,99,94,0.12);color:#4E635E;border:1px solid rgba(78,99,94,0.3);font-family:Arial,Helvetica,sans-serif;">
    <span class="w-1.5 h-1.5 rounded-full inline-block" style="background:#808C78;"></span>closed
  </span>`;
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------

let toastTimer = null;

export function showToast(type, message) {
  const toast = document.getElementById('toast');
  const iconEl = document.getElementById('toast-icon');
  const msgEl = document.getElementById('toast-message');
  if (!toast || !iconEl || !msgEl) return;

  const icons = {
    success: '✓',
    error: '✕',
    info: 'ℹ',
    warning: '⚠',
  };

  const colors = {
    success: 'border-sage/50 bg-teal',
    error:   'border-coral/50 bg-teal',
    info:    'border-sage/50 bg-teal',
    warning: 'border-orange/50 bg-teal',
  };

  const iconColors = {
    success: 'text-parchment',
    error:   'text-coral',
    info:    'text-muted',
    warning: 'text-orange',
  };

  iconEl.textContent = icons[type] || icons.info;
  iconEl.className = `flex-none text-sm font-bold ${iconColors[type] || iconColors.info}`;
  msgEl.textContent = message;
  toast.className = `fixed bottom-6 right-6 z-50 flex items-center gap-3 border rounded-xl px-4 py-3 shadow-2xl max-w-sm text-sm ${colors[type] || colors.info}`;

  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.add('hidden');
  }, 4000);
}

// ---------------------------------------------------------------------------
// Settings modal
// ---------------------------------------------------------------------------

function openSettings() {
  const modal = document.getElementById('settings-modal');
  if (!modal) return;
  modal.classList.remove('hidden');

  // Populate inputs from current config
  const config = getConfig();
  document.getElementById('input-owner').value = config.owner || '';
  document.getElementById('input-project').value = config.projectNumber || '';
  document.getElementById('input-pat').value = config.pat || '';
  document.getElementById('settings-error').classList.add('hidden');
}

function closeSettings() {
  document.getElementById('settings-modal')?.classList.add('hidden');
}

function initSettings() {
  document.getElementById('btn-settings')?.addEventListener('click', openSettings);
  document.getElementById('btn-settings-close')?.addEventListener('click', closeSettings);
  document.getElementById('settings-backdrop')?.addEventListener('click', closeSettings);

  document.getElementById('btn-settings-save')?.addEventListener('click', async () => {
    const owner = document.getElementById('input-owner')?.value.trim();
    const projectNumberStr = document.getElementById('input-project')?.value.trim();
    const pat = document.getElementById('input-pat')?.value.trim();
    const errEl = document.getElementById('settings-error');

    if (!owner) {
      errEl.textContent = 'GitHub owner/org is required.';
      errEl.classList.remove('hidden');
      return;
    }
    if (!projectNumberStr || isNaN(parseInt(projectNumberStr, 10))) {
      errEl.textContent = 'A valid project number is required.';
      errEl.classList.remove('hidden');
      return;
    }
    errEl.classList.add('hidden');

    saveConfig({ owner, projectNumber: parseInt(projectNumberStr, 10), pat });
    closeSettings();
    updateHeaderBadges();
    await loadProject();
  });

  document.getElementById('btn-settings-clear')?.addEventListener('click', () => {
    clearConfig();
    document.getElementById('input-owner').value = '';
    document.getElementById('input-project').value = '';
    document.getElementById('input-pat').value = '';
    closeSettings();
    updateHeaderBadges();
    renderEmptyState();
  });

  // Toggle PAT visibility
  // PAT visibility toggle
  document.getElementById('btn-toggle-pat')?.addEventListener('click', () => {
    const input = document.getElementById('input-pat');
    const icon  = document.getElementById('pat-eye-icon');
    if (!input) return;
    if (input.type === 'password') {
      input.type = 'text';
      icon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />`;
    } else {
      input.type = 'password';
      icon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />`;
    }
  });

  // Escape key closes modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSettings();
  });

  // Mode toggle
  document.getElementById('btn-mode-toggle')?.addEventListener('click', () => {
    toggleAdminMode();
    updateHeaderBadges();
    // Re-render pipeline to show/hide write controls
    if (state.items.length) renderProjectView();
  });
}

// ---------------------------------------------------------------------------
// Header badges
// ---------------------------------------------------------------------------

function updateHeaderBadges() {
  const config = getConfig();
  const authBadge = document.getElementById('auth-badge');
  const projectBadge = document.getElementById('project-badge');
  const projectBadgeText = document.getElementById('project-badge-text');
  const refreshBtn = document.getElementById('btn-refresh');

  // Auth badge — hidden, PAT status shown via mode toggle button only
  authBadge?.classList.add('hidden');

  // Mode toggle button — only shown when PAT is set
  const modeBtn = document.getElementById('btn-mode-toggle');
  if (modeBtn) {
    if (hasPAT()) {
      modeBtn.classList.replace('hidden', 'flex');
      if (isAdminMode()) {
        modeBtn.innerHTML = `<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg> Admin`;
        modeBtn.style.cssText = 'background:rgba(228,105,98,0.15);border:1px solid rgba(228,105,98,0.4);color:#E46962;';
      } else {
        modeBtn.innerHTML = `<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg> View`;
        modeBtn.style.cssText = 'background:rgba(78,99,94,0.15);border:1px solid rgba(78,99,94,0.35);color:#808C78;';
      }
    } else {
      modeBtn.classList.replace('flex', 'hidden');
      modeBtn.classList.add('hidden');
    }
  }

  if (config.owner && config.projectNumber) {
    projectBadge?.classList.replace('hidden', 'flex');
    if (projectBadgeText) projectBadgeText.textContent = `${config.owner} #${config.projectNumber}`;
    refreshBtn?.classList.remove('hidden');
  } else {
    projectBadge?.classList.replace('flex', 'hidden');
    projectBadge?.classList.add('hidden');
    refreshBtn?.classList.add('hidden');
  }
}

// ---------------------------------------------------------------------------
// Rendering states
// ---------------------------------------------------------------------------

function renderEmptyState() {
  const content = document.getElementById('app-content');
  if (!content) return;
  content.innerHTML = `
    <div class="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
      <div class="mb-6">
        <span class="text-6xl font-bold text-coral select-none" style="font-family:'Times New Roman',Times,serif;line-height:1;">λ</span>
      </div>
      <h2 class="text-2xl font-bold text-parchment mb-2" style="font-family:'Times New Roman',Times,serif;">Configure your project</h2>
      <p class="text-muted max-w-sm text-sm leading-relaxed mb-8" style="font-family:Arial,Helvetica,sans-serif;">
        Connect to a GitHub Projects v2 board to see your team's prioritised journeys and track which teams are blocking progress.
      </p>
      <button onclick="document.getElementById('btn-settings').click()"
              class="inline-flex items-center gap-2 bg-coral hover:bg-orange text-white font-medium px-5 py-2.5 rounded transition-colors" style="font-family:Arial,Helvetica,sans-serif;">
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        Open Settings
      </button>
      <div class="mt-10 grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl text-left">
        ${[
          {
            num: '01',
            title: 'Public read',
            desc: 'View any public GitHub project without authentication',
          },
          {
            num: '02',
            title: 'Drag to prioritise',
            desc: 'Connect a PAT to drag rows and write order back to GitHub',
          },
          {
            num: '03',
            title: 'Team tracking',
            desc: 'Colour-coded blocked:team labels show who is on the hook',
          },
        ].map(f => `
          <div style="background:rgba(12,43,45,0.6);border:1px solid rgba(78,99,94,0.4);border-radius:8px;padding:1rem;">
            <p class="rank-number mb-2" style="font-family:Arial,Helvetica,sans-serif;">${f.num}</p>
            <p class="text-sm font-bold text-parchment mb-1" style="font-family:'Times New Roman',Times,serif;">${f.title}</p>
            <p class="text-xs text-muted leading-relaxed" style="font-family:Arial,Helvetica,sans-serif;">${f.desc}</p>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function renderLoadingState() {
  const content = document.getElementById('app-content');
  if (!content) return;
  content.innerHTML = `
    <div class="flex flex-col items-center justify-center min-h-[50vh] gap-4">
      <div class="relative w-14 h-14">
        <div class="absolute inset-0 rounded-full border-2" style="border-color:rgba(78,99,94,0.4);"></div>
        <div class="absolute inset-0 rounded-full border-2 border-t-coral animate-spin"></div>
      </div>
      <div class="text-center">
        <p class="text-parchment font-medium" style="font-family:'Times New Roman',Times,serif;">Loading project…</p>
        <p class="text-muted text-sm mt-1" style="font-family:Arial,Helvetica,sans-serif;">Fetching items from GitHub Projects v2</p>
      </div>
    </div>
  `;
}

function renderErrorState(message) {
  const content = document.getElementById('app-content');
  if (!content) return;

  const noPat = !hasPAT();
  const looksLikeRateOrAuth = /rate.limit|unauthorized|forbidden|bad.credential|read:project|requires/i.test(message);
  const showPatFlow = noPat || looksLikeRateOrAuth;

  content.innerHTML = `
    <div class="max-w-xl mx-auto mt-20 px-6">
      <div style="background:rgba(255,255,255,0.85);border:1px solid rgba(228,105,98,0.35);border-radius:14px;padding:2.5rem;box-shadow:0 4px 24px rgba(14,38,24,0.07);">

        <!-- Title -->
        <h2 class="text-2xl font-bold mb-1" style="font-family:'Times New Roman',Times,serif;color:#0E2618;">
          ${showPatFlow ? 'GitHub token required' : 'Failed to load project'}
        </h2>
        <p class="text-sm mb-6" style="color:#808C78;font-family:Arial,Helvetica,sans-serif;">
          ${showPatFlow
            ? 'The GitHub API requires a Personal Access Token to load this project.'
            : escapeHtml(message)}
        </p>

        ${showPatFlow ? `
        <!-- Step-by-step PAT flow -->
        <div class="space-y-4">

          <!-- Step 1 -->
          <div class="flex gap-4 items-start">
            <span class="flex-none w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
                  style="background:#E46962;color:white;font-family:Arial,Helvetica,sans-serif;">1</span>
            <div class="flex-1 pt-0.5">
              <p class="text-sm font-semibold mb-1" style="color:#0E2618;font-family:'Times New Roman',Times,serif;">Generate a token on GitHub</p>
              <p class="text-xs mb-2" style="color:#4E635E;font-family:Arial,Helvetica,sans-serif;">
                Needs <code style="background:rgba(78,99,94,0.1);padding:0.1em 0.3em;border-radius:3px;">read:project</code> and
                <code style="background:rgba(78,99,94,0.1);padding:0.1em 0.3em;border-radius:3px;">public_repo</code> scopes.
              </p>
              <a href="https://github.com/settings/tokens/new?scopes=read:project,public_repo&description=Priority+Pipeline"
                 target="_blank" rel="noopener"
                 style="display:inline-flex;align-items:center;gap:0.4rem;font-size:0.8rem;font-family:Arial,Helvetica,sans-serif;color:#E46962;text-decoration:underline;text-underline-offset:2px;"
                 onmouseover="this.style.color='#FA7B17'" onmouseout="this.style.color='#E46962'">
                Open GitHub token page ↗
              </a>
            </div>
          </div>

          <!-- Divider -->
          <div style="border-left:2px dashed rgba(78,99,94,0.2);margin-left:0.875rem;height:0.75rem;"></div>

          <!-- Step 2 -->
          <div class="flex gap-4 items-start">
            <span class="flex-none w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
                  style="background:#E46962;color:white;font-family:Arial,Helvetica,sans-serif;">2</span>
            <div class="flex-1 pt-0.5">
              <p class="text-sm font-semibold mb-2" style="color:#0E2618;font-family:'Times New Roman',Times,serif;">Paste your token</p>
              <div class="relative">
                <input id="inline-pat-input" type="password" placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                       style="width:100%;background:rgba(255,255,255,0.9);border:1px solid rgba(78,99,94,0.35);border-radius:7px;padding:0.6rem 2.5rem 0.6rem 0.75rem;font-size:0.875rem;font-family:Arial,Helvetica,sans-serif;color:#0E2618;outline:none;"
                       onfocus="this.style.borderColor='#E46962'" onblur="this.style.borderColor='rgba(78,99,94,0.35)'"
                       onkeydown="if(event.key==='Enter')window._saveInlinePat()" />
                <button onclick="const i=document.getElementById('inline-pat-input');i.type=i.type==='password'?'text':'password'"
                        style="position:absolute;right:0.6rem;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:#808C78;padding:0.2rem;">
                  <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
                    <path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>
                  </svg>
                </button>
              </div>
            </div>
          </div>

          <!-- Divider -->
          <div style="border-left:2px dashed rgba(78,99,94,0.2);margin-left:0.875rem;height:0.75rem;"></div>

          <!-- Step 3 -->
          <div class="flex gap-4 items-start">
            <span class="flex-none w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
                  style="background:#E46962;color:white;font-family:Arial,Helvetica,sans-serif;">3</span>
            <div class="flex-1 pt-0.5">
              <p class="text-sm font-semibold mb-2" style="color:#0E2618;font-family:'Times New Roman',Times,serif;">Save &amp; reload</p>
              <button onclick="window._saveInlinePat()"
                      style="background:#E46962;color:white;font-family:Arial,Helvetica,sans-serif;border-radius:7px;padding:0.55rem 1.25rem;font-size:0.875rem;font-weight:600;border:none;cursor:pointer;"
                      onmouseover="this.style.background='#FA7B17'" onmouseout="this.style.background='#E46962'">
                Save &amp; Load Project
              </button>
            </div>
          </div>

        </div>
        ` : `
        <div class="flex items-center gap-3">
          <button onclick="window._retryLoad()"
                  style="font-size:0.875rem;color:#4E635E;font-family:Arial,Helvetica,sans-serif;background:rgba(78,99,94,0.1);border:1px solid rgba(78,99,94,0.25);border-radius:6px;padding:0.4rem 0.9rem;cursor:pointer;"
                  onmouseover="this.style.background='rgba(78,99,94,0.18)'" onmouseout="this.style.background='rgba(78,99,94,0.1)'">
            Retry
          </button>
          <button onclick="document.getElementById('btn-settings').click()"
                  style="font-size:0.875rem;color:#808C78;font-family:Arial,Helvetica,sans-serif;background:none;border:none;cursor:pointer;text-decoration:underline;text-underline-offset:2px;">
            Check Settings
          </button>
        </div>
        `}

      </div>
    </div>
  `;

  if (showPatFlow) {
    window._saveInlinePat = async () => {
      const val = document.getElementById('inline-pat-input')?.value.trim();
      if (!val) { document.getElementById('inline-pat-input')?.focus(); return; }
      saveConfig({ pat: val });
      updateHeaderBadges();
      await loadProject();
    };
    // Focus the input after render
    setTimeout(() => document.getElementById('inline-pat-input')?.focus(), 50);
  }
}

// ---------------------------------------------------------------------------
// Project loading
// ---------------------------------------------------------------------------

export async function loadProject() {
  if (!isConfigured()) {
    renderEmptyState();
    return;
  }

  const config = getConfig();
  state.loading = true;
  state.error = null;
  renderLoadingState();

  // Set up refresh button spinner
  const refreshIcon = document.getElementById('refresh-icon');
  refreshIcon?.classList.add('animate-spin');

  try {
    const { projectId, projectTitle, items } = await fetchProjectItems(
      config.owner,
      config.projectNumber,
      getReadPAT()
    );

    state.projectId = projectId;
    state.projectTitle = projectTitle;
    state.items = items;
    state.loading = false;

    renderProjectView();
  } catch (err) {
    state.error = err.message;
    state.loading = false;
    renderErrorState(err.message);
  } finally {
    refreshIcon?.classList.remove('animate-spin');
  }
}

function renderProjectView() {
  const content = document.getElementById('app-content');
  if (!content) return;

  const config = getConfig();
  const canDrag = hasWritePAT();

  // Render pipeline
  renderPipeline(content, state.items, state.projectTitle);

  // Init drag if PAT present
  if (canDrag && state.projectId) {
    setupDrag(content, config);
  }
}

function setupDrag(content, config) {
  initDrag({
    projectId: state.projectId,
    items: state.items,
    pat: config.patWrite,
    onReorder: (newItems) => {
      state.items = newItems;
      renderPipeline(content, state.items, state.projectTitle);
      // Re-init drag on the freshly rendered DOM, reusing same callback
      setupDrag(content, config);
    },
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

async function init() {
  initSettings();
  updateHeaderBadges();
  registerLabelHandlers();

  // Retry handler
  window._retryLoad = loadProject;

  // Refresh button
  document.getElementById('btn-refresh')?.addEventListener('click', loadProject);

  // Load on startup if already configured
  if (isConfigured()) {
    await loadProject();
  } else {
    renderEmptyState();
  }
}

// Start the app
init();
