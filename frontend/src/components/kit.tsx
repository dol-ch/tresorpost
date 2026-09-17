import type { MouseEvent, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";

/** SPA navigate to a fresh compose screen (view links live in the hash). */
export function navigateToCompose(event?: MouseEvent<HTMLAnchorElement>) {
  if (
    event &&
    (event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.altKey ||
      event.ctrlKey ||
      event.shiftKey)
  ) {
    return;
  }
  event?.preventDefault();
  window.history.pushState(null, "", "/");
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/** Small uppercase field/section label used throughout the app. */
export function Kicker({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "text-[12px] font-semibold tracking-[0.03em] text-muted-foreground uppercase",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Numbered step kicker, e.g. "01 — Secure transfer". */
export function StepKicker({ num, children }: { num: string; children: ReactNode }) {
  return (
    <p className="mb-2 flex items-center gap-2 text-[12px] font-semibold tracking-[0.03em] text-muted-foreground uppercase">
      <span className="text-primary">{num}</span>
      <span aria-hidden="true">—</span>
      {children}
    </p>
  );
}

/** Centered icon-in-square + heading + description + CTA, used for terminal
 *  states (nothing here / destroyed / expired). */
export function EmptyState({
  icon,
  tone = "muted",
  title,
  description,
  cta,
}: {
  icon: ReactNode;
  tone?: "muted" | "primary";
  title: string;
  description: string;
  cta: { label: string; href: string };
}) {
  return (
    <div className="flex flex-col items-center gap-3.5 px-6 py-8 text-center">
      <div
        className={cn(
          "flex size-14 items-center justify-center rounded-[16px]",
          tone === "primary"
            ? "bg-[color-mix(in_srgb,var(--primary)_12%,transparent)] text-primary"
            : "bg-muted text-muted-foreground",
        )}
      >
        {icon}
      </div>
      <h2 className="font-heading text-[23px] font-bold tracking-tight">{title}</h2>
      <p className="max-w-[44ch] text-[15px] leading-relaxed text-muted-foreground">
        {description}
      </p>
      <Button className="mt-1.5 w-full max-w-70" asChild>
        <a href="/" onClick={navigateToCompose}>
          {cta.label}
        </a>
      </Button>
    </div>
  );
}

/** Full-width compose CTA under decrypted notes, files, and errors. */
export function CreateNewSecretButton({ className }: { className?: string }) {
  const t = useT();
  return (
    <Button className={cn("w-full", className)} asChild>
      <a href="/" onClick={navigateToCompose}>
        {t("view.createNew")}
      </a>
    </Button>
  );
}

/** Self-destruct summary card (opens remaining + expiry). */
export function SelfDestructCard({
  opensLine,
  expiry,
}: {
  opensLine: string | null;
  expiry: { absolute: string; relative: string };
}) {
  const t = useT();
  return (
    <div className="flex flex-col gap-2.5 rounded-[14px] bg-muted p-4">
      <Kicker>{t("view.selfDestructs")}</Kicker>
      <div className="flex flex-col gap-1.5 text-[14.5px]">
        {opensLine && (
          <p className="flex items-center gap-2 font-medium text-primary">
            <EyeIcon />
            {opensLine}
          </p>
        )}
        <p className="flex items-center gap-2 text-muted-foreground">
          <ClockIcon />
          <span className="text-foreground">{expiry.absolute}</span>
          <span>· {expiry.relative}</span>
        </p>
      </div>
    </div>
  );
}

function EyeIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}
