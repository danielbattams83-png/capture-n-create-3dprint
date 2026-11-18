import { NextResponse } from "next/server";
import { listResumableJobs, toPublicJob } from "@/lib/jobs";
import { isSameOrigin } from "@/lib/meshy";
import { readStudioSession, withStudioSession } from "@/lib/session";

export async function GET(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  }

  const session = readStudioSession(request);
  try {
    const jobs = await listResumableJobs(session.userId);
    const response = NextResponse.json({ jobs: jobs.map(toPublicJob) });
    response.headers.set("Cache-Control", "no-store");
    return withStudioSession(response, session);
  } catch (error) {
    console.error("Could not load active generation jobs.", error);
    const message = error instanceof Error && error.message === "DATABASE_URL is not configured."
      ? "Job storage is not configured."
      : "Unable to load active generation jobs.";
    return withStudioSession(
      NextResponse.json({ error: message }, { status: 500 }),
      session,
    );
  }
}
