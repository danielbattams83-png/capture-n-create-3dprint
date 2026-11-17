import { Suspense } from "react";
import { Studio } from "../page";

async function RoutedStudio({
  searchParams,
}: {
  searchParams: PageProps<"/create-model">["searchParams"];
}) {
  const parameters = await searchParams;
  const asset = typeof parameters.asset === "string" ? parameters.asset : undefined;
  const creation =
    typeof parameters.creation === "string" ? parameters.creation : undefined;

  return <Studio initialAssetId={asset} initialCreationId={creation} />;
}

export default function CreateModelPage({
  searchParams,
}: PageProps<"/create-model">) {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-[#0b0d10] font-mono text-xs text-[#94a3b8]">
          Opening model studio…
        </main>
      }
    >
      <RoutedStudio searchParams={searchParams} />
    </Suspense>
  );
}
