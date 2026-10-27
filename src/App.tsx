import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Home,
  Users,
  FileText,
  CalendarDays,
  Database,
  Laptop,
  Plus,
  Search,
  History,
  ChartNoAxesColumnIncreasing,
  MessageSquare,
  Info,
  X,
  ArrowLeft,
  LogOut,
  Download,
  Bell,
  Paperclip,
  Copy,
  Check,
  Wallet,
  ShieldCheck,
  Settings,
  ChartColumn,
} from "lucide-react";
import { api, setCsrf, upload } from "./api";
import { followUps, dueStatus } from "./domain/follow-up";
import type { MessageSettings } from "./domain/reminder-message";
import { TodayPanel, followUpLabel, needsAction } from "./components/follow-up";
import { MonthlySummaryPage } from "./components/summary";
import { SettingsPage } from "./components/settings";
import { ModalView, type Modal } from "./components/modal";
import {
  Button,
  Input,
  Empty,
  money,
  date,
  dateTime,
  field,
} from "./components/ui";
import { calculateLedger, addMonths, todayBangkok } from "./domain/ledger";
import { calculateInterestForecast } from "./domain/forecast";
import { isLoanOverdue } from "./domain/status";
import { loanDisplayName } from "./domain/loan-name";
import { isRealLoan, loanCategory, realLedgerData, type LoanCategory } from "./domain/loan-records";
import { InterestOverview, InterestDetail } from "./components/interest";
import type {
  Borrower,
  Loan,
  LedgerData,
  LedgerSnapshot,
  InterestForecast,
} from "./domain/types";

