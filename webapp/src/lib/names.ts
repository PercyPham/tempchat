import type { PlainMember } from "../services/RoomService";

/** Strip any trailing " #N" the user may have manually typed (anti-spoofing) */
function stripSuffix(name: string): string {
  return name.replace(/ #\d+$/, "");
}

/**
 * Build uid→displayName map. Duplicates (same stripped base name) receive
 * " #2", " #3", … in chronological join order.
 * Stripping user-supplied " #N" before comparison prevents impersonation.
 */
export function buildDisplayNames(members: PlainMember[]): Map<string, string> {
  const sorted = [...members].sort((a, b) => a.joinedAt - b.joinedAt);
  const counts = new Map<string, number>();
  const result = new Map<string, string>();
  for (const m of sorted) {
    const base = stripSuffix(m.name);
    const count = (counts.get(base) ?? 0) + 1;
    counts.set(base, count);
    result.set(m.uid, count === 1 ? base : `${base} #${count}`);
  }
  return result;
}

/**
 * Split a display name into base and suffix for styled rendering.
 * e.g. "Alice #2" → { base: "Alice", suffix: " #2" }
 */
export function splitDisplayName(name: string): { base: string; suffix: string } {
  const match = name.match(/^(.*?)( #\d+)$/);
  return match ? { base: match[1], suffix: match[2] } : { base: name, suffix: "" };
}
