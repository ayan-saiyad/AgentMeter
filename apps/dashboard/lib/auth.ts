import { createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const sessionCookie = "agentmeter_admin";

function digest(value: string): Buffer {
  return createHash("sha256")
    .update("agentmeter-dashboard\0")
    .update(value)
    .digest();
}

export function validAdminToken(value: string): boolean {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected || expected.length < 32) return false;
  return timingSafeEqual(digest(value), digest(expected));
}

export function sessionValue(): string {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return "";
  return digest(token).toString("hex");
}

export async function isAdmin(): Promise<boolean> {
  const value = (await cookies()).get(sessionCookie)?.value;
  const expected = sessionValue();
  if (!value || !expected || value.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(value), Buffer.from(expected));
}
