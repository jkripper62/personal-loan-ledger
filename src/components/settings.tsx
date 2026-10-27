import { useState, type FormEvent } from "react";
import { Database, Download, Info, Smartphone, Upload } from "lucide-react";
import { api, restoreBackup } from "../api";
import type { MessageSettings } from "../domain/reminder-message";
import { formatPromptPayId } from "../domain/reminder-message";
import { Button } from "./ui";

export function SettingsPage({ settings, saved, restored }: {
  settings: MessageSettings;
  saved: (settings: MessageSettings) => void;
  restored: (message: string) => Promise<void>;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const onPhone = location.hostname.endsWith(".ts.net");

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError("");
    try {
      saved(await api<MessageSettings>("/settings", {
        politeEnding: String(form.get("politeEnding") ?? ""),
        promptPayId: String(form.get("promptPayId") ?? ""),
      }, "PUT"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    }
  }
  async function restore(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const file = new FormData(form).get("backup");
    if (!(file instanceof File) || !file.size) return setError("เลือกไฟล์สำรอง (.json) ก่อน");
    setBusy(true);
    setError("");
    try {
      const result = await restoreBackup(file);
      await restored(`นำข้อมูลกลับมาแล้ว: ผู้กู้ ${result.borrowers} คน สัญญา ${result.loans} รายการ`);
      setConfirmRestore(false);
      form.reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : "นำข้อมูลกลับมาไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-page">
      {error && <div className="banner error" role="alert">{error}</div>}
      <section className="panel">
        <div className="panel-heading"><h2>ข้อความทวงและพร้อมเพย์</h2></div>
        <form className="settings-form" onSubmit={saveSettings}>
          <fieldset>
            <legend>คำลงท้ายในข้อความ</legend>
            {[["ครับ", "ครับ"], ["ค่ะ", "ค่ะ"], ["", "ไม่ใส่"]].map(([value, label]) => (
              <label key={label} className="choice">
                <input type="radio" name="politeEnding" value={value} defaultChecked={settings.politeEnding === value} />
                {label}
              </label>
            ))}
          </fieldset>
          <label className="field">
            พร้อมเพย์สำหรับรับเงิน
            <input name="promptPayId" inputMode="numeric" placeholder="เบอร์มือถือ หรือเลขบัตรประชาชน"
              defaultValue={settings.promptPayId ? formatPromptPayId(settings.promptPayId) : ""} />
            <small>ใส่แล้ว ข้อความทวงจะมีเลขพร้อมเพย์และ QR ตามยอดดอกให้ผู้กู้สแกนจ่าย เว้นว่างถ้าไม่ต้องการ</small>
          </label>
          <Button type="submit">บันทึกการตั้งค่า</Button>
        </form>
      </section>

      <section className="panel">
        <div className="panel-heading"><h2><Smartphone /> ใช้บนมือถือ</h2></div>
        <div className="settings-text">
          {onPhone ? (
            <p>คุณกำลังเปิดแอปผ่าน Tailscale อยู่ ✓ กดปุ่มแชร์ของเบราว์เซอร์ แล้วเลือก "เพิ่มไปยังหน้าจอโฮม" เพื่อเปิดแอปได้เหมือนแอปทั่วไป</p>
          ) : (
            <>
              <p>เปิดแอปจากมือถือได้ทุกที่ผ่าน Tailscale ข้อมูลยังเก็บบนคอมเครื่องนี้ และคนอื่นเข้าไม่ได้</p>
              <ol>
                <li>ติดตั้งแอป Tailscale บนคอมและมือถือ แล้วเข้าสู่ระบบด้วยบัญชีเดียวกัน</li>
                <li>ดับเบิลคลิกไฟล์ <code>ตั้งค่ามือถือ.cmd</code> ในโฟลเดอร์แอป</li>
                <li>เปิดลิงก์ที่ได้บนมือถือ แล้วเข้าสู่ระบบด้วยอีเมลและรหัสผ่านเดิม</li>
              </ol>
              <p className="panel-note">ต้องเปิดคอมและแอปไว้ มือถือจึงจะใช้งานได้</p>
            </>
          )}
        </div>
      </section>

      <section className="panel backup">
        <div className="panel-heading"><h2><Database /> สำรองข้อมูล</h2></div>
        <div className="settings-text">
          <p>แอปสำรองข้อมูลให้อัตโนมัติทุกวันในโฟลเดอร์ <code>.data\backups</code> เก็บย้อนหลัง 30 วัน
            ควรดาวน์โหลดไฟล์สำรองไปเก็บอีกที่ด้วย เช่น แฟลชไดรฟ์ หรือ Google Drive</p>
          <div className="backup-options">
            <a className="button" href="/api/backup" download><Download />ดาวน์โหลดไฟล์สำรอง</a>
            <a className="button secondary" href="/api/export" download><Download />ส่งออกสำหรับ Excel</a>
          </div>
        </div>
        <form className="settings-form restore-form" onSubmit={restore}>
          <h3><Upload /> นำข้อมูลสำรองกลับมา</h3>
          <label className="field">
            ไฟล์สำรอง (.json)
            <input type="file" name="backup" accept="application/json,.json" required />
          </label>
          <label className="choice">
            <input type="checkbox" checked={confirmRestore} onChange={(e) => setConfirmRestore(e.target.checked)} />
            เข้าใจแล้วว่าข้อมูลปัจจุบันจะถูกแทนที่ด้วยข้อมูลในไฟล์ (ระบบเก็บสำเนาข้อมูลปัจจุบันไว้ให้ก่อน)
          </label>
          <Button type="submit" secondary disabled={!confirmRestore || busy}>
            {busy ? "กำลังนำข้อมูลกลับมา…" : "นำข้อมูลกลับมา"}
          </Button>
        </form>
        <div className="footnote">
          <Info />
          ไฟล์สำรองมีข้อมูลส่วนตัวและเอกสารแนบ แต่ไม่มีรหัสผ่านบัญชี
        </div>
      </section>
    </div>
  );
}
