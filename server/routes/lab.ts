import { labOn } from "../lab";

/** What v0.1 hides that's on here (src/lab.ts): true for everything, or the features named. */
export async function GET() {
  return Response.json({ on: await labOn() });
}
