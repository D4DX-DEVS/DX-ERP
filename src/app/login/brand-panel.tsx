import Image from "next/image";
import { CheckSquare, Clock, Lock } from "lucide-react";

export function BrandPanel() {
  return (
    <section className="relative hidden flex-[1_1_520px] flex-col justify-between gap-12 bg-gradient-to-br from-brand-500 to-brand-800 px-10 py-12 text-white lg:flex xl:px-16 xl:py-14">
      <div className="flex items-center gap-3">
        <Image src="/brand/d4dx-mark-white.png" alt="" width={44} height={36} className="h-9 w-auto" priority />
        <span className="font-display text-xl font-bold tracking-[0.04em]">D4DX</span>
        <span className="text-[13px] text-[#d6defa]">Innovations LLP</span>
      </div>
      <div className="flex max-w-[520px] flex-col gap-5">
        <h1 className="font-display text-[40px] leading-[1.12] font-bold xl:text-[44px]">People, time and delivery in one place.</h1>
        <p className="text-base leading-relaxed text-[#e3e9fc]">
          Check in, record office movements, apply for leave, log time against tasks and see your projects — on laptop or phone.
        </p>
        <ul className="mt-2 flex flex-col gap-3 text-sm text-brand-50">
          {[
            [Clock, "Attendance and Out / In movements, timed automatically"],
            [CheckSquare, "Tasks, timesheets and approvals routed to the right person"],
            [Lock, "You only see what your role allows"],
          ].map(([Icon, text], i) => {
            const I = Icon as typeof Clock;
            return (
              <li key={i} className="flex items-center gap-3">
                <span className="flex size-8 items-center justify-center rounded-[9px] bg-white/15">
                  <I className="size-[18px]" />
                </span>
                {text as string}
              </li>
            );
          })}
        </ul>
      </div>
      <div className="text-xs text-[#c9d3f8]">© {new Date().getFullYear()} D4DX Innovations LLP · d4dx.co</div>
    </section>
  );
}
