"use client";

import { useEffect, useRef, useState } from "react";
import { CameraOff, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

/** Native QR decoder (Chrome on Android / macOS); not in TypeScript's DOM types yet. */
interface NativeDetector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
interface NativeDetectorClass {
  new (options: { formats: string[] }): NativeDetector;
  getSupportedFormats(): Promise<string[]>;
}

type Decode = (video: HTMLVideoElement) => Promise<string | undefined>;

const SCAN_EVERY_MS = 250;
/** jsQR works on a downscaled frame: fast enough for phones, sharp enough for a QR filling part of the view. */
const MAX_FRAME = 640;

function cameraError(error: unknown): string {
  const name = error instanceof DOMException || error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "Camera access is blocked. Allow the camera for this site in your browser settings, then try again.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No camera was found on this device.";
  if (name === "NotReadableError") return "The camera is in use by another app. Close it and try again.";
  if (name === "InsecureContext") return "The camera only works over a secure (https) connection.";
  return "The camera could not be started. Try again.";
}

async function createDecoder(): Promise<Decode> {
  const Native = (window as unknown as { BarcodeDetector?: NativeDetectorClass }).BarcodeDetector;
  if (Native && (await Native.getSupportedFormats().catch((): string[] => [])).includes("qr_code")) {
    const detector = new Native({ formats: ["qr_code"] });
    return async (video) => (await detector.detect(video).catch(() => []))[0]?.rawValue;
  }
  const jsQR = (await import("jsqr")).default;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  return async (video) => {
    if (!ctx || !video.videoWidth) return undefined;
    const scale = Math.min(1, MAX_FRAME / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return jsQR(frame.data, frame.width, frame.height, { inversionAttempts: "dontInvert" })?.data || undefined;
  };
}

/**
 * Live camera QR scanner (back camera on phones). Calls `onResult` with every decoded text while not `paused`;
 * the camera stops when the component unmounts.
 */
export function QrScanner({ onResult, paused = false, className }: { onResult: (text: string) => void; paused?: boolean; className?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const latest = useRef({ onResult, paused });
  const [state, setState] = useState<{ ready: boolean; error: string | null }>({ ready: false, error: null });

  useEffect(() => {
    latest.current = { onResult, paused };
  });

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const start = async () => {
      try {
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new DOMException("Camera needs https", "InsecureContext");
        const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        const video = videoRef.current;
        if (stopped || !video) {
          media.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = media;
        video.srcObject = stream;
        await video.play();
        const decode = await createDecoder();
        if (stopped) return;
        setState({ ready: true, error: null });
        const tick = async () => {
          if (stopped) return;
          if (!latest.current.paused && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
            const text = await decode(video).catch(() => undefined);
            if (text && !stopped && !latest.current.paused) latest.current.onResult(text);
          }
          if (!stopped) timer = setTimeout(tick, SCAN_EVERY_MS);
        };
        void tick();
      } catch (error) {
        if (!stopped) setState({ ready: false, error: cameraError(error) });
      }
    };
    void start();
    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className={cn("relative aspect-square w-full overflow-hidden rounded-2xl bg-navy", className)}>
      <video ref={videoRef} playsInline muted autoPlay className={cn("size-full object-cover", !state.ready && "invisible")} />
      {state.ready && !state.error && (
        <div className="pointer-events-none absolute inset-[14%] rounded-2xl border-[3px] border-white/85 shadow-[0_0_0_9999px_rgba(10,20,80,0.35)]" aria-hidden />
      )}
      {!state.ready && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center text-white">
          {state.error ? (
            <>
              <CameraOff className="size-9 text-[#ffb4b4]" />
              <p className="text-sm leading-relaxed">{state.error}</p>
            </>
          ) : (
            <>
              <Loader2 className="size-8 animate-spin" />
              <p className="text-sm text-navy-text">Starting camera…</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
