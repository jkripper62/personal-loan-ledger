import { addMonths } from "./ledger.js";
import { compareEvents } from "./chronology.js";
import type { LedgerData, Loan, Payment } from "./types.js";

/**
 * The loan's stored dueDate is the owner's last chosen starting date.
 * A payment can satisfy at most one monthly appointment. We derive the
 * next appointment from uncancelled receipts instead of changing ledger data,
 * so editing or cancelling a receipt immediately recomputes the date.
 */
export function nextDueDate(loan: Loan, payments: Payment[], asOf: string): string {
  const day = Number(loan.dueDate.slice(-2));
  let due = loan.dueDate;
  let previous = addMonths(due, -1, day);
  let creditedMonth = "";
  const resetDate = loan.dueDateSetAt ? new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(loan.dueDateSetAt)) : "";

  // A corrected receipt retains the creation time of its original receipt.
  // Editing an older receipt must not undo the owner's later date override.
  const byId = new Map(payments.map(payment => [payment.id, payment]));
  const firstRecordedAt = (payment: Payment): string => {
    let original = payment;
    const seen = new Set<string>([original.id]);
    while (original.replacesPaymentId && !seen.has(original.replacesPaymentId)) {
      const parent = byId.get(original.replacesPaymentId);
      if (!parent) break;
      seen.add(parent.id);
      original = parent;
    }
    return original.createdAt;
  };

  const receipts = payments
    .filter(payment =>
      payment.loanId === loan.id &&
      !payment.canceledAt &&
      payment.totalCents > 0 &&
      payment.date >= loan.startDate &&
      payment.date >= resetDate &&
      payment.date <= asOf &&
      (!loan.dueDateSetAt || firstRecordedAt(payment) > loan.dueDateSetAt)
    )
    .sort(compareEvents);

  for (const receipt of receipts) {
    // One installment per month; split principal/interest receipts do not
    // accidentally mark two months as paid. No receipts => no auto-skipping.
    const month = receipt.date.slice(0, 7);
    if (receipt.date <= previous || month === creditedMonth) continue;
    creditedMonth = month;
    due = addMonths(due, 1, day);
    previous = addMonths(due, -1, day);
  }
  return due;
}

export function withNextDueDates(data: LedgerData, asOf: string): LedgerData {
  return {
    ...data,
    loans: data.loans.map(loan => ({
      ...loan,
      dueDate: nextDueDate(loan, data.payments, asOf),
    })),
  };
}
