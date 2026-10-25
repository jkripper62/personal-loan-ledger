import type { LedgerData, LedgerSnapshot, Loan } from "./types.js";

export type LoanCategory = "active" | "closed" | "test" | "trashed-test";
export type LoanRecordAction = "mark-test" | "mark-real" | "trash-test" | "restore-test";

export function isRealLoan(loan: Loan): boolean {
  return loan.recordStatus === undefined;
}

export function loanCategory(loan: Loan, snapshot: LedgerSnapshot | undefined): LoanCategory {
  return loan.recordStatus ?? (snapshot?.closed ? "closed" : "active");
}

export function realLedgerData(data: LedgerData): LedgerData {
  const loans = data.loans.filter(isRealLoan);
  const ids = new Set(loans.map(loan => loan.id));
  const payments = data.payments.filter(payment => ids.has(payment.loanId));
  const paymentIds = new Set(payments.map(payment => payment.id));
  return {
    ...data, loans, payments,
    rateChanges: data.rateChanges.filter(entry => ids.has(entry.loanId)),
    adjustments: data.adjustments.filter(entry => ids.has(entry.loanId)),
    contacts: data.contacts.filter(entry => ids.has(entry.loanId)),
    attachments: data.attachments.filter(entry =>
      (!entry.loanId || ids.has(entry.loanId)) && (!entry.paymentId || paymentIds.has(entry.paymentId))),
  };
}

export function changeLoanRecordStatus(loan: Loan, action: LoanRecordAction): void {
  switch (action) {
    case "mark-test":
      if (loan.recordStatus === "trashed-test") throw new Error("กู้คืนสัญญาทดลองก่อนเปลี่ยนหมวด");
      loan.recordStatus = "test";
      return;
    case "mark-real":
      if (loan.recordStatus !== "test") throw new Error("เปลี่ยนเป็นสัญญาจริงได้เฉพาะสัญญาทดลองที่ยังไม่ลบ");
      delete loan.recordStatus;
      return;
    case "trash-test":
      if (isRealLoan(loan)) throw new Error("ลบได้เฉพาะสัญญาทดลอง กรุณาระบุเป็นสัญญาทดลองก่อน");
      loan.recordStatus = "trashed-test";
      return;
    case "restore-test":
      if (loan.recordStatus !== "trashed-test") throw new Error("กู้คืนได้เฉพาะสัญญาทดลองในถังขยะ");
      loan.recordStatus = "test";
      return;
    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}
