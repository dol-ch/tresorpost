import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Kicker } from "@/components/kit";
import { brand } from "./brand";

function CheckRow({ children }: { children: string }) {
  return (
    <div className="flex items-start gap-2.5 text-[14.5px]">
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--primary)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="mt-0.5 flex-none"
        aria-hidden="true"
      >
        <polyline points="20 6 9 17 4 12" />
      </svg>
      {children}
    </div>
  );
}

function CrossRow({ children }: { children: string }) {
  return (
    <div className="flex items-start gap-2.5 text-[14.5px]">
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--muted-foreground)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="mt-0.5 flex-none"
        aria-hidden="true"
      >
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
      {children}
    </div>
  );
}

export function PrivacyPage() {
  return (
    <>
      <section className="mb-7">
        <h1 className="mb-3.5 font-heading text-[clamp(27px,7.6vw,40px)] leading-[1.1] font-extrabold tracking-tight">
          Privacy
        </h1>
        <p className="max-w-[48ch] text-[17px] leading-snug text-muted-foreground">
          Short version: the server holds ciphertext it cannot read, and forgets it
          on schedule. Swiss domain, Swiss storage, no analytics.
        </p>
      </section>

      <Card className="mb-4">
        <CardContent className="flex flex-col gap-4.5">
          <div>
            <Kicker className="mb-2.5">Stored on the server</Kicker>
            <div className="flex flex-col gap-2">
              <CheckRow>The encrypted payload</CheckRow>
              <CheckRow>Expiry time and remaining opens</CheckRow>
            </div>
          </div>
          <div className="h-px bg-border" />
          <div>
            <Kicker className="mb-2.5">Never stored</Kicker>
            <div className="flex flex-col gap-2">
              <CrossRow>Encryption keys — they stay in the URL fragment (unless you email the link)</CrossRow>
              <CrossRow>Plaintext, filenames or previews</CrossRow>
              <CrossRow>Accounts, analytics or advertising cookies</CrossRow>
              <CrossRow>Recipient addresses — email is handed to SMTP and not stored</CrossRow>
            </div>
          </div>
          <div className="h-px bg-border" />
          <div>
            <Kicker className="mb-2.5">Sovereign</Kicker>
            <div className="flex flex-col gap-2">
              <CheckRow>Swiss .ch domain</CheckRow>
              <CheckRow>App and object storage in Zurich</CheckRow>
              <CheckRow>No analytics, trackers or ad networks</CheckRow>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardContent className="flex flex-col gap-3.5">
          <Kicker>Switzerland</Kicker>
          <p className="text-[14.5px] leading-relaxed text-muted-foreground">
            tresorpost.ch is a Swiss domain. The application and object storage
            run in Zurich. There is no analytics and no third-country replica of
            ciphertext. Delivering a note still sends it to the recipient's
            browser. Emailing a share link uses SMTP, which is separate from this
            hosting.
          </p>
        </CardContent>
      </Card>

      {brand.imprint && (
        <Card>
          <CardContent className="flex flex-col gap-3.5">
            <Kicker>Imprint</Kicker>
            <div className="text-[14.5px] leading-relaxed text-muted-foreground">
              <div className="font-semibold text-foreground">{brand.imprint.name}</div>
              {brand.imprint.lines.map((line) => (
                <div key={line}>{line}</div>
              ))}
              {brand.imprint.href && (
                <a href={brand.imprint.href}>{brand.imprint.href.replace(/^https?:\/\//, "")}</a>
              )}
            </div>
            <div className="h-px bg-border" />
            <p className="text-[14.5px] leading-relaxed text-muted-foreground">
              The source code is public — audit it, or run your own instance.
            </p>
          </CardContent>
        </Card>
      )}

      <Button className="mt-5 w-full max-w-70" asChild>
        <a href="#/">Send a secret</a>
      </Button>
    </>
  );
}
