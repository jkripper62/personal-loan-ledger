import type { LedgerData, Loan } from "./types.js";

export type LoanPlacement = "before" | "after";

export function orderedLoans(data: Pick<LedgerData, "loans" | "loanOrder">): Loan[] {
  const order = new Map((data.loanOrder ?? []).map((id, index) => [id, index]));
  const fallback = new Map(data.loans.map((loan, index) => [loan.id, index]));
  return [...data.loans].sort((a, b) => {
    const left = order.get(a.id) ?? (data.loanOrder?.length ?? 0) + (fallback.get(a.id) ?? 0);
    const right = order.get(b.id) ?? (data.loanOrder?.length ?? 0) + (fallback.get(b.id) ?? 0);
    return left - right;
  });
}

export function moveLoanOrder(data: LedgerData, loanId: string, targetId: string, placement: LoanPlacement): void {
  if (placement !== "before" && placement !== "after") throw new Error("ตำแหน่งการจัดเรียงไม่ถูกต้อง");
  const ids = orderedLoans(data).map(loan => loan.id);
  if (loanId === targetId || !ids.includes(loanId) || !ids.includes(targetId))
    throw new Error("ไม่พบสัญญาที่ต้องการจัดเรียง");
  ids.splice(ids.indexOf(loanId), 1);
  const targetIndex = ids.indexOf(targetId);
  ids.splice(targetIndex + (placement === "after" ? 1 : 0), 0, loanId);
  data.loanOrder = ids;
}
