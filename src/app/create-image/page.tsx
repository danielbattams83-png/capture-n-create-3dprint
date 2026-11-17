import WorkspaceRoute from "@/components/workspace-route";

const highlights = [
  {
    label: "Compose",
    title: "Shape the source image",
    description:
      "Prepare visual concepts with the subject, material, angle, and lighting needed for a strong model.",
  },
  {
    label: "Isolate",
    title: "Keep the subject clear",
    description:
      "Background-aware preparation keeps the object readable before it enters the 3D workflow.",
  },
  {
    label: "Continue",
    title: "Move into 3D",
    description:
      "Carry an approved image forward to model generation without losing the intended composition.",
  },
] as const;

export default function CreateImagePage() {
  return (
    <WorkspaceRoute
      eyebrow="Image workspace"
      title="Start with a clearer idea."
      description="A focused route for preparing imagery before it becomes a physical object."
      highlights={highlights}
    />
  );
}
