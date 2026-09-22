import {
  providerEventSchema,
  providerUsageSchema,
  type ProviderEvent,
  type ProviderRequest,
  type ProviderUsage,
} from "@agentmeter/contracts";

export interface ProviderAdapter {
  estimateInputTokens(input: string): number;
  getUsage?(providerRequestId: string): Promise<ProviderUsage | null>;
  stream(
    request: ProviderRequest,
    signal: AbortSignal,
  ): AsyncIterable<ProviderEvent>;
}

export class SimulatorProvider implements ProviderAdapter {
  constructor(private readonly baseUrl: string) {}

  estimateInputTokens(input: string): number {
    return Math.max(1, Math.ceil(input.length / 4));
  }

  async getUsage(providerRequestId: string): Promise<ProviderUsage | null> {
    const response = await fetch(
      `${this.baseUrl}/v1/usage/${encodeURIComponent(providerRequestId)}`,
    );
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`Provider usage lookup returned ${response.status}`);
    }
    return providerUsageSchema.parse(await response.json());
  }

  async *stream(
    request: ProviderRequest,
    signal: AbortSignal,
  ): AsyncIterable<ProviderEvent> {
    const response = await fetch(`${this.baseUrl}/v1/stream`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
      signal,
    });
    if (!response.ok || !response.body) {
      throw new Error(`Provider returned ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim()) {
          yield providerEventSchema.parse(JSON.parse(line));
        }
      }
      if (done) break;
    }
    if (buffer.trim()) {
      yield providerEventSchema.parse(JSON.parse(buffer));
    }
  }
}
