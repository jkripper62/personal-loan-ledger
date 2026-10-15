import { expect, it } from "vitest";
import { calculateLedger, validatePayment } from "../src/domain/ledger";
import type { Adjustment, Loan, Payment } from "../src/domain/types";

it("distinguishes a 20-baht partial opening period from a confirmed 200-baht full installment", () => {
  const loan: Loan = { id: "loan", borrowerId: "person", source: "existing",
    principalCents: 200000, openingInterestCents: 0, rateBps: 1000,
    startDate: "2026-10-10", cycleStartDate: "2026-09-13", firstCycleEndDate: "2026-10-13",
    anchorDay: 13, dueDate: "2026-10-13", notes: "", createdAt: "2026-10-10T00:00:00Z" };
  const payment: Payment = { id: "receipt", loanId: loan.id, date: "2026-10-13",
    totalCents: 20000, principalCents: 0, interestCents: 20000, isPayoff: false,
    note: "ดอกเต็มงวด", createdAt: "2026-10-15T00:00:00Z", canceledAt: null, cancelReason: null };
  const input = { loan, payments: [], adjustments: [], rateChanges: [] };
  expect(calculateLedger({ ...input, asOf: payment.date }).payoffInterestCents).toBe(2000);
  expect(() => validatePayment({ ...input, payment })).toThrow("เกินดอก");
  expect(() => validatePayment({ ...input, payment: { ...payment, totalCents: 2000, interestCents: 2000 } })).not.toThrow();
  const adjustment: Adjustment = { id: "opening-reconciliation", loanId: loan.id, date: loan.startDate,
    principalDeltaCents: 0, interestDeltaCents: 18000, reason: "ยืนยันดอกก่อนเริ่มบันทึกของงวดเต็ม",
    createdAt: payment.createdAt, canceledAt: null, cancelReason: null };
  expect(() => validatePayment({ ...input, adjustments: [adjustment], payment })).not.toThrow();
  const afterReceipt = calculateLedger({ ...input, adjustments: [adjustment], payments: [payment], asOf: payment.date });
  expect(afterReceipt).toMatchObject({ principalCents: 200000, principalPaidCents: 0,
    interestPaidCents: 20000, payoffInterestCents: 0, nextCycleInterestCents: 20000 });
  expect(calculateLedger({ ...input, adjustments: [adjustment], payments: [payment], asOf: "2026-11-13" }))
    .toMatchObject({ principalCents: 200000, interestCents: 20000, currentRateBps: 1000 });
});
