import { expect, it } from "vitest";
import { followUps } from "../src/domain/follow-up";
import type { Borrower, LedgerData, Loan, Payment } from "../src/domain/types";

const borrower = (id: string, name: string, nickname = ""): Borrower =>
  ({ id, name, nickname, phone: "", lineId: "", facebookUrl: "", notes: "", createdAt: "2026-07-01T00:00:00Z" });
const loan = (id: string, borrowerId: string, principalCents: number, rateBps: number, startDate: string, dueDate: string, extra: Partial<Loan> = {}): Loan => {
  const anchorDay = Number(startDate.slice(-2));
  const [y, m] = startDate.split("-").map(Number);
  return {
    id, borrowerId, source: "new", principalCents, openingInterestCents: 0, rateBps, startDate,
    cycleStartDate: startDate, firstCycleEndDate: `${y}-${String(m + 1).padStart(2, "0")}-${startDate.slice(-2)}`,
    anchorDay, dueDate, notes: "", createdAt: `${startDate}T00:00:00Z`, ...extra,
  };
};
const interestOnly = (id: string, loanId: string, date: string, cents: number, extra: Partial<Payment> = {}): Payment => ({
  id, loanId, date, totalCents: cents, principalCents: 0, interestCents: cents, note: "",
  createdAt: `${date}T01:00:00Z`, canceledAt: null, cancelReason: null, isPayoff: false, interestMode: "owner", ...extra,
});

const data: LedgerData = {
  borrowers: [borrower("b1", "นพดล ทองคำ", "นพ"), borrower("b2", "สมชาย ใจดี"), borrower("b3", "มาลี ศรีสุข"), borrower("b4", "วิชัย มั่นคง")],
  loans: [
    loan("never-paid", "b1", 1500000, 400, "2026-08-01", "2026-10-01"),
    loan("on-time", "b2", 5000000, 300, "2026-07-15", "2026-10-15"),
    loan("late", "b3", 2000000, 200, "2026-08-10", "2026-09-10"),
    loan("tomorrow", "b4", 1000000, 500, "2026-09-02", "2026-10-02"),
    loan("closed", "b2", 1000000, 300, "2026-07-15", "2026-08-15"),
    loan("trial", "b2", 1000000, 300, "2026-07-15", "2026-08-15", { recordStatus: "test" }),
  ],
  payments: [
    interestOnly("p1", "on-time", "2026-08-15", 150000),
    interestOnly("p2", "on-time", "2026-09-15", 150000),
    { ...interestOnly("p3", "closed", "2026-08-15", 1030000), principalCents: 1000000, interestCents: 30000, isPayoff: true },
  ],
  rateChanges: [], adjustments: [], contacts: [], attachments: [], audit: [],
};

it("lists who to chase, most urgent first, with the interest each borrower still owes", () => {
  expect(followUps(data, "2026-10-01").map((item) => ({
    loanId: item.loan.id, status: item.status, daysLate: item.daysLate, principal: item.principalCents,
    owedNow: item.interestOwedCents, dueOnDueDate: item.interestDueCents,
  }))).toEqual([
    // 20,000 at 2% → 400 a month; one full month (10 Aug–10 Sep) unpaid, 21 days past the 10 Sep due date.
    { loanId: "late", status: "overdue", daysLate: 21, principal: 2000000, owedNow: 40000, dueOnDueDate: 40000 },
    // 15,000 at 4% → 600 a month; two months unpaid by the 1 Oct due date.
    { loanId: "never-paid", status: "today", daysLate: 0, principal: 1500000, owedNow: 120000, dueOnDueDate: 120000 },
    // 10,000 at 5% → 500 for the first month, due tomorrow.
    { loanId: "tomorrow", status: "tomorrow", daysLate: 0, principal: 1000000, owedNow: 0, dueOnDueDate: 50000 },
    // 50,000 at 3% → 1,500 a month, paid up to 15 Sep; the next 1,500 falls due 15 Oct.
    { loanId: "on-time", status: "upcoming", daysLate: 0, principal: 5000000, owedNow: 0, dueOnDueDate: 150000 },
  ]);
});

it("treats a loan the owner marked as normal as not overdue, but still shows its unpaid interest", () => {
  const marked = { ...data, loans: data.loans.map((l) => (l.id === "late" ? { ...l, statusOverride: "normal" as const } : l)) };
  const item = followUps(marked, "2026-10-01").find((entry) => entry.loan.id === "late");
  expect(item).toMatchObject({ status: "upcoming", daysLate: 0, interestOwedCents: 40000 });
});
