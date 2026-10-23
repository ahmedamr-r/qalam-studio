import { AXES, type AxisId, type Domain, type ReadBack } from "./knobs";

/** A read-back built from axis values (tests, and the starting point for sample briefs). */
export function readOf(domain: Domain, values: Partial<Record<AxisId, number>> = {}, extra: Partial<ReadBack> = {}): ReadBack {
  const axes = Object.fromEntries(AXES.map((a) => [a, { value: values[a] ?? 0.5, confidence: 0.7, evidence: [] as string[] }])) as unknown as ReadBack["axes"];
  return {
    summary: "A product.",
    adjectives: ["clear", "warm", "trustworthy"],
    domain,
    audience: "people",
    platform: "mobile",
    scripts: ["latin"],
    brandHex: null,
    axes,
    admired: [],
    avoided: [],
    language: { principles: [{ title: "Clarity", body: "Say it plainly." }], voice: "Plain.", dos: [], donts: [] },
    slots: { brand: "Lumen", currency: "AED", city: "Dubai", people: ["Sara Haddad", "Omar Nasser", "Lina Farouk"], places: ["Dubai Marina", "Downtown", "Business Bay"] },
    ...extra,
  };
}
