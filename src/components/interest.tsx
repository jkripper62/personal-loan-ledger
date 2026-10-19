import type { InterestForecast, LedgerData, Loan } from "../domain/types";
import { date, money } from "./ui";
import { useState } from "react";
import { loanDisplayName } from "../domain/loan-name";

export function InterestOverview({ data, forecasts, select, today }: {
  data: LedgerData; forecasts: Map<string, InterestForecast>;
  select: (id: string) => void; today: string;
}) {
  const [search, setSearch] = useState("");
  const people = data.borrowers.flatMap((borrower) => {
    const items = data.loans.flatMap((loan) => {
      const forecast = forecasts.get(loan.id);
      return loan.borrowerId === borrower.id && forecast ? [{ loan, forecast }] : [];
    });
    if (!items.length) return [];
    const amounts = items.reduce((sum, { forecast }) => ({
      earned: sum.earned + forecast.cycle.earnedInterestCents,
      full: sum.full + (forecast.cycle.accruing ? forecast.cycle.fullInterestCents : 0),
      month: sum.month + forecast.month.forecastInterestCents,
    }), { earned: 0, full: 0, month: 0 });
    return [{ borrower, items, amounts }];
  });
  const visiblePeople = people.filter(({ borrower, items }) =>
    `${borrower.name} ${borrower.nickname} ${items.map(({ loan }) => loan.purpose || "").join(" ")}`.includes(search.trim()),
  );
  const totals = [...forecasts.values()].reduce((sum, item) => ({
    earned: sum.earned + item.month.earnedInterestCents,
    full: sum.full + (item.cycle.accruing ? item.cycle.fullInterestCents : 0),
    forecast: sum.forecast + item.month.forecastInterestCents,
    additional: sum.additional + item.month.additionalInterestCents,
  }), { earned: 0, full: 0, forecast: 0, additional: 0 });
  const monthEnd = forecasts.values().next().value?.month.endDate;
  return <section className="panel interest-panel">
    <div className="panel-heading"><h2>ดอกแยกรายคน</h2><span className="interest-date">ณ {date(today)}</span></div>
    <div className="interest-people-tools">
      <p>{people.length} คน · ดอกถึงวันนี้และคาดการณ์ถึง {monthEnd ? date(monthEnd) : "สิ้นเดือน"}</p>
      <input aria-label="ค้นหาผู้กู้ในดอกรายคน" placeholder="ค้นหาชื่อผู้กู้" value={search} onChange={(event) => setSearch(event.target.value)} />
    </div>
    <div className="interest-people">
      {visiblePeople.map(({ borrower, items, amounts }) => (
        <article className="interest-person" aria-label={`ดอกของ ${borrower.name}`} key={borrower.id}>
          <div className="interest-person-heading">
            <h3>{borrower.name}</h3><span>{items.length} รายการกู้</span>
          </div>
          <div className="interest-person-metrics">
            <div><p>ดอกถึงวันนี้</p><strong>฿{money(amounts.earned)}</strong><small>รอบปัจจุบันของแต่ละรายการ</small></div>
            <div><p>ดอกเต็มรอบเดือน</p><strong>฿{money(amounts.full)}</strong><small>รวมเฉพาะของ{borrower.name}</small></div>
            <div><p>คาดการณ์สิ้นเดือน</p><strong>฿{money(amounts.month)}</strong><small>ดอกที่เกิดขึ้นในเดือนนี้</small></div>
          </div>
          <details className="interest-person-loans">
            <summary>ดูสูตรและรายการกู้ของ{borrower.name}</summary>
            {items.map(({ loan, forecast }) => (
              <div className="interest-person-loan" key={loan.id}>
                <button className="interest-loan" onClick={() => select(loan.id)}>{loanDisplayName(borrower.name, loan)} · ต้นเริ่ม ฿{money(loan.principalCents)}</button>
                <p>{forecast.cycle.accruing ? `ดอกเต็มรอบ ฿${money(forecast.cycle.fullInterestCents)} ÷ ${forecast.cycle.fullDays} วัน × ${forecast.cycle.elapsedDays} วัน` : "หยุดคิดดอกแล้ว"} = ฿{money(forecast.cycle.earnedInterestCents)}</p>
                <p>ครบงวด {date(forecast.cycle.endDate)} คาดการณ์ ฿{money(forecast.cycle.forecastInterestCents)}</p>
                <p>สิ้นเดือน ฿{money(forecast.month.forecastInterestCents)} · เริ่มนับ {date(forecast.cycle.chargeStartDate)}</p>
              </div>
            ))}
          </details>
        </article>
      ))}
      {!visiblePeople.length && <p className="interest-note">{people.length ? "ไม่พบผู้กู้ที่ค้นหา" : "เพิ่มผู้กู้และรายการกู้เพื่อดูดอกแยกรายคน"}</p>}
    </div>
    <details className="interest-breakdown interest-all-totals">
    <summary>ดูยอดรวมทุกคน</summary>
    <div className="interest-metrics">
      <div><p>ดอกเดือนนี้ถึงวันนี้</p><strong>฿{money(totals.earned)}</strong><small>ดอกที่เกิดขึ้น รวมส่วนที่รับชำระแล้ว</small></div>
      <div><p>ดอกเต็มรอบเดือน</p><strong>฿{money(totals.full)}</strong><small>รวมดอกเต็มรอบตามฐานต้นของแต่ละสัญญา</small></div>
      <div className="interest-projection"><p>คาดการณ์ดอกถึงสิ้นเดือน</p><strong>฿{money(totals.forecast)}</strong><small>{monthEnd ? `ถึง ${date(monthEnd)} · ` : ""}เพิ่มอีก ฿{money(totals.additional)}</small></div>
    </div>
    </details>
    <p className="interest-note">คำนวณตามจำนวนวันจริง นับวันเริ่มรอบ ไม่รวมวันนี้ · คาดการณ์สิ้นเดือนรวมวันสุดท้ายของเดือน และใช้อัตราใหม่ที่ตั้งไว้ โดยสมมติว่าไม่มีรับคืนต้นหรือปรับยอดเพิ่ม</p>
    <details className="interest-breakdown">
      <summary>ดูดอกแต่ละรายการ ({data.loans.length})</summary>
      <div className="table-scroll"><table>
        <thead><tr><th>ผู้กู้ / รายการ</th><th>วันที่นับ / วันในรอบ</th><th>ดอกเกิดขึ้นรอบนี้</th><th>ดอกเต็มรอบ</th><th>คาดการณ์ครบงวด</th><th>คาดการณ์เดือนนี้</th></tr></thead>
        <tbody>{data.loans.map((loan) => {
          const item = forecasts.get(loan.id);
          if (!item) return null;
          const borrower = data.borrowers.find((person) => person.id === loan.borrowerId);
          return <tr key={loan.id}>
            <td><button className="interest-loan" onClick={() => select(loan.id)}>{loanDisplayName(borrower?.name || "ผู้กู้", loan)}</button><small>ต้นเริ่ม ฿{money(loan.principalCents)}</small></td>
            <td>{item.cycle.elapsedDays} / {item.cycle.fullDays} วัน<small>ถึง {date(item.cycle.endDate)}</small></td>
            <td>฿{money(item.cycle.earnedInterestCents)}</td>
            <td>{item.cycle.accruing ? `฿${money(item.cycle.fullInterestCents)}` : "หยุดคิดดอกแล้ว"}</td>
            <td>฿{money(item.cycle.forecastInterestCents)}</td>
            <td>฿{money(item.month.forecastInterestCents)}</td>
          </tr>;
        })}</tbody>
      </table></div>
    </details>
    {data.loans.some((loan) => loan.source === "existing") && <p className="interest-note">หนี้เดิมนับเฉพาะดอกตั้งแต่วันเริ่มบันทึก ไม่รวมดอกยกมาหรือประวัติที่ยังไม่ทราบ · ยอดคาดการณ์เป็นดอกที่เกิดขึ้น ไม่ใช่ยอดรับเงินจริง</p>}
  </section>;
}

