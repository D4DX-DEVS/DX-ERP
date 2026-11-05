"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Elements inside a clickable row or card that keep their own click behaviour. */
const CONTROLS = "a, button, input, select, textarea, label, summary, [role=button], [role=menuitem], [role=checkbox], [role=switch], [contenteditable]";

/**
 * Makes every element with `data-href` — table rows (`<Tr href>`) and list cards — open that page when clicked
 * anywhere, like the record's own link. Ctrl / ⌘ / Shift / middle click open it in a new tab. Clicks on links,
 * buttons and form controls inside, and drag-selecting text, are left alone. Mounted once in the app shell.
 */
export function RowLinks() {
  const router = useRouter();
  useEffect(() => {
    const hrefOf = (e: MouseEvent): string | null => {
      if (!(e.target instanceof Element)) return null;
      const row = e.target.closest<HTMLElement>("[data-href]");
      if (!row?.dataset.href) return null;
      const control = e.target.closest(CONTROLS);
      if (control && row.contains(control)) return null;
      if (window.getSelection()?.toString()) return null;
      return row.dataset.href;
    };
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0) return;
      const href = hrefOf(e);
      if (!href) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey) window.open(href, "_blank", "noopener");
      else router.push(href);
    };
    const onAuxClick = (e: MouseEvent) => {
      if (e.button !== 1) return;
      const href = hrefOf(e);
      if (href) window.open(href, "_blank", "noopener");
    };
    document.addEventListener("click", onClick);
    document.addEventListener("auxclick", onAuxClick);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("auxclick", onAuxClick);
    };
  }, [router]);
  return null;
}
