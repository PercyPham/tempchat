import type { PlainMessage } from "../pages/ChatPage";

const DB_NAME = "tempchat-messages";
const STORE_NAME = "messages";
const DB_VERSION = 1;

type StoredMessage = PlainMessage & { roomId: string };

let dbPromise: Promise<IDBDatabase> | null = null;

function getDB(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: ["roomId", "eid"] });
          store.createIndex("by-room", "roomId");
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { dbPromise = null; reject(req.error); };
    });
  }
  return dbPromise;
}

const SYNTHETIC_TYPES = new Set<PlainMessage["systemType"]>(["history_gap", "unread_divider"]);

export async function saveMessages(roomId: string, msgs: PlainMessage[]): Promise<void> {
  const toSave = msgs.filter((m) => !SYNTHETIC_TYPES.has(m.systemType));
  if (toSave.length === 0) return;
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    for (const msg of toSave) {
      store.put({ ...msg, roomId });
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadMessages(roomId: string, afterEid: number): Promise<PlainMessage[]> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const range = IDBKeyRange.bound([roomId, afterEid], [roomId, Infinity]);
    const req = store.getAll(range);
    req.onsuccess = () => {
      const results = (req.result as StoredMessage[]).map(
        ({ roomId: _roomId, ...msg }) => msg as PlainMessage,
      );
      resolve(results.sort((a, b) => a.eid - b.eid));
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getMaxEid(roomId: string): Promise<number> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const range = IDBKeyRange.bound([roomId, -Infinity], [roomId, Infinity]);
    const req = store.openCursor(range, "prev");
    req.onsuccess = () => {
      const cursor = req.result;
      resolve(cursor ? (cursor.value as StoredMessage).eid : -1);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function clearRoom(roomId: string): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const range = IDBKeyRange.bound([roomId, -Infinity], [roomId, Infinity]);
    const req = store.delete(range);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
