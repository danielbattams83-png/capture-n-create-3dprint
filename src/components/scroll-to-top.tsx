"use client";

import { useLayoutEffect } from "react";
import { usePathname } from "next/navigation";

function resetScrollPosition() {
  window.scrollTo(0, 0);
  window.requestAnimationFrame(() => window.scrollTo(0, 0));
  window.setTimeout(() => window.scrollTo(0, 0), 50);
  window.setTimeout(() => window.scrollTo(0, 0), 250);
}

export default function ScrollToTop() {
  const pathname = usePathname();

  useLayoutEffect(() => {
    window.history.scrollRestoration = "manual";
    resetScrollPosition();
  }, [pathname]);

  useLayoutEffect(() => {
    window.history.scrollRestoration = "manual";
    resetScrollPosition();
    window.addEventListener("pageshow", resetScrollPosition);
    window.addEventListener("popstate", resetScrollPosition);
    window.addEventListener("beforeunload", resetScrollPosition);
    return () => {
      window.removeEventListener("pageshow", resetScrollPosition);
      window.removeEventListener("popstate", resetScrollPosition);
      window.removeEventListener("beforeunload", resetScrollPosition);
    };
  }, []);

  return null;
}
