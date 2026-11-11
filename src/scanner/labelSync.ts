import { ensureAnonymousUser, supabase } from "../lib/supabase";

/**
 * Offline-first upload queue for per-square scan labels.
 * Items wait in IndexedDB until they reach Supabase, so labels survive reloads
 * and bad connections. Paths are stored relative to the user's folder and the
 * anonymous user id is filled in at upload time, so labelling works before
 * sign-in has finished.
 */

export type LabelColour = "w" | "b" | "empty";
export type LabelPiece = "K" | "Q" | "R" | "B" | "N" | "P";
export type LabelSource = "model_guess_confirmed" | "user_corrected" | "user_manual";

export type CornerPoints = {
  corners: { x: number; y: number }[];
  rotationSteps90: number;
  imageWidth: number;
  imageHeight: number;
};

/** One scan_labels row; *_path fields are relative to "<session_id>/". */
export type ScanLabelRow = {
  id: string;
  board_id: string;
  square: string;
  colour: LabelColour;
  piece: LabelPiece | null;
  source: LabelSource;
  model_guess: string | null;
  model_version: string;
  model_confidence: number | null;
  crop_image_path: string;
  tight_crop_path: string;
  full_board_image_path: string;
  corner_points: CornerPoints;
  camera_side: string | null;
  crop_geometry: string;
  camera_angle_estimate: number | null;
  board_style_tag: string | null;
};

export type QueueItem =
  | { kind: "row"; row: ScanLabelRow }
  | { kind: "file"; path: string; blob: Blob; contentType: string };

export type SyncStatus = "" | "saving" | "saved" | "offline, will save later" | "not saving";

const BUCKET = "scan-crops";
const TABLE = "scan_labels";
const DB_NAME = "snapchess-label-queue";
const STORE = "items";
const CONSENT_KEY = "snapchess.shareCorrections";
const DEBOUNCE_MS = 500;
const MIN_BACKOFF_MS = 2000;
const MAX_BACKOFF_MS = 60000;
const ROW_BATCH = 64;

type Entry = { key: number; item: QueueItem };

let dbPromise: Promise<IDBDatabase | null> | null = null;
// Used only when IndexedDB is unavailable (private mode in some browsers).
const memoryQueue: Entry[] = [];
let memoryKey = 1;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { autoIncrement: true });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
  return dbPromise;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function addItems(items: QueueItem[]): Promise<void> {
  const db = await openDb();
  if (!db) {
    for (const item of items) memoryQueue.push({ key: memoryKey++, item });
    return;
  }
  const tx = db.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);
  for (const item of items) store.add(item);
  await done(tx);
}

async function readAll(): Promise<Entry[]> {
  const db = await openDb();
  if (!db) return memoryQueue.slice();
  const tx = db.transaction(STORE, "readonly");
  const store = tx.objectStore(STORE);
  const entries: Entry[] = [];
  await new Promise<void>((resolve, reject) => {
    const cursor = store.openCursor();
    cursor.onsuccess = () => {
      const c = cursor.result;
      if (!c) {
        resolve();
        return;
      }
      entries.push({ key: c.key as number, item: c.value as QueueItem });
      c.continue();
    };
    cursor.onerror = () => reject(cursor.error);
  });
  return entries;
}

async function removeKeys(keys: number[]): Promise<void> {
  if (keys.length === 0) return;
  const db = await openDb();
  if (!db) {
    for (const key of keys) {
      const at = memoryQueue.findIndex((e) => e.key === key);
      if (at >= 0) memoryQueue.splice(at, 1);
    }
    return;
  }
  const tx = db.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);
  for (const key of keys) store.delete(key);
  await done(tx);
}

async function clearQueue(): Promise<void> {
  memoryQueue.length = 0;
  const db = await openDb();
  if (!db) return;
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).clear();
  await done(tx);
}

// ---- status -----------------------------------------------------------------

let status: SyncStatus = "";
const listeners = new Set<() => void>();

function setStatus(next: SyncStatus): void {
  if (next === status) return;
  status = next;
  for (const fn of listeners) fn();
}

export function getSyncStatus(): SyncStatus {
  return status;
}

