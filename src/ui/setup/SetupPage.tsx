import { Onboarding } from "../onboarding/Onboarding";

/**
 * Setting the organization up, goals first, as a conversation with Qalam AI (src/ui/onboarding):
 * through one of two doors, they write their goals down (./know.ts), or Qalam AI reads what they
 * write about the company, pushes back, asks, and proposes the goals, the About and the products
 * line by line (./setup.ts), accepted in the So far panel. On the first run (?first=1) it goes on
 * to which goals are theirs and what to connect; otherwise each goal they accepted can start a board.
 */
export default function SetupPage() {
  return <Onboarding route="setup" />;
}
