import { RoomService } from "./RoomService";
import type { CreateRoomServiceResult, JoinRoomServiceResult } from "./RoomService";
import { ApiError } from "../lib/api";
import { encrypt } from "../lib/crypto";
import { clearRoom } from "../lib/messageStore";
import { clearLastSeenEid } from "../lib/lastSeen";

export interface PersistedRoom {
  roomId: string;
  userId: string;
  expiresAt: number;   // unix ms — used to prune expired rooms on load
  joinEid: number;     // lower bound for event fetching
  privateKeyJwk: string; // JWK JSON of ECDSA P-384 private key
  encryptedName?: string; // AES-GCM encrypted room name (base64url); absent in old entries
  /** Runtime-only — never persisted to localStorage. Set while awaiting server expiry verification. */
  expiredState?: 'checking' | 'unreachable';
}

const LS_PREFIX = "tc:room:";

export class HotelManager {
  private sessions = new Map<string, RoomService>();
  private metadata = new Map<string, PersistedRoom>();
  private expiredRooms = new Map<string, 'checking' | 'unreachable'>();

  // On app start: load all non-expired rooms from localStorage, rehydrate RoomService instances,
  // then refresh expiresAt from server in parallel to pick up any boosts applied while offline.
  async loadAll(): Promise<RoomService[]> {
    const sessions: RoomService[] = [];
    const now = Date.now();
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(LS_PREFIX)) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      let data: PersistedRoom;
      try {
        data = JSON.parse(raw) as PersistedRoom;
      } catch {
        continue;
      }
      if (data.expiresAt <= now) {
        // Don't remove immediately — restore session and queue for server verification.
        // The room may have been boosted while the browser was closed.
        const session = await RoomService.restore(data);
        this.sessions.set(data.roomId, session);
        this.metadata.set(data.roomId, data);
        this.expiredRooms.set(data.roomId, 'checking');
        continue;
      }
      const session = await RoomService.restore(data);
      this.sessions.set(data.roomId, session);
      this.metadata.set(data.roomId, data);
      sessions.push(session);
    }

    // Refresh expiresAt from server in parallel — catches boosts applied while browser was closed.
    // Also backfills encryptedName for old entries that predate this field.
    // Silently falls back to cached value on network errors.
    await Promise.all(
      Array.from(this.sessions.entries()).map(async ([roomId, session]) => {
        if (this.expiredRooms.has(roomId)) {
          // Verify expired rooms against server — may have been boosted while offline
          await this.verifyExpiredRoom(roomId);
          return;
        }
        try {
          const room = await session.getRoom();
          const data = this.metadata.get(roomId)!;
          const expiryChanged = room.expiresAt !== data.expiresAt;
          const missingName = !data.encryptedName;
          if (expiryChanged || missingName) {
            const updated: PersistedRoom = { ...data, expiresAt: room.expiresAt };
            if (missingName) updated.encryptedName = await encrypt(room.name, session.aesKey);
            this.metadata.set(roomId, updated);
            localStorage.setItem(`${LS_PREFIX}${roomId}`, JSON.stringify(updated));
          }
        } catch {
          // Network error or room gone server-side — keep cached version
        }
      }),
    );

    return sessions;
  }

  // Create a new room: RoomService.create() → rs.createRoom() → persist → return rs
  async createRoom(params: { name: string; creatorName: string }): Promise<{ session: RoomService; result: CreateRoomServiceResult }> {
    const session = await RoomService.create();
    const result = await session.createRoom(params);
    const encryptedName = await encrypt(params.name, session.aesKey);
    await this.persist(session, result.expiresAt, result.joinEid, encryptedName);
    return { session, result };
  }

  // Join an existing room: privateKey comes from URL hash
  // RoomService.fromPrivateKey(privateKey) → rs.joinRoom() → persist → return rs
  async joinRoom(privateKey: CryptoKey, roomId: string, params: { name: string }): Promise<{ session: RoomService; result: JoinRoomServiceResult }> {
    const session = await RoomService.fromPrivateKey(privateKey);
    session.roomId = roomId;
    const result = await session.joinRoom(params);
    const encryptedName = await encrypt(result.room.name, session.aesKey);
    await this.persist(session, result.room.expiresAt, result.joinEid, encryptedName);
    return { session, result };
  }

  // Return cached in-memory session (populated after loadAll / createRoom / joinRoom)
  getSession(roomId: string): RoomService | null {
    return this.sessions.get(roomId) ?? null;
  }

  // Return all persisted room metadata (for Dashboard, no network call).
  // Active rooms (expiresAt > now) are returned as-is.
  // Expired rooms that are pending server verification or server-unreachable are
  // included with an injected expiredState field so the UI can show them as disabled.
  listRooms(): PersistedRoom[] {
    const now = Date.now();
    const result: PersistedRoom[] = [];
    for (const room of this.metadata.values()) {
      if (room.expiresAt > now) {
        result.push(room);
      } else if (this.expiredRooms.has(room.roomId)) {
        result.push({ ...room, expiredState: this.expiredRooms.get(room.roomId) });
      }
    }
    return result;
  }

  // Update expiresAt after a boost — writes to both in-memory metadata and localStorage
  updateExpiry(roomId: string, expiresAt: number): void {
    const data = this.metadata.get(roomId);
    if (!data) return;
    const updated = { ...data, expiresAt };
    this.metadata.set(roomId, updated);
    localStorage.setItem(`${LS_PREFIX}${roomId}`, JSON.stringify(updated));
  }

  // Fetch the server once to check if an expired room's TTL was extended.
  // Called at startup (loadAll) and when a room's countdown hits zero at runtime.
  async verifyExpiredRoom(roomId: string): Promise<void> {
    this.expiredRooms.set(roomId, 'checking');
    const session = this.sessions.get(roomId);
    if (!session) {
      this.removeRoom(roomId);
      return;
    }
    try {
      const room = await session.getRoom();
      if (room.expiresAt > Date.now()) {
        // Boost was applied — restore the room to active state
        this.updateExpiry(roomId, room.expiresAt);
        this.expiredRooms.delete(roomId);
      } else {
        // Still expired on server — clean up
        this.removeRoom(roomId);
      }
    } catch (err: unknown) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 403)) {
        // Room cleared from server
        this.removeRoom(roomId);
      } else {
        // Network error — keep visible but disabled so user isn't surprised by data loss
        this.expiredRooms.set(roomId, 'unreachable');
      }
    }
  }

  // Wipe room from localStorage + in-memory maps + IndexedDB message store
  removeRoom(roomId: string): void {
    localStorage.removeItem(`${LS_PREFIX}${roomId}`);
    this.sessions.delete(roomId);
    this.metadata.delete(roomId);
    this.expiredRooms.delete(roomId);
    void clearRoom(roomId);
    clearLastSeenEid(roomId);
  }

  private async persist(session: RoomService, expiresAt: number, joinEid: number, encryptedName?: string): Promise<void> {
    const privateKeyJwk = await RoomService.exportPrivateKey(session.privateKey);
    const data: PersistedRoom = {
      roomId: session.roomId!,
      userId: session.userId!,
      expiresAt,
      joinEid,
      privateKeyJwk,
      ...(encryptedName !== undefined ? { encryptedName } : {}),
    };
    localStorage.setItem(`${LS_PREFIX}${session.roomId}`, JSON.stringify(data));
    this.sessions.set(session.roomId!, session);
    this.metadata.set(session.roomId!, data);
  }
}
