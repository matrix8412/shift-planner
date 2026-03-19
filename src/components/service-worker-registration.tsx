"use client";

import { useEffect } from "react";

const SW_URL = "/sw.js";

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    let cancelled = false;

    async function registerServiceWorker() {
      try {
        const existingRegistration = await navigator.serviceWorker.getRegistration();

        if (!cancelled && existingRegistration) {
          return;
        }

        await navigator.serviceWorker.register(SW_URL);
      } catch {
        // Ignore registration failures here; the app still works without installability.
      }
    }

    registerServiceWorker();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}