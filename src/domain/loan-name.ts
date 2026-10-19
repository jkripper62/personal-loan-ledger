import type { Loan } from "./types.js";

export function loanDisplayName(borrowerName: string, loan: Pick<Loan, "purpose">): string {
  return loan.purpose?.trim() ? `${borrowerName} (${loan.purpose.trim()})` : borrowerName;
}
