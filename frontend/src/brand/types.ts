import type { ComponentType } from "react";

export interface BrandLink {
  label: string;
  href: string;
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
}
