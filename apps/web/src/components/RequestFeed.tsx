import { Check, Robot, X } from "@phosphor-icons/react";
import type { ReactNode } from "react";

import type { ExampleAmounts } from "../landing.js";
import { useOnScreen } from "./Motion.js";
import "./requestFeed.css";

/** Stacks its children in one grid cell, so states can swap without moving the layout. */
function Stack({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`grid ${className}`}>{children}</span>;
}

const STATE = "[grid-area:1/1]";

function Pill({ tone, className, children }: { tone: "check" | "paid" | "blocked"; className: string; children: ReactNode }) {
  const tones = {
    check: "bg-zinc-100 text-zinc-500",
    paid: "bg-paid/10 text-emerald-700",
    blocked: "bg-blocked/10 text-rose-700",
  };
  return (
    <span className={`${STATE} ${className} inline-flex items-center gap-1.5 justify-self-end rounded-full px-3 py-1 text-xs font-semibold whitespace-nowrap ${tones[tone]}`}>
      {children}
    </span>
  );
}

function Checking({ row }: { row: "a" | "b" | "c" }) {
  return (
    <Pill tone="check" className={`feed-check feed-check-${row}`}>
      <span className="feed-pulse h-1.5 w-1.5 rounded-full bg-zinc-400" />
      Checking rules
    </Pill>
  );
}

function Row({ row, amount, purpose, why, status }: { row: "a" | "b" | "c"; amount: string; purpose: string; why: ReactNode; status: ReactNode }) {
  return (
    <li className={`feed-row feed-row-${row} grid grid-cols-[1fr_auto] items-center gap-4 py-4`}>
      <span className="min-w-0">
        <span className="block text-base font-semibold text-ink">Pay {amount}</span>
        <span className="block text-sm text-zinc-500">for {purpose}</span>
        <Stack className="mt-1 min-h-5 text-sm font-medium">{why}</Stack>
      </span>
      <Stack className="justify-items-end">{status}</Stack>
    </li>
  );
}

/**
 * The hero graphic: an agent's three payment requests arrive one by one, and each is decided in plain
 * words. One is paid at once, one waits until the owner taps Approve, one is refused. CSS animations
 * only; paused while off screen. With reduced motion it is one still frame showing all three outcomes.
 */
export function RequestFeed({ example, source }: { example: ExampleAmounts; source: string }) {
  const [ref, playing] = useOnScreen<HTMLElement>();

  return (
    <figure
      ref={ref}
      className="feed rounded-3xl border border-line bg-surface p-5 shadow-xl shadow-zinc-900/5 sm:p-6"
      data-playing={playing}
      data-testid="request-feed"
    >
      <p className="sr-only">
        Example: your agent asks to pay {example.paid}, which is paid at once. It asks to pay {example.waits}, which waits until you approve it in your
        wallet. It asks to pay {example.blocked}, which is refused.
      </p>
      <div aria-hidden="true">
        <div className="flex items-center justify-between gap-3 border-b border-line pb-4">
          <span className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-ink text-paper">
              <Robot size={22} weight="fill" />
            </span>
            <span>
              <span className="block text-sm font-semibold text-ink">Your AI agent</span>
              <span className="block text-xs text-zinc-500">asks the vault to pay</span>
            </span>
          </span>
          <span className="rounded-full border border-line px-2.5 py-0.5 text-xs font-medium text-zinc-500">Example</span>
        </div>

        <ol className="divide-y divide-line">
          <Row
            row="a"
            amount={example.paid}
            purpose="a search API call"
            why={<span className={`${STATE} feed-why-a text-emerald-700`}>Under your {example.auto} instant limit</span>}
            status={
              <>
                <Checking row="a" />
                <Pill tone="paid" className="feed-done-a">
                  <Check size={12} weight="bold" />
                  Paid
                </Pill>
              </>
            }
          />
          <Row
            row="b"
            amount={example.waits}
            purpose="a dataset"
            why={
              <>
                <span className={`${STATE} feed-why-b text-amber-700`}>Over {example.auto}, so it asks you first</span>
                <span className={`${STATE} feed-why-b-done text-emerald-700`}>You approved it in your wallet</span>
              </>
            }
            status={
              <>
                <Checking row="b" />
                <span className={`${STATE} feed-approve relative justify-self-end overflow-hidden rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white`}>
                  Approve
                  <span className="feed-tap absolute inset-0 m-auto h-6 w-6 rounded-full bg-white/60" />
                </span>
                <Pill tone="paid" className="feed-done-b">
                  <Check size={12} weight="bold" />
                  Paid
                </Pill>
              </>
            }
          />
          <Row
            row="c"
            amount={example.blocked}
            purpose="GPU time"
            why={<span className={`${STATE} feed-why-c text-rose-700`}>Over your {example.cap} limit per payment</span>}
            status={
              <>
                <Checking row="c" />
                <Pill tone="blocked" className="feed-done-c">
                  <X size={12} weight="bold" />
                  Refused
                </Pill>
              </>
            }
          />
        </ol>
      </div>
      <figcaption className="mt-2 border-t border-line pt-4 text-xs text-zinc-500" data-testid="feed-source">
        {source}
      </figcaption>
    </figure>
  );
}
