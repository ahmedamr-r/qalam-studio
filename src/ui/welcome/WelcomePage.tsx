import { Onboarding } from "../onboarding/Onboarding";

/**
 * The welcome, like OpenClaw's QuickStart: Qalam finds the Claude this Mac already has and makes a
 * short real call to it, then they name the organization and go on to its goals (the setup page),
 * all as one conversation with Qalam AI (src/ui/onboarding). Opened when there's no organization
 * yet, for a new one from the organization menu (?new=1), and to check the setup again
 * (?verify=1), which only tests and reports.
 */
export default function WelcomePage() {
  return <Onboarding route="welcome" />;
}
