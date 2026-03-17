const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8080";

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

export interface CreateRoomParams {
  name: string; // AES-GCM ciphertext (base64) of the plaintext room name
  accessKey: string; // base64url-encoded raw HMAC key bytes (exported RAK)
  creatorName: string; // AES-GCM ciphertext (base64) of the plaintext creator display name
}

export interface CreateRoomResult {
  roomId: string;
  createdAt: number; // unix ms
  expiresAt: number; // unix ms
  userId: string;
  joinEid: number;
}

export async function createRoom(params: CreateRoomParams): Promise<CreateRoomResult> {
  const res = await fetch(`${API_URL}/v1/rooms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "unknown" }));
    throw new ApiError(res.status, body.error ?? "unknown");
  }
  return res.json();
}

export interface RoomMember {
  uid: string;
  name: string; // AES-GCM ciphertext (base64) of the plaintext display name
  joinedAt: number; // unix ms
  leftAt?: number; // unix ms; omitted if still in room
}

export interface GetRoomResult {
  name: string; // AES-GCM ciphertext (base64) of the plaintext room name
  expiresAt: number; // unix ms
  memberCount: number;
  maxParticipants: number;
  maxEvents: number;
  members: RoomMember[];
}

export async function getRoom(roomId: string, token: string): Promise<GetRoomResult> {
  const res = await fetch(`${API_URL}/v1/rooms/${roomId}`, {
    headers: { "X-TempChat-Auth": token },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "unknown" }));
    throw new ApiError(res.status, body.error ?? "unknown");
  }
  return res.json();
}

export interface JoinRoomParams {
  roomId: string;
  name: string; // AES-GCM ciphertext (base64) of the plaintext display name
  token: string; // X-TempChat-Auth header value
}

export interface JoinRoomResult {
  userId: string;
  joinEid: number;
  room: GetRoomResult;
}

export interface RoomEvent {
  eid: number;
  uid: string | null;
  ts: number;
  msg?: string;
  type?: string;
}

export async function getEvents(roomId: string, token: string, afterEid?: number): Promise<RoomEvent[]> {
  const url = new URL(`${API_URL}/v1/rooms/${roomId}/events`);
  if (afterEid !== undefined) url.searchParams.set("afterEid", String(afterEid));
  const res = await fetch(url.toString(), {
    headers: { "X-TempChat-Auth": token },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "unknown" }));
    throw new ApiError(res.status, body.error ?? "unknown");
  }
  return res.json();
}

export async function joinRoom(params: JoinRoomParams): Promise<JoinRoomResult> {
  const res = await fetch(`${API_URL}/v1/rooms/${params.roomId}/join`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-TempChat-Auth": params.token,
    },
    body: JSON.stringify({ name: params.name }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "unknown" }));
    throw new ApiError(res.status, body.error ?? "unknown");
  }
  return res.json();
}

export async function leaveRoom(roomId: string, token: string): Promise<void> {
  const res = await fetch(`${API_URL}/v1/rooms/${roomId}/members/me`, {
    method: "DELETE",
    headers: { "X-TempChat-Auth": token },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "unknown" }));
    throw new ApiError(res.status, body.error ?? "unknown");
  }
}

export interface BoostOption {
  id: string;
  name: string;
  price: string;
  ttlMs: number;
  maxParticipants: number;
  maxEvents: number;
}

export async function getBoostOptions(): Promise<BoostOption[]> {
  const res = await fetch(`${API_URL}/v1/boost-options`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "unknown" }));
    throw new ApiError(res.status, body.error ?? "unknown");
  }
  return res.json();
}
