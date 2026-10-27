import { expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { startApp, tempDir, owner } from "./api-client";

it("records unexpected server failures so the owner can find the cause later", async () => {
  const dir = await tempDir();
  const logged: unknown[] = [];
  const api = await startApp(dir, { logError: (error) => logged.push(error) });
  await api.request("/api/auth/setup", "POST", owner);
  const db = new DatabaseSync(join(dir, "loans.sqlite"));
  db.prepare("UPDATE state SET json='{broken' WHERE key='ledger'").run();
  db.close();
  const result = await api.request("/api/data");
  expect(result.status).toBe(500);
  expect(result.body.error).toBe("ระบบขัดข้อง บันทึกรายละเอียดไว้ในไฟล์ log แล้ว");
  expect(logged).toHaveLength(1);
});

it("keeps the owner signed in when the app restarts, until they log out", async () => {
  const dir = await tempDir();
  const first = await startApp(dir);
  await first.request("/api/auth/setup", "POST", owner);
  await first.close();
  const second = await startApp(dir, {}, first.session);
  expect((await second.request("/api/auth/status")).body.user).toEqual({ email: owner.email });
  expect((await second.request("/api/borrowers", "POST", { name: "หลังรีสตาร์ต" })).status).toBe(201);
  await second.request("/api/auth/logout", "POST", {});
  const stale = { ...first.session };
  await second.close();
  const third = await startApp(dir, {}, stale);
  expect((await third.request("/api/auth/status")).body.user).toBeNull();
});

it("writes one automatic backup per day and keeps the newest 30", async () => {
  const dir = await tempDir();
  const backupDir = join(dir, "auto");
  mkdirSync(backupDir);
  for (let day = 1; day <= 31; day++)
    writeFileSync(join(backupDir, `backup-2026-08-${String(day).padStart(2, "0")}.json`), "{}");
  writeFileSync(join(backupDir, "notes.txt"), "owner file");
  const api = await startApp(dir, { backupDir });
  await api.request("/api/auth/setup", "POST", owner);
  await api.request("/api/borrowers", "POST", { name: "สำรองอัตโนมัติ" });
  await api.request("/api/borrowers", "POST", { name: "รายการที่สอง" });
  const files = readdirSync(backupDir).sort();
  expect(files).toHaveLength(31);
  expect(files).toContain("notes.txt");
  expect(files).not.toContain("backup-2026-08-01.json");
  const today = JSON.parse(readFileSync(join(backupDir, "backup-2026-10-01.json"), "utf8"));
  expect(today.data.borrowers.map((b: { name: string }) => b.name)).toEqual(["สำรองอัตโนมัติ", "รายการที่สอง"]);
});

it("restores a downloaded backup with its attachments, after saving a safety copy of the current data", async () => {
  const dir = await tempDir();
  const backupDir = join(dir, "auto");
  const api = await startApp(dir, { backupDir });
  await api.request("/api/auth/setup", "POST", owner);
  const kept = await api.request("/api/borrowers", "POST", { name: "อยู่ในไฟล์สำรอง" });
  const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
  const upload = await fetch(`${api.base}/api/attachments?borrowerId=${kept.body.id}`, {
    method: "POST",
    headers: { Origin: api.base, Cookie: api.session.cookie, "X-CSRF-Token": api.session.csrf,
      "Content-Type": "image/png", "X-Filename": "slip.png" },
    body: png,
  });
  expect(upload.status).toBe(201);
  await api.request("/api/settings", "PUT", { politeEnding: "ครับ", promptPayId: "0812345678" });
  const backup = (await api.request("/api/backup")).text;
  await api.request("/api/borrowers", "POST", { name: "เพิ่มหลังสำรอง" });
  await api.request("/api/settings", "PUT", { politeEnding: "", promptPayId: "" });

  expect((await api.request("/api/restore", "POST", { app: "other" })).status).toBe(400);
  const restored = await api.request("/api/restore", "POST", backup);
  expect(restored.status).toBe(200);
  const data = (await api.request("/api/data")).body;
  expect(data.borrowers.map((b: { name: string }) => b.name)).toEqual(["อยู่ในไฟล์สำรอง"]);
  expect((await api.request("/api/settings")).body).toEqual({ politeEnding: "ครับ", promptPayId: "0812345678" });
  const file = await fetch(`${api.base}/api/attachments/${data.attachments[0].id}`, { headers: { Cookie: api.session.cookie } });
  expect(new Uint8Array(await file.arrayBuffer())).toEqual(png);

  const safety = readdirSync(backupDir).filter((name) => name.startsWith("before-restore-"));
  expect(safety).toHaveLength(1);
  const saved = JSON.parse(readFileSync(join(backupDir, safety[0]), "utf8"));
  expect(saved.data.borrowers).toHaveLength(2);
});

function viaHost(base: string, host: string, path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; body: Record<string, any> }>((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = request(base + path, { method, headers: { Host: host, "Content-Type": "application/json", ...headers } }, (res) => {
      let text = "";
      res.on("data", (chunk) => (text += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: text ? JSON.parse(text) : {} }));
    });
    req.on("error", reject);
    req.end(payload);
  });
}

it("serves the phone through the owner's Tailscale address only, and never creates the account from there", async () => {
  const phone = "my-pc.tail1234.ts.net";
  const api = await startApp(await tempDir(), { allowedHosts: [phone] });
  const origin = { Origin: `https://${phone}` };
  expect((await viaHost(api.base, phone, "/api/auth/setup", "POST", owner, origin)).status).toBe(403);
  await api.request("/api/auth/setup", "POST", owner);
  expect((await viaHost(api.base, phone, "/api/health")).status).toBe(200);
  expect((await viaHost(api.base, phone, "/api/auth/login", "POST", owner, origin)).status).toBe(200);
  expect((await viaHost(api.base, phone, "/api/auth/login", "POST", owner, { Origin: "https://evil.example" })).status).toBe(403);
  expect((await viaHost(api.base, "other-pc.tail1234.ts.net", "/api/health")).status).toBe(403);
});

it("remembers the owner's message settings and PromptPay number", async () => {
  const api = await startApp(await tempDir());
  await api.request("/api/auth/setup", "POST", owner);
  expect((await api.request("/api/settings")).body).toEqual({ politeEnding: "", promptPayId: "" });
  expect((await api.request("/api/settings", "PUT", { politeEnding: "ค่ะ", promptPayId: "081-234-5678" })).body)
    .toEqual({ politeEnding: "ค่ะ", promptPayId: "0812345678" });
  expect((await api.request("/api/settings", "PUT", { politeEnding: "ครับ", promptPayId: "12345" })).status).toBe(400);
  expect((await api.request("/api/settings")).body.politeEnding).toBe("ค่ะ");
  const backup = JSON.parse((await api.request("/api/backup")).text);
  expect(backup.settings).toEqual({ politeEnding: "ค่ะ", promptPayId: "0812345678" });
});

it("keeps ordinary input mistakes as owner-facing messages without logging them", async () => {
  const logged: unknown[] = [];
  const api = await startApp(await tempDir(), { logError: (error) => logged.push(error) });
  await api.request("/api/auth/setup", "POST", owner);
  const result = await api.request("/api/borrowers", "POST", { name: "" });
  expect(result.status).toBe(400);
  expect(result.body.error).toBe("ชื่อไม่ถูกต้อง");
  expect(logged).toHaveLength(0);
});
