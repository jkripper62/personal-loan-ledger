import { expect, it } from "vitest";
import { calculateLedger } from "../src/domain/ledger";
import { referenceLedger } from "./reference-ledger";
import type { Loan, Adjustment } from "../src/domain/types";

it("corrects two mistaken principal additions without inventing a repayment or changing interest adjustments", () => {
  const loan: Loan = { id: "test", borrowerId: "owner", source: "existing", principalCents: 2000000,
    openingInterestCents: 0, rateBps: 1000, startDate: "2026-10-19", cycleStartDate: "2026-10-19",
    firstCycleEndDate: "2026-11-10", anchorDay: 10, dueDate: "2026-11-10", notes: "", createdAt: "2026-10-19T00:00:00Z" };
  const adjustments: Adjustment[] = [2000000, 2000000, -4000000].map((delta, index) => ({
    id: `adjustment-${index}`, loanId: loan.id, date: loan.startDate, principalDeltaCents: delta,
    interestDeltaCents: index === 0 ? 1000 : 0, reason: "แก้ข้อมูลต้น", createdAt: `2026-10-19T0${index}:00:00Z`,
    canceledAt: null, cancelReason: null,
  }));
  const input = { loan, payments: [], adjustments, rateChanges: [], asOf: "2026-10-19" };
  expect(calculateLedger({ ...input, adjustments: adjustments.slice(0, 2) }).principalCents).toBe(6000000);
  expect(calculateLedger(input)).toMatchObject({ principalCents: 2000000, principalPaidCents: 0,
    interestCents: 1000, nextCycleInterestCents: 200000 });
  expect(calculateLedger(input)).toMatchObject(referenceLedger(input));
  const next = { ...input, asOf: "2026-11-10" };
  expect(calculateLedger(next)).toMatchObject({ principalCents: 2000000, interestCents: 201000 });
  expect(calculateLedger(next)).toMatchObject(referenceLedger(next));
});
