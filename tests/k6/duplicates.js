import http from "k6/http";
import { check } from "k6";

const gateway = __ENV.GATEWAY_URL || "http://127.0.0.1:4000";
const token = __ENV.RUNTIME_KEY;
const key = __ENV.IDEMPOTENCY_KEY || "duplicate-load-request";

export const options = {
  vus: Number(__ENV.VUS || 50),
  iterations: Number(__ENV.ITERATIONS || 250),
  thresholds: { checks: ["rate==1"] },
};

export default function () {
  const response = http.post(
    `${gateway}/v1/runs`,
    JSON.stringify({
      input: "duplicate verification",
      maxDurationMs: 10_000,
      maxOutputTokens: 100,
      model: "simulator-v1",
      tools: [],
    }),
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Idempotency-Key": key,
      },
    },
  );
  check(response, {
    "same request accepted": (value) => [200, 202].includes(value.status),
    "run identifier returned": (value) => value.body.includes("runId"),
  });
}
