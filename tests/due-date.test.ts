import { expect, it } from "vitest";
import { nextDueDate, withNextDueDates } from "../src/domain/due-date";
import type { LedgerData, Loan, Payment } from "../src/domain/types";

const loan: Loan = {
  id: "loan", borrowerId: "a", source: "new", principalCents: 1000000,
  openingInterestCents: 0, rateBps: 1000, startDate: "2026-09-01",
  cycleStartDate: "2026-09-01", firstCycleEndDate: "2026-10-01",
  anchorDay: 1, dueDate: "2026-10-30", notes: "", createdAt: "2026-09-01T00:00:00Z",
};
const payment = (date: string, id: string, options: Partial<Payment> = {}): Payment => ({
  id, loanId: loan.id, date, totalCents: 10000, principalCents: 0,
  interestCents: 10000, createdAt: date + "T10:00:00Z",
  canceledAt: null, cancelReason: null, isPayoff: false, note: "", ...options,
});

it("keeps an unpaid old appointment overdue; it does not jump forward just because the calendar passed", () => {
  expect(nextDueDate(loan, [], "2026-11-11")).toBe("2026-10-30");
});
it("moves a paid appointment one month, including an early interest or principal receipt", () => {
  expect(nextDueDate(loan, [payment("2026-10-30", "on-time")], "2026-11-11")).toBe("2026-11-30");
  expect(nextDueDate(loan, [payment("2026-10-25", "early", { principalCents: 10000, interestCents: 0 })], "2026-11-11")).toBe("2026-11-30");
});
it("deduplicates split payments in the same month but advances for distinct monthly receipts", () => {
  const history = [payment("2026-10-20", "interest"), payment("2026-10-25", "principal"), payment("2026-11-07", "next")];
  expect(nextDueDate(loan, history, "2026-10-26")).toBe("2026-11-30");
  expect(nextDueDate(loan, history, "2026-11-11")).toBe("2026-12-30");
});
it("does not grant multiple missed months for one very late payment", () => {
  expect(nextDueDate(loan, [payment("2026-12-10", "late")], "2026-12-20")).toBe("2026-11-30");
});
it("uses the owner's original day 31 after clamping a month to day 30", () => {
  const lastDay = { ...loan, dueDate: "2026-10-31" };
  expect(nextDueDate(lastDay, [payment("2026-10-31", "oct")], "2026-11-01")).toBe("2026-11-30");
  expect(nextDueDate(lastDay, [payment("2026-10-31", "oct"), payment("2026-11-10", "nov")], "2026-11-11")).toBe("2026-12-31");
});
it("allows an owner-selected date to start fresh without replaying earlier receipts, even after an old receipt is corrected", () => {
  const changed = { ...loan, dueDate: "2026-12-05", dueDateSetAt: "2026-11-11T12:00:00.000Z" };
  const old = payment("2026-11-02", "old", { createdAt: "2026-11-02T08:00:00.000Z", canceledAt: "2026-11-12T10:00:00.000Z" });
  const corrected = payment("2026-11-02", "corrected", { replacesPaymentId: "old", createdAt: "2026-11-12T10:00:00.001Z" });
  expect(nextDueDate(changed, [old, corrected], "2026-12-01")).toBe("2026-12-05");
  expect(nextDueDate(changed, [old, corrected, payment("2026-11-20", "new")], "2026-12-01")).toBe("2027-01-05");
});
it("cancelling or editing a receipt recalculates the displayed appointment without touching the stored loan", () => {
  const receipt = payment("2026-10-15", "paid");
  const data: LedgerData = { borrowers: [], loans: [loan], payments: [receipt],
    adjustments: [], rateChanges: [], contacts: [], attachments: [], audit: [] };
  const view = withNextDueDates(data, "2026-11-11");
  expect(view.loans[0].dueDate).toBe("2026-11-30");
  expect(loan.dueDate).toBe("2026-10-30");
  expect(withNextDueDates({ ...data, payments: [{ ...receipt, canceledAt: "2026-11-11T10:00:00Z" }] }, "2026-11-11").loans[0].dueDate).toBe("2026-10-30");
  expect(nextDueDate(loan, [payment("2026-12-10", "future")], "2026-11-11")).toBe("2026-10-30");
});
