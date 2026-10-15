import type { Loan } from "./types.js";

export function isLoanOverdue(loan: Loan, asOf: string): boolean {
  return loan.statusOverride !== "normal" && loan.dueDate < asOf;
}
