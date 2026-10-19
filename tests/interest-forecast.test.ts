import { describe, expect, it } from "vitest";
import { calculateInterestForecast } from "../src/domain/forecast";
import type { Loan, Payment } from "../src/domain/types";

const loan: Loan = {
  id: "loan", borrowerId: "person", source: "existing",
  principalCents: 3000000, openingInterestCents: 0, rateBps: 1000,
  startDate: "2026-09-01", cycleStartDate: "2026-09-01",
  firstCycleEndDate: "2026-10-01", anchorDay: 1, dueDate: "2026-10-01",
  notes: "", createdAt: "2026-09-01T00:00:00Z",
};
const payment = (values: Partial<Payment>): Payment => ({
  id: "payment", loanId: loan.id, date: "2026-09-11", totalCents: 0,
  principalCents: 0, interestCents: 0, note: "", createdAt: "2026-09-11T00:00:00Z",
  canceledAt: null, cancelReason: null, isPayoff: false, ...values,
});
const forecast = (asOf = "2026-09-11", selectedLoan = loan, payments: Payment[] = []) =>
  calculateInterestForecast({ loan: selectedLoan, payments, rateChanges: [], adjustments: [], asOf });

it("ignores canceled scheduled rates in daily balances and month-end forecasts", () => {
  const input = { loan, payments: [], adjustments: [], asOf: "2026-10-11" };
  const scheduled = { id: "wrong-rate", loanId: loan.id, effectiveDate: "2026-10-01", rateBps: 10,
    reason: "พิมพ์ผิด", createdAt: "2026-09-20T00:00:00Z" };
  const active = calculateInterestForecast({ ...input, rateChanges: [scheduled] });
  const canceled = calculateInterestForecast({ ...input, rateChanges: [{ ...scheduled, canceledAt: "2026-09-21T00:00:00Z", cancelReason: "แก้ข้อมูล" }] });
  expect(active.cycle.fullInterestCents).toBe(3000);
  expect(canceled).toEqual(calculateInterestForecast({ ...input, rateChanges: [] }));
  expect(canceled.cycle.fullInterestCents).toBe(300000);
});

