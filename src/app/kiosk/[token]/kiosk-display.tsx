"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import QRCode from "qrcode";
import { Loader2, WifiOff } from "lucide-react";
import { useNow } from "@/components/ui/use-now";
import { serveLocalNetworkProofs, type LanHub } from "@/lib/lan-handshake";
import { fetchNetworkToken } from "@/lib/network-token";
import { fmtLongDate, fmtTime } from "@/lib/time";

type Screen =
  | { status: "loading" }
  | { status: "live"; name: string; qr: string; expiresAt: number; offset: number }
  | { status: "offline" }
  | { status: "disconnected"; message: string };

const RETRY_MS = 5_000;

/**
 * Full-screen rotating attendance QR: fetches a fresh code at every minute boundary and keeps the display awake.
 * Each poll carries a token proving this computer's network (from `networkOrigin`), for the same-network rule.
 */
export function KioskDisplay({ networkOrigin }: { networkOrigin: string }) {
  const [screen, setScreen] = useState<Screen>({ status: "loading" });
  const now = useNow(1000);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let build: string | undefined;
    // Token and secret for answering phones' local Wi-Fi handshakes, refreshed with every code.
    let hub: LanHub | null = null;
    const stopServing = serveLocalNetworkProofs(() => hub);
    const load = async () => {
      clearTimeout(timer);
      let next = RETRY_MS;
      try {
        const network = (await fetchNetworkToken(networkOrigin))?.token;
        const sent = Date.now();
        const res = await fetch(`/api/kiosk/code${network ? `?network=${encodeURIComponent(network)}` : ""}`, { cache: "no-store" });
        const body = (await res.json()) as { name: string; code: string; expiresAt: number; serverNow: number; build: string; lan: string; hub: string; error?: string };
        const received = Date.now();
        if (stopped) return;
        if (res.status === 401) {
          setScreen({ status: "disconnected", message: body.error ?? "This screen is no longer connected." });
          return;
        }
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        // The screen runs unattended: pick up a new deploy by itself.
        if (build && body.build !== build) return window.location.reload();
        build = body.build;
        hub = { origin: networkOrigin, token: body.hub, secret: body.lan };
        const svg = await QRCode.toString(body.code, { type: "svg", margin: 2, errorCorrectionLevel: "M", color: { dark: "#0a1450", light: "#ffffff" } });
        if (stopped) return;
        // Server clock − local clock, taking the server's reading as the middle of the round trip.
        const offset = body.serverNow - (sent + received) / 2;
        setScreen({ status: "live", name: body.name, qr: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, expiresAt: body.expiresAt, offset });
        next = Math.max(body.expiresAt - (Date.now() + offset), 0) + 300;
      } catch {
        if (stopped) return;
        setScreen({ status: "offline" });
      }
      timer = setTimeout(load, next);
    };
    // After sleep / a hidden tab the timer may have fired late: fetch the current code straight away.
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    void load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      stopServing();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [networkOrigin]);

  // Keep the office screen from dimming or sleeping while it shows the code.
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    const request = () => {
      if (document.visibilityState !== "visible" || !("wakeLock" in navigator)) return;
      navigator.wakeLock
        .request("screen")
        .then((l) => {
          lock = l;
        })
        .catch(() => undefined);
    };
    request();
    document.addEventListener("visibilitychange", request);
    return () => {
      document.removeEventListener("visibilitychange", request);
      void lock?.release().catch(() => undefined);
    };
  }, []);

  const serverNow = now === null ? null : now + (screen.status === "live" ? screen.offset : 0);
  const remaining = screen.status === "live" && serverNow !== null ? screen.expiresAt - serverNow : null;
  // A code past its minute (e.g. the computer just woke up) is hidden until the fresh one arrives.
  const stale = remaining !== null && remaining < -2_000;

  if (screen.status === "disconnected") {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-ground px-6 text-center">
        <WifiOff className="size-12 text-danger" />
        <h1 className="font-display text-3xl font-bold text-ink">Screen disconnected</h1>
        <p className="max-w-xl text-base text-muted">{screen.message}</p>
      </main>
    );
  }

  return (
    <main className="flex min-h-dvh flex-col bg-gradient-to-br from-brand-500 to-brand-800 text-white">
      <header className="flex flex-wrap items-center justify-between gap-4 px-6 pt-6 sm:px-10 sm:pt-8">
        <div className="flex items-center gap-3">
          <Image src="/brand/d4dx-mark-white.png" alt="" width={44} height={36} className="h-9 w-auto" priority />
          <span className="font-display text-xl font-bold tracking-[0.04em]">D4DX</span>
          {screen.status === "live" && <span className="text-[15px] text-[#d6defa]">· {screen.name}</span>}
        </div>
        <div className="text-right">
          <div className="font-display text-4xl font-semibold tabular sm:text-5xl">{serverNow === null ? "--:--" : fmtTime(serverNow)}</div>
          <div className="text-sm text-[#d6defa]">{serverNow === null ? "" : fmtLongDate(serverNow)}</div>
        </div>
      </header>

      <section className="flex flex-1 flex-wrap items-center justify-center gap-10 px-6 py-8 sm:px-10">
        <div className="flex max-w-md flex-col gap-5">
          <h1 className="font-display text-4xl leading-tight font-bold sm:text-5xl">Scan to check in or out</h1>
          <ol className="flex flex-col gap-3 text-lg text-[#e3e9fc]">
            <li>1. Open D4DX ERP on your phone</li>
            <li>2. Tap Check in or Check out</li>
            <li>3. Point the camera at this code</li>
          </ol>
          <p className="text-sm text-[#c3cae8]">The code changes every minute. Photos of it stop working.</p>
        </div>

        <div className="flex flex-col items-center gap-4">
          <div className="flex size-[min(72vh,82vw,560px)] items-center justify-center rounded-[28px] bg-white p-4 shadow-modal">
            {screen.status === "live" && !stale ? (
              // eslint-disable-next-line @next/next/no-img-element -- generated data: URI, nothing to optimise
              <img src={screen.qr} alt="Attendance QR code" className="size-full [image-rendering:pixelated]" />
            ) : screen.status === "offline" ? (
              <div className="flex flex-col items-center gap-3 px-6 text-center text-ink">
                <WifiOff className="size-10 text-danger" />
                <p className="font-display text-xl font-semibold">Reconnecting…</p>
                <p className="text-sm text-muted">Check this computer&apos;s internet connection.</p>
              </div>
            ) : (
              <Loader2 className="size-10 animate-spin text-brand-500" aria-label="Loading" />
            )}
          </div>
          {screen.status === "live" && remaining !== null && !stale && (
            <div className="flex w-full flex-col gap-1.5">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/20">
                <div className="h-full rounded-full bg-white transition-[width] duration-1000 ease-linear" style={{ width: `${Math.min(100, Math.max(0, remaining / 600))}%` }} />
              </div>
              <div className="text-center text-sm text-[#d6defa] tabular">New code in {Math.max(0, Math.ceil(remaining / 1000))}s</div>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
