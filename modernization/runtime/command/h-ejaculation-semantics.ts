/** Source-backed meanings for TCVAR:2 sites and TCVAR:50 ejaculation markers. */
export type HEjaculationSiteCode = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13;

export const H_EJACULATION_SITES: Readonly<Record<HEjaculationSiteCode, {
  kind: "ejaculation-site" | "stimulated-side";
  label: string;
}>> = {
  1: { kind: "ejaculation-site", label: "阴道内" },
  2: { kind: "ejaculation-site", label: "肛门内" },
  3: { kind: "ejaculation-site", label: "手上" },
  4: { kind: "ejaculation-site", label: "口中" },
  5: { kind: "ejaculation-site", label: "胸部" },
  6: { kind: "ejaculation-site", label: "股间" },
  7: { kind: "ejaculation-site", label: "足部" },
  8: { kind: "ejaculation-site", label: "体表" },
  9: { kind: "ejaculation-site", label: "肛门奉仕" },
  10: { kind: "ejaculation-site", label: "道具" },
  11: { kind: "ejaculation-site", label: "触手" },
  12: { kind: "stimulated-side", label: "Ａ被刺激" },
  13: { kind: "stimulated-side", label: "Ｖ被刺激" },
};

export type HEjaculationMarkerBit = 0 | 8 | 20 | 21 | 22 | 23 | 24 | 26;

export const H_EJACULATION_MARKERS: Readonly<Record<HEjaculationMarkerBit, {
  label: string;
  route: "prank-sensitive" | "normal";
}>> = {
  0: { label: "避孕套或体外承诺失败", route: "prank-sensitive" },
  8: { label: "实际体外／体表结果", route: "normal" },
  20: { label: "手淫与口交组合", route: "normal" },
  21: { label: "乳交与口交组合", route: "normal" },
  22: { label: "六九式", route: "normal" },
  23: { label: "深喉插入", route: "prank-sensitive" },
  24: { label: "子宫口刺激", route: "prank-sensitive" },
  26: { label: "授乳", route: "normal" },
};

/** Upstream KOJO_MESSAGE_PALAMCNG_A2 checks marker bits in this order. */
const EJACULATION_KOJO_PRIORITY: readonly number[] = [
  0, 26, 24, 23, 22, 21, 20, 9, 8, 7, 6, 5, 4, 3, 2, 1,
];

export interface HEjaculationKojoRoute {
  kind: "A" | "A2";
  detail: string;
}

function hasBit(mask: number, bit: number): boolean {
  return Number.isFinite(mask) && mask >= 0 && Number.isInteger(bit) && bit >= 0 && bit <= 52
    && Math.floor(Math.trunc(mask) / (2 ** bit)) % 2 === 1;
}

export function addHEjaculationBit(mask: number, bit: number): number {
  const safeMask = Number.isFinite(mask) && mask >= 0 ? Math.trunc(mask) : 0;
  if (!Number.isInteger(bit) || bit < 0 || bit > 52) return safeMask;
  return hasBit(safeMask, bit) ? safeMask : safeMask + 2 ** bit;
}

export function hasHEjaculationBit(mask: number, bit: number): boolean {
  return hasBit(mask, bit);
}

export function ejaculationSiteInfo(value: number): {
  code: HEjaculationSiteCode;
  kind: "ejaculation-site" | "stimulated-side";
  label: string;
} | undefined {
  if (!Number.isInteger(value) || value < 1 || value > 13) return undefined;
  const code = value as HEjaculationSiteCode;
  return { code, ...H_EJACULATION_SITES[code] };
}

/** Map the upstream TFLAG:50 special-command selector to its TCVAR:50 bit. */
export function hEjaculationMarkerBitsForAction(
  specialCommand: number,
  commandNo: number,
): HEjaculationMarkerBit[] {
  const specialCommandBit: Readonly<Record<number, HEjaculationMarkerBit>> = {
    1: 22,
    5: 20,
    7: 24,
    12: 21,
    19: 26,
  };
  const bit = specialCommandBit[specialCommand];
  const bits = bit === undefined ? [] : [bit];
  if (commandNo === 140) bits.push(23);
  return bits;
}

/**
 * Resolve personal ejaculation dialogue routes from the receiver's marker mask.
 * Marker routes follow upstream precedence; the actual site is appended as a
 * fallback, keeping legacy saves (which may not have TCVAR:50 populated) usable.
 */
export function hEjaculationKojoRoutes(
  markerMask: number,
  siteValue: number,
  prank: boolean,
): HEjaculationKojoRoute[] {
  const routes: HEjaculationKojoRoute[] = [];
  const seen = new Set<string>();
  const push = (detail: string, route: "normal" | "prank-sensitive") => {
    const kind = route === "normal" ? "A" : prank ? "A2" : "A";
    const key = `${kind}:${detail}`;
    if (seen.has(key)) return;
    seen.add(key);
    routes.push({ kind, detail });
  };

  for (const bit of EJACULATION_KOJO_PRIORITY) {
    if (!hasBit(markerMask, bit)) continue;
    const route = (H_EJACULATION_MARKERS as Partial<Record<number, { route: "prank-sensitive" | "normal" }>>)[bit]?.route
      ?? ([1, 2, 3, 4, 5, 7].includes(bit) ? "prank-sensitive" : "normal");
    push(String(bit), route);
  }

  // Old modern saves encoded condom use as site -1. Preserve that route while
  // new settlements retain the actual site and store condom use in marker bit 0.
  if (siteValue === -1) push("0", "prank-sensitive");
  else {
    const site = ejaculationSiteInfo(siteValue);
    if (site) {
      const route = [1, 2, 3, 4, 5, 7].includes(site.code) ? "prank-sensitive" : "normal";
      push(String(site.code), route);
    }
  }
  return routes;
}

export function hEjaculationMarkerLabels(mask: number): string[] {
  return Object.entries(H_EJACULATION_MARKERS)
    .filter(([bit]) => hasBit(mask, Number(bit)))
    .map(([, marker]) => marker.label);
}
