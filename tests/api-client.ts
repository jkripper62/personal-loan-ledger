import { afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app";

type AppOptions = Omit<Parameters<typeof createApp>[0], "dataDir">;
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action();
});

export async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "loan-api-"));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/** Starts the real HTTP server on a random port and keeps the session cookie like a browser tab. */
export async function startApp(dataDir: string, options: AppOptions = {}, session = { cookie: "", csrf: "" }) {
  const app = createApp({ clock: () => new Date("2026-10-01T06:00:00Z"), ...options, dataDir });
  await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  let closed = false;
  const close = async () => {
    if (!closed) await app.close();
    closed = true;
  };
  cleanup.push(close);
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("No HTTP address");
  const base = `http://127.0.0.1:${address.port}`;
  return {
    base,
    session,
    close,
    async request(path: string, method = "GET", data?: unknown, headers: Record<string, string> = {}) {
      const response = await fetch(base + path, {
        method,
        headers: {
          Origin: base,
          Cookie: session.cookie,
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrf,
          ...headers,
        },
        body: data === undefined ? undefined : typeof data === "string" ? data : JSON.stringify(data),
      });
      const setCookie = response.headers.get("set-cookie");
      if (setCookie) session.cookie = setCookie.split(";")[0];
      const text = await response.text();
      let body: Record<string, any> = {};
      try {
        body = JSON.parse(text);
      } catch {
        /* non-JSON response */
      }
      if (typeof body.csrfToken === "string") session.csrf = body.csrfToken;
      return { status: response.status, body, text };
    },
  };
}

export const owner = { email: "owner@example.com", password: "long-private-password" };
export const newLoan = (borrowerId: string, overrides: Record<string, unknown> = {}) => ({
  borrowerId,
  source: "new",
  principalCents: 1500000,
  openingInterestCents: 0,
  rateBps: 400,
  startDate: "2026-08-01",
  cycleStartDate: "2026-08-01",
  firstCycleEndDate: "2026-09-01",
  anchorDay: 1,
  dueDate: "2026-10-01",
  notes: "",
  ...overrides,
});
