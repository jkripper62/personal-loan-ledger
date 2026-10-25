import { expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InterestOverview } from "../src/components/interest";
import { calculateLedger } from "../src/domain/ledger";
import { calculateInterestForecast } from "../src/domain/forecast";
import { changeLoanRecordStatus, loanCategory, realLedgerData } from "../src/domain/loan-records";
import type { LedgerData, Loan, Payment } from "../src/domain/types";

const base: Loan = {
  id: "active", borrowerId: "person", source: "new", principalCents: 1000000,
  openingInterestCents: 0, rateBps: 1000, startDate: "2026-10-01", cycleStartDate: "2026-10-01",
  firstCycleEndDate: "2026-11-01", anchorDay: 1, dueDate: "2026-11-01", notes: "", createdAt: "2026-10-01T00:00:00Z",
};
const receipt = (loanId: string, principalCents: number, interestCents: number): Payment => ({
  id: loanId + "-payment", loanId, principalCents, interestCents, totalCents: principalCents + interestCents,
  isPayoff: true, interestMode: "owner", date: "2026-10-10", note: "", createdAt: "2026-10-10T00:00:00Z",
  canceledAt: null, cancelReason: null,
});
function fixture(): LedgerData {
  return {
    loans: [base, { ...base, id: "closed", principalCents: 400000 },
      { ...base, id: "trial", principalCents: 200000, recordStatus: "test" },
      { ...base, id: "trashed", recordStatus: "trashed-test" }],
    borrowers: [{ id: "person", name: "ทดสอบ", nickname: "", phone: "", lineId: "", facebookUrl: "", notes: "", createdAt: base.createdAt }],
    payments: [receipt("closed", 400000, 40000), receipt("trial", 200000, 99900)],
    adjustments: [], rateChanges: [], contacts: [], attachments: [], audit: [],
  };
}
it("counts actual closed receipts while excluding every trial balance and receipt from real portfolio totals", () => {
  const all = fixture();
  const real = realLedgerData(all);
  const totals = real.loans.map(loan => calculateLedger({ ...real, loan, asOf: "2026-10-25" })).reduce((sum, item) => ({
    principal: sum.principal + item.principalCents,
    principalPaid: sum.principalPaid + item.principalPaidCents,
    interestPaid: sum.interestPaid + item.interestPaidCents,
  }), { principal: 0, principalPaid: 0, interestPaid: 0 });
  expect(totals).toEqual({ principal: 1000000, principalPaid: 400000, interestPaid: 40000 });
  expect(real.payments.map(payment => payment.id)).toEqual(["closed-payment"]);
  expect(all.payments).toHaveLength(2);
  expect(all.loans.map(loan => loanCategory(loan, calculateLedger({ ...all, loan, asOf: "2026-10-25" })))).toEqual(["active", "closed", "test", "trashed-test"]);
});
it("limits person cards and aggregate forecasts to the displayed active real contracts even when the forecast map includes trial data", () => {
  const all = fixture();
  const forecasts = new Map(all.loans.map(loan => [loan.id, calculateInterestForecast({ ...all, loan, asOf: "2026-10-25" })]));
  const active = { ...realLedgerData(all), loans: [base] };
  const html = renderToStaticMarkup(createElement(InterestOverview, { data: active, forecasts, select: () => {}, today: "2026-10-25" }));
  expect(html).toContain('คาดการณ์ดอกถึงสิ้นเดือน</p><strong>฿1,000</strong>');
  expect(html).toContain('ดูดอกแต่ละรายการ (1)');
});
it("prevents deletion of a real contract and restores trashed data only into the excluded trial category", () => {
  const loan = { ...base };
  expect(() => changeLoanRecordStatus(loan, "trash-test")).toThrow("เฉพาะสัญญาทดลอง");
  changeLoanRecordStatus(loan, "mark-test");
  changeLoanRecordStatus(loan, "trash-test");
  expect(() => changeLoanRecordStatus(loan, "mark-real")).toThrow();
  changeLoanRecordStatus(loan, "restore-test");
  expect(loan.recordStatus).toBe("test");
  changeLoanRecordStatus(loan, "mark-real");
  expect(loan.recordStatus).toBeUndefined();
});
