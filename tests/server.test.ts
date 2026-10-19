import { afterEach, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { get } from "node:http";
import { createApp } from "../server/app";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action();
});
async function client(dataDir?: string, staticDir?: string, clock = () => new Date("2026-10-01T06:00:00Z")) {
  const dir = dataDir ?? (await mkdtemp(join(tmpdir(), "loan-api-")));
  if (!dataDir) cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const app = createApp({
    dataDir: dir,
    staticDir,
    clock,
  });
  await new Promise<void>((resolve) =>
    app.server.listen(0, "127.0.0.1", resolve),
  );
  cleanup.push(() => app.close());
  const address = app.server.address();
  if (!address || typeof address === "string")
    throw new Error("No HTTP address");
  const base = `http://127.0.0.1:${address.port}`;
  let cookie = "",
    csrf = "";
  return {
    dir,
    base,
    close: app.close,
    async request(
      path: string,
      method = "GET",
      data?: unknown,
      overrides: Record<string, string> = {},
    ) {
      const response = await fetch(base + path, {
        method,
        headers: {
          Origin: base,
          Cookie: cookie,
          "Content-Type": "application/json",
          "X-CSRF-Token": csrf,
          ...overrides,
        },
        body:
          data instanceof Uint8Array
            ? new Uint8Array(data).buffer
            : data === undefined
              ? undefined
              : JSON.stringify(data),
      });
      const setCookie = response.headers.get("set-cookie");
      if (setCookie) cookie = setCookie.split(";")[0];
      const text = await response.text();
      let body: {
        csrfToken?: string;
        id: string;
        recoveryCode: string;
        setupRequired?: boolean;
        borrowers?: unknown[];
        payments?: unknown[];
        [key: string]: unknown;
      } = { id: "", recoveryCode: "" };
      try {
        body = JSON.parse(text);
      } catch {
        /* CSV or binary response */
      }
      if (typeof body.csrfToken === "string") csrf = body.csrfToken;
      return { response, body, text };
    },
  };
}
const credentials = {
  email: "owner@example.com",
  password: "long-private-password",
};
it("corrects an entered rate and due date with audit history and explicitly canceled future rates", async () => {
  const api = await client(undefined, undefined, () => new Date("2026-10-19T06:00:00Z"));
  await api.request("/api/auth/setup", "POST", credentials);
  const person = await api.request("/api/borrowers", "POST", { name: "แก้ข้อมูลทดสอบ" });
  const created = await api.request("/api/loans", "POST", { ...loanInput(person.body.id), source: "new", rateBps: 100 });
  const scheduled = await api.request("/api/rate-changes", "POST", {
    loanId: created.body.id, effectiveDate: "2026-11-15", rateBps: 10, reason: "กรอกผิด",
  });
  expect(scheduled.response.status).toBe(201);
  expect((await api.request("/api/rate-changes", "POST", {
    loanId: created.body.id, effectiveDate: "2026-10-19", rateBps: 100, reason: "วันผิด",
  })).response.status).toBe(400);
  const corrected = await api.request(`/api/loans/${created.body.id}/correction`, "POST", {
    rateBps: 1000, dueDate: "2026-11-20", reason: "แก้ข้อมูลที่กรอกผิดตามจริง", cancelRateChangeIds: [scheduled.body.id],
  });
  expect(corrected.response.status).toBe(200);
  expect(corrected.body).toMatchObject({ rateBps: 1000, dueDate: "2026-11-20", source: "new", anchorDay: 15 });
  const data = await api.request("/api/data");
  expect(data.body.rateChanges).toMatchObject([{ id: scheduled.body.id, rateBps: 10, cancelReason: "แก้ข้อมูลที่กรอกผิดตามจริง" }]);
  expect(data.text).toContain('loan.correct');
  expect(data.text).toContain('before');
  expect((await api.request(`/api/loans/${created.body.id}/correction`, "POST", { rateBps: 700, dueDate: "2026-11-21", reason: "" })).response.status).toBe(400);
  expect((await api.request(`/api/loans/${created.body.id}/correction`, "POST", { rateBps: 700, dueDate: "2026-11-21", reason: "ผิด", principalCents: 0 })).response.status).toBe(400);
  expect((await api.request(`/api/loans/${created.body.id}/correction`, "POST", { rateBps: 700, dueDate: "2026-09-01", reason: "ผิด" })).response.status).toBe(400);
  expect((await api.request(`/api/loans/${created.body.id}/correction`, "POST", { rateBps: 700, dueDate: "2026-11-21", reason: "ผิด", cancelRateChangeIds: ["foreign"] })).response.status).toBe(404);
  expect((await api.request("/api/data")).body.loans).toMatchObject([{ rateBps: 1000, dueDate: "2026-11-20" }]);
  expect((await api.request("/api/loans/unknown/correction", "POST", { rateBps: 1000, dueDate: "2026-11-20", reason: "ผิด" })).response.status).toBe(404);
  expect((await api.request("/api/rate-changes", "POST", { loanId: created.body.id, effectiveDate: "2026-11-15", rateBps: 100, reason: "ตั้งรายการใหม่แทนที่ยกเลิก" })).response.status).toBe(201);
});
it("rolls back an initial-rate correction if it invalidates a later exact payoff", async () => {
  const api = await client();
  await api.request("/api/auth/setup", "POST", credentials);
  const person = await api.request("/api/borrowers", "POST", { name: "ตรวจประวัติ" });
  const created = await api.request("/api/loans", "POST", loanInput(person.body.id));
  expect((await api.request("/api/payments", "POST", {
    loanId: created.body.id, date: "2026-09-25", totalCents: 1033333, principalCents: 1000000, interestCents: 33333, isPayoff: true,
  })).response.status).toBe(201);
  const before = (await api.request("/api/data")).text;
  expect((await api.request(`/api/loans/${created.body.id}/correction`, "POST", {
    rateBps: 700, dueDate: "2026-11-20", reason: "แก้ย้อนหลัง",
  })).response.status).toBe(400);
  expect((await api.request("/api/data")).text).toBe(before);
});
it("atomically creates a single owner under concurrent setup and rejects a foreign Host", async () => {
  const api = await client();
  const replies = await Promise.all([
    api.request("/api/auth/setup", "POST", credentials),
    api.request("/api/auth/setup", "POST", {
      ...credentials,
      email: "other@example.com",
    }),
  ]);
  expect(replies.map((reply) => reply.response.status).sort()).toEqual([
    201, 409,
  ]);
  const foreignHost = await new Promise<number | undefined>(
    (resolve, reject) => {
      get(
        api.base + "/api/health",
        { headers: { Host: "evil.example" } },
        (response) => {
          response.resume();
          resolve(response.statusCode);
        },
      ).on("error", reject);
    },
  );
  expect(foreignHost).toBe(403);
});
it("serves the built app without exposing local database paths", async () => {
  const dir = await mkdtemp(join(tmpdir(), "loan-static-"));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  await writeFile(
    join(dir, "index.html"),
    "<!doctype html><h1>บัญชีเงินกู้</h1>",
  );
  await writeFile(join(dir, ".secret"), "must not serve");
  const api = await client(undefined, dir);
  expect((await api.request("/")).text).toContain("บัญชีเงินกู้");
  expect((await api.request("/borrowers")).response.status).toBe(200);
  expect((await api.request("/.secret")).response.status).toBe(404);
  expect((await api.request("/.data/loans.sqlite")).response.status).toBe(404);
  expect((await api.request("/api/health")).body.app).toBe(
    "personal-loan-ledger",
  );
});
const loanInput = (borrowerId: string) => ({
  borrowerId,
  source: "existing",
  principalCents: 1000000,
  openingInterestCents: 0,
  rateBps: 1000,
  startDate: "2026-09-15",
  cycleStartDate: "2026-09-15",
  firstCycleEndDate: "2026-10-15",
  anchorDay: 15,
  dueDate: "2026-10-01",
  notes: "ข้อมูลหนี้เดิม",
});
it("edits a manual receipt atomically while retaining the original and unknown-date metadata", async () => {
  const api = await client(undefined, undefined, () => new Date("2026-10-15T06:00:00Z"));
  await api.request("/api/auth/setup", "POST", credentials);
  const borrower = await api.request("/api/borrowers", "POST", { name: "เจ้าของแก้ยอดเอง" });
  const loan = await api.request("/api/loans", "POST", { ...loanInput(borrower.body.id),
    principalCents: 200000, startDate: "2026-10-10", cycleStartDate: "2026-09-13",
    firstCycleEndDate: "2026-10-13", anchorDay: 13, dueDate: "2026-10-13" });
  const body = { loanId: loan.body.id, totalCents: 50000, principalCents: 0, interestCents: 50000,
    isPayoff: false, dateEstimated: true, note: "จำวันที่จ่ายไม่ได้" };
  const receipt = await api.request("/api/payments", "POST", body);
  expect(receipt.response.status).toBe(201);
  expect(receipt.body).toMatchObject({ date: "2026-10-15", dateEstimated: true, interestMode: "owner", interestCents: 50000 });
  const invalid = await api.request(`/api/payments/${receipt.body.id}`, "PATCH", { ...body, date: "2026-10-15", totalCents: 1 });
  expect(invalid.response.status).toBe(400);
  expect((await api.request("/api/data")).body.payments).toMatchObject([{ id: receipt.body.id, canceledAt: null }]);
  const edited = await api.request(`/api/payments/${receipt.body.id}`, "PATCH", {
    ...body, date: "2026-10-13", dateEstimated: false, totalCents: 20000, interestCents: 20000, editReason: "นึกวันและยอดจริงได้แล้ว" });
  expect(edited.response.status).toBe(200);
  expect(edited.body).toMatchObject({ replacesPaymentId: receipt.body.id, date: "2026-10-13", dateEstimated: false, interestCents: 20000 });
  const data = await api.request("/api/data");
  expect(data.body.payments).toMatchObject([
    { id: receipt.body.id, interestCents: 50000, cancelReason: "แก้ไขรายการ: นึกวันและยอดจริงได้แล้ว" },
    { id: edited.body.id, interestCents: 20000, canceledAt: null },
  ]);
  expect((await api.request(`/api/payments/${receipt.body.id}`, "PATCH", { ...body, date: "2026-10-15" })).response.status).toBe(409);
  const csv = await api.request("/api/export");
  expect(csv.text).toContain("จำวันที่จ่ายจริงไม่ได้");
  expect(csv.text).toContain("แก้ไขจากรายการ");
  expect(csv.text).toContain("ยอดดอกตามที่เจ้าของระบุ");
});

