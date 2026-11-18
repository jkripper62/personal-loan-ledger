import { expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { receivedInterestByPerson } from "../src/domain/received-interest";
import { ReceivedInterestOverview } from "../src/components/received-interest";
import type { LedgerData, Loan, Payment } from "../src/domain/types";

const borrower = (id: string) => ({ id, name: id, nickname: "", phone: "", lineId: "", facebookUrl: "", notes: "", createdAt: "" });
const loan = (id: string, borrowerId: string, recordStatus?: Loan["recordStatus"]): Loan =>
  ({ id, borrowerId, recordStatus, source: "new", principalCents: 100000, openingInterestCents: 0,
     rateBps: 1000, startDate: "2026-09-01", cycleStartDate: "2026-09-01", firstCycleEndDate: "2026-10-01",
     anchorDay: 1, dueDate: "2026-10-01", notes: "", createdAt: "" });
const payment = (id: string, loanId: string, date: string, interestCents: number, canceledAt: string | null = null): Payment =>
  ({ id, loanId, date, totalCents: interestCents + 100000, principalCents: 100000, interestCents,
     note: "", createdAt: "", canceledAt, cancelReason: canceledAt ? "แก้ไข" : null, isPayoff: true });
const data: LedgerData = {
  borrowers: [borrower("ก้อย"), borrower("บี"), borrower("ไม่มีสัญญา")],
  loans: [loan("closed","ก้อย"), loan("active","ก้อย"), loan("other","บี"), loan("trial","บี","test"), loan("trash","บี","trashed-test")],
  payments: [
    payment("old","closed","2026-09-20",9000,"2026-09-21"),
    payment("fixed","closed","2026-09-20",5000),
    payment("month","active","2026-11-05",12000),
    payment("future","active","2026-11-11",999999),
    payment("other","other","2026-11-09",3000),
    payment("test","trial","2026-11-01",500000),
    payment("trash","trash","2026-11-01",600000),
  ], rateChanges: [], adjustments: [], contacts: [], attachments: [], audit: [],
};

it("sums actual interest by borrower, including closed loans but excluding principal, trials, cancellations and future receipts", () => {
  expect(receivedInterestByPerson(data, "2026-11-09")).toEqual([
    { borrowerId: "ก้อย", name: "ก้อย", nickname: "", loanCount: 2, receivedCents: 17000, monthCents: 12000 },
    { borrowerId: "บี", name: "บี", nickname: "", loanCount: 1, receivedCents: 3000, monthCents: 3000 },
  ]);
});
it("renders per-person totals and an independently summed overall total", () => {
  const html = renderToStaticMarkup(createElement(ReceivedInterestOverview, { data, today: "2026-11-09" }));
  expect(html).toContain("ดอกเบี้ยที่ได้รับจริง แยกรายคน");
  expect(html).toContain("฿200");
  expect(html).toContain("฿150");
  expect(html).toContain("฿170");
  expect(html).not.toContain("฿9,999.99");
});
