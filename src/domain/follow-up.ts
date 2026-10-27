import { calculateLedger, daysBetween } from "./ledger.js";
import { realLedgerData } from "./loan-records.js";
import { isLoanOverdue } from "./status.js";
import type { Borrower, LedgerData, Loan } from "./types.js";

export type FollowUpStatus = "overdue" | "today" | "tomorrow" | "upcoming";

export interface FollowUp {
  loan: Loan;
  borrower: Borrower | undefined;
  status: FollowUpStatus;
  /** Days past the due date; 0 unless overdue. */
  daysLate: number;
  principalCents: number;
  /** ดอกเบี้ยค้าง: interest from finished cycles that is still unpaid today. */
  interestOwedCents: number;
  /** ดอกเบี้ยค้าง as it will stand on the due date, for the reminder message. */
  interestDueCents: number;
}

const rank: Record<FollowUpStatus, number> = { overdue: 0, today: 1, tomorrow: 2, upcoming: 3 };

export function dueStatus(loan: Loan, today: string): FollowUpStatus {
  if (isLoanOverdue(loan, today)) return "overdue";
  if (loan.dueDate === today) return "today";
  if (daysBetween(today, loan.dueDate) === 1) return "tomorrow";
  return "upcoming";
}

/** Open real loans, most urgent first: who to chase and how much interest they owe. */
export function followUps(data: LedgerData, today: string): FollowUp[] {
  const real = realLedgerData(data);
  const balance = (loan: Loan, asOf: string) =>
    calculateLedger({ loan, payments: real.payments, rateChanges: real.rateChanges, adjustments: real.adjustments, asOf });
  return real.loans
    .flatMap((loan): FollowUp[] => {
      const now = balance(loan, today);
      if (now.closed) return [];
      const status = dueStatus(loan, today);
      return [{
        loan,
        borrower: real.borrowers.find((b) => b.id === loan.borrowerId),
        status,
        daysLate: status === "overdue" ? daysBetween(loan.dueDate, today) : 0,
        principalCents: now.principalCents,
        interestOwedCents: now.interestCents,
        interestDueCents: loan.dueDate > today ? balance(loan, loan.dueDate).interestCents : now.interestCents,
      }];
    })
    .sort((a, b) => rank[a.status] - rank[b.status] || b.daysLate - a.daysLate || a.loan.dueDate.localeCompare(b.loan.dueDate));
}
