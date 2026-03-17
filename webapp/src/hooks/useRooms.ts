import { useState, useEffect } from "react";
import { emitter, hotel } from "../context/HotelContext";
import type { PersistedRoom } from "../services/HotelManager";

export function useRooms(): PersistedRoom[] {
  const [rooms, setRooms] = useState<PersistedRoom[]>(() => hotel.listRooms());

  useEffect(() => {
    const handler = () => setRooms(hotel.listRooms());
    emitter.addEventListener("change", handler);
    return () => emitter.removeEventListener("change", handler);
  }, []);

  return rooms;
}
