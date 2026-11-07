import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setLab } from "./src/lab";

// Never the real ~/Qalam: anything a test writes to this computer's settings (who answers, the engine)
// goes to a scratch home, unless the test points QALAM_HOME somewhere of its own.
process.env.QALAM_HOME ??= mkdtempSync(path.join(tmpdir(), "qalam-test-home-"));

// Tests cover the whole app: what v0.1 hides (src/lab.ts) is on unless a test turns it off.
setLab(true);
