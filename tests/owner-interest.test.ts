import { expect, it } from "vitest";
import { calculateLedger, validatePayment } from "../src/domain/ledger";
import { referenceLedger } from "./reference-ledger";
import type { Loan, Payment } from "../src/domain/types";

const loan: Loan = { id: "loan", borrowerId: "person", source: "existing", principalCents: 200000,
  openingInterestCents: 0, rateBps: 1000, startDate: "2026-10-10", cycleStartDate: "2026-09-13",
  firstCycleEndDate: "2026-10-13", anchorDay: 13, dueDate: "2026-10-13", notes: "", createdAt: "2026-10-10T00:00:00Z" };
const receipt: Payment = { id: "payment", loanId: loan.id, date: "2026-10-13", totalCents: 20000,
  principalCents: 0, interestCents: 20000, interestMode: "owner", isPayoff: false, note: "",
  createdAt: "2026-10-15T00:00:00Z", canceledAt: null, cancelReason: null };
const input = { loan, payments: [], adjustments: [], rateChanges: [] };

it("records the owner's 4400 payoff as 4000 principal and 400 received interest, independently of the formula", () => {
  const selectedLoan = { ...loan, principalCents: 400000, cycleStartDate: "2026-09-25", firstCycleEndDate: "2026-10-25", anchorDay: 25 };
  const payment = { ...receipt, date: "2026-10-24", totalCents: 440000, principalCents: 400000, interestCents: 40000, isPayoff: true };
  const selected = { ...input, loan: selectedLoan, payments: [payment], asOf: "2027-01-25" };
  expect(() => validatePayment({ ...selected, payment })).not.toThrow();
  expect(calculateLedger(selected)).toMatchObject({ principalCents: 0, closed: true, principalPaidCents: 400000,
    interestPaidCents: 40000, earnedInterestCents: 18667, manualInterestDifferenceCents: 21333 });
  expect(calculateLedger(selected)).toMatchObject(referenceLedger(selected));
});

it("closes with owner-agreed zero interest without recording the formula interest as cash received", () => {
  const payment = { ...receipt, totalCents: loan.principalCents, principalCents: loan.principalCents, interestCents: 0, isPayoff: true };
  const selected = { ...input, payments: [payment], asOf: "2027-01-13" };
  expect(() => validatePayment({ ...input, payment })).not.toThrow();
  expect(calculateLedger(selected)).toMatchObject({ closed: true, interestPaidCents: 0, payoffInterestCents: 0,
    earnedInterestCents: 2000, uncollectedInterestCents: 2000 });
  expect(calculateLedger(selected)).toMatchObject(referenceLedger(selected));
});

it("accepts the owner's actual interest above the formula without changing principal or prepaying the next cycle", () => {
  expect(() => validatePayment({ ...input, payment: receipt })).not.toThrow();
  expect(calculateLedger({ ...input, payments: [receipt], asOf: receipt.date })).toMatchObject({
    principalCents: 200000, interestPaidCents: 20000, payoffInterestCents: 0,
    earnedInterestCents: 2000, manualInterestDifferenceCents: 18000,
  });
  const next = { ...input, payments: [receipt], asOf: "2026-11-13" };
  expect(calculateLedger(next)).toMatchObject({ principalCents: 200000, interestCents: 20000, currentRateBps: 1000 });
  expect(calculateLedger(next)).toMatchObject(referenceLedger(next));
});

it("records a late receipt without adding penalties or changing the contracted rate", () => {
  const payment = { ...receipt, date: "2026-10-15", dateEstimated: true };
  const selected = { ...input, payments: [payment], asOf: payment.date };
  expect(() => validatePayment({ ...input, payment })).not.toThrow();
  expect(calculateLedger(selected)).toMatchObject({ principalCents: 200000, currentRateBps: 1000,
    earnedInterestCents: 3290, interestPaidCents: 20000, payoffInterestCents: 0, manualInterestDifferenceCents: 16710 });
  expect(calculateLedger(selected)).toMatchObject(referenceLedger(selected));
});

it("excludes the original canceled receipt when an owner amount is corrected", () => {
  const old = { ...receipt, canceledAt: "2026-10-15T00:01:00Z", cancelReason: "แก้ไข" };
  const replacement = { ...receipt, id: "replacement", totalCents: 15000, interestCents: 15000,
    replacesPaymentId: old.id, date: "2026-10-14" };
  expect(calculateLedger({ ...input, payments: [old, replacement], asOf: "2026-10-15" }))
    .toEqual(calculateLedger({ ...input, payments: [replacement], asOf: "2026-10-15" }));
  expect(calculateLedger({ ...input, payments: [old, replacement], asOf: "2026-10-15" }).interestPaidCents).toBe(15000);
});

it("allows a final principal return with owner interest and stops subsequent accrual", () => {
  const payment = { ...receipt, principalCents: 200000, interestCents: 50000, totalCents: 250000 };
  expect(() => validatePayment({ ...input, payment })).not.toThrow();
  const selected = { ...input, payments: [payment], asOf: "2027-01-13" };
  expect(calculateLedger(selected)).toMatchObject({ principalCents: 0, closed: true,
    interestPaidCents: 50000, earnedInterestCents: 2000, manualInterestDifferenceCents: 48000 });
  expect(calculateLedger(selected)).toMatchObject(referenceLedger(selected));
});

it("keeps allocation, principal and exact automated payoff checks", () => {
  expect(() => validatePayment({ ...input, payment: { ...receipt, totalCents: 19999 } })).toThrow("ยอดรับจริง");
  expect(() => validatePayment({ ...input, payment: { ...receipt, principalCents: 200001, totalCents: 220001 } })).toThrow("เกินเงินต้น");
  expect(() => validatePayment({ ...input, payment: { ...receipt, interestMode: undefined, principalCents: 200000, totalCents: 220000, isPayoff: true } })).toThrow("ดอกเกิน");
  expect(() => validatePayment({ ...input, payment: { ...receipt, principalCents: 100000, totalCents: 120000, isPayoff: true } })).toThrow("ยอดปิดหนี้");
});
