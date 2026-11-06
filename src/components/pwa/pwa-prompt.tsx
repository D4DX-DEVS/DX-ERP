"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { Download, RefreshCw, Share, SquarePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

/** Chrome / Edge / Samsung Internet install event (not in TypeScript's DOM types). */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface PwaState {
  /** The browser offered a native install prompt. */
  canInstall: boolean;
  /** iPhone / iPad outside the installed app: install is manual (Share → Add to Home Screen). */
  iosInstall: boolean;
  /** A new version's service worker is installed and waiting. */
  updateReady: boolean;
}

/*
 * Module-level store: `beforeinstallprompt` can fire before React has hydrated, so it is captured as soon as
 * this module loads (it is part of the root layout's bundle) and shared through useSyncExternalStore.
 */
const SERVER_STATE: PwaState = { canInstall: false, iosInstall: false, updateReady: false };
let state = SERVER_STATE;
let installEvent: InstallPromptEvent | null = null;
let waitingWorker: ServiceWorker | null = null;
let started = false;
let updating = false;
const listeners = new Set<() => void>();

function update(patch: Partial<PwaState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

if (typeof window !== "undefined") {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  state = { ...state, iosInstall: ios && !isStandalone() };
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault(); // our own popup replaces the browser's mini-infobar
    installEvent = event as InstallPromptEvent;
    update({ canInstall: true });
  });
  window.addEventListener("appinstalled", () => {
    installEvent = null;
    update({ canInstall: false });
  });
}

function watch(registration: ServiceWorkerRegistration) {
  const offer = (worker: ServiceWorker | null) => {
    // With no controller this is the first install, not an update.
    if (!worker || !navigator.serviceWorker.controller) return;
    waitingWorker = worker;
    update({ updateReady: true });
  };
  offer(registration.waiting);
  registration.addEventListener("updatefound", () => {
    const worker = registration.installing;
    worker?.addEventListener("statechange", () => {
      if (worker.state === "installed") offer(worker);
    });
  });
}

/** Registers the service worker once, and checks for a new version on focus and every 30 minutes. */
function start() {
  if (started || !("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return;
  started = true;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (updating) window.location.reload();
  });
  navigator.serviceWorker
    .register("/sw.js", { scope: "/", updateViaCache: "none" })
    .then((registration) => {
      watch(registration);
      const check = () => registration.update().catch(() => undefined);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") void check();
      });
      setInterval(check, 30 * 60_000);
    })
    .catch((error: unknown) => console.error("[pwa] service worker registration failed", error));
}

/** Shows the browser's install dialog; true when the user installed. */
async function promptInstall(): Promise<boolean> {
  const event = installEvent;
  if (!event) return false;
  installEvent = null;
  await event.prompt().catch(() => undefined);
  const choice = await event.userChoice.catch(() => null);
  update({ canInstall: false });
  return choice?.outcome === "accepted";
}

/** Lets the waiting worker take over; its controllerchange reloads the page into the new version. */
function activateUpdate() {
  if (!waitingWorker) return window.location.reload();
  updating = true;
  waitingWorker.postMessage({ type: "SKIP_WAITING" });
  // Fallback if the worker never takes over.
  setTimeout(() => window.location.reload(), 4_000);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Install / update popup. The install offer only appears on the page the app was opened or reloaded on — the
 * browser can make it available later (after some use), and it must not pop up while moving between pages.
 * A new version is offered as soon as it is ready.
 */
export function PwaPrompt() {
  const pwa = useSyncExternalStore(
    subscribe,
    () => state,
    () => SERVER_STATE,
  );
  const pathname = usePathname();
  const [dismissed, setDismissed] = useState({ install: false, update: false });
  const [busy, setBusy] = useState(false);
  const [openedOn] = useState(pathname);
  const [navigated, setNavigated] = useState(false);
  if (!navigated && pathname !== openedOn) setNavigated(true);

  useEffect(start, []);

  // The office QR screen runs unattended: never cover it.
  if (pathname.startsWith("/kiosk/")) return null;

  const mode = pwa.updateReady && !dismissed.update ? "update" : (pwa.canInstall || pwa.iosInstall) && !dismissed.install && !navigated ? "install" : null;
  const close = () => setDismissed((d) => ({ ...d, [mode === "update" ? "update" : "install"]: true }));

  const install = async () => {
    setBusy(true);
    const installed = await promptInstall();
    setBusy(false);
    if (!installed) close();
  };

  const applyUpdate = () => {
    setBusy(true);
    activateUpdate();
  };

  if (!mode) return null;

  const footer =
    mode === "update" ? (
      <>
        <Button variant="secondary" onClick={close} disabled={busy}>
          Later
        </Button>
        <Button icon={<RefreshCw className="size-4" />} loading={busy} onClick={applyUpdate}>
          Update now
        </Button>
      </>
    ) : pwa.canInstall ? (
      <>
        <Button variant="secondary" onClick={close} disabled={busy}>
          Not now
        </Button>
        <Button icon={<Download className="size-4" />} loading={busy} onClick={install}>
          Install
        </Button>
      </>
    ) : (
      <Button variant="secondary" onClick={close}>
        Got it
      </Button>
    );

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !busy && close()}
      size="sm"
      centered
      title={mode === "update" ? "Update available" : "Install D4DX ERP"}
      description={mode === "update" ? "A new version of D4DX ERP is ready." : "Use the ERP like an app: its own icon, full screen and quicker to open."}
      footer={footer}
    >
      <div className="flex items-start gap-3.5 pb-1">
        <Image src="/brand/icon-192.png" alt="" width={48} height={48} className="size-12 shrink-0 rounded-xl border border-line-soft" />
        {mode === "update" ? (
          <p className="text-sm leading-relaxed text-ink-2">Update now to get the latest fixes and features. The page reloads; save any open form first.</p>
        ) : pwa.canInstall ? (
          <p className="text-sm leading-relaxed text-ink-2">Install it on this device and open D4DX ERP straight from your home screen or desktop.</p>
        ) : (
          <ol className="flex list-decimal flex-col gap-2 pl-4 text-sm leading-relaxed text-ink-2">
            <li>
              Tap <Share className="inline size-4 align-[-3px]" aria-label="Share" /> <strong>Share</strong> in the browser toolbar.
            </li>
            <li>
              Choose <SquarePlus className="inline size-4 align-[-3px]" aria-hidden /> <strong>Add to Home Screen</strong>, then <strong>Add</strong>.
            </li>
          </ol>
        )}
      </div>
    </Dialog>
  );
}
