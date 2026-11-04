import { Onboarding } from "../onboarding/Onboarding";
import { StartFlow } from "../start/StartFlow";

/**
 * The welcome: who it's for, then what to read (../start). Opened when there's no organization yet
 * and for a new one from the organization menu (?new=1). Setting it up in detail (?full=1, ?for=) is
 * the conversation with Qalam AI in panels (../onboarding), and so is checking the setup again
 * (?verify=1), which only tests and reports.
 */
export default function WelcomePage() {
  const q = new URLSearchParams(window.location.search);
  return q.has("full") || q.has("for") || q.has("verify") ? <Onboarding route="welcome" /> : <StartFlow />;
}
