import { z } from "zod";

export const healthSchema = z.object({
  service: z.string(),
  status: z.enum(["ok", "degraded"]),
  version: z.string(),
});

export type Health = z.infer<typeof healthSchema>;

export const serviceVersion = "0.1.0";
