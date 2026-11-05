import Link from "next/link";
import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { ThemeToggle } from "~/components/theme-toggle";

/** Signed-out screens share this frame: the product on the left, the form on the right. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  const highlights = [
    "Projects with list and board views",
    "Multiple assignees, due dates, labels, attachments",
    "In-app and email notifications, plus an activity trail",
    "Workload, overdue and completion analytics",
  ];

  return (
    <main className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      {/* Brand panel: a deep, layered gradient with a soft accent glow. */}
      <section className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-brand-600 via-brand-700 to-brand-800 px-12 py-12 text-white lg:flex">
        <div
          className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-white/10 blur-3xl"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.12]"
          aria-hidden
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, white 1px, transparent 0)",
            backgroundSize: "22px 22px",
          }}
        />

        <Link
          href="/"
          className="relative flex items-center gap-2 text-lg font-semibold tracking-tight"
        >
          <span
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/15 text-sm font-bold ring-1 ring-white/20"
            aria-hidden
          >
            O
          </span>
          Orbita
        </Link>

        <div className="relative max-w-md space-y-6">
          <h1 className="text-[2rem] font-semibold leading-tight tracking-tight text-balance">
            Every task, every owner, every deadline — in one place.
          </h1>
          <p className="text-[15px] leading-relaxed text-white/70">
            Assign work, follow the board, and see whether the project is on
            track without asking anybody for a status update.
          </p>
          <ul className="grid gap-2.5 text-sm text-white/85">
            {highlights.map((item) => (
              <li key={item} className="flex items-center gap-2.5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/15 ring-1 ring-white/20">
                  <Check className="h-3 w-3" strokeWidth={3} />
                </span>
                {item}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-white/50">
          Built for teams that ship.
        </p>
      </section>

      <section className="relative flex items-center justify-center bg-canvas px-5 py-12">
        <div className="absolute right-4 top-4">
          <ThemeToggle />
        </div>
        <div className="w-full max-w-sm">{children}</div>
      </section>
    </main>
  );
}
