import { MessageSquare, Plus, PartyPopper } from "lucide-react";
import type { FollowUp } from "../domain/follow-up";
import { loanDisplayName } from "../domain/loan-name";
import type { Modal } from "./modal";
import { Button, date, money } from "./ui";

export function followUpLabel(item: FollowUp): string {
  if (item.status === "overdue") return `เกินกำหนด ${item.daysLate} วัน`;
  if (item.status === "today") return "ครบกำหนดวันนี้";
  if (item.status === "tomorrow") return "ครบกำหนดพรุ่งนี้";
  return item.interestOwedCents > 0 ? "มีดอกค้าง" : `นัด ${date(item.loan.dueDate)}`;
}

/** Needs action now: due within a day, overdue, or carrying unpaid interest. */
export const needsAction = (item: FollowUp) => item.status !== "upcoming" || item.interestOwedCents > 0;

export function TodayPanel({ items, open, select }: {
  items: FollowUp[];
  open: (modal: Modal) => void;
  select: (id: string) => void;
}) {
  const urgent = items.filter(needsAction);
  const owedTotal = urgent.reduce((sum, item) => sum + item.interestOwedCents, 0);
  return (
    <section className="panel today-panel">
      <div className="panel-heading">
        <h2>วันนี้ต้องตาม <small>{urgent.length} รายการ</small></h2>
        {owedTotal > 0 && <span className="today-total">ดอกค้างรวม ฿{money(owedTotal)}</span>}
      </div>
      {!urgent.length ? (
        <p className="today-empty"><PartyPopper /> วันนี้ไม่มีใครต้องตาม ทุกคนจ่ายตรงเวลา</p>
      ) : (
        <div className="today-list">
          {urgent.map((item) => {
            const name = loanDisplayName(item.borrower?.name ?? "ผู้กู้", item.loan);
            const amount = item.interestOwedCents || item.interestDueCents;
            return (
              <article key={item.loan.id} className={item.status === "overdue" ? "late" : ""}>
                <button className="today-name" onClick={() => select(item.loan.id)}>
                  <span className="avatar">{(item.borrower?.name ?? "?").slice(0, 1)}</span>
                  <span>
                    <strong>{name}</strong>
                    <small>
                      <span className={`badge ${item.status === "overdue" || item.interestOwedCents > 0 ? "late" : ""}`}>
                        {followUpLabel(item)}
                      </span>
                      {" "}ต้นคงเหลือ ฿{money(item.principalCents)}
                    </small>
                  </span>
                </button>
                <div className="today-amount">
                  {amount > 0 ? (
                    <>
                      <small>{item.interestOwedCents > 0 ? "ดอกค้างชำระ" : "ดอกงวดนี้"}</small>
                      <strong>฿{money(amount)}</strong>
                    </>
                  ) : (
                    <small>ไม่มีดอกค้าง</small>
                  )}
                </div>
                <div className="today-actions">
                  <Button onClick={() => open({ kind: "payment", loan: item.loan, suggestInterestCents: item.interestOwedCents })}>
                    <Plus />รับเงิน
                  </Button>
                  <Button secondary onClick={() => open({ kind: "contact", loan: item.loan })}>
                    <MessageSquare />ส่งข้อความ
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
