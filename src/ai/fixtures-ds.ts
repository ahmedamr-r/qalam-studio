/**
 * Recorded output of the two extraction passes on public/samples/lumen-wallet.png (a fictional
 * screen made for this prototype). Used when AI isn't configured, and labelled as a sample.
 */
import type { FoundationsResult, GuideResult } from "./ds-schemas";
import foundations from "./fixtures/ds-foundations.json";
import guide from "./fixtures/ds-guide.json";

export const SAMPLE_DS_FOUNDATIONS = foundations as unknown as FoundationsResult;
export const SAMPLE_DS_GUIDE = guide as unknown as GuideResult;
