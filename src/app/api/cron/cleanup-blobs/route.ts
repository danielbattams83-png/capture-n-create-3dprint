import { NextResponse } from "next/server";
import { deleteExpiredTemporaryBlobs } from "@/lib/blob-uploads";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const deleted = await deleteExpiredTemporaryBlobs(
      new Date(Date.now() - 24 * 60 * 60 * 1000),
    );
    return NextResponse.json({ deleted });
  } catch (error) {
    console.error("Scheduled temporary Blob cleanup failed.", error);
    return NextResponse.json({ error: "Blob cleanup failed." }, { status: 500 });
  }
}
