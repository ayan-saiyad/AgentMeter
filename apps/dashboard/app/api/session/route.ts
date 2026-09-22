import { NextResponse } from "next/server";
import {
  sessionCookie,
  sessionValue,
  validAdminToken,
} from "../../../lib/auth";

export async function POST(request: Request) {
  const body = (await request.json()) as { token?: unknown };
  if (typeof body.token !== "string" || !validAdminToken(body.token)) {
    return NextResponse.json({ code: "INVALID_ADMIN_TOKEN" }, { status: 401 });
  }
  const response = NextResponse.json({ authenticated: true });
  response.cookies.set(sessionCookie, sessionValue(), {
    httpOnly: true,
    maxAge: 8 * 60 * 60,
    path: "/",
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}

export function DELETE() {
  const response = NextResponse.json({ authenticated: false });
  response.cookies.set(sessionCookie, "", { maxAge: 0, path: "/" });
  return response;
}
