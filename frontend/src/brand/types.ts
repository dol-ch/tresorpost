import type { ComponentType } from "react";

export interface BrandLink {
  label: string;
  href: string;
}

export interface BrandImprint {
  /** Operator name shown in bold on the Privacy page. */
  name: string;
  /** Address / location lines. */
  lines: string[];
  /** Optional homepage link. */
  href?: string;
}

export interface Brand {
  /** Product name, used for the document title. */
  name: string;
  /** Short tagline shown in the header. */
  tagline: string;
  /** Header wordmark / logo. */
  Wordmark: ComponentType;
  /** Footer links (e.g. source, homepage). */
  footerLinks: BrandLink[];
  /** Optional operator details shown on the Privacy page. Omit to hide the
   *  imprint card entirely (e.g. for a self-hosted overlay). */
  imprint?: BrandImprint;
  /** Optional short footer credit line, e.g. "Made with love in … by …". */
  footerCredit?: {
    flag?: ComponentType;
    text: string;
    linkLabel: string;
    linkHref: string;
  };
}
