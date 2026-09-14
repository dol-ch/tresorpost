import { useEffect, useState } from "react";
import { fetchPublicStats, type PublicStats } from "./api";
import { humanSize } from "./options";
import { Card, CardDescription, CardHeader } from "@/components/ui/card";

function formatCount(n: number): string {
  return Math.max(0, Math.round(n)).toLocaleString("en-US");
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <p className="font-heading text-4xl font-semibold tracking-tight tabular-nums sm:text-5xl">
          {value}
        </p>
        {hint ? <CardDescription>{hint}</CardDescription> : null}
      </CardHeader>
    </Card>
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
    <section className="mb-8" aria-label="All-time usage">
      <div className="grid gap-3 sm:grid-cols-2">
        <StatCard
          label="Links created"
          value={formatCount(stats.links_created)}
          hint="All time"
        />
        <StatCard
          label="Transferred"
          value={humanSize(stats.bytes_transferred)}
          hint="Encrypted ciphertext, all time"
        />
        <StatCard
          label="Images"
          value={formatCount(images)}
          hint="All time"
        />
        <StatCard
          label="Files"
          value={formatCount(files)}
          hint={`${formatCount(texts)} notes · ${formatCount(videos)} videos`}
        />
      </div>
    </section>
  );
}
