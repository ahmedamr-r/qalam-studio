import StudioLoader from "@/ui/StudioLoader";

/** A Discovery project: the board for the product's opportunity tree. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <StudioLoader projectId={id} mode="discovery" />;
}
