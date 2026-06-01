"use client";

import { useEffect } from "react";

const SW_URL = "/sw.js";

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    navigator.serviceWorker.register(SW_URL).catch(() => {
      // Ignore registration failures; the app still works without installability.
    });
  }, []);

  return null;
}