describe("daily interest and calendar month forecast", () => {
  it("earns 1,000 after ten of thirty days and forecasts 3,000 through month end", () => {
    const result = forecast();
    expect(result.cycle).toMatchObject({ elapsedDays: 10, fullDays: 30,
      fullInterestCents: 300000, earnedInterestCents: 100000, forecastInterestCents: 300000 });
    expect(result.month).toEqual({ startDate: "2026-09-01", endDate: "2026-09-30",
      earnedInterestCents: 100000, additionalInterestCents: 200000, forecastInterestCents: 300000 });
  });

  it.each([
    ["2026-10-01", "2026-11-01", "2026-10-11", 31, 96774],
    ["2026-02-01", "2026-03-01", "2026-02-11", 28, 107143],
    ["2028-02-01", "2028-03-01", "2028-02-11", 29, 103448],
  ])("uses actual days for the cycle starting %s", (startDate, firstCycleEndDate, asOf, fullDays, earned) => {
    const result = forecast(asOf, { ...loan, startDate, cycleStartDate: startDate, firstCycleEndDate });
    expect(result.cycle.fullDays).toBe(fullDays);
    expect(result.cycle.earnedInterestCents).toBe(earned);
    expect(result.month.forecastInterestCents).toBe(300000);
  });

  it("excludes brought-forward interest and days before the opening balance date", () => {
    const result = forecast("2026-09-11", { ...loan, startDate: "2026-09-10", openingInterestCents: 50000 });
    expect(result.cycle.earnedInterestCents).toBe(10000);
    expect(result.cycle.forecastInterestCents).toBe(210000);
    expect(result.month.forecastInterestCents).toBe(210000);
    expect(result.month.earnedInterestCents).toBe(10000);
  });

  it("keeps gross earned interest when interest is paid", () => {
    const result = forecast(undefined, loan, [payment({ totalCents: 100000, interestCents: 100000 })]);
    expect(result.cycle.earnedInterestCents).toBe(100000);
    expect(result.month.forecastInterestCents).toBe(300000);
  });

  it("keeps the current cycle base but reduces the following cycle after principal repayment", () => {
    const selectedLoan = { ...loan, startDate: "2026-09-15", cycleStartDate: "2026-09-15",
      firstCycleEndDate: "2026-10-15", anchorDay: 15 };
    const result = forecast("2026-10-10", selectedLoan,
      [payment({ date: "2026-10-05", totalCents: 1000000, principalCents: 1000000 })]);
    expect(result.cycle.fullInterestCents).toBe(300000);
    // October 1..15: 14/30 * 3,000; October 15..November 1: 17/31 * 2,000.
    expect(result.month.forecastInterestCents).toBe(249677);
  });

  it("stops forecasts at final principal repayment, even with unpaid interest", () => {
    const result = forecast(undefined, loan, [payment({ totalCents: 3000000, principalCents: 3000000 })]);
    expect(result.month.earnedInterestCents).toBe(100000);
    expect(result.month.additionalInterestCents).toBe(0);
    expect(result.month.forecastInterestCents).toBe(100000);
    expect(result.cycle.forecastInterestCents).toBe(100000);
  });

  it("uses scheduled rate changes while excluding future unconfirmed payments", () => {
    const selectedLoan = { ...loan, startDate: "2026-09-15", cycleStartDate: "2026-09-15",
      firstCycleEndDate: "2026-10-15", anchorDay: 15 };
    const result = calculateInterestForecast({ loan: selectedLoan, asOf: "2026-10-10", adjustments: [],
      payments: [payment({ date: "2026-10-20", totalCents: 3000000, principalCents: 3000000 })],
      rateChanges: [{ id: "rate", loanId: loan.id, effectiveDate: "2026-10-15", rateBps: 500,
        reason: "ตกลงอัตราใหม่", createdAt: "2026-10-01T00:00:00Z" }] });
    expect(result.month.forecastInterestCents).toBe(222258);
  });

  it("returns zero for interest-free loans", () => {
    expect(forecast(undefined, { ...loan, rateBps: 0 }).month.forecastInterestCents).toBe(0);
  });

  it("does not treat interest adjustments or opening arrears as earned income", () => {
    const result = calculateInterestForecast({ loan: { ...loan, openingInterestCents: 999999 },
      asOf: "2026-09-11", payments: [], rateChanges: [], adjustments: [
        { id: "adjust", loanId: loan.id, date: "2026-09-05", principalDeltaCents: 0,
          interestDeltaCents: 50000, reason: "ปรับยอดยกมา", createdAt: "2026-09-05T00:00:00Z",
          canceledAt: null, cancelReason: null },
      ] });
    expect(result.month.earnedInterestCents).toBe(100000);
    expect(result.month.forecastInterestCents).toBe(300000);
  });

  it("recalculates after cancellation of final principal repayment", () => {
    const result = forecast(undefined, loan, [payment({ totalCents: 3000000, principalCents: 3000000,
      canceledAt: "2026-09-11T01:00:00Z", cancelReason: "ลงผิด" })]);
    expect(result.cycle.accruing).toBe(true);
    expect(result.month.forecastInterestCents).toBe(300000);
  });

  it("keeps elapsed days at zero when all principal was returned on the opening date", () => {
    const result = forecast("2026-09-20", loan, [payment({ date: loan.startDate,
      totalCents: 3000000, principalCents: 3000000 })]);
    expect(result.cycle).toMatchObject({ accruing: false, elapsedDays: 0, accrualEndDate: loan.startDate });
    expect(result.month.forecastInterestCents).toBe(0);
  });

  it("keeps the 31st anchor after February and includes the final calendar day", () => {
    const selectedLoan = { ...loan, startDate: "2026-01-31", cycleStartDate: "2026-01-31",
      firstCycleEndDate: "2026-02-28", anchorDay: 31 };
    const result = forecast("2026-03-10", selectedLoan);
    expect(result.cycle.endDate).toBe("2026-03-31");
    // March includes 30/31 of Feb 28..Mar 31, then 1/30 of Mar 31..Apr 30.
    expect(result.month.forecastInterestCents).toBe(300323);
  });
});