export function InterestDetail({ forecast, loan }: { forecast: InterestForecast; loan: Loan }) {
  const { cycle, month } = forecast;
  return <section className="interest-detail" aria-label="ดอกตามวันของสัญญา">
    <h3>ดอกตามวันของสัญญา</h3>
    <div className="interest-metrics">
      <div><p>ดอกเกิดขึ้นรอบนี้</p><strong>฿{money(cycle.earnedInterestCents)}</strong><small>ผ่านไป {cycle.elapsedDays} จาก {cycle.fullDays} วัน</small></div>
      <div><p>คาดการณ์เมื่อครบงวด</p><strong>฿{money(cycle.forecastInterestCents)}</strong><small>ตัดรอบ {date(cycle.endDate)}</small></div>
      <div className="interest-projection"><p>คาดการณ์ดอกเดือนนี้</p><strong>฿{money(month.forecastInterestCents)}</strong><small>รวมถึง {date(month.endDate)}</small></div>
    </div>
    <p className="interest-formula">ดอกเต็มรอบ ฿{money(cycle.fullInterestCents)} ÷ {cycle.fullDays} วัน × {cycle.elapsedDays} วันที่ผ่าน</p>
    <p className="interest-note">เริ่มนับ {date(cycle.chargeStartDate)} ไม่นับวันที่ {date(cycle.accrualEndDate)}{!cycle.accruing && " (หยุดคิดดอกแล้ว)"} ปัดยอดสุดท้ายเป็นสตางค์ · ดอกที่เกิดขึ้นรวมส่วนที่จ่ายแล้ว ส่วนยอดปิดหนี้หักส่วนที่จ่ายแล้ว</p>
    {loan.startDate > loan.cycleStartDate && cycle.chargeStartDate === loan.startDate && <p className="interest-note">รอบแรกของหนี้ยกมานับเฉพาะวันที่เหลือจากวันเริ่มบันทึก ดอกครบงวดจึงอาจน้อยกว่าดอกเต็มรอบ</p>}
    <p className="interest-note">คาดการณ์โดยไม่มีรับคืนต้นหรือปรับยอดเพิ่ม รวมอัตราใหม่ที่ตั้งไว้แล้ว หากคืนต้นบางส่วน ดอกรอบนี้ยังใช้ฐานต้นต้นรอบ และลดลงในรอบถัดไป</p>
  </section>;
}
