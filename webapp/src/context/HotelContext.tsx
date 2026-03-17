import { createContext, use, type ReactNode } from "react";
import { HotelManager } from "../services/HotelManager";

// Module-level singleton — created once before React mounts, immune to StrictMode double-init
export const hotel = new HotelManager();

// Module-level event emitter for reactive state updates
export const emitter = new EventTarget();

// Start loading immediately at import time
const readyPromise = hotel.loadAll();

export const HotelContext = createContext<HotelManager>(hotel);

export function HotelProvider({ children }: { children: ReactNode }) {
  // Suspends until loadAll() resolves; requires a <Suspense> boundary above
  use(readyPromise);
  return <HotelContext.Provider value={hotel}>{children}</HotelContext.Provider>;
}

function dispatchChange() {
  emitter.dispatchEvent(new Event("change"));
}

// Wrapper actions that dispatch change events so useRooms re-renders reactively
export const hotelActions = {
  async createRoom(params: { name: string; creatorName: string }) {
    const result = await hotel.createRoom(params);
    dispatchChange();
    return result;
  },

  async joinRoom(privateKey: CryptoKey, roomId: string, params: { name: string }) {
    const result = await hotel.joinRoom(privateKey, roomId, params);
    dispatchChange();
    return result;
  },

  removeRoom(roomId: string): void {
    hotel.removeRoom(roomId);
    dispatchChange();
  },
};
