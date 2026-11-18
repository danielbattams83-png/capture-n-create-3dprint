import { NextResponse } from "next/server";

const SESSION_COOKIE = "studio_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export type StudioSession = {
  userId: string;
  isNew: boolean;
};

export function isStudioUserId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function readStudioSession(request: Request): StudioSession {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  if (match) {
    const userId = decodeURIComponent(match[1] ?? "");
    if (isStudioUserId(userId)) return { userId, isNew: false };
  }

  return { userId: crypto.randomUUID(), isNew: true };
}

export function withStudioSession<T extends Response>(
  response: T,
  session: StudioSession,
): T {
  if (!session.isNew) return response;
  if (!(response instanceof NextResponse)) return response;

  response.cookies.set(SESSION_COOKIE, session.userId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return response;
}
