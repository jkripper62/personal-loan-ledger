import type { LedgerData } from "../src/domain/types.js";
import { calculateLedger } from "../src/domain/ledger.js";
import { compareEvents } from "../src/domain/chronology.js";

const money = (value: number) => (value / 100).toFixed(2);
function csvCell(value: string): string {
  const safe = /^[\s\u0000-\u001f]*[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function createLedgerCsv(data: LedgerData, asOf: string): string {
  const names = new Map(
    data.borrowers.map((borrower) => [borrower.id, borrower.name]),
  );
  const loans = new Map(data.loans.map((loan) => [loan.id, loan]));
  const rows: string[][] = [
    [
      "ประเภท",
      "ผู้กู้",
      "รายการกู้",
      "รายการรับชำระ",
      "วันที่อ้างอิง/รับชำระ",
      "ต้นคงเหลือ (บาท)",
      "ดอกค้าง (บาท)",
      "คืนต้น (บาท)",
      "รับดอก (บาท)",
      "ยอดรับรวม (บาท)",
      "วันนัดชำระ",
      "สถานะ",
      "วันเวลายกเลิก",
      "เหตุผลยกเลิก",
      "หมายเหตุ",
      "ประวัติก่อนเริ่มบันทึก",
    ],
  ];
  for (const loan of data.loans) {
    const balance = calculateLedger({
      loan,
      asOf,
      payments: data.payments,
      rateChanges: data.rateChanges,
      adjustments: data.adjustments,
    });
    rows.push([
      "สรุปยอด",
      names.get(loan.borrowerId) ?? "",
      loan.id,
      "",
      asOf,
      money(balance.principalCents),
      money(balance.interestCents),
      money(balance.principalPaidCents),
      money(balance.interestPaidCents),
      money(balance.principalPaidCents + balance.interestPaidCents),
      loan.dueDate,
      balance.closed ? "ปิดหนี้แล้ว" : "กำลังชำระ",
      "",
      "",
      loan.notes,
      loan.source === "existing"
        ? "ยอดรับคืนก่อนหน้านั้นยังไม่ทราบ"
        : "เริ่มจากกู้ใหม่",
    ]);
  }
  for (const payment of [...data.payments].sort(compareEvents)) {
    const loan = loans.get(payment.loanId);
    rows.push([
      "รับชำระ",
      loan ? (names.get(loan.borrowerId) ?? "") : "",
      payment.loanId,
      payment.id,
      payment.date,
      "",
      "",
      money(payment.principalCents),
      money(payment.interestCents),
      money(payment.totalCents),
      loan?.dueDate ?? "",
      payment.canceledAt ? "ยกเลิก" : payment.isPayoff ? "ปิดหนี้" : "มีผล",
      payment.canceledAt ?? "",
      payment.cancelReason ?? "",
      [payment.dateEstimated ? "จำวันที่จ่ายจริงไม่ได้ ใช้วันที่บันทึก" : "",
        payment.interestMode === "owner" ? "ยอดดอกตามที่เจ้าของระบุ" : "",
        payment.replacesPaymentId ? `แก้ไขจากรายการ ${payment.replacesPaymentId}` : "", payment.note].filter(Boolean).join(" · "),
      loan?.source === "existing" ? "ยอดรับคืนก่อนหน้านั้นยังไม่ทราบ" : "",
    ]);
  }
  return "\ufeff" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}
