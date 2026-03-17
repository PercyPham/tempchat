import { useRef, useCallback } from "react";

export function useNotifications(roomName: string) {
  const askedRef = useRef(false);

  const notify = useCallback(
    (senderName: string, text: string) => {
      if (document.visibilityState !== "hidden") return;
      if (!("Notification" in window)) return; // iOS Safari guard

      async function fire() {
        if (Notification.permission === "granted") {
          new Notification(`${senderName} in ${roomName}`, {
            body: text,
            tag: `tempchat-msg`,
          });
        } else if (Notification.permission === "default" && !askedRef.current) {
          askedRef.current = true;
          const result = await Notification.requestPermission();
          if (result === "granted") {
            new Notification(`${senderName} in ${roomName}`, {
              body: text,
              tag: `tempchat-msg`,
            });
          }
        }
        // "denied" — silent
      }

      void fire();
    },
    [roomName],
  );

  return { notify };
}
