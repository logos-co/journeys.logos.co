/**
 * drag.js — HTML5 drag-and-drop reordering for pipeline rows
 */

import { moveProjectItem } from './api.js';
import { showToast } from './app.js';

let dragSrcIndex = null;
let dragSrcEl = null;
let onReorderCallback = null;
let projectId = null;
let itemsRef = null;
let patRef = null;

/**
 * Initialise drag-and-drop on the pipeline list.
 * @param {Object} options
 * @param {string} options.projectId - GitHub project ID
 * @param {Array} options.items - mutable items array
 * @param {string} options.pat - PAT for write
 * @param {Function} options.onReorder - called after successful reorder with updated items
 */
export function initDrag({ projectId: pid, items, pat, onReorder }) {
  projectId = pid;
  itemsRef = items;
  patRef = pat;
  onReorderCallback = onReorder;
  attachDragHandlers();
}

/**
 * Re-attach handlers when the list is re-rendered.
 */
export function reattachDrag() {
  attachDragHandlers();
}

function attachDragHandlers() {
  const rows = document.querySelectorAll('[data-draggable="true"]');
  rows.forEach(row => {
    // Remove existing listeners by cloning - use a flag instead
    if (row._dragInitialised) return;
    row._dragInitialised = true;

    row.addEventListener('dragstart', handleDragStart);
    row.addEventListener('dragend', handleDragEnd);
    row.addEventListener('dragover', handleDragOver);
    row.addEventListener('dragenter', handleDragEnter);
    row.addEventListener('dragleave', handleDragLeave);
    row.addEventListener('drop', handleDrop);
  });
}

function handleDragStart(e) {
  dragSrcEl = this;
  dragSrcIndex = parseInt(this.dataset.index, 10);
  this.classList.add('drag-source');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', String(dragSrcIndex));
}

function handleDragEnd() {
  this.classList.remove('drag-source');
  document.querySelectorAll('[data-draggable="true"]').forEach(row => {
    row.classList.remove('drag-over');
  });
  dragSrcEl = null;
  dragSrcIndex = null;
}

function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  return false;
}

function handleDragEnter() {
  if (this !== dragSrcEl) {
    this.classList.add('drag-over');
  }
}

function handleDragLeave() {
  this.classList.remove('drag-over');
}

async function handleDrop(e) {
  e.stopPropagation();
  e.preventDefault();
  this.classList.remove('drag-over');

  if (!dragSrcEl || this === dragSrcEl) return;

  const targetIndex = parseInt(this.dataset.index, 10);
  if (isNaN(dragSrcIndex) || isNaN(targetIndex)) return;
  if (dragSrcIndex === targetIndex) return;

  // Optimistically reorder local items array
  const items = itemsRef;
  const [moved] = items.splice(dragSrcIndex, 1);
  items.splice(targetIndex, 0, moved);

  // Determine afterItemId: the item now just before the moved item, or null if at top
  const newIndex = targetIndex;
  const afterItemId = newIndex === 0 ? null : items[newIndex - 1].id;

  // Re-render optimistically
  if (onReorderCallback) {
    onReorderCallback([...items]);
  }

  // Write to GitHub
  try {
    await moveProjectItem(projectId, moved.id, afterItemId, patRef);
  } catch (err) {
    showToast('error', `Failed to save order: ${err.message}`);
    // Revert
    items.splice(newIndex, 1);
    items.splice(dragSrcIndex, 0, moved);
    if (onReorderCallback) {
      onReorderCallback([...items]);
    }
  }
}
