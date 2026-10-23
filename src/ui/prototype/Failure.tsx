import { Component, type ReactNode } from "react";
import { TriangleAlert } from "lucide-react";

/** A runtime error in the prototype shows in place of the device instead of taking the studio down. */
export class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return <Failure title="The prototype stopped" message={this.state.error.message} />;
  }
}

export function Failure({ title, message }: { title: string; message: string }) {
  return (
    <div className="flex w-[360px] flex-col gap-[8px] rounded-lg bg-panel p-[16px] text-body text-fg shadow-popover">
      <p className="flex items-center gap-[8px] font-semibold">
        <TriangleAlert size={14} className="text-danger" /> {title}
      </p>
      <p className="font-mono text-caption break-words text-fg-muted">{message}</p>
    </div>
  );
}
