import { homedir } from "node:os";
import path from "node:path";

/*
 * Where Qalam keeps things on this computer, apart from any one organization: the organizations'
 * home (~/Qalam; QALAM_HOME moves it, for tests and browser checks) and, inside it, this
 * computer's own state (.qalam/: settings, usage). Kept tiny so anything can import it.
 */

export const qalamHome = () => path.resolve(process.env.QALAM_HOME || path.join(homedir(), "Qalam"));

/** This computer's own files: never an organization's, never shared through one. */
export const localDir = () => path.join(qalamHome(), ".qalam");
