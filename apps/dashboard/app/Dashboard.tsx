"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DashboardData } from "../lib/types";

function dollars(value: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(Number(value) / 1_000_000);
}

function compactId(value: string): string {
  return value.slice(0, 8);
}

export function Dashboard({ initial }: { initial: DashboardData }) {
  const [data, setData] = useState(initial);
  const [policyMessage, setPolicyMessage] = useState("");

  useEffect(() => {
    const timer = window.setInterval(() => {
      void fetch("/api/overview", { cache: "no-store" })
        .then((response) => (response.ok ? response.json() : null))
        .then((next: DashboardData | null) => {
          if (next) setData(next);
        });
    }, 5_000);
    return () => window.clearInterval(timer);
  }, []);

  const chart = useMemo(
    () =>
      data.daily.map((item) => ({
        ...item,
        cost: Number(item.cost) / 1_000_000,
        label: item.day.slice(5),
      })),
    [data.daily],
  );

  async function savePolicy(bindingId: string, rules: string) {
    setPolicyMessage("Saving…");
    try {
      const parsed: unknown = JSON.parse(rules);
      const response = await fetch(`/api/policies/${bindingId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rules: parsed }),
      });
      if (!response.ok) throw new Error("Policy update failed");
      setPolicyMessage("Policy published.");
      const refreshed = await fetch("/api/overview", { cache: "no-store" });
      if (refreshed.ok) setData((await refreshed.json()) as DashboardData);
    } catch {
      setPolicyMessage(
        "The policy could not be saved. Check the JSON and limits.",
      );
    }
  }

  async function logout() {
    await fetch("/api/session", { method: "DELETE" });
    window.location.reload();
  }

  return (
    <main className="dashboard-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark small">AM</span>
          <span>AgentMeter</span>
        </div>
        <div className="tenant">
          <span className="live-dot" />
          {data.tenant.name}
          <button className="quiet" onClick={() => void logout()}>
            Sign out
          </button>
        </div>
      </header>

      <section className="hero">
        <div>
          <p className="eyebrow">RUNTIME GOVERNANCE</p>
          <h1>Operations overview</h1>
          <p className="muted">
            Budget, policy, execution, and settlement state in one place.
          </p>
        </div>
        <p className="updated">
          Updated {new Date(data.generatedAt).toLocaleTimeString()}
        </p>
      </section>

      <section className="metric-grid">
        <article className="metric accent">
          <span>Available</span>
          <strong>{dollars(data.budget.available)}</strong>
          <small>of {dollars(data.budget.limit)}</small>
        </article>
        <article className="metric">
          <span>Reserved</span>
          <strong>{dollars(data.budget.reserved)}</strong>
          <small>{data.budget.active} active runs</small>
        </article>
        <article className="metric">
          <span>Spent</span>
          <strong>{dollars(data.budget.spent)}</strong>
          <small>forecast {dollars(data.forecast)}</small>
        </article>
        <article className="metric">
          <span>Error rate</span>
          <strong>{(data.operations.errorRate * 100).toFixed(2)}%</strong>
          <small>
            {data.operations.openReconciliations} open reconciliations
          </small>
        </article>
      </section>

      <section className="content-grid">
        <article className="panel wide">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">TREND</p>
              <h2>Spend and run volume</h2>
            </div>
            <span>Last 30 days</span>
          </div>
          <div className="chart">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chart}>
                <CartesianGrid stroke="#243248" vertical={false} />
                <XAxis dataKey="label" stroke="#8492a6" />
                <YAxis yAxisId="left" stroke="#8492a6" />
                <YAxis yAxisId="right" orientation="right" stroke="#8492a6" />
                <Tooltip
                  contentStyle={{
                    background: "#111b2b",
                    border: "1px solid #2d3b52",
                  }}
                />
                <Line
                  yAxisId="left"
                  dataKey="cost"
                  stroke="#55e6a5"
                  strokeWidth={3}
                  dot={false}
                />
                <Bar
                  yAxisId="right"
                  dataKey="runs"
                  fill="#526b94"
                  opacity={0.55}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </article>
        <article className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">LATENCY</p>
              <h2>Gateway percentiles</h2>
            </div>
          </div>
          <div className="latency-list">
            <div>
              <span>p50</span>
              <strong>{data.operations.p50LatencyMs ?? "—"} ms</strong>
            </div>
            <div>
              <span>p95</span>
              <strong>{data.operations.p95LatencyMs ?? "—"} ms</strong>
            </div>
            <div>
              <span>p99</span>
              <strong>{data.operations.p99LatencyMs ?? "—"} ms</strong>
            </div>
            <div>
              <span>Settlement avg</span>
              <strong>{data.operations.settlementDelayMs ?? "—"} ms</strong>
            </div>
          </div>
        </article>
      </section>

      <section className="content-grid thirds">
        <Breakdown
          title="Spend by application"
          items={data.spendByApplication}
        />
        <Breakdown title="Spend by model" items={data.spendByModel} />
        <article className="panel">
          <div className="panel-heading">
            <h2>Tool activity</h2>
          </div>
          <div className="rank-list">
            {data.spendByTool.length ? (
              data.spendByTool.map((item) => (
                <div key={item.name}>
                  <span>
                    {item.name}
                    <small>{item.uses} calls</small>
                  </span>
                  <strong>{dollars(item.cost)}</strong>
                </div>
              ))
            ) : (
              <p className="empty">No tool calls yet.</p>
            )}
          </div>
        </article>
      </section>

      <section className="content-grid">
        <article className="panel wide">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">EXECUTION</p>
              <h2>Recent runs</h2>
            </div>
            <span>
              {data.operations.pendingSettlements} settlements pending
            </span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Run</th>
                  <th>Application</th>
                  <th>Model</th>
                  <th>Status</th>
                  <th>Cost</th>
                  <th>Started</th>
                </tr>
              </thead>
              <tbody>
                {data.recentRuns.map((run) => (
                  <tr key={run.id}>
                    <td className="mono">{compactId(run.id)}</td>
                    <td>{run.application}</td>
                    <td>{run.model}</td>
                    <td>
                      <span className={`status ${run.status.toLowerCase()}`}>
                        {run.status}
                      </span>
                    </td>
                    <td>{dollars(run.cost)}</td>
                    <td>{new Date(run.createdAt).toLocaleTimeString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
        <article className="panel feed">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">LIVE</p>
              <h2>Event feed</h2>
            </div>
          </div>
          {data.live.length ? (
            data.live.slice(0, 12).map((event) => (
              <div className="feed-item" key={event.id}>
                <span className="event-dot" />
                <div>
                  <strong>{event.type}</strong>
                  <small>
                    {compactId(event.runId)} ·{" "}
                    {event.timestamp
                      ? new Date(event.timestamp).toLocaleTimeString()
                      : "now"}
                  </small>
                </div>
              </div>
            ))
          ) : (
            <p className="empty">Waiting for runtime events.</p>
          )}
        </article>
      </section>

      <section className="content-grid">
        <article className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">ADMISSION</p>
              <h2>Rejection reasons</h2>
            </div>
          </div>
          <div className="chart short">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.rejections} layout="vertical">
                <XAxis type="number" hide />
                <YAxis
                  dataKey="reason"
                  type="category"
                  width={145}
                  stroke="#8492a6"
                  tick={{ fontSize: 11 }}
                />
                <Tooltip
                  contentStyle={{
                    background: "#111b2b",
                    border: "1px solid #2d3b52",
                  }}
                />
                <Bar dataKey="count" fill="#ffb86b" radius={[0, 5, 5, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </article>
        <article className="panel wide">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">POLICY</p>
              <h2>Published controls</h2>
            </div>
            <span>{policyMessage}</span>
          </div>
          {data.policies.map((policy) => (
            <PolicyEditor
              key={policy.bindingId}
              policy={policy}
              onSave={savePolicy}
            />
          ))}
        </article>
      </section>
    </main>
  );
}

function Breakdown({
  title,
  items,
}: {
  title: string;
  items: Array<{ cost: string; name: string }>;
}) {
  return (
    <article className="panel">
      <div className="panel-heading">
        <h2>{title}</h2>
      </div>
      <div className="rank-list">
        {items.length ? (
          items.map((item) => (
            <div key={item.name}>
              <span>{item.name}</span>
              <strong>{dollars(item.cost)}</strong>
            </div>
          ))
        ) : (
          <p className="empty">No settled spend yet.</p>
        )}
      </div>
    </article>
  );
}

function PolicyEditor({
  policy,
  onSave,
}: {
  policy: DashboardData["policies"][number];
  onSave: (id: string, rules: string) => Promise<void>;
}) {
  const [rules, setRules] = useState(JSON.stringify(policy.rules, null, 2));
  return (
    <div className="policy-editor">
      <div>
        <strong>{policy.name}</strong>
        <small>version {policy.version}</small>
      </div>
      <textarea
        aria-label={`${policy.name} rules`}
        value={rules}
        onChange={(event) => setRules(event.target.value)}
      />
      <button onClick={() => void onSave(policy.bindingId, rules)}>
        Publish new version
      </button>
    </div>
  );
}
