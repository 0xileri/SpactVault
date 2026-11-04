import type { ReactNode } from "react";
import { CheckCircle, Info, WarningCircle, XCircle, type Icon } from "@phosphor-icons/react";

import type { Status } from "@spact/shared";

/** A raised white panel on the app pages' tinted backdrop (ADR-039). */
export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-3xl border border-white/80 bg-white/90 p-6 shadow-[0_1px_2px_rgb(20_15_43/0.04),0_12px_32px_-18px_rgb(76_29_149/0.22)] ring-1 ring-line/70 backdrop-blur ${className}`}>
      {children}
    </section>
  );
}

type Tone = "neutral" | "good" | "warn" | "bad" | "info";

const TONES: Record<Tone, string> = {
  neutral: "bg-zinc-100 text-zinc-700 ring-zinc-200",
  good: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  warn: "bg-amber-50 text-amber-900 ring-amber-200",
  bad: "bg-rose-50 text-rose-800 ring-rose-200",
  info: "bg-sky-50 text-sky-900 ring-sky-200",
};

const TONE_ICON: Record<Tone, Icon> = { neutral: Info, good: CheckCircle, warn: WarningCircle, bad: XCircle, info: Info };
const TONE_ICON_COLOR: Record<Tone, string> = {
  neutral: "text-zinc-500",
  good: "text-emerald-600",
  warn: "text-amber-600",
  bad: "text-rose-600",
  info: "text-sky-600",
};

export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ${TONES[tone]}`}>{children}</span>;
}

export function Notice({ tone, title, children, icon }: { tone: Tone; title: string; children?: ReactNode; icon?: Icon | undefined }) {
  const ToneIcon = icon ?? TONE_ICON[tone];
  return (
    <div className={`flex gap-3 rounded-2xl p-4 text-sm ring-1 ${TONES[tone]}`} role={tone === "bad" ? "alert" : undefined}>
      <ToneIcon size={20} weight="fill" aria-hidden="true" className={`mt-px shrink-0 ${TONE_ICON_COLOR[tone]}`} />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{title}</p>
        {children ? <div className="mt-1 leading-relaxed">{children}</div> : null}
      </div>
    </div>
  );
}

const STATUS_TONE: Record<Status, Tone> = {
  BLOCKED: "bad",
  AWAITING_APPROVAL: "warn",
  APPROVED: "info",
  DENIED: "neutral",
  EXPIRED: "neutral",
  TRANSFER_PENDING: "info",
  SETTLED: "good",
  TRANSFER_FAILED: "bad",
  CROSS_CHAIN_PENDING: "info",
};

const STATUS_LABEL: Record<Status, string> = {
  BLOCKED: "Refused",
  AWAITING_APPROVAL: "Waiting for you",
  APPROVED: "Approved",
  DENIED: "Rejected",
  EXPIRED: "Expired",
  TRANSFER_PENDING: "Sending",
  SETTLED: "Paid",
  TRANSFER_FAILED: "Failed",
  CROSS_CHAIN_PENDING: "Sent to 1Click",
};

export function StatusBadge({ status }: { status: Status }) {
  return (
    <span data-testid="request-status" data-status={status}>
      <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>
    </span>
  );
}

export function statusLabel(status: Status): string {
  return STATUS_LABEL[status];
}

export function Field({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return (
    <div className="grid gap-1 py-3 sm:grid-cols-[10rem_1fr] sm:gap-4">
      <dt className="text-sm text-zinc-500">{label}</dt>
      <dd className="min-w-0 text-sm text-zinc-900" data-testid={testId}>
        {children}
      </dd>
    </div>
  );
}

export function Mono({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`font-mono break-all ${className}`}>{children}</span>;
}

export function Button({
  children,
  onClick,
  disabled,
  variant = "primary",
  title,
  testId,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  variant?: "primary" | "danger" | "secondary";
  title?: string;
  testId?: string;
}) {
  const styles = {
    primary: "bg-brand text-white shadow-md shadow-brand/25 hover:-translate-y-px hover:bg-brand-strong hover:shadow-lg hover:shadow-brand/30 focus-visible:outline-brand disabled:shadow-none",
    danger: "bg-white text-rose-700 ring-1 ring-rose-200 hover:bg-rose-50 hover:ring-rose-300 focus-visible:outline-rose-700",
    secondary: "bg-white text-zinc-800 shadow-sm shadow-zinc-900/5 ring-1 ring-line hover:-translate-y-px hover:ring-zinc-300 focus-visible:outline-zinc-700",
  }[variant];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      data-testid={testId}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition duration-300 ease-fluid active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-45 ${styles}`}
    >
      {children}
    </button>
  );
}

const CHIP_TINTS = {
  brand: "bg-brand/10 text-brand",
  paid: "bg-paid/15 text-emerald-700",
  waits: "bg-waits/15 text-amber-700",
  blocked: "bg-blocked/15 text-rose-700",
  sky: "bg-sky-500/10 text-sky-700",
  ink: "bg-ink text-white",
} as const;

export type ChipTint = keyof typeof CHIP_TINTS;

/** The rounded icon square the front page uses for its outcomes, for section titles and stat tiles. */
export function IconChip({ icon: ChipIcon, tint = "brand", size = "md" }: { icon: Icon; tint?: ChipTint | undefined; size?: "sm" | "md" | undefined }) {
  const box = size === "sm" ? "h-8 w-8 rounded-lg" : "h-10 w-10 rounded-2xl";
  return (
    <span className={`grid shrink-0 place-items-center ${box} ${CHIP_TINTS[tint]}`}>
      <ChipIcon size={size === "sm" ? 16 : 20} weight="bold" aria-hidden="true" />
    </span>
  );
}

/**
 * The head of an app page: a small mono label, a display-size title and a short lede, with the page's own
 * actions on the right (ADR-039). `title` may hold a badge next to the words; the h1's text stays the words.
 */
export function PageHeader({ eyebrow, title, lede, actions }: { eyebrow: string; title: ReactNode; lede?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-10">
      <p className="font-mono text-xs font-medium tracking-[0.16em] text-brand uppercase">{eyebrow}</p>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0 max-w-3xl">
          <h1 className="flex flex-wrap items-center gap-3 font-display text-4xl leading-tight font-bold tracking-tight text-ink sm:text-5xl">{title}</h1>
          {lede ? <div className="mt-3 max-w-2xl text-base leading-relaxed text-zinc-600">{lede}</div> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

/** A section's title with its icon chip, and an optional note on the right. */
export function SectionTitle({ icon, tint = "brand", title, aside }: { icon?: Icon | undefined; tint?: ChipTint | undefined; title: string; aside?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="flex items-center gap-3 text-xl font-semibold tracking-tight text-ink">
        {icon ? <IconChip icon={icon} tint={tint} size="sm" /> : null}
        {title}
      </h2>
      {aside ? <div className="text-xs text-zinc-500">{aside}</div> : null}
    </div>
  );
}
