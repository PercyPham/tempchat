const KEY = (roomId: string) => `tempchat:lastSeen:${roomId}`;

export const getLastSeenEid = (roomId: string): number =>
  Number(localStorage.getItem(KEY(roomId)) ?? 0);

export const setLastSeenEid = (roomId: string, eid: number): void =>
  localStorage.setItem(KEY(roomId), String(eid));

export const clearLastSeenEid = (roomId: string): void =>
  localStorage.removeItem(KEY(roomId));
