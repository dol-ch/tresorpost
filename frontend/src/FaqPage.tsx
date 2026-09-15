import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

function Step({ num, title, body }: { num: string; title: string; body: string }) {
  return (
    <div className="flex items-start gap-3.5">
      <span className="flex size-7 flex-none items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--primary)_14%,transparent)] text-[13.5px] font-bold text-primary">
        {num}
      </span>
      <div>
        <div className="mb-1 text-base font-semibold tracking-tight">{title}</div>
        <p className="text-[14.5px] leading-relaxed text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}

function Qa({ q, a }: { q: string; a: string }) {
  return (
    <div>
      <div className="mb-1 text-base font-semibold tracking-tight">{q}</div>
      <p className="text-[14.5px] leading-relaxed text-muted-foreground">{a}</p>
    </div>
  );
}

export function FaqPage() {
  return (
    <>
      <section className="mb-7">
        <h1 className="mb-3.5 font-heading text-[clamp(27px,7.6vw,40px)] leading-[1.1] font-extrabold tracking-tight">
          How it works
        </h1>
        <p className="max-w-[48ch] text-[17px] leading-snug text-muted-foreground">
          Three steps, no account, nothing readable ever leaves your device.
        </p>
      </section>

      <Card className="mb-4">
        <CardContent className="flex flex-col gap-4.5">
          <Step
            num="1"
            title="You write, your browser encrypts"
            body="A random 256-bit key is generated on your device and never sent anywhere. The server only ever receives ciphertext."
          />
          <div className="h-px bg-border" />
          <Step
            num="2"
            title="The key travels in the link"
            body="Everything after the # stays in the browser — it is never part of the request. Send the link over any channel you already trust."
          />
          <div className="h-px bg-border" />
          <Step
            num="3"
            title="It opens once, then disappears"
            body="After the last allowed open, or when the timer runs out, the ciphertext is deleted. Nothing is archived."
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-4.5">
          <Qa
            q="What can the server see?"
            a="Ciphertext, an expiry timestamp and a counter of remaining opens. No key, no plaintext, no filenames."
          />
          <div className="h-px bg-border" />
          <Qa
            q={"What does “quantum-safe” mean here?"}
            a="A 256-bit symmetric key stays far out of reach of Grover's algorithm, the best known quantum attack against it — the effective security only drops to ~128 bits."
          />
          <div className="h-px bg-border" />
          <Qa
            q="How large can a file be?"
            a="Images, video and files are limited by the server operator (5 MB by default, more with S3 configured). Text notes have no practical limit."
          />
          <div className="h-px bg-border" />
          <Qa
            q="Can I delete a note before it is read?"
            a="Yes — keep the private delete link you get after creating a note, and destroy it at any time."
          />
          <div className="h-px bg-border" />
          <Qa q="Do I need an account?" a="No. There is no sign-up, no analytics and no tracking cookie." />
          <div className="h-px bg-border" />
          <Qa
            q="Can I email the link?"
            a="If the operator enabled SMTP, yes — after creating a note you can send the share URL. That message includes the key in the link, so the mail provider can see it. Limited to 3 sends per minute per IP."
          />
          <div className="h-px bg-border" />
          <Qa
            q="Where is this hosted?"
            a="Sovereign Swiss infrastructure: tresorpost.ch is a Swiss domain, the app and object storage run in Zurich, and there is no analytics. Ciphertext is not replicated outside the country. Opening a link still delivers it to the recipient's device, wherever they are. Emailing a share URL sends that message through SMTP (see above)."
          />
        </CardContent>
      </Card>

      <Button className="mt-5 w-full max-w-70" asChild>
        <a href="#/">Send a secret</a>
      </Button>
    </>
  );
}
