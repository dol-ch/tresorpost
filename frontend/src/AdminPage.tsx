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
      <div className="card admin-gate">
        <p className="eyebrow">
          <span className="num">•</span>&nbsp;&nbsp;— Admin
        </p>
        <h2>Dashboard access</h2>
        <p className="muted small">
          Enter the admin token (server <code>ADMIN_TOKEN</code>). Only aggregate
          metadata is shown — never any content or keys.
        </p>
        <form
          className="share-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (token) load(token);
          }}
        >
          <input
            className="share-input"
            type="password"
            placeholder="admin token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoFocus
          />
          <button className="btn primary" type="submit" disabled={busy || !token}>
            {busy ? "Checking…" : "Unlock"}
          </button>
        </form>
        {error && <p className="error">{error}</p>}
        <div className="actions">
          <a className="btn ghost" href="#/">
            Back
          </a>
        </div>
      </div>
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
    <div className="admin">
      <div className="admin-head">
        <div>
          <p className="eyebrow">
            <span className="num">•</span>&nbsp;&nbsp;— Admin
          </p>
          <h2>Service statistics</h2>
        </div>
        <div className="actions">
          <button className="btn ghost" onClick={onPurge} disabled={busy}>
            Purge expired now
          </button>
          <button className="btn ghost" onClick={() => load(token)} disabled={busy}>
            {busy ? "…" : "Refresh"}
          </button>
          <button className="btn ghost" onClick={logout}>
            Lock
          </button>
        </div>
      </div>

      {purgeMsg && <p className="muted small purge-msg">{purgeMsg}</p>}

      <div className="stat-grid">
        <Stat label="Storage used" value={humanSize(stats.storage.db_file_bytes)} sub="SQLite file on disk" />
        <Stat label="Active links" value={String(a.count)} sub={`${humanSize(a.bytes)} encrypted`} />
        <Stat label="Created — all time" value={String(l.created_total)} sub={`${humanSize(l.bytes_created_total)} total`} />
        <Stat label="Opens served" value={String(l.opens_total)} sub="successful decrypt fetches" />
        <Stat label="Burned" value={String(l.burned_total)} sub="reached open limit" />
        <Stat label="Expired" value={String(l.expired_total)} sub="removed after TTL" />
      </div>

      <div className="stat-block">
        <span className="eyebrow">Created — last 14 days</span>
        <div className="chart">
          {series.map((p) => (
            <div className="chart-col" key={p.day} title={`${p.count} on ${p.day}`}>
              <div className="chart-bar-wrap">
                <div
                  className="chart-bar"
                  style={{ height: `${(p.count / maxDay) * 100}%` }}
                />
              </div>
              <span className="chart-label">{p.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="stat-block">
        <span className="eyebrow">By type — all time</span>
        <div className="bars">
          {kinds.map(([key, label]) => {
            const created = l.by_kind[key] ?? 0;
            const activeCount = a.by_kind[key] ?? 0;
            const max = Math.max(1, l.created_total);
            return (
              <div className="bar-row" key={key}>
                <span className="bar-label">{label}</span>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${(created / max) * 100}%` }} />
                </div>
                <span className="bar-val">
                  {created} <span className="muted">· {activeCount} active</span>
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="stat-block">
        <span className="eyebrow">
          Active links — {active.total}
          {active.total > active.items.length ? ` (showing ${active.items.length})` : ""}
        </span>
        {active.items.length === 0 ? (
          <p className="muted small">No active links.</p>
        ) : (
          <div className="active-table">
            <div className="active-row active-head">
              <span>Type</span>
              <span>Size</span>
              <span>Created</span>
              <span>Expires in</span>
              <span>Opens</span>
            </div>
            {active.items.map((it) => (
              <div className="active-row" key={it.id}>
                <span className="active-kind">{it.kind}</span>
                <span>{humanSize(it.size)}</span>
                <span className="muted">{agoLabel(it.created_at)}</span>
                <span className={formatTtl(it.expires_at) === "expired" ? "ttl-exp" : "ttl"}>
                  {formatTtl(it.expires_at)}
                </span>
                <span className="muted">
                  {it.views}
                  {it.max_views !== null ? ` / ${it.max_views}` : ""}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="actions">
        <a className="btn ghost" href="#/">
          Back to app
        </a>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stat-card">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  );
}
