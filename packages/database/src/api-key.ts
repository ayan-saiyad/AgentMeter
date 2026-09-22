import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

export function digestApiKey(apiKey: string, pepper: string): string {
  return createHash("sha256")
    .update(pepper)
    .update("\0")
    .update(apiKey)
    .digest("hex");
}

export function createApiKey(prefix = "am_live"): {
  prefix: string;
  token: string;
} {
  const identifier = randomBytes(6).toString("hex");
  const secret = randomBytes(32).toString("base64url");
  return {
    prefix: `${prefix}_${identifier}`,
    token: `${prefix}_${identifier}_${secret}`,
  };
}

export async function findApiKey(
  database: PrismaClient,
  token: string,
  pepper: string,
) {
  const digest = digestApiKey(token, pepper);
  const record = await database.apiKey.findUnique({
    where: { secretDigest: digest },
    include: { application: true, tenant: true },
  });

  if (
    !record ||
    record.status !== "ACTIVE" ||
    record.tenant.status !== "ACTIVE" ||
    !record.application.enabled
  ) {
    return null;
  }
  if (record.expiresAt && record.expiresAt <= new Date()) {
    return null;
  }

  const actual = Buffer.from(record.secretDigest, "hex");
  const expected = Buffer.from(digest, "hex");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return null;
  }

  void database.apiKey
    .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
    .catch(() => undefined);
  return record;
}
