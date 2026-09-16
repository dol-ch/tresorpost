import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { fetchConfig } from "./api";
import { MAX_FILE_BYTES, humanSize, uploadMaxBytes } from "./options";
import { useI18n, useT } from "./i18n";
import faqsDe from "./content/faqs.de.json";
import faqsEn from "./content/faqs.en.json";
import faqsUk from "./content/faqs.uk.json";
import type { Locale } from "./i18n";

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
      <h2 className="mb-1 font-heading text-base font-semibold tracking-tight">{q}</h2>
      <p className="text-[14.5px] leading-relaxed text-muted-foreground">{a}</p>
    </div>
  );
}

const FAQ_BY_LOCALE: Record<Locale, { q: string; a: string }[]> = {
  de: faqsDe,
  en: faqsEn,
  uk: faqsUk,
};

export function FaqPage() {
  const t = useT();
  const { locale } = useI18n();
  const base = FAQ_BY_LOCALE[locale];
  const [items, setItems] = useState(base);

  useEffect(() => {
    setItems(base);
    fetchConfig()
      .then((cfg) => {
        const cap = uploadMaxBytes(
          cfg.s3_enabled,
          cfg.max_s3_file_bytes,
          cfg.max_file_bytes || MAX_FILE_BYTES,
        );
        const a = t("faq.sizeA", { cap: humanSize(cap) });
        const q = t("faq.sizeQ");
        setItems(base.map((item) => (item.q === q ? { ...item, a } : item)));
      })
      .catch(() => {
        /* keep the static answer */
      });
  }, [base, t]);

  useEffect(() => {
    const id = "tresorpost-faq-jsonld";
    const script =
      document.getElementById(id) ??
      Object.assign(document.createElement("script"), { id, type: "application/ld+json" });
    script.textContent = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: items.map((item) => ({
        "@type": "Question",
        name: item.q,
        acceptedAnswer: { "@type": "Answer", text: item.a },
      })),
    });
    if (!script.parentNode) document.head.appendChild(script);
    return () => script.remove();
  }, [items]);

  return (
    <>
      <section className="mb-7">
        <h1 className="mb-3.5 font-heading text-[clamp(27px,7.6vw,40px)] leading-[1.1] font-extrabold tracking-tight">
          {t("faq.title")}
        </h1>
        <p className="max-w-[48ch] text-[17px] leading-snug text-muted-foreground">
          {t("faq.lead")}
        </p>
      </section>

      <Card className="mb-4">
        <CardContent className="flex flex-col gap-4.5">
          <Step num="1" title={t("faq.step1t")} body={t("faq.step1b")} />
          <div className="h-px bg-border" />
          <Step num="2" title={t("faq.step2t")} body={t("faq.step2b")} />
          <div className="h-px bg-border" />
          <Step num="3" title={t("faq.step3t")} body={t("faq.step3b")} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-4.5">
          {items.map((item, i) => (
            <div key={item.q}>
              {i > 0 ? <div className="mb-4.5 h-px bg-border" /> : null}
              <Qa q={item.q} a={item.a} />
            </div>
          ))}
        </CardContent>
      </Card>

      <Button className="mt-5 w-full max-w-70" asChild>
        <a href="/">{t("faq.send")}</a>
      </Button>
    </>
  );
}
