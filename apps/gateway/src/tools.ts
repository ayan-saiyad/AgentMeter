import { createHash } from "node:crypto";
import { z } from "zod";

interface ToolDefinition {
  input: z.ZodType<Record<string, unknown>>;
  execute: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

const tools: Record<string, ToolDefinition> = {
  "inventory.lookup": {
    input: z.object({ sku: z.string().min(1).max(100) }),
    execute: ({ sku }) =>
      Promise.resolve({ available: true, quantity: 24, sku }),
  },
  "weather.lookup": {
    input: z.object({ location: z.string().min(1).max(200) }),
    execute: ({ location }) =>
      Promise.resolve({
        condition: "clear",
        location,
        temperatureCelsius: 21,
      }),
  },
};

export function digestToolArguments(value: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export async function executeManagedTool(
  name: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const tool = tools[name];
  if (!tool) throw new Error("TOOL_NOT_REGISTERED");
  return tool.execute(tool.input.parse(input));
}
