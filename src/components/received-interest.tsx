import { useState } from "react";
import type { LedgerData } from "../domain/types";
import { receivedInterestByPerson } from "../domain/received-interest";
import { money } from "./ui";

export function ReceivedInterestOverview({ data, today }: { data: LedgerData; today: string }) {
  const [search, setSearch] = useState("");
  const people = receivedInterestByPerson(data, today);
  const visible = people.filter(person => `${person.name} ${person.nickname}`.toLocaleLowerCase("th").includes(search.trim().toLocaleLowerCase("th")));
  const received = people.reduce((sum, person) => sum + person.receivedCents, 0);
  const month = people.reduce((sum, person) => sum + person.monthCents, 0);
  return <section className="panel received-interest-panel" aria-label="ดอกเบี้ยรับจริงแยกรายคน">
    <div className="panel-heading">
      <div><h2>ดอกเบี้ยที่ได้รับจริง แยกรายคน</h2><p className="received-subtitle">รวมสัญญากำลังชำระและปิดแล้ว · ไม่รวมสัญญาทดลอง</p></div>
      <span className="interest-date">ถึงวันที่ {today.split("-").reverse().join("/")}</span>
    </div>
    <div className="received-totals">
      <div><p>รับดอกเบี้ยสะสมทั้งหมด</p><strong>฿{money(received)}</strong></div>
      <div><p>รับดอกเบี้ยเดือนนี้</p><strong>฿{money(month)}</strong></div>
      <div><p>ผู้กู้ที่มีสัญญาจริง</p><strong>{people.length} คน</strong></div>
    </div>
    <div className="interest-people-tools">
      <p>นับเฉพาะเงินดอกเบี้ยที่รับและบันทึกจริง ไม่รวมเงินต้นหรือดอกคาดการณ์</p>
      <input aria-label="ค้นหาสรุปดอกเบี้ยรับจริง" placeholder="ค้นหาชื่อผู้กู้" value={search} onChange={event => setSearch(event.target.value)} />
    </div>
    <div className="table-scroll received-table"><table>
      <thead><tr><th>ผู้กู้</th><th>สัญญาจริง</th><th>รับดอกเดือนนี้</th><th>รับดอกสะสม</th></tr></thead>
      <tbody>{visible.map(person => <tr key={person.borrowerId}>
        <td><strong>{person.name}</strong>{person.nickname && <small>{person.nickname}</small>}</td>
        <td>{person.loanCount} รายการ</td><td>฿{money(person.monthCents)}</td><td><strong>฿{money(person.receivedCents)}</strong></td>
      </tr>)}</tbody>
    </table>{!visible.length && <p className="interest-note">{people.length ? "ไม่พบผู้กู้ที่ค้นหา" : "ยังไม่มีสัญญาจริง"}</p>}</div>
    <p className="interest-note">ยอดสะสมเริ่มจากข้อมูลการรับชำระที่บันทึกไว้ · รายการยกเลิกไม่นับซ้ำ · ยอดรวมด้านบนไม่เปลี่ยนตามคำค้นหา</p>
  </section>;
}
