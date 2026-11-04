import { StartFlow } from "../start/StartFlow";

/** The welcome: who it's for, then what to read (../start). Opened when there's no organization yet and for a new one from the organization menu (?new=1). */
export default function WelcomePage() {
  return <StartFlow />;
}
