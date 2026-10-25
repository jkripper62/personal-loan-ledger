import { expect, it } from "vitest";
import { calculateLedger, validatePayment } from "../src/domain/ledger";
import { calculateInterestForecast } from "../src/domain/forecast";
import { referenceLedger } from "./reference-ledger";
import type { Loan, Payment, Adjustment, RateChange } from "../src/domain/types";

const after = (date: string, days: number) => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};
const calendarDate = (month: number, anchor: number) =>
  new Date(Date.UTC(2024, month, Math.min(anchor, new Date(Date.UTC(2024, month + 1, 0)).getUTCDate())))
    .toISOString().slice(0, 10);

it("matches an independent interval oracle across 180 dated repayment, adjustment and rate scenarios", () => {
  for (let scenario = 0; scenario < 180; scenario++) {
    const anchor = [1, 15, 31][scenario % 3];
    const month = scenario % 2;
    const calendarStart = calendarDate(month, anchor);
    const start = after(calendarStart, scenario % 6);
    const loan: Loan = {
      id: "audit-loan", borrowerId: "audit-person", source: "existing",
      principalCents: 1000000 + scenario * 113, openingInterestCents: scenario % 5 * 71,
      rateBps: [0, 700, 750, 1000, 1500][scenario % 5],
      startDate: start, cycleStartDate: calendarStart, firstCycleEndDate: calendarDate(month + 1, anchor),
      anchorDay: anchor, dueDate: calendarDate(month + 1, anchor), notes: "",
      createdAt: `${start}T00:00:00Z`,
    };
    const payments: Payment[] = [];
    const adjustments: Adjustment[] = [];
    const rateChanges: RateChange[] = scenario % 3 === 0 ? [{
      id: "rate", loanId: loan.id, effectiveDate: loan.firstCycleEndDate,
      rateBps: [0, 750, 1000][scenario % 7 % 3], reason: "audit", createdAt: `${start}T00:00:00Z`,
    }] : [];
    const input = { loan, payments, adjustments, rateChanges };
    const receive = (date: string, principalCents: number, interestCents: number, isPayoff = false, canceled = false) => {
      const payment: Payment = {
        id: `payment-${payments.length}`, loanId: loan.id, date,
        totalCents: principalCents + interestCents, principalCents, interestCents,
        note: "audit", isPayoff, createdAt: `${date}T12:00:00Z`,
        interestMode: scenario % 3 === 0 ? "owner" : undefined,
        canceledAt: canceled ? `${date}T13:00:00Z` : null, cancelReason: canceled ? "audit" : null,
      };
      if (!canceled) validatePayment({ ...input, payment });
      payments.push(payment);
    };
    receive(after(start, 10), Math.floor(loan.principalCents / 4), 0);
    const earlyInterest = referenceLedger({ ...input, asOf: after(start, 15) }).payoffInterestCents;
    if (earlyInterest > 0) receive(after(start, 15), 0, earlyInterest + (scenario % 3 === 0 ? 5432 : 0));
    if (scenario % 2 === 0) adjustments.push({
      id: "adjustment", loanId: loan.id, date: after(start, 20),
      principalDeltaCents: scenario % 4 === 0 ? 10000 : -10000,
      interestDeltaCents: scenario % 4 === 0 ? 101
        : referenceLedger({ ...input, asOf: after(start, 20) }).payoffInterestCents >= 101 ? -101 : 0,
      reason: "audit", createdAt: `${after(start, 20)}T12:00:00Z`, canceledAt: null, cancelReason: null,
    });
    if (scenario % 5 === 0) receive(after(start, 25), 1000, 0, false, true);
    if (scenario % 4 === 0) {
      const date = after(start, 45), balance = referenceLedger({ ...input, asOf: date });
      receive(date, balance.principalCents, scenario % 3 === 0
        ? scenario % 8 === 0 ? 0 : balance.payoffInterestCents + 5432 : balance.payoffInterestCents, true);
    } else if (scenario % 4 === 1) {
      const date = after(start, 45), balance = referenceLedger({ ...input, asOf: date });
      receive(date, balance.principalCents, 0);
    }
    for (const elapsed of [0, 9, 10, 15, 20, 30, 45, 60, 90]) {
      const asOf = after(start, elapsed);
      expect(calculateLedger({ ...input, asOf }), `scenario ${scenario}, day ${elapsed}`)
        .toMatchObject(referenceLedger({ ...input, asOf }));
      const monthStart = `${asOf.slice(0, 7)}-01`;
      const next = new Date(`${monthStart}T00:00:00Z`);
      next.setUTCMonth(next.getUTCMonth() + 1);
      const confirmed = { ...input, payments: payments.filter(p => p.date <= asOf),
        adjustments: adjustments.filter(a => a.date <= asOf) };
      const baseline = referenceLedger({ ...confirmed, asOf: monthStart < start ? start : monthStart });
      const projected = referenceLedger({ ...confirmed, asOf: next.toISOString().slice(0, 10) });
      expect(calculateInterestForecast({ ...input, asOf }).month.forecastInterestCents,
        `month projection, scenario ${scenario}, day ${elapsed}`)
        .toBe(projected.earnedInterestCents - baseline.earnedInterestCents);
    }
  }
});
