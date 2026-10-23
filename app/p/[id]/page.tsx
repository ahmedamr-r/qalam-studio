import StudioLoader from "@/ui/StudioLoader";

/** A Screens project: the canvas. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <StudioLoader projectId={id} mode="screens" />;
}
