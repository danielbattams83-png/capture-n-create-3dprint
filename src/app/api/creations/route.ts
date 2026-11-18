import { NextResponse } from "next/server";
import {
  isOwnedCreationUrl,
  listSavedCreations,
  updateSavedCreationDimensions,
  upsertSavedCreation,
} from "@/lib/creations-repository";
import { isRecord, isSameOrigin, MeshyApiError } from "@/lib/meshy";
import { readStudioSession, withStudioSession } from "@/lib/session";

function readDimensions(value: unknown): { width: number; depth: number; height: number } | null {
  if (!isRecord(value)) return null;
  const width = Number(value.width);
  const depth = Number(value.depth);
  const height = Number(value.height);
  if (![width, depth, height].every((item) => Number.isFinite(item) && item > 0 && item <= 10000)) {
    return null;
  }
  return { width, depth, height };
}

function readCreationId(value: unknown): string | null {
  return typeof value === "string" && /^[\w.-]{8,160}$/.test(value) ? value : null;
}

export async function GET(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  }
  const session = readStudioSession(request);
  try {
    const creations = await listSavedCreations(session.userId);
    const response = NextResponse.json({ creations });
    response.headers.set("Cache-Control", "no-store");
    return withStudioSession(response, session);
  } catch (error) {
    console.error("Could not load saved creations.", error);
    return withStudioSession(
      NextResponse.json({ error: "Unable to load saved creations." }, { status: 500 }),
      session,
    );
  }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  }
  const session = readStudioSession(request);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return withStudioSession(
      NextResponse.json({ error: "Send the creation as JSON." }, { status: 400 }),
      session,
    );
  }
  if (!isRecord(body)) {
    return withStudioSession(
      NextResponse.json({ error: "The creation is invalid." }, { status: 400 }),
      session,
    );
  }
  const id = readCreationId(body.id);
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 160) : "";
  const dimensions = readDimensions(body.dimensions);
  const modelUrl = typeof body.modelUrl === "string" ? body.modelUrl : "";
  const thumbnailUrl = typeof body.thumbnailUrl === "string" ? body.thumbnailUrl : null;
  if (!id || !name || !dimensions || !isOwnedCreationUrl(session.userId, modelUrl)) {
    return withStudioSession(
      NextResponse.json({ error: "The creation metadata is invalid." }, { status: 400 }),
      session,
    );
  }
  if (thumbnailUrl && !isOwnedCreationUrl(session.userId, thumbnailUrl)) {
    return withStudioSession(
      NextResponse.json({ error: "The creation thumbnail is invalid." }, { status: 400 }),
      session,
    );
  }

  try {
    const creation = await upsertSavedCreation({
      userId: session.userId,
      id,
      name,
      modelUrl,
      thumbnailUrl,
      dimensions,
    });
    return withStudioSession(NextResponse.json({ creation }, { status: 201 }), session);
  } catch (error) {
    if (error instanceof MeshyApiError) {
      return withStudioSession(
        NextResponse.json({ error: error.message }, { status: error.status }),
        session,
      );
    }
    console.error("Could not save the creation.", error);
    return withStudioSession(
      NextResponse.json({ error: "Unable to save the creation." }, { status: 500 }),
      session,
    );
  }
}

export async function PATCH(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  }
  const session = readStudioSession(request);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return withStudioSession(
      NextResponse.json({ error: "Send the creation dimensions as JSON." }, { status: 400 }),
      session,
    );
  }
  if (!isRecord(body)) {
    return withStudioSession(
      NextResponse.json({ error: "The creation update is invalid." }, { status: 400 }),
      session,
    );
  }
  const id = readCreationId(body.id);
  const dimensions = readDimensions(body.dimensions);
  if (!id || !dimensions) {
    return withStudioSession(
      NextResponse.json({ error: "The creation update is invalid." }, { status: 400 }),
      session,
    );
  }
  try {
    const updated = await updateSavedCreationDimensions(session.userId, id, dimensions);
    return withStudioSession(NextResponse.json({ updated }), session);
  } catch (error) {
    console.error("Could not update the creation.", error);
    return withStudioSession(
      NextResponse.json({ error: "Unable to update the creation." }, { status: 500 }),
      session,
    );
  }
}
