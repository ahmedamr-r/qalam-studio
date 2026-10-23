import { SystemProjectLoader } from "@/ui/StudioLoader";

/** A Design system project: the brand interview, then the system it saved. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SystemProjectLoader projectId={id} />;
}
