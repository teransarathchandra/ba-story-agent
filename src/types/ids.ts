import { monotonicFactory } from "ulid";

export const ID_PREFIXES = [
  "prj", "ses", "aud", "trs", "seg", "clm",
  "req", "sty", "acr", "oqn", "rec", "apv", "egr", "ckp", "lnk",
] as const;

export type IdPrefix = (typeof ID_PREFIXES)[number];

const monotonic = monotonicFactory();

export function newId(prefix: IdPrefix): string {
  return `${prefix}_${monotonic()}`;
}
