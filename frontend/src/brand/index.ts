// Brand resolution.


import { brand as defaultBrand } from "./default";
import type { Brand } from "./types";

const overrides = import.meta.glob<{ brand: Brand }>("./private/index.tsx", {
    eager: true,
});

const privateBrand = Object.values(overrides)[0]?.brand;

export const brand: Brand = privateBrand ?? defaultBrand;
export type { Brand } from "./types";
