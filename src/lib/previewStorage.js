// --- Preview Storage Manager ---
// Manages project-scoped localStorage persistence for generated apps running
// inside the origin-isolated preview iframe. The parent window persists storage
// per project under `orion-preview-storage:<projectId>` and hydrates the iframe
// on load, synchronizing mutations over postMessage.

import { safeStorage } from './config.js';

const STORAGE_PREFIX = 'orion-preview-storage:';
const MAX_STORAGE_BYTES = 2 * 1024 * 1024; // 2MB quota per project
const MAX_KEY_LENGTH = 256;

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export const getPreviewStorageKey = (projectId) => {
  return `${STORAGE_PREFIX}${projectId || 'draft'}`;
};

/**
 * Load the stored key-value pairs for a given project.
 * @param {string|null} projectId
 * @returns {Record<string, string>}
 */
export const loadPreviewStorage = (projectId) => {
  try {
    const store = safeStorage('local');
    if (!store) return {};
    const raw = store.getItem(getPreviewStorageKey(projectId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

    const clean = Object.create(null);
    for (const [k, v] of Object.entries(parsed)) {
      if (!FORBIDDEN_KEYS.has(k) && typeof k === 'string' && k.length <= MAX_KEY_LENGTH) {
        clean[k] = String(v ?? '');
      }
    }
    return clean;
  } catch (err) {
    console.warn('[previewStorage] Failed to load storage for', projectId, err);
    return {};
  }
};

/**
 * Persist the given store map for a project.
 * @param {string|null} projectId
 * @param {Record<string, string>} storeMap
 * @returns {boolean}
 */
export const savePreviewStorage = (projectId, storeMap) => {
  try {
    const store = safeStorage('local');
    if (!store) return false;

    const clean = Object.create(null);
    if (storeMap && typeof storeMap === 'object' && !Array.isArray(storeMap)) {
      for (const [k, v] of Object.entries(storeMap)) {
        if (!FORBIDDEN_KEYS.has(k) && typeof k === 'string' && k.length <= MAX_KEY_LENGTH) {
          clean[k] = String(v ?? '');
        }
      }
    }

    const serialized = JSON.stringify(clean);
    if (serialized.length > MAX_STORAGE_BYTES) {
      console.warn('[previewStorage] Quota exceeded (max 2MB), ignoring save for', projectId);
      return false;
    }

    store.setItem(getPreviewStorageKey(projectId), serialized);
    return true;
  } catch (err) {
    console.warn('[previewStorage] Failed to save storage for', projectId, err);
    return false;
  }
};

/**
 * Clear the preview storage for a project.
 * @param {string|null} projectId
 */
export const clearPreviewStorage = (projectId) => {
  try {
    const store = safeStorage('local');
    store?.removeItem(getPreviewStorageKey(projectId));
  } catch (err) {
    console.warn('[previewStorage] Failed to clear storage for', projectId, err);
  }
};

/**
 * Clear the preview storage of every project (used on hosted sign-out so the
 * next user of this browser doesn't inherit a previous account's app data).
 */
export const clearAllPreviewStorage = () => {
  try {
    const store = safeStorage('local');
    if (!store) return;
    const keys = [];
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (key && key.startsWith(STORAGE_PREFIX)) keys.push(key);
    }
    keys.forEach((key) => store.removeItem(key));
  } catch (err) {
    console.warn('[previewStorage] Failed to clear all storage:', err);
  }
};

/**
 * Migrate preview storage from one project id to another (e.g. 'draft' -> actual project id).
 * @param {string} fromProjectId
 * @param {string} toProjectId
 */
export const migratePreviewStorage = (fromProjectId, toProjectId) => {
  const fromKey = getPreviewStorageKey(fromProjectId);
  const toKey = getPreviewStorageKey(toProjectId);
  if (fromKey === toKey) return;

  try {
    const store = safeStorage('local');
    if (!store) return;
    const existing = store.getItem(fromKey);
    if (existing) {
      if (!store.getItem(toKey)) {
        store.setItem(toKey, existing);
      }
      store.removeItem(fromKey);
    }
  } catch (err) {
    console.warn('[previewStorage] Migration failed:', err);
  }
};

/**
 * Apply a mutation from the preview iframe to an in-memory store object.
 * @param {Record<string, string>} storeObj
 * @param {string} action
 * @param {any} payload
 * @returns {boolean} true if storeObj was modified
 */
export const applyStorageChange = (storeObj, action, payload) => {
  if (!storeObj || typeof storeObj !== 'object') return false;

  if (action === 'storage_set') {
    const key = payload?.key;
    if (typeof key !== 'string' || key.length === 0 || key.length > MAX_KEY_LENGTH) return false;
    if (FORBIDDEN_KEYS.has(key)) return false;
    storeObj[key] = String(payload?.value ?? '');
    return true;
  }

  if (action === 'storage_remove') {
    const key = payload?.key;
    if (typeof key !== 'string' || FORBIDDEN_KEYS.has(key)) return false;
    if (key in storeObj) {
      delete storeObj[key];
      return true;
    }
    return false;
  }

  if (action === 'storage_clear') {
    let changed = false;
    for (const k of Object.keys(storeObj)) {
      delete storeObj[k];
      changed = true;
    }
    return changed;
  }

  return false;
};
