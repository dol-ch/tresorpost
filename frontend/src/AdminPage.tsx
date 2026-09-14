import { useEffect, useState } from "react";
import {
  fetchAdminStats,
  fetchActive,
  purgeExpired,
  type AdminStats,
  type ActiveItem,
  type DailyPoint,
} from "./api";
import { humanSize } from "./options";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const TOKEN_KEY = "et_admin_token";

function formatTtl(expiresAt: number): string {
  let s = Math.round(expiresAt - Date.now() / 1000);
  if (s <= 0) return "expired";
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${Math.max(1, s % 60)}s`;
}

function agoLabel(sec: number): string {
  const s = Math.max(0, Math.round(Date.now() / 1000 - sec));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function buildSeries(daily: DailyPoint[], days = 14) {
  const map = new Map(daily.map((d) => [d.day, d.count]));
  const now = new Date();
  const out: { day: string; label: string; count: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i),
    );
    const iso = d.toISOString().slice(0, 10);
    out.push({ day: iso, label: String(d.getUTCDate()), count: map.get(iso) ?? 0 });
  }
  return out;
}

export function AdminPage() {
  const [token, setToken] = useState<string>(
    () => localStorage.getItem(TOKEN_KEY) ?? "",
  );
  const [authed, setAuthed] = useState<boolean>(false);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [active, setActive] = useState<{ items: ActiveItem[]; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [purgeMsg, setPurgeMsg] = useState<string | null>(null);

  async function load(t: string) {
    setBusy(true);
    setError(null);
    try {
      const [s, a] = await Promise.all([fetchAdminStats(t), fetchActive(t)]);
      setStats(s);
      setActive(a);
      setAuthed(true);
      localStorage.setItem(TOKEN_KEY, t);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setAuthed(false);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (token) load(token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    setToken("");
    setStats(null);
    setActive(null);
    setAuthed(false);
  }

  async function onPurge() {
    setBusy(true);
    setPurgeMsg(null);
    try {
      const { purged } = await purgeExpired(token);
      setPurgeMsg(
        purged === 0 ? "Nothing to purge." : `Purged ${purged} expired secret(s).`,
      );
      const [s, a] = await Promise.all([fetchAdminStats(token), fetchActive(token)]);
      setStats(s);
      setActive(a);
    } catch (e) {
      setPurgeMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!authed || !stats || !active) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Dashboard access</CardTitle>
          <CardDescription>
            Enter the admin token (server <code className="font-mono text-xs">ADMIN_TOKEN</code>).
            Only aggregate metadata is shown — never any content or keys.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              if (token) load(token);
            }}
          >
            <div className="grid flex-1 gap-2">
              <Label htmlFor="admin-token">Admin token</Label>
              <Input
                id="admin-token"
                type="password"
                placeholder="admin token"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                autoFocus
              />
            </div>
            <Button type="submit" disabled={busy || !token}>
              {busy ? "Checking…" : "Unlock"}
            </Button>
          </form>
          {error && (
            <Alert variant="destructive" className="mt-4">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </CardContent>
        <CardFooter>
          <Button variant="ghost" asChild>
            <a href="#/">Back</a>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  const l = stats.lifetime;
  const a = stats.active;
  const kinds: [string, string][] = [
    ["text", "Text"],
    ["image", "Images"],
    ["file", "Files"],
    ["video", "Videos"],
  ];
  const series = buildSeries(stats.daily, 14);
  const maxDay = Math.max(1, ...series.map((p) => p.count));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-heading text-xl font-semibold tracking-tight">
            Service statistics
          </h2>
          <p className="text-sm text-muted-foreground">Aggregate metadata only</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={onPurge} disabled={busy}>
            Purge expired now
          </Button>
          <Button variant="outline" size="sm" onClick={() => load(token)} disabled={busy}>
            {busy ? "…" : "Refresh"}
          </Button>
          <Button variant="ghost" size="sm" onClick={logout}>
            Lock
          </Button>
        </div>
      </div>

      {purgeMsg && <p className="text-sm text-muted-foreground">{purgeMsg}</p>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Stat label="Storage used" value={humanSize(stats.storage.db_file_bytes)} sub="SQLite file on disk" />
        <Stat label="Active links" value={String(a.count)} sub={`${humanSize(a.bytes)} encrypted`} />
        <Stat label="Created — all time" value={String(l.created_total)} sub={`${humanSize(l.bytes_created_total)} total`} />
        <Stat label="Opens served" value={String(l.opens_total)} sub="successful decrypt fetches" />
        <Stat label="Burned" value={String(l.burned_total)} sub="reached open limit" />
        <Stat label="Expired" value={String(l.expired_total)} sub="removed after TTL" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Created — last 14 days</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-24 items-end gap-1.5">
            {series.map((p) => (
              <div
                className="flex min-w-0 flex-1 flex-col items-center gap-1.5"
                key={p.day}
                title={`${p.count} on ${p.day}`}
              >
                <div className="flex h-[74px] w-full items-end">
                  <div
                    className="w-full rounded-t-sm bg-primary"
                    style={{ height: `${(p.count / maxDay) * 100}%`, minHeight: 2 }}
                  />
                </div>
                <span className="font-mono text-[10px] text-muted-foreground">{p.label}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>By type — all time</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {kinds.map(([key, label]) => {
            const created = l.by_kind[key] ?? 0;
            const activeCount = a.by_kind[key] ?? 0;
            const max = Math.max(1, l.created_total);
            return (
              <div className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-3" key={key}>
                <span className="text-sm text-muted-foreground">{label}</span>
                <Progress value={(created / max) * 100} />
                <span className="font-mono text-xs">
                  {created}{" "}
                  <span className="text-muted-foreground">· {activeCount} active</span>
                </span>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            Active links — {active.total}
            {active.total > active.items.length ? ` (showing ${active.items.length})` : ""}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {active.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active links.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Expires in</TableHead>
                  <TableHead>Opens</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {active.items.map((it) => (
                  <TableRow key={it.id}>
                    <TableCell className="font-medium">{it.kind}</TableCell>
                    <TableCell>{humanSize(it.size)}</TableCell>
                    <TableCell className="text-muted-foreground">{agoLabel(it.created_at)}</TableCell>
                    <TableCell
                      className={formatTtl(it.expires_at) === "expired" ? "text-destructive" : undefined}
                    >
                      {formatTtl(it.expires_at)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {it.views}
                      {it.max_views !== null ? ` / ${it.max_views}` : ""}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Button variant="ghost" asChild>
        <a href="#/">Back to app</a>
      </Button>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="font-heading text-2xl font-semibold tracking-tight">
          {value}
        </CardTitle>
        {sub && <CardDescription>{sub}</CardDescription>}
      </CardHeader>
    </Card>
  );
}
