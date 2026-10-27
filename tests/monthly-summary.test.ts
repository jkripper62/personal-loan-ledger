import { expect, it } from "vitest";
import { monthlyHistory, monthlySummary } from "../src/domain/monthly-summary";
import type { LedgerData, Loan, Payment } from "../src/domain/types";

const loan = (id: string, borrowerId: string, principalCents: number, startDate: string, extra: Partial<Loan> = {}) =>
  ({ id, borrowerId, principalCents, startDate, ...extra }) as Loan;
const paid = (id: string, loanId: string, date: string, principalCents: number, interestCents: number, extra: Partial<Payment> = {}) =>
  ({ id, loanId, date, principalCents, interestCents, totalCents: principalCents + interestCents, canceledAt: null, ...extra }) as Payment;

const data = {
  borrowers: [{ id: "b1", name: "สมชาย" }, { id: "b2", name: "สุดา" }],
  loans: [
    loan("l1", "b1", 5000000, "2026-07-15"),
    loan("l2", "b2", 3000000, "2026-10-05"),
    loan("trial", "b2", 999900, "2026-10-06", { recordStatus: "test" }),
  ],
  payments: [
    paid("p1", "l1", "2026-09-15", 0, 150000),
    paid("p2", "l1", "2026-10-15", 1000000, 150000),
    paid("p3", "l2", "2026-10-20", 0, 90000),
    paid("p4", "l2", "2026-10-21", 0, 90000, { canceledAt: "2026-10-22T00:00:00Z" }),
    paid("p5", "trial", "2026-10-21", 0, 77700),
    paid("p6", "l1", "2026-11-01", 0, 150000),
  ],
  rateChanges: [], adjustments: [], contacts: [], attachments: [], audit: [],
} as unknown as LedgerData;

it("adds up the real money received in a month, per borrower, ignoring cancelled and trial receipts", () => {
  expect(monthlySummary(data, "2026-10")).toEqual({
    month: "2026-10",
    interestCents: 240000,
    principalCents: 1000000,
    receivedCents: 1240000,
    paymentCount: 2,
    lentCents: 3000000,
    byBorrower: [
      { borrowerId: "b1", name: "สมชาย", interestCents: 150000, principalCents: 1000000 },
      { borrowerId: "b2", name: "สุดา", interestCents: 90000, principalCents: 0 },
    ],
  });
});

it("lists the last months oldest first for the chart, including empty months", () => {
  expect(monthlyHistory(data, "2026-11", 4).map((m) => [m.month, m.interestCents, m.principalCents])).toEqual([
    ["2026-08", 0, 0],
    ["2026-09", 150000, 0],
    ["2026-10", 240000, 1000000],
    ["2026-11", 150000, 0],
  ]);
});
