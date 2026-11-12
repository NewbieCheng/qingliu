/**
 * 原件页预览的浏览器持久缓存（IndexedDB）。
 * 键：cid + documentId + page + sha —— sha 变了自动 miss，避免脏页。
 * 这是加速层，不是权威源；清缓存/换设备后会回源拉取。
 */

import { tStandalone } from "@/shared/i18n/core.js";

const DB_NAME = "qingliu-page-preview";
const DB_VERSION = 1;
const STORE = "pages";
const MAX_ENTRIES = 200;

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error || new Error("IndexedDB 打开失败"));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "key" });
        store.createIndex("updatedAt", "updatedAt");
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

function cacheKey(cid, documentId, page, sha) {
  return `${cid}:${documentId}:${page}:${sha || ""}`;
}

function idbGet(key) {
  return new Promise((resolve, reject) => {
    openDB().then((db) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => {
        db.close();
        resolve(req.result || null);
      };
      req.onerror = () => {
        db.close();
        reject(req.error);
      };
    }, reject);
  });
}

function idbPut(entry) {
  return new Promise((resolve, reject) => {
    openDB().then((db) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(entry);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    }, reject);
  });
}

export async function readPagePreview(cid, documentId, page, sha) {
  if (!sha) return null;
  try {
    const row = await idbGet(cacheKey(cid, documentId, page, sha));
    return row?.blob || null;
  } catch {
    return null;
  }
}

export async function writePagePreview(cid, documentId, page, sha, blob) {
  if (!blob || !sha) return;
  try {
    await idbPut({
      key: cacheKey(cid, documentId, page, sha),
      blob,
      updatedAt: Date.now(),
      cid,
      documentId,
      page,
      sha,
    });
    await trimOldest();
  } catch {
    // 缓存失败不影响主流程
  }
}

async function trimOldest() {
  try {
    await new Promise((resolve, reject) => {
      openDB().then((db) => {
        const tx = db.transaction(STORE, "readwrite");
        const store = tx.objectStore(STORE);
        const index = store.index("updatedAt");
        const keys = [];
        const cursorReq = index.openKeyCursor();
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (cursor) {
            keys.push(cursor.primaryKey);
            cursor.continue();
            return;
          }
          const overflow = keys.length - MAX_ENTRIES;
          if (overflow > 0) {
            for (let i = 0; i < overflow; i += 1) store.delete(keys[i]);
          }
        };
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      }, reject);
    });
  } catch {
    // ignore
  }
}

/**
 * 优先 IndexedDB；未命中再带 cookie 拉 PNG，并回写缓存。
 */
export async function loadPagePreview(cid, documentId, page, sha, url) {
  if (sha) {
    const cached = await readPagePreview(cid, documentId, page, sha);
    if (cached) return URL.createObjectURL(cached);
  }

  const headers = {};
  if (sha) headers["If-None-Match"] = `"${sha}:${page}"`;
  const response = await fetch(url, {
    method: "GET",
    credentials: "same-origin",
    headers,
  });
  if (response.status === 304 && sha) {
    const cached = await readPagePreview(cid, documentId, page, sha);
    if (cached) return URL.createObjectURL(cached);
  }
  if (!response.ok) {
    throw new Error(
      response.status === 401
        ? tStandalone("auth.session_expired")
        : tStandalone("api.page_load_failed"),
    );
  }
  const headerSha = response.headers.get("X-Document-SHA") || sha || "";
  const blob = await response.blob();
  if (headerSha) {
    void writePagePreview(cid, documentId, page, headerSha, blob);
  }
  return URL.createObjectURL(blob);
}
