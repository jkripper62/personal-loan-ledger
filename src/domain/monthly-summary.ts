import { realLedgerData } from "./loan-records.js";
import type { LedgerData } from "./types.js";

export interface MonthlySummary {
  month: string;
  interestCents: number;
  principalCents: number;
  receivedCents: number;
  paymentCount: number;
  /** New lending that started this month; brought-forward debts are not new money out. */
  lentCents: number;
  byBorrower: Array<{ borrowerId: string; name: string; interestCents: number; principalCents: number }>;
}

/** Money actually received in a calendar month ("YYYY-MM"), real loans only. */
export function monthlySummary(data: LedgerData, month: string): MonthlySummary {
  const real = realLedgerData(data);
  const borrowerOf = new Map(real.loans.map((loan) => [loan.id, loan.borrowerId]));
  const receipts = real.payments.filter((p) => !p.canceledAt && p.date.startsWith(month));
  const byBorrower = new Map<string, MonthlySummary["byBorrower"][number]>();
  for (const p of receipts) {
    const borrowerId = borrowerOf.get(p.loanId) ?? "";
    const entry = byBorrower.get(borrowerId) ?? {
      borrowerId, name: real.borrowers.find((b) => b.id === borrowerId)?.name ?? "", interestCents: 0, principalCents: 0,
    };
    entry.interestCents += p.interestCents;
    entry.principalCents += p.principalCents;
    byBorrower.set(borrowerId, entry);
  }
  const interestCents = receipts.reduce((sum, p) => sum + p.interestCents, 0);
  const principalCents = receipts.reduce((sum, p) => sum + p.principalCents, 0);
  return {
    month,
    interestCents,
    principalCents,
    receivedCents: interestCents + principalCents,
    paymentCount: receipts.length,
    lentCents: real.loans
      .filter((loan) => loan.source !== "existing" && loan.startDate.startsWith(month))
      .reduce((sum, loan) => sum + loan.principalCents, 0),
    byBorrower: [...byBorrower.values()].sort((a, b) =>
      b.interestCents + b.principalCents - (a.interestCents + a.principalCents)),
  };
}

export function monthlyHistory(data: LedgerData, endMonth: string, count: number): MonthlySummary[] {
  const [year, month] = endMonth.split("-").map(Number);
  return Array.from({ length: count }, (_, index) => {
    const offset = year * 12 + (month - 1) - (count - 1 - index);
    return monthlySummary(data, `${Math.floor(offset / 12)}-${String((offset % 12) + 1).padStart(2, "0")}`);
  });
}
