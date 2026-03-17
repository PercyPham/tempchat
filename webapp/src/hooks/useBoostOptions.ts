import { useState, useEffect } from "react";
import { getBoostOptions } from "../lib/api";
import type { BoostOption } from "../lib/api";

// Module-level cache — fetched once per app session
let cachedOptions: BoostOption[] | null = null;

async function fetchBoostOptions(): Promise<BoostOption[]> {
  if (cachedOptions) return cachedOptions;
  cachedOptions = await getBoostOptions();
  return cachedOptions;
}

export function useBoostOptions(): { options: BoostOption[]; loading: boolean; error: Error | null } {
  const [options, setOptions] = useState<BoostOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    fetchBoostOptions()
      .then(setOptions)
      .catch((e: unknown) => setError(e instanceof Error ? e : new Error(String(e))))
      .finally(() => setLoading(false));
  }, []);

  return { options, loading, error };
}
