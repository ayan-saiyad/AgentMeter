import { randomUUID } from "node:crypto";

const gateway = process.env.GATEWAY_URL ?? "http://127.0.0.1:4000";
const token = process.env.RUNTIME_KEY;
const attempts = Number(process.env.ATTEMPTS ?? 8);

if (!token) throw new Error("RUNTIME_KEY is required");

async function interruptedRun(index) {
  const controller = new AbortController();
  const response = await fetch(`${gateway}/v1/runs`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": `disconnect-${Date.now()}-${index}-${randomUUID()}`,
    },
    body: JSON.stringify({
      input: "disconnect verification",
      maxDurationMs: 5_000,
      maxOutputTokens: 100,
      metadata: { simulatorDelayMs: "100" },
      model: "simulator-v1",
      tools: [],
    }),
    signal: controller.signal,
  });
  if (!response.ok || !response.body) {
    throw new Error(`Admission failed with ${response.status}`);
  }
  const reader = response.body.getReader();
  const first = await reader.read();
  const text = new TextDecoder().decode(first.value);
  const match = text.match(/"runId":"([^"]+)"/);
  controller.abort();
  if (!match?.[1]) throw new Error("Run identifier was not streamed");
  return match[1];
}

const runIds = await Promise.all(
  Array.from({ length: attempts }, (_, index) => interruptedRun(index)),
);
await new Promise((resolve) => setTimeout(resolve, 1_000));
const terminal = new Set(["SETTLED", "EXPIRED", "RECONCILING"]);
const results = await Promise.all(
  runIds.map(async (runId) => {
    const response = await fetch(`${gateway}/v1/runs/${runId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const run = await response.json();
    return { runId, status: run.status };
  }),
);
const invalid = results.filter((run) => !terminal.has(run.status));
console.log(JSON.stringify({ attempts, invalid, results }, null, 2));
if (invalid.length > 0) process.exitCode = 1;
