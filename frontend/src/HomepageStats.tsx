import { useEffect, useState } from "react";
import { fetchPublicStats, type PublicStats } from "./api";
import { humanSize } from "./options";
import { Kicker } from "@/components/kit";

function formatCount(n: number): string {
  return Math.max(0, Math.round(n)).toLocaleString("en-US");
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[12.5px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-heading text-lg font-semibold tabular-nums tracking-tight">
        {value}
      </p>
      {hint ? (
        <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

export function HomepageStats() {
  const [stats, setStats] = useState<PublicStats | null>(null);

  useEffect(() => {
    fetchPublicStats()
      .then(setStats)
      .catch(() => {
        /* keep the homepage usable if stats are unavailable */
      });
  }, []);

  if (!stats) return null;

  const images = stats.by_kind.image ?? 0;
  const files = stats.by_kind.file ?? 0;
  const videos = stats.by_kind.video ?? 0;
  const texts = stats.by_kind.text ?? 0;

  return (
    <section className="mt-9 border-t border-border pt-6" aria-label="All-time usage">
      <Kicker className="mb-4">All-time usage</Kicker>
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
        <Stat
          label="Links created"
          value={formatCount(stats.links_created)}
          hint="All time"
        />
        <Stat
          label="Transferred"
          value={humanSize(stats.bytes_transferred)}
          hint="Encrypted ciphertext, all time"
        />
        <Stat label="Images" value={formatCount(images)} hint="All time" />
        <Stat
          label="Files"
          value={formatCount(files)}
          hint={`${formatCount(texts)} notes · ${formatCount(videos)} videos`}
        />
      </div>
    </section>
  );
}
