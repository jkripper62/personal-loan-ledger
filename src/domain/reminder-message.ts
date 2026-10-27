import { date, money } from "./format.js";
import type { FollowUp } from "./follow-up.js";

export interface MessageSettings {
  politeEnding: string;
  promptPayId: string;
}

export const formatPromptPayId = (id: string) =>
  id.length === 13
    ? `${id[0]}-${id.slice(1, 5)}-${id.slice(5, 10)}-${id.slice(10, 12)}-${id[12]}`
    : `${id.slice(0, 3)}-${id.slice(3, 6)}-${id.slice(6)}`;

/** ข้อความเตือนชำระ the owner reviews and sends from their own LINE or Facebook. */
export function reminderMessage(item: FollowUp, settings: MessageSettings): string {
  const ending = settings.politeEnding;
  const name = item.borrower?.nickname || item.borrower?.name || "";
  const due = date(item.loan.dueDate);
  const when = {
    overdue: `เลยวันนัดชำระ ${due} มาแล้ว ${item.daysLate} วัน`,
    today: `วันนี้ (${due}) ครบกำหนดชำระ`,
    tomorrow: `พรุ่งนี้ (${due}) ครบกำหนดชำระ`,
    upcoming: `ครบกำหนดชำระวันที่ ${due}`,
  }[item.status];
  return [
    `สวัสดี${ending} คุณ${name}`,
    item.loan.purpose?.trim() && `รายการกู้: ${item.loan.purpose.trim()}`,
    when,
    item.interestDueCents > 0 && `ดอกเบี้ยที่ต้องชำระ ${money(item.interestDueCents)} บาท`,
    `เงินต้นคงเหลือ ${money(item.principalCents)} บาท`,
    settings.promptPayId && `โอนผ่านพร้อมเพย์ ${formatPromptPayId(settings.promptPayId)}`,
    `โอนแล้วรบกวนส่งสลิปให้ด้วย ขอบคุณ${ending}`,
  ].filter(Boolean).join("\n");
}
