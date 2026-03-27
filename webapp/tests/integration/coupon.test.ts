import { describe, it, expect, beforeAll } from "vitest";
import { API_URL, RoomService } from "./helpers";
import { getOrderStatus, redeemCoupon, ApiError } from "../../src/lib/api";

let reachable = false;

beforeAll(async () => {
  reachable = await fetch(`${API_URL}/v1/health`)
    .then((r) => r.ok)
    .catch(() => false);
  if (!reachable) {
    console.warn(`[integration] Backend not reachable at ${API_URL} — skipping coupon tests`);
  }
});

/** Creates a test coupon via the test-only endpoint. */
async function createTestCoupon(boostId = "boost_plus") {
  const res = await fetch(`${API_URL}/v1/test/coupons`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ boostId }),
  });
  if (!res.ok) throw new Error(`createTestCoupon failed: ${res.status}`);
  return res.json() as Promise<{
    orderId: string;
    code: string;
    boostName: string;
    ttlMs: number;
    maxParticipants: number;
    maxEvents: number;
    expiresAt: number;
  }>;
}

describe("Coupon — test endpoint", () => {
  it("creates a coupon + order and returns expected fields", async () => {
    if (!reachable) return;
    const coupon = await createTestCoupon("boost_plus");

    expect(coupon.orderId).toMatch(/^tc_[a-f0-9]{16}$/);
    expect(coupon.code).toMatch(/^tc_cpn_[a-f0-9]{16}$/);
    expect(coupon.boostName).toBe("Plus Boost");
    expect(coupon.ttlMs).toBe(86_400_000);
    expect(coupon.maxParticipants).toBe(10);
    expect(coupon.maxEvents).toBe(100);
    expect(coupon.expiresAt).toBeGreaterThan(Date.now());
  });

  it("unknown boost id → 400", async () => {
    if (!reachable) return;
    const res = await fetch(`${API_URL}/v1/test/coupons`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ boostId: "boost_nonexistent" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("Coupon — GET /v1/orders/:orderId", () => {
  it("returns room_expired status with coupon data", async () => {
    if (!reachable) return;
    const created = await createTestCoupon("boost_plus");
    const status = await getOrderStatus(created.orderId);

    expect(status.status).toBe("room_expired");
    if (status.status === "room_expired") {
      expect(status.coupon?.code).toBe(created.code);
      expect(status.coupon?.boostName).toBe("Plus Boost");
      expect(status.coupon?.ttlMs).toBe(86_400_000);
      expect(status.coupon?.maxParticipants).toBe(10);
      expect(status.coupon?.maxEvents).toBe(100);
      expect(status.coupon?.expiresAt).toBeGreaterThan(Date.now());
    }
  });

  it("unknown order id → 404", async () => {
    if (!reachable) return;
    await expect(getOrderStatus("tc_0000000000000000")).rejects.toMatchObject({
      status: 404,
      message: "order_not_found",
    });
  });
});

describe("Coupon — POST /v1/rooms/:roomId/redeem-coupon", () => {
  it("applies boost and returns 200", async () => {
    if (!reachable) return;
    const rs = await RoomService.create();
    const { roomId } = await rs.createRoom({ name: "Boost Test", creatorName: "Alice" });
    const room = await rs.getRoom();
    const originalExpiry = room.expiresAt;
    const originalMaxP = room.maxParticipants;

    const created = await createTestCoupon("boost_plus");
    const token = await rs.makeToken(rs.userId);
    await redeemCoupon(roomId, created.code, token);

    const boosted = await rs.getRoom();
    expect(boosted.maxParticipants).toBeGreaterThanOrEqual(
      Math.max(originalMaxP, created.maxParticipants)
    );
    expect(boosted.expiresAt).toBeGreaterThan(originalExpiry);
  });

  it("second redemption of same coupon → 409 coupon_already_used", async () => {
    if (!reachable) return;
    const rs = await RoomService.create();
    const { roomId } = await rs.createRoom({ name: "Dupe Test", creatorName: "Alice" });

    const created = await createTestCoupon("boost_plus");
    const token = await rs.makeToken(rs.userId);
    await redeemCoupon(roomId, created.code, token);

    await expect(redeemCoupon(roomId, created.code, token)).rejects.toMatchObject({
      status: 409,
      message: "coupon_already_used",
    });
  });

  it("unknown coupon code → 404", async () => {
    if (!reachable) return;
    const rs = await RoomService.create();
    const { roomId } = await rs.createRoom({ name: "Bad Coupon Test", creatorName: "Alice" });
    const token = await rs.makeToken(rs.userId);

    await expect(redeemCoupon(roomId, "tc_cpn_0000000000000000", token)).rejects.toMatchObject({
      status: 404,
      message: "coupon_not_found",
    });
  });

  it("missing auth → 401", async () => {
    if (!reachable) return;
    const created = await createTestCoupon("boost_plus");
    const res = await fetch(`${API_URL}/v1/rooms/nonexistent/redeem-coupon`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ couponCode: created.code }),
    });
    expect(res.status).toBe(401);
  });
});
