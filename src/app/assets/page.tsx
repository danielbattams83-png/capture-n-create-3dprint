import WorkspaceRoute from "@/components/workspace-route";

const highlights = [
  {
    label: "Browse",
    title: "Find a starting point",
    description:
      "Explore downloadable, clearly licensed 3D assets before opening one in the model studio.",
  },
  {
    label: "Local",
    title: "Your Creations",
    description:
      "Return to models saved on this device and see when each local copy expires.",
  },
  {
    label: "Flexible",
    title: "Edit or export",
    description:
      "Take an asset into the editor, adjust its dimensions, texture it, or export it for printing.",
  },
] as const;

export default function AssetsPage() {
  return (
    <WorkspaceRoute
      eyebrow="Asset library"
      title="Models worth building on."
      description="A dedicated home for source models and your locally saved creations."
      highlights={highlights}
    />
  );
}
