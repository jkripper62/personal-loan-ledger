import { useEffect, useState, type FormEvent } from "react";
import { Copy, Check, X, Download, Send } from "lucide-react";
import QRCode from "qrcode";
import { calculateLedger, addMonths, daysBetween, todayBangkok } from "../domain/ledger";
import { loanDisplayName } from "../domain/loan-name";
import { followUps } from "../domain/follow-up";
import { reminderMessage, type MessageSettings } from "../domain/reminder-message";
import { promptPayPayload } from "../domain/promptpay";
import type { LoanRecordAction } from "../domain/loan-records";
const recordActionTitles: Record<LoanRecordAction, string> = {
  "mark-test": "ย้ายเป็นสัญญาทดลอง",
  "mark-real": "เปลี่ยนเป็นสัญญาจริง",
  "trash-test": "ลบสัญญาทดลอง",
  "restore-test": "กู้คืนสัญญาทดลอง",
};
import type {
  Borrower,
  Loan,
  LedgerData,
  LedgerSnapshot,
  Payment,
} from "../domain/types";
import { Button, Input, money, date, field, cents } from "./ui";
function MonthlyRateInput({ label, value, onChange }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return <label className="field">{label}
    <input name="rate" type="number" min="0" step="0.01" required value={value} onChange={e => onChange(e.target.value)} />
    <small>10% ให้กรอก 10 · 7.5% ให้กรอก 7.5 · ไม่มีดอกกรอก 0</small>
    {Number(value) > 1.25 && <small>
      บันทึกอัตราตามจริง การบันทึกไม่รับรองสิทธิเรียกเก็บดอก อัตราทั่วไปสำหรับบุคคลธรรมดาไม่เกิน 15% ต่อปี (เฉลี่ย 1.25% ต่อเดือน) · <a href="https://personal.prd.go.th/th/content/category/detail/id/1824/cid/1825/iid/296636" target="_blank" rel="noreferrer">ข้อมูลจากกรมประชาสัมพันธ์</a>
    </small>}
  </label>;
}
export type Modal =
  | { kind: "loan-record"; loan: Loan; action: LoanRecordAction }
  | { kind: "borrower"; borrower?: Borrower }
  | { kind: "loan"; borrowerId?: string }
  | { kind: "edit-payment"; loan: Loan; payment: Payment }
  | { kind: "payment"; loan: Loan; suggestInterestCents?: number }
  | {
      kind: "payoff" | "rate" | "adjustment" | "loan-correction" | "loan-purpose" | "contact";
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
  settings,
}: {
  modal: Modal;
  settings: MessageSettings;
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
    loan ? String((modal.kind === "loan-correction" ? loan.rateBps : s?.currentRateBps ?? loan.rateBps) / 100) : "0",
  );
  const [remainingPrincipal, setRemainingPrincipal] = useState(() => loan ? String((snapshots.get(loan.id)?.principalCents ?? loan.principalCents) / 100) : "");
  const [purpose, setPurpose] = useState(loan?.purpose ?? "");
  const [payoffInterest, setPayoffInterest] = useState("");
  // After collecting a due or late payment, offer to move the due date to the next cycle end.
  const nextDueDate = modal.kind === "payment" && s ? s.currentCycleEndDate : undefined;
  const offerNextDue = Boolean(nextDueDate && loan && daysBetween(todayBangkok(), loan.dueDate) <= 1 && nextDueDate > loan.dueDate);
  const [moveDueDate, setMoveDueDate] = useState(true);
  const futureRates = loan ? data.rateChanges.filter(r => r.loanId === loan.id && !r.canceledAt && r.effectiveDate > todayBangkok()) : [];
  const availableRateDates = loan && s && modal.kind === "rate"
    ? Array.from({ length: 24 }, (_, index) => addMonths(s.currentCycleEndDate, index, loan.anchorDay))
      .filter(day => !futureRates.some(r => r.effectiveDate === day)) : [];
  const followUp = modal.kind === "contact" ? followUps(data, todayBangkok()).find((item) => item.loan.id === modal.loan.id) : undefined;
  const [message, setMessage] = useState(followUp ? reminderMessage(followUp, settings) : "");
  const [qr, setQr] = useState("");
  useEffect(() => {
    if (!followUp || !settings.promptPayId) return;
    void QRCode.toDataURL(promptPayPayload(settings.promptPayId, followUp.interestDueCents), { width: 320, margin: 2 })
      .then(setQr)
      .catch(() => setQr(""));
  }, [followUp?.interestDueCents, settings.promptPayId]);
  const suggested = modal.kind === "payment" ? modal.suggestInterestCents ?? 0 : 0;
  const [amounts, setAmounts] = useState(() => ({
    total: editingPayment ? String(editingPayment.totalCents / 100) : suggested ? String(suggested / 100) : "",
    principal: editingPayment ? String(editingPayment.principalCents / 100) : "0",
    interest: editingPayment ? String(editingPayment.interestCents / 100) : suggested ? String(suggested / 100) : "0",
  }));
  const sum = (principal: string, interest: string) => String((Math.round(Number(principal) * 100) + Math.round(Number(interest) * 100)) / 100);
  const setPart = (part: "principal" | "interest", value: string) =>
    setAmounts((current) => {
      const next = { ...current, [part]: value };
      return { ...next, total: sum(next.principal, next.interest) };
    });
  const titles = {
    "loan-record": modal.kind === "loan-record" ? recordActionTitles[modal.action] : "จัดหมวดสัญญา",
    borrower:
      "borrower" in modal && modal.borrower
        ? "แก้ไขข้อมูลผู้กู้"
        : "เพิ่มผู้กู้",
    loan: "เพิ่มสัญญาเงินกู้",
    payment: "บันทึกรับชำระ",
    "edit-payment": "แก้ไขรับชำระ",
    payoff: "บันทึกรับเงินปิดหนี้",
    rate: "เปลี่ยนอัตรางวดถัดไป",
    adjustment: "เพิ่ม/ลดยอด (ขั้นสูง)",
    "loan-correction": "แก้ต้น / ดอก / วันนัด",
    "loan-purpose": "ตั้งชื่อรายการกู้",
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
          isTest: f.get("isTest") === "on",
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
          purpose: field(f, "purpose"),
          notes: field(f, "notes"),
        });
      } else if (modal.kind === "payment" || modal.kind === "edit-payment" || modal.kind === "payoff") {
        const submittedDate = dateEstimated && modal.kind !== "payoff" ? paymentDate : field(f, "date");
        const submittedBalance = calculateLedger({
          loan: modal.loan,
          payments: data.payments.filter(p => p.id !== editingPayment?.id),
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
              ? submittedBalance.principalCents + cents(f, "interest")
              : cents(f, "total"),
          principalCents:
            modal.kind === "payoff"
              ? submittedBalance.principalCents
              : cents(f, "principal"),
          interestCents: cents(f, "interest"),
          note: field(f, "note"),
          isPayoff: modal.kind === "payoff" || editingPayment?.isPayoff === true,
          ...((modal.kind === "payoff" || editingPayment?.isPayoff) ? { payoffMode: "owner" } : {}),
          ...(editingPayment ? { editReason: field(f, "editReason") } : {}),
        }, editingPayment ? "PATCH" : "POST");
        if (offerNextDue && moveDueDate && nextDueDate)
          await submit(`/loans/${modal.loan.id}`, { dueDate: nextDueDate, reason: "เลื่อนวันนัดเป็นงวดถัดไปหลังรับชำระ" }, "PATCH");
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
      else if (modal.kind === "loan-record")
        await submit(`/loans/${modal.loan.id}/record-status`, { action: modal.action, reason: field(f, "reason") });
      else if (modal.kind === "loan-purpose")
        await submit(`/loans/${modal.loan.id}`, { purpose: field(f, "purpose"), reason: "เจ้าของตั้งชื่อรายการกู้" }, "PATCH");
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
            {borrower && <p>{loan ? loanDisplayName(borrower.name, loan) : borrower.name}</p>}
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
                  <label className="payment-date-unknown">
                    <input type="checkbox" name="isTest" />
                    สัญญาทดลอง · ไม่นับต้น ดอก เงินรับ หรือยอดคาดการณ์ในบัญชีจริง
                  </label>
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
                    <MonthlyRateInput
                      label="ดอกเบี้ยต่อเดือน (%) *"
                      value={ratePercent}
                      onChange={setRatePercent}
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
                          label="ดอกยกมาที่คุณระบุเอง (บาท) *"
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
                  <Input label="ชื่อรายการ / กู้ไปเพื่ออะไร" name="purpose" hint="เช่น ค่าเหล้า, คอนเนคชั่นเอาไปปล่อยต่อ, กู้เอง" />
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
                      {offerNextDue && nextDueDate && (
                        <label className="payment-date-unknown">
                          <input type="checkbox" checked={moveDueDate} onChange={(e) => setMoveDueDate(e.target.checked)} />
                          เลื่อนวันนัดชำระเป็นงวดถัดไป {date(nextDueDate)} (เดิม {date(loan!.dueDate)})
                        </label>
                      )}
                      <div className="payment-interest-context" role="status">
                        <p>ดอกค้างชำระ ณ วันที่เลือก</p>
                        <strong className={s?.interestCents ? "owed" : ""}>฿{money(s?.interestCents || 0)}</strong>
                        {(s?.accruedInterestCents || 0) > 0 && <small>ดอกรอบปัจจุบันที่เดินอยู่ (ยังไม่ครบรอบ) ฿{money(s?.accruedInterestCents || 0)}</small>}
                        <div className="quick-fill">
                          {(s?.interestCents || 0) > 0 && <button type="button" className="text-button"
                            onClick={() => setPart("interest", String((s?.interestCents || 0) / 100))}>รับดอกค้าง ฿{money(s?.interestCents || 0)}</button>}
                          {(s?.cycleInterest.fullInterestCents || 0) > 0 && <button type="button" className="text-button"
                            onClick={() => setPart("interest", String((s?.cycleInterest.fullInterestCents || 0) / 100))}>ดอก 1 เดือน ฿{money(s?.cycleInterest.fullInterestCents || 0)}</button>}
                        </div>
                        <small>ตัวเลขเป็นยอดอ้างอิงตามสูตร คุณกรอกยอดที่รับจริงเองได้ · ส่วนที่รับเกินไม่เป็นเครดิตงวดถัดไป</small>
                      </div>
                      <div className="form-grid">
                        <label className="field">ชำระดอก (บาท) *
                          <input name="interest" type="number" min="0" step="0.01" required inputMode="decimal"
                            value={amounts.interest} onChange={(e) => setPart("interest", e.target.value)} />
                        </label>
                        <label className="field">คืนต้น (บาท) *
                          <input name="principal" type="number" min="0" step="0.01" required inputMode="decimal"
                            value={amounts.principal} onChange={(e) => setPart("principal", e.target.value)} />
                        </label>
                        <label className="field">ยอดรับเงินจริง (บาท) *
                          <input name="total" type="number" min="0.01" step="0.01" required inputMode="decimal"
                            value={amounts.total} onChange={(e) => setAmounts((current) => ({
                              ...current, total: e.target.value,
                              interest: String(Math.max(0, Math.round(Number(e.target.value) * 100) - Math.round(Number(current.principal) * 100)) / 100),
                            }))} />
                          <small>รวมให้อัตโนมัติ · แก้ยอดนี้แล้วระบบคิดส่วนดอกให้</small>
                        </label>
                      </div>
                    </>
                  ) : (
                    <div className="payoff-preview">
                      <p>เงินต้น ฿{money(s?.principalCents || 0)}</p>
                      <p>ดอกตามสูตรถึงวันที่ปิด ฿{money(s?.payoffInterestCents || 0)}
                        {(s?.interestCents || 0) > 0 && <> (ค้างชำระ ฿{money(s?.interestCents || 0)} + ดอกตามวันรอบนี้ ฿{money(s?.accruedInterestCents || 0)})</>}
                        {" "}<button type="button" className="text-button" onClick={() => setPayoffInterest(String((s?.payoffInterestCents || 0) / 100))}>ใช้ยอดนี้</button>
                      </p>
                      <label className="field">ดอกที่รับจริงตอนปิดหนี้ (บาท) *
                        <input name="interest" type="number" min="0" step="0.01" required value={payoffInterest} onChange={e => setPayoffInterest(e.target.value)} />
                        <small>กรอกยอดที่ได้รับจริง ไม่มีดอกให้กรอก 0 ระบบจะไม่เติมดอกจากสูตรแทนคุณ</small>
                      </label>
                      <strong>
                        {payoffInterest === "" ? "กรอกดอกที่รับจริงเพื่อดูยอดรวม" : `ยอดรับปิดหนี้ ฿${money((s?.principalCents || 0) + Math.round(Number(payoffInterest) * 100))}`}
                      </strong>
                      <small>
                        ปิดหนี้โดยใช้ดอกที่คุณระบุ ดอกตามสูตรที่ไม่ได้เรียกเก็บจะไม่ถูกนับเป็นเงินรับจริง
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
                    <MonthlyRateInput label="อัตราใหม่ต่อเดือน (%) *" value={ratePercent} onChange={setRatePercent} />
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
                  <MonthlyRateInput label="อัตราดอกที่ถูกต้องต่อเดือน (%) *" value={ratePercent} onChange={setRatePercent} />
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
              {modal.kind === "loan-record" && <>
                <p className="panel-note">
                  {modal.action === "mark-real"
                    ? "สัญญานี้และประวัติรับชำระทั้งหมดจะกลับมานับในยอดบัญชีจริง"
                    : modal.action === "trash-test"
                      ? "ย้ายสัญญาทดลองพร้อมประวัติไปถังขยะ ไม่นับในยอดบัญชีจริง และกู้คืนเป็นสัญญาทดลองได้"
                      : "สัญญานี้และประวัติรับชำระทั้งหมดเป็นข้อมูลทดลอง ไม่นับต้น ดอก เงินรับ ยอดคาดการณ์ หรือรายการเตือนในบัญชีจริง"}
                </p>
                <Input label="เหตุผล *" name="reason" required value={modal.action === "mark-test" ? "เจ้าของระบุว่าเป็นข้อมูลทดลอง" : modal.action === "trash-test" ? "ลบสัญญาที่ใช้ทดลอง" : "เจ้าของเปลี่ยนหมวดสัญญา"} />
              </>}
              {modal.kind === "loan-purpose" && (
                <>
                  <label className="field">ชื่อรายการ / กู้ไปเพื่ออะไร
                    <input name="purpose" maxLength={200} value={purpose} onChange={e => setPurpose(e.target.value)} />
                    <small>กรอกเฉพาะข้อความในวงเล็บ เช่น ค่าเหล้า, คอนเนคชั่นเอาไปปล่อยต่อ หรือกู้เอง เว้นว่างเพื่อลบชื่อรายการ</small>
                  </label>
                  <div className="payment-interest-context" role="status">
                    <p>ตัวอย่างชื่อที่จะแสดง</p>
                    <strong>{loanDisplayName(borrower?.name || "ผู้กู้", { purpose })}</strong>
                  </div>
                  <p className="panel-note">ชื่อนี้ใช้เฉพาะสัญญานี้ ยอดเงินและผู้กู้ยังเป็นคนเดิม</p>
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
                  {qr && followUp && (
                    <div className="promptpay-qr">
                      <img src={qr} alt={`QR พร้อมเพย์ ยอด ${money(followUp.interestDueCents)} บาท`} />
                      <div>
                        <strong>QR พร้อมเพย์ {followUp.interestDueCents ? `฿${money(followUp.interestDueCents)}` : "(ผู้กู้ใส่ยอดเอง)"}</strong>
                        <small>บันทึกรูปนี้แล้วส่งตามข้อความ ผู้กู้สแกนจ่ายได้ทันที</small>
                        <a className="button secondary" href={qr} download={`promptpay-${borrower?.nickname || borrower?.name || "qr"}.png`}>
                          <Download />บันทึกรูป QR
                        </a>
                      </div>
                    </div>
                  )}
                  {!settings.promptPayId && <p className="panel-note">ใส่เลขพร้อมเพย์ในหน้าตั้งค่า เพื่อแนบ QR ตามยอดดอกให้ผู้กู้สแกนจ่าย</p>}
                  <div className="actions-wrap">
                    {channel === "LINE" && (
                      <a className="button" href={`https://line.me/R/msg/text/?${encodeURIComponent(message)}`} target="_blank" rel="noreferrer">
                        <Send />ส่งทาง LINE
                      </a>
                    )}
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
                  </div>
                  {channel === "LINE" && <p className="panel-note">"ส่งทาง LINE" เปิดแอป LINE บนมือถือพร้อมข้อความ ให้เลือกผู้กู้แล้วกดส่ง</p>}
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
                  busy || (modal.kind === "loan" && !data.borrowers.length) || (modal.kind === "payoff" && payoffInterest === "")
                }
              >
                {busy
                  ? "กำลังบันทึก…"
                  : modal.kind === "contact"
                    ? "ส่งแล้ว บันทึกประวัติ"
                    : modal.kind === "loan-record"
                      ? recordActionTitles[modal.action]
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
