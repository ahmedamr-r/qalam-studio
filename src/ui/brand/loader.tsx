import clsx from "clsx";

/** Brand loader: three nuqtas pulsing 120ms apart (static under reduced motion). */
export function NuqtaLoader({ label = "Loading", className }: { label?: string; className?: string }) {
  return (
    <span role="status" aria-label={label} className={clsx("q-loader", className)}>
      <i />
      <i />
      <i />
    </span>
  );
}