it("rolls back a principal edit that would invalidate a later final payment", async () => {
  const api = await client();
  await api.request("/api/auth/setup", "POST", credentials);
  const borrower = await api.request("/api/borrowers", "POST", { name: "ทดสอบแก้ย้อนหลัง" });
  const loan = await api.request("/api/loans", "POST", { ...loanInput(borrower.body.id), principalCents: 100000, rateBps: 0 });
  const body = { loanId: loan.body.id, date: "2026-09-20", totalCents: 40000, principalCents: 40000, interestCents: 0, isPayoff: false };
  const first = await api.request("/api/payments", "POST", body);
  const final = await api.request("/api/payments", "POST", { ...body, date: "2026-09-25", totalCents: 60000, principalCents: 60000, isPayoff: true });
  expect(final.response.status).toBe(201);
  expect((await api.request(`/api/payments/${first.body.id}`, "PATCH", { ...body, totalCents: 50000, principalCents: 50000 })).response.status).toBe(400);
  expect((await api.request("/api/data")).body.payments).toMatchObject([
    { id: first.body.id, canceledAt: null, principalCents: 40000 }, { id: final.body.id, canceledAt: null, principalCents: 60000 },
  ]);
});

it("lets the owner normalize an overdue status without moving the due date or balances", async () => {
  const api = await client(undefined, undefined, () => new Date("2026-10-15T06:00:00Z"));
  await api.request("/api/auth/setup", "POST", credentials);
  const borrower = await api.request("/api/borrowers", "POST", { name: "ทดสอบสถานะปกติ" });
  const loan = await api.request("/api/loans", "POST", { ...loanInput(borrower.body.id), dueDate: "2026-10-13" });
  expect((await api.request("/api/reminders")).text).toContain("overdue");
  const normal = await api.request(`/api/loans/${loan.body.id}`, "PATCH", { statusOverride: "normal", reason: "เจ้าของตั้งปกติ" });
  expect(normal.response.status).toBe(200);
  expect(normal.body).toMatchObject({ statusOverride: "normal", dueDate: "2026-10-13", principalCents: 1000000 });
  expect((await api.request("/api/reminders")).body.items).toEqual([]);
  expect((await api.request(`/api/loans/${loan.body.id}`, "PATCH", { statusOverride: "paid", reason: "ทดสอบ" })).response.status).toBe(400);
  const automatic = await api.request(`/api/loans/${loan.body.id}`, "PATCH", { statusOverride: "auto", reason: "กลับไปตามวันนัด" });
  expect(automatic.response.status).toBe(200);
  expect((await api.request("/api/reminders")).text).toContain("overdue");
  for (const [dueDate, kind] of [["2026-10-15", "today"], ["2026-10-16", "tomorrow"]]) {
    await api.request(`/api/loans/${loan.body.id}`, "PATCH", { statusOverride: "normal", dueDate, reason: "นัดรอบใหม่" });
    expect((await api.request("/api/reminders")).body.items).toEqual([
      { loanId: loan.body.id, borrowerName: "ทดสอบสถานะปกติ", dueDate, kind },
    ]);
  }
  await api.request(`/api/loans/${loan.body.id}`, "PATCH", { dueDate: "2026-10-18", reason: "นัดรอบใหม่" });
  expect((await api.request("/api/reminders")).body.items).toEqual([]);
});
it("accepts owner interest regardless of formula while retaining optional historical reconciliation", async () => {
  const api = await client(undefined, undefined, () => new Date("2026-10-15T06:00:00Z"));
  await api.request("/api/auth/setup", "POST", credentials);
  const borrower = await api.request("/api/borrowers", "POST", { name: "ผู้กู้ทดสอบเต็มงวด" });
  const loan = await api.request("/api/loans", "POST", {
    ...loanInput(borrower.body.id), principalCents: 200000,
    startDate: "2026-10-10", cycleStartDate: "2026-09-13", firstCycleEndDate: "2026-10-13",
    anchorDay: 13, dueDate: "2026-10-13",
  });
  expect(loan.response.status).toBe(201);
  const installment = { loanId: loan.body.id, date: "2026-10-13", totalCents: 20000,
    principalCents: 0, interestCents: 20000, isPayoff: false, note: "ดอกเต็มงวด" };
  const initial = await api.request("/api/payments", "POST", installment);
  expect(initial.response.status).toBe(201);
  expect(initial.body.interestMode).toBe("owner");
  await api.request(`/api/payments/${initial.body.id}/cancel`, "POST", { reason: "ทดสอบยอดยกมา" });
  const adjustment = await api.request("/api/adjustments", "POST", {
    loanId: loan.body.id, date: "2026-10-10", principalDeltaCents: 0, interestDeltaCents: 18000,
    reason: "ยืนยันดอกเต็มงวด 200 บาท มีดอกก่อนเริ่มบันทึก 180 บาท",
  });
  expect(adjustment.response.status).toBe(201);
  const receipt = await api.request("/api/payments", "POST", installment);
  expect(receipt.response.status).toBe(201);
  expect(receipt.body).toMatchObject({ principalCents: 0, interestCents: 20000 });
  const csv = await api.request("/api/export");
  expect(csv.text).toContain("2000.00");
  const repeated = await api.request("/api/payments", "POST", { ...installment, interestCents: 20001 });
  expect(repeated.response.status).toBe(400);
  const reversed = await api.request(`/api/adjustments/${adjustment.body.id}/cancel`, "POST", { reason: "ทดสอบประวัติย้อนหลัง" });
  expect(reversed.response.status).toBe(200);
});
it("exports individually dated payments including canceled allocations alongside balance summaries", async () => {
  const api = await client();
  await api.request("/api/auth/setup", "POST", credentials);
  const borrower = await api.request("/api/borrowers", "POST", {
    name: "ผู้กู้เดิม",
  });
  const loan = await api.request(
    "/api/loans",
    "POST",
    loanInput(borrower.body.id),
  );
  const payment = await api.request("/api/payments", "POST", {
    loanId: loan.body.id,
    date: "2026-09-25",
    totalCents: 430000,
    principalCents: 400000,
    interestCents: 30000,
    isPayoff: false,
    note: "รับโอน",
  });
  await api.request(`/api/payments/${payment.body.id}/cancel`, "POST", {
    reason: "สลิปผิดรายการ",
  });
  const csv = await api.request("/api/export");
  expect(csv.text).toContain("สรุปยอด");
  expect(csv.text).toContain("ยอดรับคืนก่อนหน้านั้นยังไม่ทราบ");
  expect(csv.text).toContain(payment.body.id);
  expect(csv.text).toContain("2026-09-25");
  expect(csv.text).toContain('"4000.00","300.00","4300.00"');
  expect(csv.text).toContain("ยกเลิก");
  expect(csv.text).toContain("สลิปผิดรายการ");
});
it("requires canceling final principal return before canceling any existing adjustment", async () => {
  const api = await client();
  await api.request("/api/auth/setup", "POST", credentials);
  const borrower = await api.request("/api/borrowers", "POST", {
    name: "ผู้ยืม",
  });
  const loan = await api.request("/api/loans", "POST", {
    ...loanInput(borrower.body.id),
    source: "new",
    rateBps: 0,
  });
  const loanId = loan.body.id;
  const adjustment = await api.request("/api/adjustments", "POST", {
    loanId,
    date: "2026-09-20",
    principalDeltaCents: 0,
    interestDeltaCents: 0,
    reason: "ตรวจยอดเดิม",
  });
  const payoff = await api.request("/api/payments", "POST", {
    loanId,
    date: "2026-09-25",
    totalCents: 1000000,
    principalCents: 1000000,
    interestCents: 0,
    isPayoff: true,
  });
  expect(payoff.response.status).toBe(201);
  expect(
    (
      await api.request(
        `/api/adjustments/${adjustment.body.id}/cancel`,
        "POST",
        { reason: "แก้" },
      )
    ).response.status,
  ).toBe(400);
  expect(
    (
      await api.request(`/api/payments/${payoff.body.id}/cancel`, "POST", {
        reason: "แก้ปิดหนี้ก่อน",
      })
    ).response.status,
  ).toBe(200);
  expect(
    (
      await api.request(
        `/api/adjustments/${adjustment.body.id}/cancel`,
        "POST",
        { reason: "แก้" },
      )
    ).response.status,
  ).toBe(200);
});
it("rejects unsafe optional links, short passwords, oversized files and mismatched attachment owners", async () => {
  const api = await client();
  expect(
    (
      await api.request("/api/auth/setup", "POST", {
        ...credentials,
        password: "12345678901",
      })
    ).response.status,
  ).toBe(400);
  await api.request("/api/auth/setup", "POST", credentials);
  expect(
    (
      await api.request("/api/borrowers", "POST", {
        name: "A",
        facebookUrl: "javascript:alert(1)",
      })
    ).response.status,
  ).toBe(400);
  const borrower = await api.request("/api/borrowers", "POST", {
    name: "A",
    facebookUrl: "https://facebook.com/example",
  });
  expect(
    (
      await api.request(`/api/borrowers/${borrower.body.id}`, "PATCH", {
        facebookUrl: "data:text/html,bad",
      })
    ).response.status,
  ).toBe(400);
  const other = await api.request("/api/borrowers", "POST", { name: "B" });
  const loan = await api.request(
    "/api/loans",
    "POST",
    loanInput(borrower.body.id),
  );
  const headers = {
    "Content-Type": "application/pdf",
    "X-Filename": "receipt.pdf",
  };
  expect(
    (
      await api.request(
        `/api/attachments?loanId=${loan.body.id}&borrowerId=${other.body.id}`,
        "POST",
        new TextEncoder().encode("%PDF-1.7"),
        headers,
      )
    ).response.status,
  ).toBe(400);
  expect(
    (
      await api.request(
        `/api/attachments?borrowerId=${borrower.body.id}`,
        "POST",
        new Uint8Array(10 * 1024 * 1024 + 1),
        headers,
      )
    ).response.status,
  ).toBe(413);
  expect((await api.request("/api/data")).body.attachments).toHaveLength(0);
});
it("enforces same-day payment totals and can cancel a payoff to resume the original debt", async () => {
  const api = await client();
  await api.request("/api/auth/setup", "POST", credentials);
  const borrower = await api.request("/api/borrowers", "POST", {
    name: "ผู้ยืม",
  });
  const loan = await api.request("/api/loans", "POST", {
    ...loanInput(borrower.body.id),
    source: "new",
    rateBps: 0,
  });
  const loanId = loan.body.id;
  expect(loan.response.status).toBe(201);
  expect(
    (
      await api.request("/api/rate-changes", "POST", {
        loanId,
        effectiveDate: "2026-10-15",
        rateBps: 126,
        reason: "ใหม่",
      })
    ).response.status,
  ).toBe(400);
  expect(
    (
      await api.request("/api/adjustments", "POST", {
        loanId,
        date: "2026-09-20",
        principalDeltaCents: -1000001,
        interestDeltaCents: 0,
        reason: "แก้",
      })
    ).response.status,
  ).toBe(400);
  expect(
    (
      await api.request("/api/payments", "POST", {
        loanId,
        date: "2026-09-20",
        totalCents: 700000,
        principalCents: 700000,
        interestCents: 0,
        isPayoff: false,
      })
    ).response.status,
  ).toBe(201);
  expect(
    (
      await api.request("/api/payments", "POST", {
        loanId,
        date: "2026-09-20",
        totalCents: 400000,
        principalCents: 400000,
        interestCents: 0,
        isPayoff: false,
      })
    ).response.status,
  ).toBe(400);
  const payoff = await api.request("/api/payments", "POST", {
    loanId,
    date: "2026-09-25",
    totalCents: 300000,
    principalCents: 300000,
    interestCents: 0,
    isPayoff: true,
  });
  expect(payoff.response.status).toBe(201);
  expect((await api.request("/api/reminders")).body.items).toHaveLength(0);
  expect(
    (
      await api.request(`/api/payments/${payoff.body.id}/cancel`, "POST", {
        reason: "ยังไม่จ่าย",
      })
    ).response.status,
  ).toBe(200);
  expect((await api.request("/api/reminders")).body.items).toHaveLength(1);
  expect(
    (
      await api.request(`/api/payments/${payoff.body.id}/cancel`, "POST", {
        reason: "ยังไม่จ่าย",
      })
    ).response.status,
  ).toBe(200);
  expect((await api.request("/api/data")).body.payments).toHaveLength(2);
});
it("rejects cancellation that would make a later interest adjustment negative", async () => {
  const api = await client();
  await api.request("/api/auth/setup", "POST", credentials);
  const borrower = await api.request("/api/borrowers", "POST", {
    name: "ผู้ยืม",
  });
  const loan = await api.request("/api/loans", "POST", {
    ...loanInput(borrower.body.id),
    source: "new",
    rateBps: 0,
  });
  const loanId = loan.body.id;
  const positive = await api.request("/api/adjustments", "POST", {
    loanId,
    date: "2026-09-20",
    principalDeltaCents: 0,
    interestDeltaCents: 10000,
    reason: "เพิ่มดอกยกมา",
  });
  expect(positive.response.status).toBe(201);
  expect(
    (
      await api.request("/api/adjustments", "POST", {
        loanId,
        date: "2026-09-25",
        principalDeltaCents: 0,
        interestDeltaCents: -10000,
        reason: "ลดดอก",
      })
    ).response.status,
  ).toBe(201);
  expect(
    (
      await api.request(`/api/adjustments/${positive.body.id}/cancel`, "POST", {
        reason: "ยกเลิก",
      })
    ).response.status,
  ).toBe(400);
  expect((await api.request("/api/data")).body.adjustments).toMatchObject([
    { canceledAt: null },
    { canceledAt: null },
  ]);
});
it("privately stores verified attachment bytes and includes them in secret-free backups and safe CSV", async () => {
  const api = await client();
  await api.request("/api/auth/setup", "POST", credentials);
  const borrower = await api.request("/api/borrowers", "POST", {
    name: "=SUM(A1:A2)",
  });
  const loan = await api.request(
    "/api/loans",
    "POST",
    loanInput(borrower.body.id),
  );
  const payload = new TextEncoder().encode("%PDF-1.7\nprivate receipt");
  const headers = {
    "Content-Type": "application/pdf",
    "X-Filename": encodeURIComponent("หลักฐาน.pdf"),
  };
  const uploaded = await api.request(
    `/api/attachments?loanId=${loan.body.id}`,
    "POST",
    payload,
    headers,
  );
  expect(uploaded.response.status).toBe(201);
  const download = await api.request(`/api/attachments/${uploaded.body.id}`);
  expect(download.text).toBe("%PDF-1.7\nprivate receipt");
  expect(download.response.headers.get("content-disposition")).toContain(
    "attachment",
  );
  expect(
    (
      await api.request(
        `/api/attachments?loanId=${loan.body.id}`,
        "POST",
        new TextEncoder().encode("<script>bad</script>"),
        headers,
      )
    ).response.status,
  ).toBe(400);
  const backup = await api.request("/api/backup");
  expect(backup.body.attachmentFiles).toMatchObject([
    { id: uploaded.body.id, base64: "JVBERi0xLjcKcHJpdmF0ZSByZWNlaXB0" },
  ]);
  expect(backup.text).not.toContain("passwordHash");
  expect(backup.text).not.toContain("recoveryHash");
  const csv = await api.request("/api/export");
  expect(csv.text).toContain("'=SUM(A1:A2)");
  await api.request("/api/auth/logout", "POST");
  expect(
    (await api.request(`/api/attachments/${uploaded.body.id}`)).response.status,
  ).toBe(401);
  expect((await api.request("/api/backup")).response.status).toBe(401);
});
it("tracks rate changes, adjustments, contacts and owner reminders while keeping an audit trail", async () => {
  const api = await client();
  await api.request("/api/auth/setup", "POST", credentials);
  const borrower = await api.request("/api/borrowers", "POST", {
    name: "คนรู้จัก",
  });
  const loan = await api.request(
    "/api/loans",
    "POST",
    loanInput(borrower.body.id),
  );
  const loanId = loan.body.id;
  expect(
    (
      await api.request("/api/rate-changes", "POST", {
        loanId,
        effectiveDate: "2026-10-14",
        rateBps: 700,
        reason: "ตกลงใหม่",
      })
    ).response.status,
  ).toBe(400);
  expect(
    (
      await api.request("/api/rate-changes", "POST", {
        loanId,
        effectiveDate: "2026-10-15",
        rateBps: 700,
        reason: "ตกลงใหม่",
      })
    ).response.status,
  ).toBe(201);
  const adjust = await api.request("/api/adjustments", "POST", {
    loanId,
    date: "2026-09-25",
    principalDeltaCents: -100000,
    interestDeltaCents: 0,
    reason: "แก้ยอด",
  });
  expect(adjust.response.status).toBe(201);
  expect(
    (
      await api.request(`/api/adjustments/${adjust.body.id}/cancel`, "POST", {
        reason: "ตรวจพบผิด",
      })
    ).response.status,
  ).toBe(200);
  expect(
    (
      await api.request("/api/contacts", "POST", {
        loanId,
        channel: "LINE",
        message: "ส่งเองแล้ว",
      })
    ).response.status,
  ).toBe(201);
  expect((await api.request("/api/reminders")).body.items).toMatchObject([
    { loanId, borrowerName: "คนรู้จัก", kind: "today" },
  ]);
  expect(
    (
      await api.request(`/api/loans/${loanId}`, "PATCH", {
        dueDate: "2026-10-02",
        reason: "เลื่อนนัด",
      })
    ).response.status,
  ).toBe(200);
  expect((await api.request("/api/reminders")).body.items).toMatchObject([
    { kind: "tomorrow" },
  ]);
  expect((await api.request("/api/data")).body.audit).toHaveLength(7);
});
it("validates loan source and rates, records payoff and protects later history against backdated changes", async () => {
  const api = await client();
  await api.request("/api/auth/setup", "POST", credentials);
  const borrower = await api.request("/api/borrowers", "POST", {
    name: "ผู้กู้",
  });
  const loan = loanInput(borrower.body.id);
  expect(
    (await api.request("/api/loans", "POST", { ...loan, source: "arbitrary" }))
      .response.status,
  ).toBe(400);
  expect(
    (await api.request("/api/loans", "POST", { ...loan, source: "new" }))
      .response.status,
  ).toBe(400);
  expect(
    (
      await api.request("/api/loans", "POST", {
        ...loan,
        startDate: "2099-01-01",
      })
    ).response.status,
  ).toBe(400);
  const created = await api.request("/api/loans", "POST", loan);
  expect(created.response.status).toBe(201);
  const loanId = created.body.id;
  const first = await api.request("/api/payments", "POST", {
    loanId,
    date: "2026-09-20",
    totalCents: 400000,
    principalCents: 400000,
    interestCents: 0,
    isPayoff: false,
  });
  expect(first.response.status).toBe(201);
  expect(
    (
      await api.request("/api/payments", "POST", {
        loanId,
        date: "2026-09-25",
        totalCents: 633333,
        principalCents: 600000,
        interestCents: 33333,
        isPayoff: true,
      })
    ).response.status,
  ).toBe(201);
  expect(
    (
      await api.request(`/api/payments/${first.body.id}/cancel`, "POST", {
        reason: "ผิด",
      })
    ).response.status,
  ).toBe(400);
  expect(
    (
      await api.request("/api/payments", "POST", {
        loanId,
        date: "2026-09-18",
        totalCents: 100000,
        principalCents: 100000,
        interestCents: 0,
        isPayoff: false,
      })
    ).response.status,
  ).toBe(400);
  expect((await api.request("/api/data")).body.payments).toHaveLength(2);
});
it("rejects cross-origin requests and missing CSRF, and recovery reset revokes existing sessions", async () => {
  const api = await client();
  expect(
    (
      await api.request("/api/auth/setup", "POST", credentials, {
        Origin: "https://evil.example",
      })
    ).response.status,
  ).toBe(403);
  const setup = await api.request("/api/auth/setup", "POST", credentials);
  expect(
    (
      await api.request(
        "/api/borrowers",
        "POST",
        { name: "อื่น" },
        { "X-CSRF-Token": "" },
      )
    ).response.status,
  ).toBe(403);
  expect(
    (
      await api.request("/api/auth/forgot", "POST", {
        email: credentials.email,
      })
    ).response.status,
  ).toBe(503);
  expect(
    (
      await api.request("/api/auth/reset", "POST", {
        email: credentials.email,
        recoveryCode: "wrong",
        password: "replacement-password",
      })
    ).response.status,
  ).toBe(400);
  expect(
    (
      await api.request("/api/auth/reset", "POST", {
        email: credentials.email,
        recoveryCode: setup.body.recoveryCode,
        password: "replacement-password",
      })
    ).response.status,
  ).toBe(200);
  expect((await api.request("/api/data")).response.status).toBe(401);
  expect(
    (await api.request("/api/auth/login", "POST", credentials)).response.status,
  ).toBe(401);
  expect(
    (
      await api.request("/api/auth/login", "POST", {
        ...credentials,
        password: "replacement-password",
      })
    ).response.status,
  ).toBe(200);
  expect((await api.request("/api/auth/logout", "POST")).response.status).toBe(
    200,
  );
  expect((await api.request("/api/data")).response.status).toBe(401);
});
it("creates one owner, protects private data and persists borrower details after restart", async () => {
  const api = await client();
  expect((await api.request("/api/data")).response.status).toBe(401);
  expect((await api.request("/api/auth/status")).body.setupRequired).toBe(true);
  const setup = await api.request("/api/auth/setup", "POST", credentials);
  expect(setup.response.status).toBe(201);
  expect(setup.body.recoveryCode).toMatch(/^\S{20,}$/);
  expect(setup.response.headers.get("set-cookie")).toContain("HttpOnly");
  const borrower = await api.request("/api/borrowers", "POST", {
    name: "สมชาย",
    nickname: "ชาย",
  });
  expect(borrower.response.status).toBe(201);
  expect(
    (await api.request("/api/auth/setup", "POST", credentials)).response.status,
  ).toBe(409);
  await api.close();
  const again = await client(api.dir);
  expect((await again.request("/api/auth/status")).body.setupRequired).toBe(
    false,
  );
  expect(
    (await again.request("/api/auth/login", "POST", credentials)).response
      .status,
  ).toBe(200);
  expect((await again.request("/api/data")).body.borrowers).toMatchObject([
    { name: "สมชาย", nickname: "ชาย" },
  ]);
});
