import { useContext } from "react";
import { HotelContext } from "../context/HotelContext";
import type { HotelManager } from "../services/HotelManager";

export function useHotel(): HotelManager {
  const ctx = useContext(HotelContext);
  if (!ctx) throw new Error("useHotel must be used within HotelProvider");
  return ctx;
}
