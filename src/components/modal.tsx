import { useEffect, useState, type FormEvent } from "react";
import { Copy, Check, X } from "lucide-react";
import { calculateLedger, addMonths, todayBangkok } from "../domain/ledger";
import type {
  Borrower,
  Loan,
  LedgerData,
  LedgerSnapshot,
  Payment,
} from "../domain/types";
import { Button, Input, money, date, field, cents } from "./ui";
export type Modal =
  | { kind: "borrower"; borrower?: Borrower }
  | { kind: "loan"; borrowerId?: string }
  | { kind: "edit-payment"; loan: Loan; payment: Payment }
  | {
      kind: "payment" | "payoff" | "rate" | "adjustment" | "loan-correction" | "contact";
      loan: Loan;
    }
  | { kind: "attachment"; loan: Loan }
  | { kind: "payment-attachment"; loan: Loan; paymentId: string }
  | { kind: "cancel"; path: string }
  | { kind: "recovery"; code: string };
export function ModalView({
  modal,
  data,
  snapshots,
  close,
  submit,
  uploadOnly,
  busy,
}: {
  modal: Modal;
  data: LedgerData;
  snapshots: Map<string, LedgerSnapshot>;
  close: () => void;
  busy: boolean;
  submit: (
    path: string,
    body: unknown,
    method?: string,
    file?: File,
    ids?: Record<string, string>,
  ) => Promise<void>;
  uploadOnly: (file: File, ids: Record<string, string>) => Promise<void>;
}) {
  const editingPayment = modal.kind === "edit-payment" ? modal.payment : undefined;
  const [error, setError] = useState("");
  const [source, setSource] = useState("new");
  const [paymentDate, setPaymentDate] = useState(editingPayment?.date ?? todayBangkok());
  const [dateEstimated, setDateEstimated] = useState(editingPayment?.dateEstimated ?? false);
  const [copied, setCopied] = useState(false);
  const [channel, setChannel] = useState<"LINE" | "Facebook">("LINE");
  const loan = "loan" in modal ? modal.loan : undefined;
  const borrower = loan
    ? data.borrowers.find((b) => b.id === loan.borrowerId)
    : undefined;
  const s = loan
    ? calculateLedger({
        loan,
        payments: data.payments.filter(p => p.id !== editingPayment?.id),
        rateChanges: data.rateChanges,
        adjustments: data.adjustments,
        asOf:
          paymentDate && paymentDate >= loan.startDate
            ? paymentDate
            : loan.startDate,
      })
    : undefined;
  const [ratePercent, setRatePercent] = useState(() =>
    loan ? String((modal.kind === "loan-correction" ? loan.rateBps : s?.currentRateBps ?? loan.rateBps) / 100) : "",
  );
  const [remainingPrincipal, setRemainingPrincipal] = useState(() => loan ? String((snapshots.get(loan.id)?.principalCents ?? loan.principalCents) / 100) : "");
  const futureRates = loan ? data.rateChanges.filter(r => r.loanId === loan.id && !r.canceledAt && r.effectiveDate > todayBangkok()) : [];
  const availableRateDates = loan && s && modal.kind === "rate"
    ? Array.from({ length: 24 }, (_, index) => addMonths(s.currentCycleEndDate, index, loan.anchorDay))
      .filter(day => !futureRates.some(r => r.effectiveDate === day)) : [];
  const [message, setMessage] = useState(
    loan
      ? `สวัสดี ${borrower?.nickname || borrower?.name} ขอแจ้งวันนัดชำระ ${date(loan.dueDate)} สำหรับรายการกู้ ${loan.id.slice(0, 8)} ดอกค้าง ${money(snapshots.get(loan.id)?.interestCents || 0)} บาท เงินต้นคงเหลือ ${money(snapshots.get(loan.id)?.principalCents || 0)} บาท หากชำระแล้วส่งหลักฐานให้ตรวจสอบได้ ขอบคุณครับ/ค่ะ`
      : "",
  );
  const titles = {
    borrower:
      "borrower" in modal && modal.borrower
        ? "แก้ไขข้อมูลผู้กู้"
        : "เพิ่มผู้กู้",
    loan: "เพิ่มสัญญาเงินกู้",
    payment: "บันทึกรับชำระ",
    "edit-payment": "แก้ไขรับชำระ",
    payoff: "ปิดหนี้ตามวัน",
    rate: "เปลี่ยนอัตรางวดถัดไป",
    adjustment: "เพิ่ม/ลดยอด (ขั้นสูง)",
    "loan-correction": "แก้ต้น / ดอก / วันนัด",
    contact: "เตรียมข้อความติดตาม",
    attachment: "แนบหลักฐาน",
    "payment-attachment": "แนบสลิปการชำระ",
    cancel: "ยกเลิกรายการ",
    recovery: "เก็บรหัสกู้คืนของคุณ",
  };
  async function handle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const f = new FormData(event.currentTarget);
    try {
      if (modal.kind === "borrower")
        await submit(
          modal.borrower ? `/borrowers/${modal.borrower.id}` : "/borrowers",
          {
            name: field(f, "name"),
            nickname: field(f, "nickname"),
            phone: field(f, "phone"),
            lineId: field(f, "lineId"),
            facebookUrl: field(f, "facebookUrl"),
            notes: field(f, "notes"),
          },
          modal.borrower ? "PATCH" : "POST",
        );
      else if (modal.kind === "loan") {
        const startDate = field(f, "startDate");
        const cycleStartDate =
          source === "existing" ? field(f, "cycleStartDate") : startDate;
        const anchorDay = Number(field(f, "anchorDay"));
        await submit("/loans", {
          borrowerId: field(f, "borrowerId"),
          source,
          principalCents: cents(f, "principal"),
          openingInterestCents:
            source === "existing" ? cents(f, "openingInterest") : 0,
          rateBps: Math.round(Number(field(f, "rate")) * 100),
          startDate,
          cycleStartDate,
          firstCycleEndDate:
            source === "existing"
              ? field(f, "firstCycleEndDate")
              : addMonths(startDate, 1, anchorDay),
          anchorDay,
          dueDate: field(f, "dueDate"),
          notes: field(f, "notes"),
        });
      } else if (modal.kind === "payment" || modal.kind === "edit-payment" || modal.kind === "payoff") {
        const submittedDate = dateEstimated && modal.kind !== "payoff" ? paymentDate : field(f, "date");
        const submittedBalance = calculateLedger({
          loan: modal.loan,
          payments: data.payments,
          rateChanges: data.rateChanges,
          adjustments: data.adjustments,
          asOf: submittedDate,
        });
        await submit(editingPayment ? `/payments/${editingPayment.id}` : "/payments", {
          loanId: modal.loan.id,
          date: submittedDate,
          dateEstimated: modal.kind !== "payoff" && dateEstimated,
          totalCents:
            modal.kind === "payoff"
              ? submittedBalance.payoffTotalCents
              : cents(f, "total"),
          principalCents:
            modal.kind === "payoff"
              ? submittedBalance.principalCents
              : cents(f, "principal"),
          interestCents:
            modal.kind === "payoff"
              ? submittedBalance.payoffInterestCents
              : cents(f, "interest"),
          note: field(f, "note"),
          isPayoff: modal.kind === "payoff",
          ...(editingPayment ? { editReason: field(f, "editReason") } : {}),
        }, editingPayment ? "PATCH" : "POST");
      } else if (modal.kind === "rate")
        await submit("/rate-changes", {
          loanId: modal.loan.id,
          effectiveDate: field(f, "effectiveDate"),
          rateBps: Math.round(Number(field(f, "rate")) * 100),
          reason: field(f, "reason"),
        });
      else if (modal.kind === "adjustment")
        await submit("/adjustments", {
          loanId: modal.loan.id,
          date: field(f, "date"),
          principalDeltaCents: cents(f, "principalDelta"),
          interestDeltaCents: cents(f, "interestDelta"),
          reason: field(f, "reason"),
        });
      else if (modal.kind === "loan-correction")
        await submit(
          `/loans/${modal.loan.id}/correction`,
          {
            rateBps: Math.round(Number(field(f, "rate")) * 100),
            remainingPrincipalCents: cents(f, "remainingPrincipal"),
            dueDate: field(f, "dueDate"),
            reason: field(f, "reason"),
            cancelRateChangeIds: f.getAll("cancelRateChangeIds").map(String),
          },
          "POST",
        );
      else if (modal.kind === "cancel")
        await submit(modal.path, { reason: field(f, "reason") });
      else if (modal.kind === "contact")
        await submit("/contacts", { loanId: modal.loan.id, channel, message });
      else if (
        modal.kind === "attachment" ||
        modal.kind === "payment-attachment"
      ) {
        const file = f.get("file");
        if (file instanceof File && file.size)
          await uploadOnly(file, {
            loanId: modal.loan.id,
            borrowerId: modal.loan.borrowerId,
            ...(modal.kind === "payment-attachment"
              ? { paymentId: modal.paymentId }
              : {}),
          });
        else throw new Error("เลือกไฟล์หลักฐานก่อนบันทึก");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    }
  }
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy && modal.kind !== "recovery") close();
    };
    window.addEventListener("keydown", handler);
    const previous = document.activeElement;
    const dialog = document.querySelector<HTMLElement>(".modal");
    dialog?.focus();
    return () => {
      window.removeEventListener("keydown", handler);
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [busy]);
  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy && modal.kind !== "recovery")
          close();
      }}
    >
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        tabIndex={-1}
      >
        <header>
          <div>
            <h2 id="modal-title">{titles[modal.kind]}</h2>
            {borrower && <p>{borrower.name}</p>}
            {loan && <small className="modal-loan-context">ต้นเริ่มบันทึก ฿{money(loan.principalCents)} · นัดชำระ {date(loan.dueDate)}</small>}
          </div>
          {modal.kind !== "recovery" && (
            <button aria-label="ปิด" disabled={busy} onClick={close}>
              <X />
            </button>
          )}
        </header>
        {modal.kind === "recovery" ? (
          <div className="modal-content">
            <p>
              บันทึกรหัสนี้ในที่ปลอดภัย
              ใช้ตั้งรหัสผ่านใหม่หากคุณเข้าใช้งานไม่ได้
            </p>
            <code className="recovery-code">{modal.code}</code>
            <Button
              secondary
              onClick={() =>
                void navigator.clipboard
                  .writeText(modal.code)
                  .then(() => setCopied(true))
              }
            >
              <Copy />
              {copied ? "คัดลอกแล้ว" : "คัดลอกรหัส"}
            </Button>
            <Button onClick={close}>เก็บรหัสแล้ว</Button>
          </div>
        ) : (
          <form onSubmit={handle}>
            <div className="modal-content">
              {modal.kind === "borrower" && (
                <div className="form-grid">
                  <Input
                    label="ชื่อจริง *"
                    name="name"
                    value={modal.borrower?.name}
                    required
                  />
                  <Input
                    label="ชื่อเรียก"
                    name="nickname"
                    value={modal.borrower?.nickname}
                  />
                  <Input
                    label="เบอร์โทร"
                    name="phone"
                    type="tel"
                    value={modal.borrower?.phone}
                  />
                  <Input
                    label="LINE ID"
                    name="lineId"
                    value={modal.borrower?.lineId}
                  />
                  <Input
                    label="ลิงก์ Facebook"
                    name="facebookUrl"
                    type="url"
                    value={modal.borrower?.facebookUrl}
                  />
                  <Input
                    label="หมายเหตุ"
                    name="notes"
                    value={modal.borrower?.notes}
                  />
                </div>
              )}
              {modal.kind === "loan" && (
                <>
                  <label className="field">
                    ผู้กู้ *
                    <select
                      name="borrowerId"
                      required
                      defaultValue={modal.borrowerId || ""}
                    >
                      <option value="">เลือกผู้กู้</option>
                      {data.borrowers.map((b) => (
                        <option value={b.id} key={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {!data.borrowers.length && (
                    <p className="panel-note">
                      ปิดหน้าต่างนี้ แล้วเพิ่มผู้กู้ในเมนูผู้กู้และสัญญาก่อน
                    </p>
                  )}
                  <div className="segmented">
                    <button
                      type="button"
                      className={source === "new" ? "selected" : ""}
                      onClick={() => setSource("new")}
                    >
                      กู้ใหม่ / ยืมไม่มีดอก
                    </button>
                    <button
                      type="button"
                      className={source === "existing" ? "selected" : ""}
                      onClick={() => setSource("existing")}
                    >
                      หนี้เดิมยกมา
                    </button>
                  </div>
                  <div className="form-grid">
                    <Input
                      label={
                        source === "existing"
                          ? "ต้นคงเหลือยกมา (บาท) *"
                          : "เงินต้น (บาท) *"
                      }
                      name="principal"
                      type="number"
                      step="0.01"
                      min="0.01"
                      required
                    />
                    <Input
                      label="ดอกเบี้ยต่อเดือน (%) *"
                      name="rate"
                      type="number"
                      min="0"
                      max={source === "new" ? "1.25" : undefined}
                      step="0.01"
                      value="0"
                      hint={
                        source === "new"
                          ? "0% สำหรับยืมไม่มีดอก สูงสุดทั่วไป 1.25% ต่อเดือน"
                          : "บันทึกอัตราตามหลักฐานหนี้เดิม"
                      }
                      required
                    />
                    <Input
                      label={
                        source === "existing"
                          ? "วันที่เริ่มนับยอด *"
                          : "วันที่ให้กู้ *"
                      }
                      name="startDate"
                      type="date"
                      value={todayBangkok()}
                      max={todayBangkok()}
                      required
                    />
                    <Input
                      label="วันนัดชำระ *"
                      name="dueDate"
                      type="date"
                      required
                      value={addMonths(todayBangkok(), 1)}
                    />
                    <Input
                      label="วันตัดรอบของเดือน *"
                      name="anchorDay"
                      type="number"
                      min="1"
                      max="31"
                      step="1"
                      value={Number(todayBangkok().slice(-2))}
                      required
                    />
                    {source === "existing" && (
                      <>
                        <Input
                          label="ดอกค้างถึงวันเริ่มนับยอด (บาท) *"
                          name="openingInterest"
                          type="number"
                          step="0.01"
                          min="0"
                          value="0"
                          required
                        />
                        <Input
                          label="วันเริ่มรอบเดิม *"
                          name="cycleStartDate"
                          type="date"
                          required
                          hint="ขอบเขตต้นรอบก่อนวันยกยอด ใช้เป็นฐานจำนวนวันจริง"
                        />
                        <Input
                          label="วันตัดรอบถัดไป *"
                          name="firstCycleEndDate"
                          type="date"
                          required
                        />
                      </>
                    )}
                  </div>
                  <Input label="หมายเหตุ / ข้อตกลง" name="notes" />
                </>
              )}
              {(modal.kind === "payment" || modal.kind === "edit-payment" || modal.kind === "payoff") && (
                <>
                  <label className="field">
                    วันที่รับชำระ *
                    <input
                      name="date"
                      type="date"
                      required
                      disabled={modal.kind !== "payoff" && dateEstimated}
                      value={paymentDate}
                      min={loan?.startDate}
                      max={todayBangkok()}
                      onInput={(e) => setPaymentDate(e.currentTarget.value)}
                      onChange={(e) => setPaymentDate(e.target.value)}
                    />
                  </label>
                  {modal.kind !== "payoff" ? (
                    <>
                      <label className="payment-date-unknown">
                        <input type="checkbox" checked={dateEstimated} onChange={(event) => {
                          setDateEstimated(event.target.checked);
                          if (event.target.checked) setPaymentDate(todayBangkok());
                        }} />
                        จำวันที่จ่ายจริงไม่ได้ ใช้วันที่บันทึกและระบุไว้ในประวัติ
                      </label>
                      <div className="payment-interest-context" role="status">
                        <p>ดอกตามสูตร ณ วันที่เลือก สำหรับอ้างอิง</p>
                        <strong>฿{money(s?.payoffInterestCents || 0)}</strong>
                        <small>คุณระบุยอดดอกที่รับจริงเองได้ ไม่จำกัดตามยอดคำนวณ · ไม่มีค่าปรับอัตโนมัติ</small>
                        <small>ส่วนที่รับเกินยอดสูตรเป็นดอกรับตามตกลง ไม่เป็นเครดิตหักดอกล่วงหน้า</small>
                      </div>
                      <div className="form-grid">
                        <Input
                          label="ยอดรับเงินจริง (บาท) *"
                          name="total"
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={editingPayment ? editingPayment.totalCents / 100 : undefined}
                          required
                        />
                        <Input
                          label="คืนต้น (บาท) *"
                          name="principal"
                          type="number"
                          min="0"
                          step="0.01"
                          value={editingPayment ? editingPayment.principalCents / 100 : "0"}
                          required
                        />
                        <Input
                          label="ชำระดอก (บาท) *"
                          name="interest"
                          type="number"
                          min="0"
                          step="0.01"
                          value={editingPayment ? editingPayment.interestCents / 100 : "0"}
                          required
                        />
                      </div>
                      <p className="panel-note">
                        คืนต้น + ชำระดอก ต้องเท่ากับยอดรับจริง
                        จ่ายเฉพาะดอกได้โดยคืนต้นเป็น 0 ยอดดอกให้กรอกตามที่คุณรับจริง
                      </p>
                    </>
                  ) : (
                    <div className="payoff-preview">
                      <p>เงินต้น ฿{money(s?.principalCents || 0)}</p>
                      <p>
                        ดอกรวมถึงวันปิด ฿{money(s?.payoffInterestCents || 0)}
                      </p>
                      <strong>
                        ยอดรับปิดหนี้ ฿{money(s?.payoffTotalCents || 0)}
                      </strong>
                      <small>
                        คิดตามวันจริงในรอบ นับวันเริ่ม ไม่นับวันชำระ
                      </small>
                    </div>
                  )}
                  <Input label="หมายเหตุ" name="note" value={editingPayment?.note} />
                  {editingPayment && <>
                    <Input label="เหตุผลที่แก้ไข (ไม่บังคับ)" name="editReason" />
                    <p className="panel-note">เก็บรายการเดิมเป็นประวัติ และใช้รายการที่แก้ไขคำนวณยอดแทน</p>
                  </>}
                </>
              )}
              {modal.kind === "rate" && (
                <>
                  <div className="form-grid">
                    <label className="field">อัตราใหม่ต่อเดือน (%) *
                      <input name="rate" type="number" min="0" max={modal.loan.source === "new" ? "1.25" : undefined}
                        step="0.01" required value={ratePercent} onChange={e => setRatePercent(e.target.value)} />
                      <small>10% ให้กรอก 10 · 7.5% ให้กรอก 7.5 · ไม่มีดอกกรอก 0</small>
                      {modal.loan.source === "new" && <small>รายการประเภทกู้ใหม่ ตั้งอัตราสำหรับงวดใหม่ได้ไม่เกิน 1.25% ต่อเดือน</small>}
                    </label>
                    <label className="field">เริ่มใช้อัตราใหม่ในงวด *
                      <select name="effectiveDate" required defaultValue={availableRateDates[0]}>
                        {availableRateDates.map(day => <option key={day} value={day}>{date(day)}</option>)}
                      </select>
                      <small>แสดงเฉพาะวันเริ่มรอบที่ยังไม่ได้ตั้งอัตราไว้</small>
                    </label>
                  </div>
                  <p className="panel-note">
                    ใช้สำหรับตกลงอัตราใหม่ในอนาคต หากกรอกอัตราเดิมผิด ให้ปิดหน้านี้แล้วเลือก “แก้ต้น / ดอก / วันนัด”
                  </p>
                  <Input label="เหตุผล *" name="reason" required />
                </>
              )}
              {modal.kind === "adjustment" && (
                <>
                  <Input
                    label="วันที่ปรับยอด *"
                    name="date"
                    type="date"
                    value={todayBangkok()}
                    required
                  />
                  <div className="form-grid">
                    <Input
                      label="จำนวนต้นที่จะเพิ่ม/ลด (บาท) *"
                      name="principalDelta"
                      type="number"
                      step="0.01"
                      value="0"
                      hint="เป็นส่วนต่าง: ใส่ -40000 เพื่อลดจาก 60000 เหลือ 20000"
                      required
                    />
                    <Input
                      label="จำนวนดอกที่จะเพิ่ม/ลด (บาท) *"
                      name="interestDelta"
                      type="number"
                      step="0.01"
                      value="0"
                      required
                    />
                  </div>
                  <p className="panel-note">
                    ช่องนี้รับจำนวนที่จะเพิ่มหรือลด หากต้องการใส่ยอดสุดท้าย ให้เลือก “แก้ต้น / ดอก / วันนัด” แทน ค่าบวกเพิ่มยอด ค่าลบลดยอด
                  </p>
                  <Input label="เหตุผล *" name="reason" required />
                </>
              )}
              {modal.kind === "loan-correction" && (
                <>
                  <p className="panel-note">แก้ข้อมูลที่กรอกผิด โดยใช้อัตราที่ถูกต้องตั้งแต่วันเริ่มบันทึก เก็บค่าเดิมและเหตุผลไว้ในประวัติ</p>
                  <label className="field">เงินต้นคงเหลือที่ถูกต้อง (บาท) *
                    <input name="remainingPrincipal" type="number" min="0" step="0.01" required value={remainingPrincipal} onChange={e => setRemainingPrincipal(e.target.value)} />
                    <small>กรอกยอดสุดท้ายที่ต้องการ เช่น 20000 เมื่อต้องเหลือต้น 20,000 บาท</small>
                  </label>
                  <p className="panel-note">ต้นคงเหลือปัจจุบัน ฿{money(snapshots.get(modal.loan.id)?.principalCents ?? modal.loan.principalCents)} → ยอดที่ต้องการ ฿{money(Math.round(Number(remainingPrincipal) * 100) || 0)}
                    <br />การแก้ต้นจะเก็บรายการปรับส่วนต่าง ณ วันนี้ ไม่บันทึกเป็นเงินรับชำระ</p>
                  <label className="field">อัตราดอกที่ถูกต้องต่อเดือน (%) *
                    <input name="rate" type="number" min="0" step="0.01" required value={ratePercent} onChange={e => setRatePercent(e.target.value)} />
                    <small>10% ให้กรอก 10 · 7.5% ให้กรอก 7.5 · ไม่มีดอกกรอก 0</small>
                  </label>
                  <div className="payment-interest-context" role="status">
                    <p>ตัวอย่างดอกเต็มเดือนจากต้นที่ระบุ ฿{money(Math.round(Number(remainingPrincipal) * 100) || 0)}</p>
                    <strong>{Number.isFinite(Number(ratePercent)) && Number(ratePercent) >= 0
                      ? `${Number(ratePercent)}% = ฿${money(Math.round(Number(remainingPrincipal) * Number(ratePercent)) || 0)}` : "กรอกอัตราที่ถูกต้อง"}</strong>
                  </div>
                  <Input
                    label="วันนัดชำระใหม่ *"
                    name="dueDate"
                    type="date"
                    value={modal.loan.dueDate}
                    min={modal.loan.startDate}
                    required
                  />
                  {futureRates.length > 0 && <div className="panel-note">
                    <p>มีอัตราที่ตั้งไว้ล่วงหน้า หากตั้งผิด ให้เลือกยกเลิกรายการนั้นด้วย</p>
                    {futureRates.map(r => <label className="payment-date-unknown" key={r.id}>
                      <input type="checkbox" name="cancelRateChangeIds" value={r.id} />
                      ยกเลิกอัตรา {r.rateBps / 100}% วันที่ {date(r.effectiveDate)}
                    </label>)}
                  </div>}
                  <Input label="เหตุผล *" name="reason" required />
                  <p className="panel-note">เปลี่ยนวันนัดชำระได้ แต่รอบตัดดอกยังเดิม รายการที่ตั้งอัตราล่วงหน้าไว้จะยังใช้ตามเดิมหากไม่ได้เลือกยกเลิก</p>
                </>
              )}
              {modal.kind === "cancel" && (
                <>
                  <p>
                    รายการเดิมจะยังอยู่ในประวัติ
                    และยอดจะคำนวณใหม่จากรายการที่มีผล
                  </p>
                  <Input label="เหตุผลที่ยกเลิก *" name="reason" required />
                </>
              )}
              {(modal.kind === "attachment" ||
                modal.kind === "payment-attachment") && (
                <label className="field">
                  ไฟล์หลักฐาน *
                  <input
                    type="file"
                    name="file"
                    accept="image/jpeg,image/png,image/webp,application/pdf"
                    required
                  />
                  <small>รูปภาพหรือ PDF ไม่เกิน 10 MB</small>
                </label>
              )}
              {modal.kind === "contact" && (
                <>
                  <div className="segmented">
                    <button
                      type="button"
                      className={channel === "LINE" ? "selected" : ""}
                      onClick={() => setChannel("LINE")}
                    >
                      LINE
                    </button>
                    <button
                      type="button"
                      className={channel === "Facebook" ? "selected" : ""}
                      onClick={() => setChannel("Facebook")}
                    >
                      Facebook
                    </button>
                  </div>
                  <label className="field">
                    ตรวจและปรับข้อความ
                    <textarea
                      rows={6}
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      required
                    />
                  </label>
                  <div className="actions-wrap">
                    <Button
                      secondary
                      onClick={() =>
                        void navigator.clipboard
                          .writeText(message)
                          .then(() => setCopied(true))
                          .catch(() =>
                            setError(
                              "คัดลอกไม่ได้ โปรดเลือกข้อความและคัดลอกเอง",
                            ),
                          )
                      }
                    >
                      {copied ? <Check /> : <Copy />}
                      {copied ? "คัดลอกแล้ว" : "คัดลอกข้อความ"}
                    </Button>
                    {channel === "Facebook" && borrower?.facebookUrl && (
                      <a
                        className="button secondary"
                        href={borrower.facebookUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        เปิด Facebook
                      </a>
                    )}
                    {channel === "LINE" && (
                      <a
                        className="button secondary"
                        href="https://line.me/"
                        target="_blank"
                        rel="noreferrer"
                      >
                        เปิด LINE
                      </a>
                    )}
                  </div>
                  <p className="panel-note">
                    หลังส่งด้วยบัญชีส่วนตัวแล้ว จึงกด "ส่งแล้ว"
                    การคัดลอกยังไม่บันทึกว่าส่ง
                  </p>
                </>
              )}
            </div>
            <footer>
              {error && (
                <p className="error modal-error" role="alert">
                  {error}
                </p>
              )}
              <Button secondary onClick={close} disabled={busy}>
                ยกเลิก
              </Button>
              <Button
                type="submit"
                disabled={
                  busy || (modal.kind === "loan" && !data.borrowers.length)
                }
              >
                {busy
                  ? "กำลังบันทึก…"
                  : modal.kind === "contact"
                    ? "ส่งแล้ว บันทึกประวัติ"
                    : modal.kind === "payoff"
                      ? "ยืนยันรับเงินปิดหนี้"
                    : modal.kind === "edit-payment"
                      ? "บันทึกการแก้ไข"
                      : "บันทึก"}
              </Button>
            </footer>
          </form>
        )}
      </section>
    </div>
  );
}
