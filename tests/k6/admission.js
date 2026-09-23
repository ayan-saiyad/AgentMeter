import http from "k6/http";
import { check } from "k6";
import exec from "k6/execution";

const gateway = __ENV.GATEWAY_URL || "http://127.0.0.1:4000";
const token = __ENV.RUNTIME_KEY;

export const options = {
  scenarios: {
    reservations: {
      executor: "shared-iterations",
      vus: Number(__ENV.VUS || 200),
      iterations: Number(__ENV.ITERATIONS || 1000),
      maxDuration: "2m",
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<2000"],
    http_req_failed: ["rate<0.02"],
  },
};

export default function () {
  const idempotency = `load-${exec.scenario.iterationInTest}-${exec.vu.idInTest}`;
  const response = http.post(
    `${gateway}/v1/runs`,
    JSON.stringify({
      input: "reservation load",
      maxDurationMs: 10_000,
      maxOutputTokens: 100,
      model: "simulator-v1",
      tools: [],
    }),
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotency,
      },
      responseCallback: http.expectedStatuses(200, 202, 429),
      timeout: "15s",
    },
  );
  check(response, {
    "accepted or limited": (value) => [200, 202, 429].includes(value.status),
  });
}