type Auth = {
  setupRequired: boolean;
  user: { email: string } | null;
  csrfToken?: string;
  smtpConfigured: boolean;
};
type Page = "overview" | "borrowers" | "history" | "reminders" | "summary" | "settings";
const emptyData: LedgerData = {
  borrowers: [],
  loans: [],
  payments: [],
  rateChanges: [],
  adjustments: [],
  contacts: [],
  attachments: [],
  audit: [],
};
const nav = [
  { id: "overview", title: "ภาพรวม", icon: Home },
  { id: "borrowers", title: "ผู้กู้และสัญญา", icon: Users },
  { id: "history", title: "ประวัติรับชำระ", icon: FileText },
  { id: "reminders", title: "ติดตามการชำระ", icon: CalendarDays },
  { id: "summary", title: "สรุปรายเดือน", icon: ChartColumn },
  { id: "settings", title: "ตั้งค่า / สำรอง", icon: Settings },
] satisfies { id: Page; title: string; icon: typeof Home }[];
function AuthScreen({
  auth,
  done,
}: {
  auth: Auth;
  done: (code?: string) => Promise<void>;
}) {
  const [mode, setMode] = useState<"login" | "reset" | "forgot">("login");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    const data = new FormData(event.currentTarget);
    try {
      if (mode === "forgot") {
        const result = await api<{ message: string }>("/auth/forgot", {
          email: field(data, "email"),
        });
        setMessage(result.message);
      } else if (mode === "reset") {
        await api("/auth/reset", {
          email: field(data, "email"),
          recoveryCode: field(data, "recoveryCode"),
          token: field(data, "token"),
          password: field(data, "password"),
        });
        setMode("login");
        setMessage("เปลี่ยนรหัสผ่านแล้ว เข้าสู่ระบบด้วยรหัสใหม่");
      } else {
        if (
          auth.setupRequired &&
          field(data, "password") !== field(data, "confirmPassword")
        )
          throw new Error("รหัสผ่านทั้งสองช่องต้องตรงกัน");
        const result = await api<{ csrfToken: string; recoveryCode?: string }>(
          auth.setupRequired ? "/auth/setup" : "/auth/login",
          { email: field(data, "email"), password: field(data, "password") },
        );
        setCsrf(result.csrfToken);
        await done(result.recoveryCode);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "ทำรายการไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-page">
      <aside className="auth-intro">
        <div className="brand">
          <span>
            <Database />
          </span>
          บัญชีเงินกู้
        </div>
        <h1>
          ทุกยอดเงิน
          <br />
          มีเรื่องราวที่ตรวจสอบได้
        </h1>
        <p>
          เก็บเงินต้น ดอกเบี้ย และประวัติการชำระ
          <br />
          ไว้ด้วยกันบนเครื่องของคุณ
        </p>
        <div className="auth-note">
          <ShieldCheck />
          ข้อมูลส่วนตัวของคุณ เก็บบนคอมพิวเตอร์นี้
        </div>
      </aside>
      <main className="auth-main">
        <div className="auth-box">
          <span className="auth-mark">
            <Wallet />
          </span>
          <h2>
            {auth.setupRequired
              ? "สร้างบัญชีเจ้าของ"
              : mode === "reset"
                ? "ตั้งรหัสผ่านใหม่"
                : mode === "forgot"
                  ? "ลืมรหัสผ่าน"
                  : "ยินดีต้อนรับกลับ"}
          </h2>
          <p>
            {auth.setupRequired
              ? "ข้อมูลเก็บบนคอมเครื่องนี้"
              : "บัญชีเงินกู้ส่วนตัวของคุณ"}
          </p>
          <form onSubmit={submit}>
            <Input label="อีเมล" name="email" type="email" required />
            {mode !== "forgot" && (
              <Input
                label="รหัสผ่าน"
                name="password"
                type="password"
                required
                min={auth.setupRequired || mode === "reset" ? "12" : undefined}
                hint={
                  auth.setupRequired || mode === "reset"
                    ? "อย่างน้อย 12 ตัวอักษร"
                    : undefined
                }
              />
            )}
            {auth.setupRequired && (
              <Input
                label="ยืนยันรหัสผ่าน"
                name="confirmPassword"
                type="password"
                required
                min="12"
              />
            )}
            {mode === "reset" && (
              <>
                <Input
                  label="รหัสกู้คืนที่ได้รับตอนสร้างบัญชี"
                  name="recoveryCode"
                />
                <Input label="หรือรหัสตั้งรหัสผ่านจากอีเมล" name="token" />
              </>
            )}
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            {message && <p className="success">{message}</p>}
            <Button type="submit" disabled={busy}>
              {busy
                ? "กำลังดำเนินการ…"
                : auth.setupRequired
                  ? "สร้างบัญชี"
                  : mode === "reset"
                    ? "เปลี่ยนรหัสผ่าน"
                    : mode === "forgot"
                      ? "ส่งอีเมลกู้คืน"
                      : "เข้าสู่ระบบ"}
            </Button>
          </form>
          {!auth.setupRequired && (
            <div className="auth-links">
              <button
                onClick={() => {
                  setMode(mode === "login" ? "reset" : "login");
                  setError("");
                }}
              >
                {mode === "login"
                  ? "ลืมรหัสผ่าน / ใช้รหัสกู้คืน"
                  : "กลับเข้าสู่ระบบ"}
              </button>
              {mode === "reset" && auth.smtpConfigured && (
                <button onClick={() => setMode("forgot")}>
                  ขอรหัสทางอีเมล
                </button>
              )}
            </div>
          )}
          {mode === "reset" && !auth.smtpConfigured && (
            <small>
              เครื่องนี้ยังไม่ได้ตั้งค่าอีเมล
              ใช้รหัสกู้คืนที่บันทึกไว้ตอนสร้างบัญชี
            </small>
          )}
        </div>
      </main>
    </div>
  );
}

export default function App() {
  const [auth, setAuth] = useState<Auth>();
  const [data, setData] = useState(emptyData);
  const [page, setPage] = useState<Page>("overview");
  const [selected, setSelected] = useState<string>();
  const [modal, setModal] = useState<Modal>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [category, setCategory] = useState<LoanCategory>("active");
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState<MessageSettings>({ politeEnding: "", promptPayId: "" });
  const today = todayBangkok();
  async function reload() {
    const [ledger, saved] = await Promise.all([api<LedgerData>("/data"), api<MessageSettings>("/settings")]);
    setData(ledger);
    setSettings(saved);
  }
  async function loadAuth(code?: string) {
    const result = await api<Auth>("/auth/status");
    if (result.csrfToken) setCsrf(result.csrfToken);
    if (result.user) await reload();
    setAuth(result);
    if (code) setModal({ kind: "recovery", code });
  }
  useEffect(() => {
    void loadAuth().catch((e) => setError(String(e)));
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!auth?.user) return;
    const timer = window.setInterval(() => {
      void reload().catch(() => {});
      if ("Notification" in window && Notification.permission === "granted") {
        const now = new Date();
        const time = new Intl.DateTimeFormat("en-GB", {
          timeZone: "Asia/Bangkok",
          hour: "numeric",
          minute: "numeric",
          hourCycle: "h23",
        }).format(now);
        const key = `loan-reminder-${todayBangkok()}`;
        if (time >= "13:00" && localStorage.getItem(key) !== "sent")
          void api<{ items: unknown[] }>("/reminders")
            .then((result) => {
              if (result.items.length) {
                new Notification("มีรายการถึงกำหนดชำระ", {
                  body: "เปิดบัญชีเงินกู้เพื่อตรวจรายการ",
                });
                localStorage.setItem(key, "sent");
              }
            })
            .catch(() => {});
      }
    }, 60000);
    return () => clearInterval(timer);
  }, [auth?.user?.email]);
  const snapshots = useMemo(
    () =>
      new Map(
        data.loans.map((loan) => [
          loan.id,
          calculateLedger({
            loan,
            payments: data.payments,
            rateChanges: data.rateChanges,
            adjustments: data.adjustments,
            asOf: today,
          }),
        ]),
      ),
    [data, today],
  );
  const realData = useMemo(() => realLedgerData(data), [data]);
  const realSnapshots = realData.loans.flatMap(loan => {
    const snapshot = snapshots.get(loan.id);
    return snapshot ? [snapshot] : [];
  });
  const activeData = { ...realData, loans: realData.loans.filter(loan => !snapshots.get(loan.id)?.closed) };
  const totals = realSnapshots.reduce(
    (a, s) => ({
      principal: a.principal + s.principalCents,
      principalPaid: a.principalPaid + s.principalPaidCents,
      interestPaid: a.interestPaid + s.interestPaidCents,
    }),
    { principal: 0, principalPaid: 0, interestPaid: 0 },
  );
  const forecasts = useMemo(
    () => new Map(data.loans.map((loan) => [loan.id, calculateInterestForecast({
      loan, payments: data.payments, rateChanges: data.rateChanges,
      adjustments: data.adjustments, asOf: today,
    })])),
    [data, today],
  );
  const borrowerName = (id: string) =>
    data.borrowers.find((b) => b.id === id)?.name || "ผู้กู้";
  const searchText = (l: Loan) => {
    const b = data.borrowers.find((entry) => entry.id === l.borrowerId);
    return `${loanDisplayName(borrowerName(l.borrowerId), l)} ${b?.nickname ?? ""} ${b?.phone ?? ""}`.toLowerCase();
  };
  const loans = data.loans.filter(
    (l) =>
      searchText(l).includes(search.trim().toLowerCase()) &&
      loanCategory(l, snapshots.get(l.id)) === category &&
      (category !== "active" || filter === "all" ||
        (filter === "overdue" && isLoanOverdue(l, today)) ||
        (filter === "owed" && (snapshots.get(l.id)?.interestCents ?? 0) > 0)),
  );
  const chase = useMemo(() => followUps(data, today), [data, today]);
  const selectedLoan = data.loans.find((l) => l.id === selected && l.recordStatus !== "trashed-test");
  const snapshot = selectedLoan ? snapshots.get(selectedLoan.id) : undefined;
  async function mutate(path: string, body: unknown, method = "POST") {
    await api(path, body, method);
    await reload();
    setNotice("บันทึกเรียบร้อยแล้ว");
  }
  async function setLoanStatus(loan: Loan) {
    setBusy(true);
    try {
      await mutate(`/loans/${loan.id}`, { statusOverride: loan.statusOverride === "normal" ? "auto" : "normal",
        reason: loan.statusOverride === "normal" ? "เจ้าของเลือกใช้สถานะตามวันนัด" : "เจ้าของตั้งสถานะปกติ" }, "PATCH");
    } catch (err) { setError(err instanceof Error ? err.message : "เปลี่ยนสถานะไม่สำเร็จ"); }
    finally { setBusy(false); }
  }
  if (!auth)
    return <div className="loading">{error || "กำลังเปิดบัญชีเงินกู้…"}</div>;
  if (!auth.user) return <AuthScreen auth={auth} done={loadAuth} />;
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span>
            <Database />
          </span>
          บัญชีเงินกู้
        </div>
        <nav>
          {nav.map((n) => (
            <button
              key={n.id}
              className={page === n.id && !selected ? "active" : ""}
              onClick={() => {
                setPage(n.id);
                setSelected(undefined);
                setSearch("");
              }}
            >
              <n.icon />
              {n.title}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <p>
            <Laptop />
            ข้อมูลบนเครื่องนี้
          </p>
          <button
            className="logout"
            title={auth.user.email}
            onClick={() =>
              void api("/auth/logout", {})
                .then(() => loadAuth())
                .catch((e) => setError(String(e)))
            }
          >
            <LogOut />
            ออกจากระบบ
          </button>
        </div>
      </aside>
      <main className="workspace">
        <header className="header">
          <div>
            <h1>
              {selectedLoan
                ? loanDisplayName(borrowerName(selectedLoan.borrowerId), selectedLoan)
                : page === "overview"
                  ? "ภาพรวมบัญชี"
                  : nav.find((n) => n.id === page)?.title}
            </h1>
            <p>
              {selectedLoan
                ? `สัญญา ${selectedLoan.id.slice(0, 8)} · เริ่ม ${date(selectedLoan.startDate)}`
                : page === "overview"
                  ? "ติดตามเงินต้น ดอกเบี้ย และการชำระในที่เดียว"
                  : "บัญชีเงินกู้ส่วนตัวของคุณ"}
            </p>
            {selectedLoan && <button className="text-button" onClick={() => setModal({ kind: "loan-purpose", loan: selectedLoan })}>ตั้งชื่อรายการกู้</button>}
          </div>
          <div className="header-actions">
            <Button onClick={() => setModal({ kind: "loan" })}>
              <Plus />
              เพิ่มสัญญา
            </Button>
            <small>ข้อมูล ณ วันที่ {date(today)}</small>
          </div>
        </header>
        {error && (
          <div className="banner error" role="alert">
            {error}
            <button onClick={() => setError("")}>
              <X />
            </button>
          </div>
        )}
        {notice && (
          <div className="banner success" role="status">
            {notice}
            <button onClick={() => setNotice("")}>
              <X />
            </button>
          </div>
        )}
        {selectedLoan && snapshot ? (
          <LoanDetail
            loan={selectedLoan}
            snapshot={snapshot}
            setStatus={setLoanStatus}
            busy={busy}
            forecast={forecasts.get(selectedLoan.id)}
            data={data}
            back={() => setSelected(undefined)}
            open={setModal}
          />
        ) : (
          <>
            {page === "overview" && (
              <>
                <TodayPanel items={chase} open={setModal} select={setSelected} />
                <div className="summary">
                  {[
                    {
                      label: "เงินต้นคงเหลือ",
                      value: totals.principal,
                      icon: Database,
                    },
                    {
                      label: "รับคืนต้นแล้ว",
                      value: totals.principalPaid,
                      icon: History,
                    },
                    {
                      label: "รับดอกเบี้ยแล้ว",
                      value: totals.interestPaid,
                      icon: ChartNoAxesColumnIncreasing,
                    },
                  ].map((item) => (
                    <div className="stat" key={item.label}>
                      <span>
                        <item.icon />
                      </span>
                      <div>
                        <p>{item.label}</p>
                        <strong>฿{money(item.value)}</strong>
                        {data.loans.some((l) => l.source === "existing") &&
                          (item.label === "รับคืนต้นแล้ว" ||
                            item.label === "รับดอกเบี้ยแล้ว") && (
                            <small className="stat-scope">
                              ตั้งแต่เริ่มบันทึก
                            </small>
                          )}
                      </div>
                    </div>
                  ))}
                </div>
                <p className="portfolio-scope">ยอดบัญชีจริงรวมเงินที่รับจากสัญญาปิดแล้ว · ไม่รวมสัญญาทดลองและถังขยะ</p>
                <details className="interest-fold">
                  <summary>ดอกแยกรายคน · ดอกที่เดินอยู่และคาดการณ์สิ้นเดือน</summary>
                  <InterestOverview data={activeData} forecasts={forecasts} select={setSelected} today={today} />
                </details>
                <div className="dashboard-grid">
                  <section className="panel contracts">
                    <div className="panel-heading">
                      <h2>สัญญาเงินกู้</h2>
                      <div className="filters">
                        <label className="search">
                          <Search />
                          <input
                            placeholder="ค้นหาชื่อ ชื่อเล่น หรือเบอร์โทร"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                          />
                        </label>
                        {category === "active" && <select
                          aria-label="กรองสัญญา"
                          value={filter}
                          onChange={(e) => setFilter(e.target.value)}
                        >
                          <option value="all">ทุกสัญญาในหมวด</option>
                          <option value="overdue">เกินกำหนด</option>
                          <option value="owed">มีดอกค้าง</option>
                        </select>}
                      </div>
                    </div>
                    <LoanCategories data={data} snapshots={snapshots} value={category} onChange={setCategory} />
                    <LoanTable
                      loans={loans}
                      snapshots={snapshots}
                      setStatus={setLoanStatus}
                      busy={busy}
                      name={borrowerName}
                      select={setSelected}
                      open={setModal}
                    />
                    {!loans.length && (
                      <Empty
                        title={
                          data.loans.length
                            ? "ยังไม่มีสัญญาในหมวดนี้"
                            : "เริ่มบันทึกสัญญาแรกของคุณ"
                        }
                        text="เพิ่มสัญญาเพื่อเริ่มติดตามเงินต้น ดอกเบี้ย และการชำระได้ทันที"
                      >
                        <Button onClick={() => setModal({ kind: "loan" })}>
                          <Plus />
                          เพิ่มสัญญา
                        </Button>
                      </Empty>
                    )}
                  </section>
                  <div className="right-column">
                    <section className="panel reminders">
                      <h2>นัดชำระถัดไป</h2>
                      {chase.some((item) => !needsAction(item)) ? (
                        <div className="due-list">
                          {chase.filter((item) => !needsAction(item)).slice(0, 5).map((item) => (
                            <button key={item.loan.id} onClick={() => setSelected(item.loan.id)}>
                              <span className="avatar">{borrowerName(item.loan.borrowerId).slice(0, 1)}</span>
                              <div>
                                <strong>{loanDisplayName(borrowerName(item.loan.borrowerId), item.loan)}</strong>
                                <small>{date(item.loan.dueDate)} · ดอก ฿{money(item.interestDueCents)}</small>
                              </div>
                              <span className="badge">รอชำระ</span>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <Empty
                          calendar
                          title="ยังไม่มีนัดถัดไป"
                          text="สัญญาที่ยังไม่ถึงกำหนดจะแสดงที่นี่"
                        />
                      )}
                    </section>
                    <div className="contact-tip">
                      <h3>
                        <span>
                          <MessageSquare />
                        </span>
                        ส่งข้อความด้วยบัญชีส่วนตัว
                      </h3>
                      <p>เตรียมข้อความ แล้วคัดลอกไปส่งใน LINE หรือ Facebook</p>
                    </div>
                  </div>
                </div>
                <div className="footnote">
                  <Info />
                  ยอดคำนวณตามเงื่อนไขของแต่ละสัญญา
                  {data.loans.some((l) => l.source === "existing") && (
                    <span>
                      {" "}
                      · ยอดรับคืนก่อนเริ่มบันทึกที่ไม่มีประวัติ ยังไม่ทราบ
                    </span>
                  )}
                </div>
              </>
            )}
            {page === "borrowers" && (
              <section className="panel">
                <div className="panel-heading">
                  <h2>
                    ผู้กู้ทั้งหมด <small>{data.borrowers.length} คน</small>
                  </h2>
                  <Button onClick={() => setModal({ kind: "borrower" })}>
                    <Plus />
                    เพิ่มผู้กู้
                  </Button>
                </div>
                {!data.borrowers.length ? (
                  <Empty
                    title="เพิ่มผู้กู้คนแรกของคุณ"
                    text="เริ่มจากชื่อ แล้วเพิ่มข้อมูลติดต่อภายหลังได้"
                  >
                    <Button onClick={() => setModal({ kind: "borrower" })}>
                      <Plus />
                      เพิ่มผู้กู้
                    </Button>
                  </Empty>
                ) : (
                  <div className="borrower-list">
                    <LoanCategories data={data} snapshots={snapshots} value={category} onChange={setCategory} />
                    {data.borrowers.filter(b => !data.loans.some(l => l.borrowerId === b.id) || data.loans.some(l => l.borrowerId === b.id && loanCategory(l, snapshots.get(l.id)) === category)).map((b) => (
                      <article key={b.id}>
                        <div className="borrower-heading">
                          <span className="avatar">{b.name.slice(0, 1)}</span>
                          <div>
                            <h3>{b.name}</h3>
                            <p>
                              {b.nickname || b.phone || "ยังไม่มีข้อมูลติดต่อ"}
                            </p>
                          </div>
                          <Button
                            secondary
                            onClick={() =>
                              setModal({ kind: "borrower", borrower: b })
                            }
                          >
                            แก้ไข
                          </Button>
                          <Button
                            onClick={() =>
                              setModal({ kind: "loan", borrowerId: b.id })
                            }
                          >
                            <Plus />
                            เพิ่มสัญญา
                          </Button>
                        </div>
                        <LoanTable
                          loans={data.loans.filter(
                            (l) => l.borrowerId === b.id && loanCategory(l, snapshots.get(l.id)) === category,
                          )}
                          snapshots={snapshots}
                          open={setModal}
                          setStatus={setLoanStatus}
                          busy={busy}
                          name={borrowerName}
                          select={setSelected}
                        />
                      </article>
                    ))}
                  </div>
                )}
              </section>
            )}
            {page === "history" && (
              <section className="panel">
                <div className="panel-heading">
                  <h2>ประวัติรับชำระ</h2>
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>ผู้กู้ / วันที่</th>
                        <th>รับเงินจริง</th>
                        <th>คืนต้น</th>
                        <th>ชำระดอก</th>
                        <th>สถานะ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {realData.payments
                        .toSorted((a, b) => b.date.localeCompare(a.date))
                        .map((p) => {
                          const loan = data.loans.find(
                            (l) => l.id === p.loanId,
                          );
                          return (
                            <tr
                              key={p.id}
                              onClick={() => setSelected(p.loanId)}
                            >
                              <td>
                                {loan ? loanDisplayName(borrowerName(loan.borrowerId), loan) : ""}
                                <small>{date(p.date)}{p.dateEstimated && " · วันที่บันทึก ไม่ทราบวันจ่ายจริง"}</small>
                              </td>
                              <td>฿{money(p.totalCents)}</td>
                              <td>฿{money(p.principalCents)}</td>
                              <td>฿{money(p.interestCents)}</td>
                              <td>
                                <span
                                  className={`badge ${p.canceledAt ? "late" : ""}`}
                                >
                                  {p.canceledAt
                                    ? "ยกเลิก"
                                    : p.isPayoff
                                      ? "ปิดหนี้"
                                      : "บันทึกแล้ว"}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
                {!realData.payments.length && (
                  <Empty
                    title="ยังไม่มีประวัติรับชำระ"
                    text="เปิดสัญญาเพื่อบันทึกเงินที่ได้รับ"
                  />
                )}
              </section>
            )}
            {page === "reminders" && (
              <section className="panel">
                <div className="panel-heading">
                  <h2>ติดตามการชำระ</h2>
                  <Button
                    secondary
                    onClick={() => {
                      if ("Notification" in window)
                        void Notification.requestPermission().then((p) =>
                          setNotice(
                            p === "granted"
                              ? "เปิดแจ้งเตือนแล้ว เวลา 13:00 น. ขณะเปิดแอปและคอมทำงาน"
                              : "ยังไม่ได้อนุญาตการแจ้งเตือน",
                          ),
                        );
                    }}
                  >
                    <Bell />
                    เปิดแจ้งเตือนบนคอม
                  </Button>
                </div>
                <p className="panel-note">
                  เตือนก่อนครบกำหนด 1 วันและวันครบกำหนด เวลา 13:00 น.
                  ขณะเปิดแอปไว้ (บนคอมหรือมือถือ)
                </p>
                {!chase.length ? (
                  <Empty calendar title="ยังไม่มีรายการต้องติดตาม" />
                ) : (
                  <div className="follow-list">
                    {chase.map((item) => (
                      <div key={item.loan.id}>
                        <div>
                          <h3>{loanDisplayName(borrowerName(item.loan.borrowerId), item.loan)}</h3>
                          <p>
                            <span className={`badge ${item.status === "overdue" || item.interestOwedCents ? "late" : ""}`}>{followUpLabel(item)}</span>
                            {" "}นัดชำระ {date(item.loan.dueDate)}
                            {item.interestOwedCents > 0
                              ? ` · ดอกค้าง ฿${money(item.interestOwedCents)}`
                              : ` · ดอกงวดนี้ ฿${money(item.interestDueCents)}`}
                          </p>
                        </div>
                        <Button secondary onClick={() => setModal({ kind: "payment", loan: item.loan, suggestInterestCents: item.interestOwedCents })}>
                          <Plus />
                          รับเงิน
                        </Button>
                        <Button
                          onClick={() => setModal({ kind: "contact", loan: item.loan })}
                        >
                          <MessageSquare />
                          ส่งข้อความ
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}
            {page === "summary" && <MonthlySummaryPage data={data} today={today} />}
            {page === "settings" && (
              <SettingsPage
                settings={settings}
                saved={(next) => { setSettings(next); setNotice("บันทึกการตั้งค่าแล้ว"); }}
                restored={async (message) => { await reload(); setNotice(message); }}
              />
            )}
          </>
        )}
      </main>
      {modal && (
        <ModalView
          key={modal.kind + ("loan" in modal ? modal.loan.id : "")}
          modal={modal}
          settings={settings}
          data={data}
          snapshots={snapshots}
          busy={busy}
          close={() => setModal(undefined)}
          submit={async (path, body, method, file, ids) => {
            setBusy(true);
            try {
              await mutate(path, body, method);
              if (file && ids) {
                await upload(file, ids);
                await reload();
              }
              setModal(undefined);
              if (modal.kind === "loan") {
                setSelected(undefined);
                setPage("overview");
                setCategory(body && typeof body === "object" && "isTest" in body && body.isTest === true ? "test" : "active");
              }
              if (modal.kind === "loan-record") {
                setSelected(undefined);
                setPage("overview");
                setCategory(modal.action === "mark-real" ? (snapshots.get(modal.loan.id)?.closed ? "closed" : "active") : "test");
              }
            } catch (e) {
              throw e;
            } finally {
              setBusy(false);
            }
          }}
          uploadOnly={async (file, ids) => {
            setBusy(true);
            try {
              await upload(file, ids);
              await reload();
              setModal(undefined);
              setNotice("แนบหลักฐานแล้ว");
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
    </div>
  );
}

const loanCategories: Array<{ id: LoanCategory; label: string }> = [
  { id: "active", label: "กำลังชำระ" },
  { id: "closed", label: "ปิดแล้ว" },
  { id: "test", label: "ทดลอง" },
  { id: "trashed-test", label: "ถังขยะทดลอง" },
];
function LoanCategories({ data, snapshots, value, onChange }: {
  data: LedgerData;
  snapshots: Map<string, LedgerSnapshot>;
  value: LoanCategory;
  onChange: (category: LoanCategory) => void;
}) {
  return <div className="loan-categories" role="group" aria-label="หมวดสัญญา">
    {loanCategories.map(item => <button key={item.id} type="button" aria-pressed={value === item.id}
      className={value === item.id ? "selected" : ""} onClick={() => onChange(item.id)}>
      {item.label} ({data.loans.filter(loan => loanCategory(loan, snapshots.get(loan.id)) === item.id).length})
    </button>)}
    {(value === "test" || value === "trashed-test") && <p>ข้อมูลในหมวดนี้ไม่นับรวมในยอดเงินจริง ดอกคาดการณ์ และรายการเตือน</p>}
  </div>;
}
function LoanTable({
  loans,
  snapshots,
  name,
  select,
  setStatus,
  busy,
  open,
}: {
  loans: Loan[];
  snapshots: Map<string, LedgerSnapshot>;
  name: (id: string) => string;
  select: (id: string) => void;
  setStatus: (loan: Loan) => void;
  busy: boolean;
  open: (modal: Modal) => void;
}) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>ผู้กู้</th>
            <th>เงินต้นคงเหลือ</th>
            <th>ดอกค้าง</th>
            <th>ครบกำหนด</th>
            <th>สถานะ</th>
          </tr>
        </thead>
        <tbody>
          {loans.map((l) => {
            const s = snapshots.get(l.id);
            const due = dueStatus(l, todayBangkok());
            return (
              <tr key={l.id} onClick={() => { if (l.recordStatus !== "trashed-test") select(l.id); }}>
                <td>
                  <button className="table-name" disabled={l.recordStatus === "trashed-test"} onClick={() => select(l.id)}>
                    {loanDisplayName(name(l.borrowerId), l)}
                  </button>
                  <small>
                    {s?.currentRateBps === 0
                      ? "ไม่มีดอกเบี้ย"
                      : `${(s?.currentRateBps || 0) / 100}% ต่อเดือน`}
                  </small>
                </td>
                <td>฿{money(s?.principalCents || 0)}</td>
                <td className={s?.interestCents ? "owed" : ""}>{s?.interestCents ? `฿${money(s.interestCents)}` : "–"}</td>
                <td>{date(l.dueDate)}</td>
                <td>
                  <span
                    className={`badge ${!s?.closed && due === "overdue" ? "late" : !s?.closed && due !== "upcoming" ? "soon" : ""}`}
                  >
                    {l.recordStatus === "trashed-test" ? "ลบแล้ว · ทดลอง" : l.recordStatus === "test" ? "ทดลอง · ไม่รวมยอด" : s?.closed
                      ? "ปิดแล้ว"
                      : { overdue: "เกินกำหนด", today: "ครบวันนี้", tomorrow: "ครบพรุ่งนี้", upcoming: "ปกติ" }[due]}
                  </span>
                  {l.recordStatus && <button className="text-button status-toggle" disabled={busy}
                    onClick={event => { event.stopPropagation(); open({ kind: "loan-record", loan: l, action: l.recordStatus === "trashed-test" ? "restore-test" : "trash-test" }); }}>
                    {l.recordStatus === "trashed-test" ? "กู้คืนสัญญาทดลอง" : "ลบสัญญาทดลอง"}
                  </button>}
                  {isRealLoan(l) && !s?.closed && (isLoanOverdue(l, todayBangkok()) || l.statusOverride === "normal") && <button
                    className="text-button status-toggle" disabled={busy}
                    aria-label={`${l.statusOverride === "normal" ? "ใช้สถานะตามวันนัด" : "ตั้งสถานะปกติ"} ${loanDisplayName(name(l.borrowerId), l)} ต้นเริ่ม ${money(l.principalCents)}`}
                    onClick={(event) => { event.stopPropagation(); setStatus(l); }}>
                    {l.statusOverride === "normal" ? "ใช้สถานะตามวันนัด" : "ตั้งสถานะปกติ"}
                  </button>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
function LoanDetail({
  loan,
  snapshot: s,
  forecast,
  data,
  back,
  open,
  setStatus,
  busy,
}: {
  loan: Loan;
  snapshot: LedgerSnapshot;
  forecast: InterestForecast | undefined;
  data: LedgerData;
  back: () => void;
  open: (modal: Modal) => void;
  setStatus: (loan: Loan) => void;
  busy: boolean;
}) {
  const borrower = data.borrowers.find((b) => b.id === loan.borrowerId);
  const loanAttachments = data.attachments.filter(
    (a) =>
      !a.paymentId &&
      (a.loanId === loan.id || (!a.loanId && a.borrowerId === loan.borrowerId)),
  );
  return (
    <>
      <button className="back-link" onClick={back}>
        <ArrowLeft />
        กลับรายการสัญญา
      </button>
      <div className="detail-grid">
        <section className="panel detail-main">
          <div className="panel-heading">
            <h2>รายละเอียดสัญญา</h2>
            <span className={`badge ${!s.closed && isLoanOverdue(loan, todayBangkok()) ? "late" : ""}`}>
              {s.closed ? "ปิดหนี้แล้ว" : { overdue: "เกินกำหนด", today: "ครบกำหนดวันนี้", tomorrow: "ครบกำหนดพรุ่งนี้", upcoming: "ปกติ" }[dueStatus(loan, todayBangkok())]}
            </span>
          </div>
          {!s.closed && s.interestCents > 0 && (
            <div className="owed-callout" role="status">
              <div>
                <p>ดอกค้างชำระ</p>
                <strong>฿{money(s.interestCents)}</strong>
                <small>ดอกของรอบที่ครบแล้วแต่ยังไม่ได้รับ{s.accruedInterestCents > 0 && ` · รอบนี้เดินอยู่อีก ฿${money(s.accruedInterestCents)}`}</small>
              </div>
              <Button onClick={() => open({ kind: "payment", loan, suggestInterestCents: s.interestCents })}>
                <Plus />รับดอก ฿{money(s.interestCents)}
              </Button>
            </div>
          )}
          <div className="detail-totals">
            <div>
              <p>เงินต้นคงเหลือ</p>
              <strong>฿{money(s.principalCents)}</strong>
            </div>
            <div>
              <p>รับคืนต้นแล้ว</p>
              <strong>฿{money(s.principalPaidCents)}</strong>
              {loan.source === "existing" && <small>ตั้งแต่เริ่มบันทึก</small>}
            </div>
            <div>
              <p>รับดอกเบี้ยแล้ว</p>
              <strong>฿{money(s.interestPaidCents)}</strong>
              {loan.source === "existing" && <small>ตั้งแต่เริ่มบันทึก</small>}
            </div>
          </div>
          {forecast && <InterestDetail forecast={forecast} loan={loan} />}
          <dl>
            <div>
              <dt>ประเภท</dt>
              <dd>{loan.source === "existing" ? "หนี้เดิมยกมา" : "กู้ใหม่"}</dd>
            </div>
            <div>
              <dt>อัตราปัจจุบัน</dt>
              <dd>{s.currentRateBps / 100}% ต่อเดือน</dd>
            </div>
            <div>
              <dt>รอบคิดดอก</dt>
              <dd>
                {date(s.currentCycleStartDate)} ถึง{" "}
                {date(s.currentCycleEndDate)}
              </dd>
            </div>
            <div>
              <dt>วันนัดชำระ</dt>
              <dd>{date(loan.dueDate)}</dd>
            </div>
            <div>
              <dt>
                {loan.source === "existing"
                  ? "รับคืนต้นตั้งแต่เริ่มบันทึก"
                  : "รับคืนต้นแล้ว"}
              </dt>
              <dd>฿{money(s.principalPaidCents)}</dd>
            </div>
            <div>
              <dt>
                {loan.source === "existing"
                  ? "รับดอกตั้งแต่เริ่มบันทึก"
                  : "รับดอกแล้ว"}
              </dt>
              <dd>฿{money(s.interestPaidCents)}</dd>
            </div>
            {s.manualInterestDifferenceCents > 0 && <div>
              <dt>ดอกรับตามตกลงส่วนที่เกินยอดสูตร</dt>
              <dd>฿{money(s.manualInterestDifferenceCents)} · ไม่เป็นเครดิตงวดถัดไป</dd>
            </div>}
            {s.uncollectedInterestCents > 0 && <div>
              <dt>ดอกตามสูตรที่ไม่ได้เรียกเก็บตอนปิด</dt>
              <dd>฿{money(s.uncollectedInterestCents)} · ไม่นับเป็นเงินรับจริง</dd>
            </div>}
            {loan.source === "existing" && (
              <>
                <div>
                  <dt>ยอดรับคืนต้นก่อนเริ่มบันทึก</dt>
                  <dd>ยังไม่ทราบ</dd>
                </div>
                <div>
                  <dt>ยอดรับดอกก่อนเริ่มบันทึก</dt>
                  <dd>ยังไม่ทราบ</dd>
                </div>
              </>
            )}
          </dl>
          {loan.source === "existing" && (
            <p className="panel-note">
              ยอดรับคืนก่อนวันยกมาที่ไม่มีประวัติ ยังไม่ทราบ
            </p>
          )}
          {loan.notes && <p className="panel-note">{loan.notes}</p>}
          {loan.recordStatus === "test" && <p className="panel-note">สัญญาทดลอง · ยอดของสัญญานี้และประวัติรับชำระไม่นับรวมในบัญชีจริง</p>}
          <div className="actions-wrap">
            <Button secondary onClick={() => open({ kind: "loan-record", loan, action: isRealLoan(loan) ? "mark-test" : "mark-real" })}>
              {isRealLoan(loan) ? "ย้ายเป็นสัญญาทดลอง" : "เปลี่ยนเป็นสัญญาจริง"}
            </Button>
            {loan.recordStatus === "test" && <Button secondary onClick={() => open({ kind: "loan-record", loan, action: "trash-test" })}>ลบสัญญาทดลอง</Button>}
            {!s.closed && (
              <>
                <Button onClick={() => open({ kind: "payment", loan })}>
                  <Plus />
                  รับชำระ
                </Button>
                <Button
                  secondary
                  onClick={() => open({ kind: "payoff", loan })}
                >
                  ปิดหนี้
                </Button>
                <Button secondary onClick={() => open({ kind: "loan-correction", loan })}>
                  แก้ต้น / ดอก / วันนัด
                </Button>
                <Button secondary disabled={busy} onClick={() => setStatus(loan)}>
                  {loan.statusOverride === "normal" ? "ใช้สถานะตามวันนัด" : "ตั้งสถานะปกติ"}
                </Button>
                <Button secondary onClick={() => open({ kind: "rate", loan })}>
                  เปลี่ยนอัตรางวดถัดไป
                </Button>
              </>
            )}
            <Button
              secondary
              onClick={() => open({ kind: "adjustment", loan })}
            >
              เพิ่ม/ลดยอด (ขั้นสูง)
            </Button>
            <Button
              secondary
              onClick={() => open({ kind: "attachment", loan })}
            >
              <Paperclip />
              แนบหลักฐาน
            </Button>
          </div>
        </section>
        <aside className="panel detail-contact">
          <h2>ข้อมูลผู้กู้</h2>
          <h3>{borrower?.name}</h3>
          <p>{borrower?.nickname}</p>
          <dl>
            <div>
              <dt>โทรศัพท์</dt>
              <dd>{borrower?.phone || "ยังไม่ระบุ"}</dd>
            </div>
            <div>
              <dt>LINE</dt>
              <dd>{borrower?.lineId || "ยังไม่ระบุ"}</dd>
            </div>
          </dl>
          {borrower?.facebookUrl && (
            <a href={borrower.facebookUrl} target="_blank" rel="noreferrer">
              เปิด Facebook
            </a>
          )}
          <p>{borrower?.notes}</p>
          <Button onClick={() => open({ kind: "contact", loan })}>
            <MessageSquare />
            เตรียมข้อความ
          </Button>
        </aside>
      </div>
      <section className="panel history-panel">
        <h2>ประวัติสัญญา</h2>
        <div className="timeline">
          <div>
            <span className="timeline-dot" />
            <strong>เริ่มบันทึก {date(loan.startDate)}</strong>
            <p>
              ต้น ฿{money(loan.principalCents)} · ดอกยกมา ฿
              {money(loan.openingInterestCents)} · {loan.rateBps / 100}%
              ต่อเดือน
            </p>
          </div>
          {data.payments
            .filter((p) => p.loanId === loan.id)
            .map((p) => (
              <div key={p.id} className={p.canceledAt ? "canceled" : ""}>
                <span className="timeline-dot" />
                <strong>
                  {date(p.date)} · {p.isPayoff ? "ปิดหนี้" : "รับชำระ"} ฿
                  {money(p.totalCents)}
                </strong>
                {p.dateEstimated && <p>จำวันที่จ่ายจริงไม่ได้ ใช้วันที่บันทึก {date(p.date)}</p>}
                {p.interestMode === "owner" && <small>ยอดดอกตามที่เจ้าของระบุ</small>}
                {p.replacesPaymentId && <small> · แก้ไขจากรายการ {p.replacesPaymentId.slice(0, 8)}</small>}
                <p>
                  คืนต้น ฿{money(p.principalCents)} · ชำระดอก ฿
                  {money(p.interestCents)} {p.note}
                </p>
                {p.canceledAt ? (
                  <small>ยกเลิก: {p.cancelReason}</small>
                ) : (
                  <>
                  <button className="text-button" onClick={() => open({ kind: "edit-payment", loan, payment: p })}>แก้ไข</button>
                  <button
                    className="text-button danger"
                    onClick={() =>
                      open({ kind: "cancel", path: `/payments/${p.id}/cancel` })
                    }
                  >
                    ยกเลิกรายการ
                  </button>
                  </>
                )}
                <button
                  className="text-button"
                  onClick={() =>
                    open({ kind: "payment-attachment", loan, paymentId: p.id })
                  }
                >
                  <Paperclip />
                  แนบสลิปการชำระ
                </button>
                <div className="attachments">
                  {data.attachments
                    .filter((a) => a.paymentId === p.id && a.loanId === loan.id)
                    .map((a) => (
                      <a
                        key={a.id}
                        href={`/api/attachments/${a.id}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <Paperclip />
                        {a.name}
                      </a>
                    ))}
                </div>
              </div>
            ))}
          {data.rateChanges
            .filter((r) => r.loanId === loan.id)
            .map((r) => (
              <div key={r.id} className={r.canceledAt ? "canceled" : ""}>
                <span className="timeline-dot" />
                <strong>
                  อัตรา {r.rateBps / 100}% มีผล {date(r.effectiveDate)}
                </strong>
                <p>{r.reason}</p>
                {r.canceledAt && <small>ยกเลิก: {r.cancelReason}</small>}
              </div>
            ))}
          {data.adjustments
            .filter((a) => a.loanId === loan.id)
            .map((a) => (
              <div key={a.id} className={a.canceledAt ? "canceled" : ""}>
                <span className="timeline-dot" />
                <strong>ปรับยอด {date(a.date)}</strong>
                <p>
                  ต้น {money(a.principalDeltaCents)} · ดอก{" "}
                  {money(a.interestDeltaCents)} · {a.reason}
                </p>
                {a.canceledAt ? (
                  <small>ยกเลิก: {a.cancelReason}</small>
                ) : (
                  <button
                    className="text-button danger"
                    onClick={() =>
                      open({
                        kind: "cancel",
                        path: `/adjustments/${a.id}/cancel`,
                      })
                    }
                  >
                    ยกเลิกรายการ
                  </button>
                )}
              </div>
            ))}
          {data.contacts
            .filter((c) => c.loanId === loan.id)
            .map((c) => (
              <div key={c.id}>
                <span className="timeline-dot" />
                <strong>
                  ยืนยันส่ง {c.channel} · {dateTime(c.date)}
                </strong>
                <p>{c.message}</p>
                <small>สถานะยืนยันโดยคุณ</small>
              </div>
            ))}
          {data.audit
            .filter((a) => a.entityId === loan.id)
            .map((a) => (
              <div key={a.id}>
                <span className="timeline-dot" />
                <strong>
                  {a.action} · {dateTime(a.at)}
                </strong>
                <p>{a.detail}</p>
              </div>
            ))}
        </div>
        {loanAttachments.length > 0 && (
          <>
            <h3>หลักฐานแนบ</h3>
            <div className="attachments">
              {loanAttachments.map((a) => (
                <a
                  key={a.id}
                  href={`/api/attachments/${a.id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Paperclip />
                  {a.name}
                </a>
              ))}
            </div>
          </>
        )}
      </section>
    </>
  );
}
