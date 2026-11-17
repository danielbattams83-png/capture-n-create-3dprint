import WorkspaceRoute from "@/components/workspace-route";

const highlights = [
  {
    label: "Describe",
    title: "Prompt the surface",
    description:
      "Describe color, material, finish, and wear to establish a precise texture direction.",
  },
  {
    label: "Generate",
    title: "Watch progress live",
    description:
      "Meshy task progress remains visible while the new material is generated and downloaded.",
  },
  {
    label: "Apply",
    title: "Keep your viewpoint",
    description:
      "Hot-swap the textured GLB in the active viewport without resetting the camera angle.",
  },
] as const;

export default function TexturesPage() {
  return (
    <WorkspaceRoute
      eyebrow="Texture studio"
      title="Give every surface a story."
      description="A dedicated route for creating and applying material treatments to active 3D models."
      highlights={highlights}
    />
  );
}
