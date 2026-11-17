import Link from "next/link";

type WorkspaceRouteProps = {
  eyebrow: string;
  title: string;
  description: string;
  highlights: readonly {
    label: string;
    title: string;
    description: string;
  }[];
};

export default function WorkspaceRoute({
  eyebrow,
  title,
  description,
  highlights,
}: WorkspaceRouteProps) {
  return (
    <main className="min-h-[calc(100vh-140px)] bg-[#0b0d10] px-5 py-12 text-white sm:px-8 sm:py-16">
      <div className="mx-auto max-w-6xl">
        <p className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-[#60a5fa]">
          {eyebrow}
        </p>
        <h1 className="mt-3 max-w-3xl text-[clamp(2.25rem,6vw,4.5rem)] font-bold leading-[0.98] tracking-[-0.055em]">
          {title}
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-7 text-[#aeb8c4] sm:text-lg">
          {description}
        </p>

        <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {highlights.map((highlight, index) => (
            <article
              key={highlight.title}
              className={`group relative min-h-56 overflow-hidden rounded-[22px] border border-white/[0.08] bg-[#182028] p-6 shadow-[0_12px_32px_-18px_rgba(0,0,0,0.6)] ${
                index === 0 ? "sm:col-span-2" : ""
              }`}
            >
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(420px_circle_at_80%_10%,rgba(96,165,250,0.18),transparent_60%)] opacity-60 transition duration-500 group-hover:opacity-100" />
              <div className="relative flex h-full flex-col">
                <span className="w-fit rounded-full border border-[#60a5fa]/35 bg-[#60a5fa]/10 px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-[#93c5fd]">
                  {highlight.label}
                </span>
                <h2 className="mt-auto pt-10 text-xl font-semibold tracking-[-0.025em]">
                  {highlight.title}
                </h2>
                <p className="mt-2 text-sm leading-6 text-[#aeb8c4]">
                  {highlight.description}
                </p>
              </div>
            </article>
          ))}
        </div>

        <Link
          href="/create-model"
          className="mt-8 inline-flex min-h-11 items-center justify-center rounded-xl bg-[#2563eb] px-5 text-sm font-semibold text-white transition hover:bg-[#1d4ed8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#93c5fd]"
        >
          Open model studio
        </Link>
      </div>
    </main>
  );
}
