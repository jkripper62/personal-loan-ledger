import { useState } from "react";
import { monthlyHistory, monthlySummary } from "../domain/monthly-summary";
import type { LedgerData } from "../domain/types";
import { Empty, money } from "./ui";

const monthName = (month: string) =>
  new Date(`${month}-15T12:00:00`).toLocaleDateString("th-TH", { month: "long", year: "numeric" });
const shortMonth = (month: string) =>
  new Date(`${month}-15T12:00:00`).toLocaleDateString("th-TH", { month: "short" });

export function MonthlySummaryPage({ data, today }: { data: LedgerData; today: string }) {
  const months = monthlyHistory(data, today.slice(0, 7), 12).map((m) => m.month).reverse();
  const [month, setMonth] = useState(months[0]);
  const summary = monthlySummary(data, month);
  const history = monthlyHistory(data, month, 6);
  const peak = Math.max(1, ...history.map((m) => m.receivedCents));
  return (
    <section className="panel summary-page">
      <div className="panel-heading">
        <h2>สรุปรายเดือน</h2>
        <select aria-label="เลือกเดือน" value={month} onChange={(e) => setMonth(e.target.value)}>
          {months.map((m) => <option key={m} value={m}>{monthName(m)}</option>)}
        </select>
      </div>
      <div className="month-stats">
        <div><p>รับดอกเบี้ย</p><strong>฿{money(summary.interestCents)}</strong></div>
        <div><p>รับคืนต้น</p><strong>฿{money(summary.principalCents)}</strong></div>
        <div><p>รับเงินรวม</p><strong>฿{money(summary.receivedCents)}</strong><small>{summary.paymentCount} รายการ</small></div>
        <div><p>ปล่อยกู้ใหม่</p><strong>฿{money(summary.lentCents)}</strong></div>
      </div>
      <h3>เงินที่รับ 6 เดือนล่าสุด</h3>
      <div className="month-chart" role="img"
        aria-label={history.map((m) => `${monthName(m.month)} ดอก ${money(m.interestCents)} บาท ต้น ${money(m.principalCents)} บาท`).join(", ")}>
        {history.map((m) => (
          <div key={m.month} className={m.month === month ? "selected" : ""}>
            <span className="bar-value">{m.receivedCents ? `฿${money(m.receivedCents)}` : ""}</span>
            <span className="bar" title={`ดอก ฿${money(m.interestCents)} · ต้น ฿${money(m.principalCents)}`}>
              <span className="bar-principal" style={{ height: `${(m.principalCents / peak) * 100}%` }} />
              <span className="bar-interest" style={{ height: `${(m.interestCents / peak) * 100}%` }} />
            </span>
            <span className="bar-label">{shortMonth(m.month)}</span>
          </div>
        ))}
      </div>
      <p className="chart-legend"><span className="bar-interest" /> ดอกเบี้ย <span className="bar-principal" /> คืนต้น</p>
      <h3>แยกรายคน · {monthName(month)}</h3>
      {summary.byBorrower.length ? (
        <div className="table-scroll">
          <table>
            <thead><tr><th>ผู้กู้</th><th>ดอกเบี้ย</th><th>คืนต้น</th><th>รวม</th></tr></thead>
            <tbody>
              {summary.byBorrower.map((row) => (
                <tr key={row.borrowerId}>
                  <td>{row.name}</td>
                  <td>฿{money(row.interestCents)}</td>
                  <td>฿{money(row.principalCents)}</td>
                  <td>฿{money(row.interestCents + row.principalCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title="เดือนนี้ยังไม่มีรายการรับเงิน" text="เมื่อบันทึกรับชำระ ยอดจะแสดงที่นี่" />
      )}
    </section>
  );
}
