import { RoomService } from "./RoomService";
import type { CreateRoomServiceResult, JoinRoomServiceResult } from "./RoomService";

export interface PersistedRoom {
  roomId: string;
  userId: string;
  expiresAt: number;   // unix ms — used to prune expired rooms on load
  joinEid: number;     // lower bound for event fetching
  privateKeyJwk: string; // JWK JSON of ECDSA P-384 private key
}

const LS_PREFIX = "tc:room:";

export class HotelManager {
  private sessions = new Map<string, RoomService>();
  private metadata = new Map<string, PersistedRoom>();

  // On app start: load all non-expired rooms from localStorage, rehydrate RoomService instances
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
        localStorage.removeItem(key);
        continue;
      }
      const session = await RoomService.restore(data);
      this.sessions.set(data.roomId, session);
      this.metadata.set(data.roomId, data);
      sessions.push(session);
    }
    return sessions;
  }

  // Create a new room: RoomService.create() → rs.createRoom() → persist → return rs
  async createRoom(params: { name: string; creatorName: string }): Promise<{ session: RoomService; result: CreateRoomServiceResult }> {
    const session = await RoomService.create();
    const result = await session.createRoom(params);
    await this.persist(session, result.expiresAt, result.joinEid);
    return { session, result };
  }

  // Join an existing room: privateKey comes from URL hash
  // RoomService.fromPrivateKey(privateKey) → rs.joinRoom() → persist → return rs
  async joinRoom(privateKey: CryptoKey, roomId: string, params: { name: string }): Promise<{ session: RoomService; result: JoinRoomServiceResult }> {
    const session = await RoomService.fromPrivateKey(privateKey);
    session.roomId = roomId;
    const result = await session.joinRoom(params);
    await this.persist(session, result.room.expiresAt, result.joinEid);
    return { session, result };
  }

  // Return cached in-memory session (populated after loadAll / createRoom / joinRoom)
  getSession(roomId: string): RoomService | null {
    return this.sessions.get(roomId) ?? null;
  }

  // Return all persisted room metadata (for Dashboard, no network call)
  // Filters out expired rooms (expiresAt < Date.now())
  listRooms(): PersistedRoom[] {
    const now = Date.now();
    return Array.from(this.metadata.values()).filter((m) => m.expiresAt > now);
  }

  // Wipe room from localStorage + in-memory maps
  removeRoom(roomId: string): void {
    localStorage.removeItem(`${LS_PREFIX}${roomId}`);
    this.sessions.delete(roomId);
    this.metadata.delete(roomId);
  }

  private async persist(session: RoomService, expiresAt: number, joinEid: number): Promise<void> {
    const privateKeyJwk = await RoomService.exportPrivateKey(session.privateKey);
    const data: PersistedRoom = {
      roomId: session.roomId!,
      userId: session.userId!,
      expiresAt,
      joinEid,
      privateKeyJwk,
    };
    localStorage.setItem(`${LS_PREFIX}${session.roomId}`, JSON.stringify(data));
    this.sessions.set(session.roomId!, session);
    this.metadata.set(session.roomId!, data);
  }
}
