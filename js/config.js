/**
 * config.js — Config load/save via localStorage
 * Keys: ppd_owner, ppd_project_number, ppd_pat
 */

const KEYS = {
  OWNER: 'ppd_owner',
  PROJECT_NUMBER: 'ppd_project_number',
  PAT: 'ppd_pat',
};

// Default project: logos-co / project 12
const DEFAULTS = {
  owner: 'logos-co',
  projectNumber: 12,
};

export function getConfig() {
  return {
    owner: localStorage.getItem(KEYS.OWNER) || DEFAULTS.owner,
    projectNumber: parseInt(localStorage.getItem(KEYS.PROJECT_NUMBER) || '0', 10) || DEFAULTS.projectNumber,
    pat: localStorage.getItem(KEYS.PAT) || '',
  };
}

export function saveConfig({ owner, projectNumber, pat }) {
  if (owner !== undefined) {
    if (owner) localStorage.setItem(KEYS.OWNER, owner.trim());
    else localStorage.removeItem(KEYS.OWNER);
  }
  if (projectNumber !== undefined) {
    if (projectNumber) localStorage.setItem(KEYS.PROJECT_NUMBER, String(projectNumber));
    else localStorage.removeItem(KEYS.PROJECT_NUMBER);
  }
  if (pat !== undefined) {
    if (pat) localStorage.setItem(KEYS.PAT, pat.trim());
    else localStorage.removeItem(KEYS.PAT);
  }
}

export function clearConfig() {
  localStorage.removeItem(KEYS.OWNER);
  localStorage.removeItem(KEYS.PROJECT_NUMBER);
  localStorage.removeItem(KEYS.PAT);
}

export function isConfigured() {
  const { owner, projectNumber } = getConfig();
  return Boolean(owner && projectNumber);
}

export function hasPAT() {
  return Boolean(getConfig().pat);
}
