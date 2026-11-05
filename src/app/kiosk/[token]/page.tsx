import type { Metadata } from "next";
import type { ReactNode } from "react";
import Image from "next/image";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { Monitor } from "lucide-react";
import { ActionButton } from "@/components/ui/actions";
import { KIOSK_COOKIE } from "@/lib/auth/token";
import { db } from "@/lib/db";
import { kioskFromCookie, networkCheckOrigin } from "@/lib/domain/kiosk";
import { hashKioskToken } from "@/lib/domain/kiosk-code";
import { AttendanceKiosk } from "@/lib/models";
import { activateKiosk } from "../actions";
import { KioskDisplay } from "./kiosk-display";

export const metadata: Metadata = { title: "Attendance screen" };

/**
 * Office QR attendance screen. No user session: the link token identifies the screen, and the first browser
 * that activates it is bound through a signed cookie, so the link only works on that computer.
 */
export default async function KioskPage({ params }: PageProps<"/kiosk/[token]">) {
  const { token } = await params;
  const [kiosk] =
    token.length <= 100
      ? await db()
          .select({ _id: AttendanceKiosk._id, name: AttendanceKiosk.name, deviceId: AttendanceKiosk.deviceId })
          .from(AttendanceKiosk)
          .where(eq(AttendanceKiosk.tokenHash, hashKioskToken(token)))
          .limit(1)
      : [];
  if (!kiosk) {
    return <Notice title="This link is not valid">The link was renewed or the screen was removed. Ask an admin for the current link (Settings → Attendance → QR check-in screens).</Notice>;
  }

  const bound = await kioskFromCookie((await cookies()).get(KIOSK_COOKIE)?.value);
  if (bound?.kiosk._id === kiosk._id) return <KioskDisplay networkOrigin={await networkCheckOrigin()} />;
  if (kiosk.deviceId) {
    return (
      <Notice title="Already active on another screen">
        “{kiosk.name}” is already running on another computer. To move it here, an admin creates a new link in Settings → Attendance → QR check-in screens.
      </Notice>
    );
  }
  return (
    <Notice title={`Set up “${kiosk.name}”`}>
      <span className="block">Use this only on the office computer that will show the attendance QR. Once activated, the link works in this browser only.</span>
      <ActionButton action={activateKiosk.bind(null, token)} size="lg" className="mt-6" icon={<Monitor className="size-5" />} successMessage="Screen activated">
        Use this computer as the attendance screen
      </ActionButton>
    </Notice>
  );
}

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-ground px-4 py-12">
      <div className="flex w-full max-w-[520px] flex-col items-start rounded-[20px] border border-line bg-white p-6 shadow-popover sm:p-8">
        <Image src="/brand/d4dx-logo.png" alt="D4DX" width={60} height={64} className="mb-6 h-12 w-auto" priority />
        <h1 className="font-display text-2xl font-bold text-ink">{title}</h1>
        <div className="mt-2 text-sm leading-relaxed text-muted">{children}</div>
      </div>
    </main>
  );
}
