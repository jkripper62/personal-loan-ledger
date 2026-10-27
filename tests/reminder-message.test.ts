import { expect, it } from "vitest";
import { reminderMessage } from "../src/domain/reminder-message";
import type { FollowUp } from "../src/domain/follow-up";
import type { Borrower, Loan } from "../src/domain/types";

const borrower: Borrower = { id: "b", name: "มาลี ศรีสุข", nickname: "แดง", phone: "", lineId: "", facebookUrl: "",
  notes: "", createdAt: "2026-07-01T00:00:00Z" };
const loan = { id: "49828f3d-aaaa", borrowerId: "b", dueDate: "2026-10-10", purpose: "ค่าเทอมลูก" } as Loan;
const item = (extra: Partial<FollowUp>): FollowUp => ({
  loan, borrower, status: "overdue", daysLate: 18, principalCents: 10000000, interestOwedCents: 200000,
  interestDueCents: 200000, ...extra,
});

it("tells an overdue borrower how late they are and exactly how much interest to pay", () => {
  expect(reminderMessage(item({}), { politeEnding: "ค่ะ", promptPayId: "0812345678" })).toBe([
    "สวัสดีค่ะ คุณแดง",
    "รายการกู้: ค่าเทอมลูก",
    "เลยวันนัดชำระ 10 ต.ค. 2569 มาแล้ว 18 วัน",
    "ดอกเบี้ยที่ต้องชำระ 2,000 บาท",
    "เงินต้นคงเหลือ 100,000 บาท",
    "โอนผ่านพร้อมเพย์ 081-234-5678",
    "โอนแล้วรบกวนส่งสลิปให้ด้วย ขอบคุณค่ะ",
  ].join("\n"));
});

it("reminds the day before without an internal loan code, and skips the interest line when nothing is due", () => {
  const message = reminderMessage(
    item({ status: "tomorrow", daysLate: 0, interestDueCents: 0, borrower: { ...borrower, nickname: "" }, loan: { ...loan, purpose: "" } }),
    { politeEnding: "", promptPayId: "" },
  );
  expect(message).toBe([
    "สวัสดี คุณมาลี ศรีสุข",
    "พรุ่งนี้ (10 ต.ค. 2569) ครบกำหนดชำระ",
    "เงินต้นคงเหลือ 100,000 บาท",
    "โอนแล้วรบกวนส่งสลิปให้ด้วย ขอบคุณ",
  ].join("\n"));
  expect(message).not.toContain("49828f3d");
});

it("formats a 13-digit PromptPay ID the way Thai ID cards print it", () => {
  expect(reminderMessage(item({ status: "today", daysLate: 0 }), { politeEnding: "ครับ", promptPayId: "1234567890123" }))
    .toContain("วันนี้ (10 ต.ค. 2569) ครบกำหนดชำระ\nดอกเบี้ยที่ต้องชำระ 2,000 บาท\nเงินต้นคงเหลือ 100,000 บาท\nโอนผ่านพร้อมเพย์ 1-2345-67890-12-3\nโอนแล้วรบกวนส่งสลิปให้ด้วย ขอบคุณครับ");
});
