import type {
  Loan,
  Payment,
  RateChange,
  Adjustment,
  LedgerSnapshot,
  InterestPeriod,
} from "./types.js";
import { compareEvents } from "./chronology.js";
type LedgerInput = {
  loan: Loan;
  payments: Payment[];
  rateChanges: RateChange[];
  adjustments: Adjustment[];
  asOf: string;
};
const DAY = 86400000;
function parseDate(date: string): Date {
  const value = new Date(`${date}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(value.getTime()) ||
    value.toISOString().slice(0, 10) !== date
  )
    throw new Error("วันที่ไม่ถูกต้อง");
  return value;
}
export function daysBetween(start: string, end: string): number {
  return (parseDate(end).getTime() - parseDate(start).getTime()) / DAY;
}
export function addMonths(
  date: string,
  count: number,
  anchorDay = parseDate(date).getUTCDate(),
): string {
  if (
    !Number.isSafeInteger(count) ||
    !Number.isInteger(anchorDay) ||
    anchorDay < 1 ||
    anchorDay > 31
  )
    throw new Error("รอบเดือนหรือวันตัดรอบไม่ถูกต้อง");
  const source = parseDate(date);
  const first = new Date(
    Date.UTC(source.getUTCFullYear(), source.getUTCMonth() + count, 1),
  );
  const last = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
  ).getUTCDate();
  first.setUTCDate(Math.min(anchorDay, last));
  return first.toISOString().slice(0, 10);
}
export function todayBangkok(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
function interest(
  principal: number,
  rate: number,
  days: number,
  fullDays: number,
): number {
  const numerator = BigInt(principal) * BigInt(rate) * BigInt(days);
  const denominator = 10000n * BigInt(fullDays);
  const rounded = (numerator * 2n + denominator) / (denominator * 2n);
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("ยอดเงินเกินขอบเขตการคำนวณที่แม่นยำ");
  return Number(rounded);
}
export function calculateLedger({
  loan,
  payments,
  rateChanges,
  adjustments,
  asOf,
}: LedgerInput): LedgerSnapshot {
  parseDate(asOf);
  parseDate(loan.startDate);
  parseDate(loan.cycleStartDate);
  parseDate(loan.firstCycleEndDate);
  if (
    loan.cycleStartDate > loan.startDate ||
    loan.firstCycleEndDate <= loan.startDate ||
    asOf < loan.startDate
  )
    throw new Error("วันที่เริ่มนับยอดหรือรอบดอกไม่ถูกต้อง");
  if (
    !Number.isInteger(loan.anchorDay) ||
    loan.anchorDay < 1 ||
    loan.anchorDay > 31
  )
    throw new Error("วันตัดรอบไม่ถูกต้อง");
  for (const value of [
    loan.principalCents,
    loan.openingInterestCents,
    loan.rateBps,
  ]) {
    if (!Number.isSafeInteger(value) || value < 0)
      throw new Error("ยอดเงินหรืออัตราดอกไม่ถูกต้อง");
  }
  let principal = loan.principalCents,
    dueInterest = loan.openingInterestCents;
  let start = loan.startDate,
    fullStart = loan.cycleStartDate,
    end = loan.firstCycleEndDate;
  let base = principal,
    rate = loan.rateBps,
    principalPaid = 0,
    interestPaid = 0,
    manualInterestDifference = 0;
  const periods: InterestPeriod[] = [];
  let finalized = false;
  let accrualEnd = asOf;
  const activePayments = payments.filter(
    (p) => p.loanId === loan.id && !p.canceledAt && p.date <= asOf,
  );
  const selectedRates = rateChanges
    .filter((c) => c.loanId === loan.id && !c.canceledAt)
    .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
  for (const change of selectedRates)
    if (change.effectiveDate <= fullStart) rate = change.rateBps;
  const postPeriods = (date: string) => {
    while (!finalized && end <= date) {
      const days = daysBetween(start, end),
        fullDays = daysBetween(fullStart, end);
      const charge = interest(base, rate, days, fullDays);
      dueInterest += charge;
      periods.push({
        startDate: start,
        endDate: end,
        principalCents: base,
        rateBps: rate,
        interestCents: charge,
        days,
        fullDays,
      });
      fullStart = end;
      start = end;
      end = addMonths(end, 1, loan.anchorDay);
      base = principal;
      for (const change of selectedRates)
        if (change.effectiveDate <= start) rate = change.rateBps;
    }
  };
  const events = [
    ...activePayments.map(
      (value) =>
        ({ kind: "payment", value }) satisfies {
          kind: "payment";
          value: Payment;
        },
    ),
    ...adjustments
      .filter((a) => a.loanId === loan.id && !a.canceledAt && a.date <= asOf)
      .map(
        (value) =>
          ({ kind: "adjustment", value }) satisfies {
            kind: "adjustment";
            value: Adjustment;
          },
      ),
  ].sort((a, b) => compareEvents(a.value, b.value));
  for (const event of events) {
    if (event.kind === "adjustment") {
      const a = event.value;
      postPeriods(a.date);
      principal += a.principalDeltaCents;
      dueInterest += a.interestDeltaCents;
      if (a.date === start) base = principal;
      if (finalized)
        throw new Error("ต้องยกเลิกรายการคืนต้นสุดท้ายก่อนปรับยอด");
      continue;
    }
    const p = event.value;
    postPeriods(p.date);
    if (!finalized && (p.isPayoff || p.principalCents === principal)) {
      const days = daysBetween(start, p.date),
        fullDays = daysBetween(fullStart, end);
      const charge = interest(base, rate, days, fullDays);
      dueInterest += charge;
      if (days > 0)
        periods.push({
          startDate: start,
          endDate: p.date,
          principalCents: base,
          rateBps: rate,
          interestCents: charge,
          days,
          fullDays,
        });
      finalized = true;
      accrualEnd = p.date;
    }
    principal -= p.principalCents;
    let appliedInterest = p.interestCents;
    if (p.interestMode === "owner" && !p.isPayoff) {
      const accruedAtReceipt = finalized ? 0
        : interest(base, rate, daysBetween(start, p.date), daysBetween(fullStart, end));
      appliedInterest = Math.min(p.interestCents, Math.max(0, dueInterest + accruedAtReceipt));
      manualInterestDifference += p.interestCents - appliedInterest;
    }
    dueInterest -= appliedInterest;
    principalPaid += p.principalCents;
    interestPaid += p.interestCents;
    if (p.date === start) base = principal;
  }
  postPeriods(asOf);
  const accrued = finalized
    ? 0
    : interest(
        base,
        rate,
        Math.max(0, daysBetween(start, asOf)),
        daysBetween(fullStart, end),
      );
  let nextRate = rate;
  for (const change of selectedRates)
    if (change.effectiveDate <= end) nextRate = change.rateBps;
  const arrears = Math.max(0, dueInterest),
    payableAccrued = Math.max(0, accrued + Math.min(0, dueInterest));
  // Gross interest is independent of receipts and brought-forward balances.
  const earnedInterest = periods.reduce((sum, period) => sum + period.interestCents, 0) + accrued;
  const cycleEarned = periods
    .filter((period) => period.startDate >= fullStart)
    .reduce((sum, period) => sum + period.interestCents, accrued);
  const fullDays = daysBetween(fullStart, end);
  const elapsedDays = daysBetween(start, accrualEnd);
  const cycleForecast = finalized ? cycleEarned : interest(base, rate, daysBetween(start, end), fullDays);
  for (const value of [
    principal,
    dueInterest,
    accrued,
    principalPaid,
    interestPaid,
    manualInterestDifference,
    earnedInterest,
    cycleForecast,
    principal + arrears + payableAccrued,
  ]) {
    if (!Number.isSafeInteger(value))
      throw new Error("ยอดเงินเกินขอบเขตการคำนวณที่แม่นยำ");
  }
  return {
    principalCents: principal,
    interestCents: arrears,
    accruedInterestCents: payableAccrued,
    payoffInterestCents: arrears + payableAccrued,
    totalCents: principal + arrears,
    payoffTotalCents: principal + arrears + payableAccrued,
    principalPaidCents: principalPaid,
    interestPaidCents: interestPaid,
    manualInterestDifferenceCents: manualInterestDifference,
    currentRateBps: rate,
    currentCycleStartDate: fullStart,
    currentCycleEndDate: end,
    nextCycleInterestCents: interest(principal, nextRate, 1, 1),
    earnedInterestCents: earnedInterest,
    cycleInterest: {
      chargeStartDate: start,
      endDate: end,
      accrualEndDate: accrualEnd,
      accruing: !finalized,
      elapsedDays,
      fullDays,
      fullInterestCents: interest(base, rate, 1, 1),
      earnedInterestCents: cycleEarned,
      forecastInterestCents: cycleForecast,
    },
    periods,
    closed: principal === 0 && dueInterest + accrued === 0,
  };
}

export function validatePayment(
  input: Omit<LedgerInput, "asOf"> & { payment: Payment },
): void {
  const { loan, payment } = input;
  parseDate(payment.date);
  if (payment.loanId !== loan.id)
    throw new Error("รายการรับชำระไม่ตรงกับรายการกู้");
  if (payment.date < loan.startDate)
    throw new Error("วันรับชำระต้องไม่ก่อนวันเริ่มนับยอด");
  if (payment.date > todayBangkok())
    throw new Error("ไม่สามารถรับชำระล่วงหน้าได้");
  for (const value of [
    payment.totalCents,
    payment.principalCents,
    payment.interestCents,
  ]) {
    if (!Number.isSafeInteger(value) || value < 0)
      throw new Error("ยอดเงินต้องเป็นจำนวนสตางค์ที่ถูกต้องและไม่ติดลบ");
  }
  if (
    payment.totalCents <= 0 ||
    payment.principalCents + payment.interestCents !== payment.totalCents
  )
    throw new Error("คืนต้นและดอกต้องรวมเท่ากับยอดรับจริง");
  const beforePayment = (event: Payment | Adjustment) =>
    compareEvents(event, payment) < 0;
  const balance = calculateLedger({
    ...input,
    payments: input.payments.filter(beforePayment),
    adjustments: input.adjustments.filter(beforePayment),
    asOf: payment.date,
  });
  if (balance.closed) throw new Error("รายการกู้นี้ปิดหนี้แล้ว");
  if (payment.principalCents > balance.principalCents)
    throw new Error("ยอดคืนต้นเกินเงินต้นคงเหลือ");
  if (payment.interestMode !== "owner" && payment.interestCents > balance.payoffInterestCents)
    throw new Error("ยอดชำระดอกเกินดอกที่เกิดขึ้นถึงวันรับชำระ");
  if (
    payment.isPayoff &&
    (payment.principalCents !== balance.principalCents ||
      payment.interestCents !== balance.payoffInterestCents)
  )
    throw new Error("ยอดปิดหนี้ต้องตรงกับต้นและดอกถึงวันรับชำระ");
}
