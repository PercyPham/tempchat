import { useState, useEffect } from "react";

export function useVisualViewport(): number | null {
  const [height, setHeight] = useState<number | null>(null);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const handler = () => setHeight(vv.height);
    handler();

    vv.addEventListener("resize", handler);
    return () => vv.removeEventListener("resize", handler);
  }, []);

  return height;
}
