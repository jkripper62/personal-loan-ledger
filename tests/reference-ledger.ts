import type { Adjustment, Loan, Payment, RateChange, LedgerSnapshot } from "../src/domain/types";

type Input = { loan: Loan; payments: Payment[]; adjustments: Adjustment[]; rateChanges: RateChange[]; asOf: string };
type ReferenceBalance = Pick<LedgerSnapshot, "principalCents" | "interestCents" | "accruedInterestCents" |
  "payoffInterestCents" | "payoffTotalCents" | "totalCents" | "earnedInterestCents" | "principalPaidCents" |
  "interestPaidCents" | "manualInterestDifferenceCents" | "closed">;
const day = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86400000;
const nextBoundary = (date: string, anchor: number) => {
  const value = new Date(`${date}T00:00:00Z`);
  const year = value.getUTCFullYear(), month = value.getUTCMonth() + 1;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(anchor, last))).toISOString().slice(0, 10);
};
const roundedCharge = (principal: number, rate: number, elapsed: number, cycleDays: number) => {
  const numerator = BigInt(principal) * BigInt(rate) * BigInt(elapsed);
  const denominator = BigInt(cycleDays) * 10000n;
  const whole = numerator / denominator, remainder = numerator % denominator;
  return Number(whole + (remainder * 2n >= denominator ? 1n : 0n));
};

/** Audit oracle: enumerates calendar intervals and derives each base from dated balances.
 * Does not call production date, interest, event-ordering, or calculation helpers. */
export function referenceLedger(input: Input, memo = new Map<string, ReferenceBalance>()): ReferenceBalance {
  const { loan, asOf } = input;
  const events = [
    ...input.payments.filter(p => p.loanId === loan.id && !p.canceledAt && p.date <= asOf)
      .map(value => ({ kind: "payment", value }) satisfies { kind: "payment"; value: Payment }),
    ...input.adjustments.filter(a => a.loanId === loan.id && !a.canceledAt && a.date <= asOf)
      .map(value => ({ kind: "adjustment", value }) satisfies { kind: "adjustment"; value: Adjustment }),
  ].sort((a, b) => a.value.date.localeCompare(b.value.date)
    || a.value.createdAt.localeCompare(b.value.createdAt) || a.value.id.localeCompare(b.value.id));
  const key = `${loan.id}:${asOf}:${events.map(event => `${event.kind}:${event.value.id}`).join(",")}`;
  const cached = memo.get(key);
  if (cached) return cached;
  let principal = loan.principalCents, paidPrincipal = 0, paidInterest = 0;
  let appliedInterest = 0;
  let interestAdjustment = 0, stopped: string | undefined;
  for (const [index, event] of events.entries()) {
    if (event.kind === "adjustment") {
      principal += event.value.principalDeltaCents;
      interestAdjustment += event.value.interestDeltaCents;
    } else {
      let applied = event.value.interestCents;
      if (event.value.interestMode === "owner" && !event.value.isPayoff) {
        const prior = events.slice(0, index);
        const available = referenceLedger({ ...input, asOf: event.value.date,
          payments: prior.filter(item => item.kind === "payment").map(item => item.value),
          adjustments: prior.filter(item => item.kind === "adjustment").map(item => item.value),
        }, memo).payoffInterestCents;
        applied = Math.min(applied, available);
      }
      appliedInterest += applied;
      if (!stopped && (event.value.isPayoff || event.value.principalCents === principal)) stopped = event.value.date;
      principal -= event.value.principalCents;
      paidPrincipal += event.value.principalCents;
      paidInterest += event.value.interestCents;
    }
  }
  const principalAt = (date: string) => events.filter(event => event.value.date <= date)
    .reduce((value, event) => value + (event.kind === "adjustment"
      ? event.value.principalDeltaCents : -event.value.principalCents), loan.principalCents);
  const limit = stopped && stopped < asOf ? stopped : asOf;
  let chargeStart = loan.startDate, calendarStart = loan.cycleStartDate, calendarEnd = loan.firstCycleEndDate;
  let posted = 0, accrued = 0;
  while (chargeStart < limit) {
    const cut = calendarEnd < limit ? calendarEnd : limit;
    const rate = [...input.rateChanges].filter(change => change.loanId === loan.id && !change.canceledAt && change.effectiveDate <= calendarStart)
      .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))[0]?.rateBps ?? loan.rateBps;
    const charge = roundedCharge(principalAt(chargeStart), rate, day(cut) - day(chargeStart), day(calendarEnd) - day(calendarStart));
    if (calendarEnd <= asOf && calendarEnd <= limit || stopped && stopped <= asOf && cut === stopped) posted += charge;
    else accrued += charge;
    chargeStart = calendarEnd;
    calendarStart = calendarEnd;
    calendarEnd = nextBoundary(calendarEnd, loan.anchorDay);
  }
  const due = loan.openingInterestCents + interestAdjustment + posted - appliedInterest;
  const arrears = Math.max(0, due), payableAccrued = Math.max(0, accrued + Math.min(0, due));
  const result = {
    principalCents: principal, interestCents: arrears, accruedInterestCents: payableAccrued,
    payoffInterestCents: arrears + payableAccrued,
    payoffTotalCents: principal + arrears + payableAccrued,
    totalCents: principal + arrears,
    earnedInterestCents: posted + accrued,
    principalPaidCents: paidPrincipal, interestPaidCents: paidInterest,
    manualInterestDifferenceCents: paidInterest - appliedInterest,
    closed: principal === 0 && due + accrued === 0,
  };
  memo.set(key, result);
  return result;
}
