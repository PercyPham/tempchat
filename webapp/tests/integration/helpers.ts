import WebSocket from "ws";

export { genAuthToken } from "../../src/lib/crypto";
export { createRoom, joinRoom } from "../../src/lib/api";
export { createKeyMaterial, RoomService } from "../../src/services";

export const API_URL: string = import.meta.env.VITE_API_URL;
export const API_URL_2: string = import.meta.env.VITE_API_URL_2 ?? "";

if (!API_URL) {
  throw new Error("VITE_API_URL is not set. Please set it in your environment variables.");
}

// Helper: connect a WebSocket and wait for it to open.
export function wsConnect(url: string, token: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers: { "X-TempChat-Auth": token } });
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

// Helper: wait for the next matching WebSocket message (parsed JSON).
export function wsNextMessage(
  ws: WebSocket,
  predicate: (msg: Record<string, unknown>) => boolean,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("wsNextMessage timed out")), 3000);
    ws.on("message", function handler(raw) {
      const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
      if (predicate(msg)) {
        clearTimeout(timeout);
        ws.off("message", handler);
        resolve(msg);
      }
    });
  });
}
