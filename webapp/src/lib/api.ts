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
  publicKey: string; // ECDSA P-384 public key as JWK JSON
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
  ttlMs: number;
  maxParticipants: number;
  maxEvents: number;
  priceUsdCents: number;
  priceVnd: number;
}

export async function getBoostOptions(): Promise<BoostOption[]> {
  const res = await fetch(`${API_URL}/v1/boost-options`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "unknown" }));
    throw new ApiError(res.status, body.error ?? "unknown");
  }
  return res.json();
}

export interface CouponData {
  code: string;
  boostName: string;
  ttlMs: number;
  maxParticipants: number;
  maxEvents: number;
  expiresAt: number; // unix ms
}

export type OrderStatusResponse =
  | { status: "pending" }
  | { status: "completed" }
  | { status: "room_expired"; coupon?: CouponData };

export async function getOrderStatus(orderId: string): Promise<OrderStatusResponse> {
  const res = await fetch(`${API_URL}/v1/orders/${orderId}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "unknown" }));
    throw new ApiError(res.status, body.error ?? "unknown");
  }
  return res.json();
}

export type InitiatePaymentResponse =
  | { provider: "sepay"; orderId: string; amountVnd: number; accountNumber: string; bankCode: string }
  | { provider: "polar"; orderId: string; checkoutUrl: string };

export async function initiatePayment(
  params: { roomId: string; boostId: string; provider: "sepay" | "polar" },
  token: string,
): Promise<InitiatePaymentResponse> {
  const { roomId, ...bodyParams } = params;
  const res = await fetch(`${API_URL}/v1/rooms/${roomId}/payments/initiate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-TempChat-Auth": token,
    },
    body: JSON.stringify(bodyParams),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "unknown" }));
    throw new ApiError(res.status, body.error ?? "unknown");
  }
  return res.json();
}

export async function redeemCoupon(roomId: string, couponCode: string, token: string): Promise<void> {
  const res = await fetch(`${API_URL}/v1/rooms/${roomId}/redeem-coupon`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-TempChat-Auth": token,
    },
    body: JSON.stringify({ couponCode }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "unknown" }));
    throw new ApiError(res.status, body.error ?? "unknown");
  }
}