export function subscribeSyncStatus(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

// ---- consent ----------------------------------------------------------------

export function getShareConsent(): boolean {
  try {
    return localStorage.getItem(CONSENT_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setShareConsent(on: boolean): void {
  try {
    localStorage.setItem(CONSENT_KEY, on ? "on" : "off");
  } catch {
    // Storage blocked: the choice lasts for this page only.
  }
  consent = on;
  if (!on) {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
    void clearQueue();
    setStatus("not saving");
  } else {
    setStatus(supabase ? "" : "not saving");
    scheduleFlush(0);
  }
  for (const fn of listeners) fn();
}

let consent = typeof window !== "undefined" ? getShareConsent() : false;

export function isSharing(): boolean {
  return consent && supabase !== null;
}

// ---- flushing ---------------------------------------------------------------

let timer: number | null = null;
let flushing = false;
let flushAgain = false;
let backoff = 0;

export function scheduleFlush(delay = DEBOUNCE_MS): void {
  if (!isSharing()) return;
  if (timer !== null) window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    timer = null;
    void flush();
  }, delay);
}

/** Adds items to the queue and uploads them shortly after. No-op when sharing is off. */
export async function enqueue(items: QueueItem[]): Promise<void> {
  if (!isSharing() || items.length === 0) return;
  await addItems(items);
  scheduleFlush();
}

function isDuplicateFile(error: unknown): boolean {
  const e = error as { message?: string; statusCode?: string | number; status?: number };
  return (
    String(e.statusCode) === "409" ||
    e.status === 409 ||
    /already exists|duplicate/i.test(e.message ?? "")
  );
}

function absolute(uid: string, path: string): string {
  return `${uid}/${path}`;
}

function rowForUpload(uid: string, row: ScanLabelRow) {
  return {
    ...row,
    session_id: uid,
    crop_image_path: absolute(uid, row.crop_image_path),
    tight_crop_path: absolute(uid, row.tight_crop_path),
    full_board_image_path: absolute(uid, row.full_board_image_path),
  };
}

async function uploadFile(uid: string, item: Extract<QueueItem, { kind: "file" }>) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(absolute(uid, item.path), item.blob, {
      contentType: item.contentType,
      upsert: false,
    });
  if (error && !isDuplicateFile(error)) throw error;
}

async function insertRows(uid: string, rows: ScanLabelRow[]): Promise<void> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const payload = rows.map((row) => rowForUpload(uid, row));
  const { error } = await supabase.from(TABLE).insert(payload);
  if (!error) return;
  if (error.code !== "23505") throw error;
  // Some rows of this batch already landed on an earlier try; insert one by one.
  for (const row of payload) {
    const single = await supabase.from(TABLE).insert(row);
    if (single.error && single.error.code !== "23505") throw single.error;
  }
}

async function flush(): Promise<void> {
  if (!isSharing()) return;
  if (flushing) {
    flushAgain = true;
    return;
  }
  flushing = true;
  try {
    do {
      flushAgain = false;
      const entries = await readAll();
      if (entries.length === 0) break;
      setStatus("saving");
      const uid = await ensureAnonymousUser();
      if (!uid) throw new Error("Not signed in.");

      for (const entry of entries) {
        if (!consent) return;
        if (entry.item.kind !== "file") continue;
        await uploadFile(uid, entry.item);
        await removeKeys([entry.key]);
      }

      const rowEntries = entries.filter((e) => e.item.kind === "row");
      for (let i = 0; i < rowEntries.length; i += ROW_BATCH) {
        if (!consent) return;
        const batch = rowEntries.slice(i, i + ROW_BATCH);
        await insertRows(
          uid,
          batch.map((e) => (e.item as Extract<QueueItem, { kind: "row" }>).row),
        );
        await removeKeys(batch.map((e) => e.key));
      }
      setStatus("saved");
    } while (flushAgain);
    backoff = 0;
  } catch (err) {
    console.warn("Saving scan labels failed, will retry.", err);
    backoff = backoff === 0 ? MIN_BACKOFF_MS : Math.min(MAX_BACKOFF_MS, backoff * 2);
    setStatus("offline, will save later");
    scheduleFlush(backoff);
  } finally {
    flushing = false;
  }
}

if (typeof window !== "undefined") {
  if (!isSharing()) setStatus("not saving");
  window.addEventListener("online", () => {
    backoff = 0;
    scheduleFlush(0);
  });
  scheduleFlush(0);
}
