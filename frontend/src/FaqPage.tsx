import { useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import faqs from "./content/faqs.json";

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
      <h2 className="mb-1 text-base font-semibold tracking-tight">{q}</h2>
      <p className="text-[14.5px] leading-relaxed text-muted-foreground">{a}</p>
    </div>
  );
}

const FAQS: { q: string; a: string }[] = faqs;

export function FaqPage() {
  useEffect(() => {
    const id = "tresorpost-faq-jsonld";
    const script =
      document.getElementById(id) ??
      Object.assign(document.createElement("script"), { id, type: "application/ld+json" });
    script.textContent = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: FAQS.map((item) => ({
        "@type": "Question",
        name: item.q,
        acceptedAnswer: { "@type": "Answer", text: item.a },
      })),
    });
    if (!script.parentNode) document.head.appendChild(script);
    return () => script.remove();
  }, []);

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
          {FAQS.map((item, i) => (
            <div key={item.q}>
              {i > 0 ? <div className="mb-4.5 h-px bg-border" /> : null}
              <Qa q={item.q} a={item.a} />
            </div>
          ))}
        </CardContent>
      </Card>

      <Button className="mt-5 w-full max-w-70" asChild>
        <a href="/">Send a secret</a>
      </Button>
    </>
  );
}
