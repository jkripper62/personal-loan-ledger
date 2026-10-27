import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { DatabaseSync } from "node:sqlite";
import {
  mkdirSync,
  readFileSync,
  existsSync,
  statSync,
  writeFileSync,
  renameSync,
  readdirSync,
  rmSync,
} from "node:fs";
import {
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { join, resolve, extname, sep } from "node:path";
import type {
  LedgerData,
  Borrower,
  Loan,
  Payment,
  Adjustment,
  RateChange,
  Attachment,
} from "../src/domain/types.js";
import {
  calculateLedger,
  validatePayment,
  addMonths,
  daysBetween,
} from "../src/domain/ledger.js";
import { compareEvents } from "../src/domain/chronology.js";
import { isLoanOverdue } from "../src/domain/status.js";
import { loanDisplayName } from "../src/domain/loan-name.js";
import { changeLoanRecordStatus, realLedgerData } from "../src/domain/loan-records.js";
import { createLedgerCsv } from "./export.js";

const hashPassword = (
  password: string,
  salt: string,
  length: number,
): Promise<Buffer> =>
  new Promise((resolve, reject) =>
    scrypt(password, salt, length, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );
const emptyData = (): LedgerData => ({
  borrowers: [],
  loans: [],
  payments: [],
  rateChanges: [],
  adjustments: [],
  contacts: [],
  attachments: [],
  audit: [],
});
interface Owner {
  email: string;
  salt: string;
  passwordHash: string;
  recoveryHash: string;
}
interface Settings {
  politeEnding: string;
  promptPayId: string;
}
interface Session {
  csrf: string;
  expires: number;
}
interface ResetToken {
  hash: string;
  expires: number;
}
class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const fail = (status: number, message: string): never => {
  throw new HttpError(status, message);
};
// Ledger rules throw plain Error with an owner-facing message; anything else
// (TypeError, SyntaxError from stored data, SQLite errors) is a defect.
const isUnexpected = (error: unknown) =>
  !(error instanceof HttpError) &&
  (!(error instanceof Error) || error.constructor !== Error || "code" in error);
const parseInput = <T>(parse: () => T, message: string): T => {
  try {
    return parse();
  } catch {
    return fail(400, message);
  }
};
const defaultLogError = (error: unknown, context: string) =>
  process.stderr.write(
    `[${new Date().toISOString()}] ${context}\n${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return fail(400, "ข้อมูลไม่ถูกต้อง");
  return Object.fromEntries(Object.entries(value));
}
function text(
  value: unknown,
  label: string,
  required = false,
  max = 10000,
): string {
  if (value === undefined && !required) return "";
  if (
    typeof value !== "string" ||
    value.length > max ||
    (required && !value.trim())
  )
    return fail(400, `${label}ไม่ถูกต้อง`);
  return value.trim();
}
function facebookUrl(value: unknown): string {
  const result = text(value, "ลิงก์ Facebook", false, 2000);
  if (!result) return "";
  try {
    const url = new URL(result);
    if (url.protocol !== "https:" || url.username || url.password)
      return fail(400, "ลิงก์ Facebook ต้องใช้ https");
  } catch {
    return fail(400, "ลิงก์ Facebook ต้องใช้ https");
  }
  return result;
}
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
function integer(value: unknown, label: string, signed = false): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    (!signed && value < 0)
  )
    return fail(400, `${label}ต้องเป็นจำนวนเต็มที่ถูกต้อง`);
  return value;
}
function date(value: unknown, label: string): string {
  const result = text(value, label, true, 10);
  daysBetween(result, result);
  return result;
}
function required<T>(value: T | undefined, label: string): T {
  return value ?? fail(404, `ไม่พบ${label}`);
}
async function readBody(
  request: IncomingMessage,
  limit = 1024 * 1024,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0,
      rejected = false;
    request.on("data", (chunk: Buffer) => {
      if (rejected) return;
      size += chunk.length;
      if (size > limit) {
        rejected = true;
        chunks.length = 0;
        reject(new HttpError(413, "ไฟล์หรือข้อมูลมีขนาดเกินกำหนด"));
      } else chunks.push(chunk);
    });
    request.on("end", () => {
      if (!rejected) resolve(Buffer.concat(chunks));
    });
    request.on("error", reject);
    request.on("aborted", () => reject(new HttpError(400, "ส่งข้อมูลไม่ครบ")));
  });
}
function json(response: ServerResponse, status: number, data: unknown) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(data));
}

export function createApp({
  dataDir,
  staticDir,
  clock = () => new Date(),
  logError = defaultLogError,
  backupDir = join(dataDir, "backups"),
  keepBackups = 30,
  allowedHosts = [],
}: {
  dataDir: string;
  staticDir?: string;
  clock?: () => Date;
  logError?: (error: unknown, context: string) => void;
  backupDir?: string;
  keepBackups?: number;
  allowedHosts?: string[];
}) {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(join(dataDir, "loans.sqlite"));
  db.exec(
    "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, json TEXT NOT NULL) STRICT; CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY, bytes BLOB NOT NULL) STRICT;",
  );
  const load = (key: string): string | null => {
    const row = db.prepare("SELECT json FROM state WHERE key=?").get(key);
    return row && typeof row.json === "string" ? row.json : null;
  };
  const save = (key: string, value: unknown) =>
    db
      .prepare(
        "INSERT INTO state (key,json) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET json=excluded.json",
      )
      .run(key, JSON.stringify(value));
  if (!load("ledger")) save("ledger", emptyData());
  const getData = (): LedgerData => JSON.parse(load("ledger") ?? "{}");
  const getOwner = (): Owner | null => {
    const raw = load("owner");
    return raw ? JSON.parse(raw) : null;
  };
  const buildBackup = () => {
    const data = getData();
    const attachmentFiles = data.attachments.map((attachment) => {
      const row = db.prepare("SELECT bytes FROM files WHERE id=?").get(attachment.id);
      if (!row || !(row.bytes instanceof Uint8Array))
        return fail(500, "หลักฐานไม่ครบ ไม่สามารถสำรองได้");
      return { id: attachment.id, base64: Buffer.from(row.bytes).toString("base64") };
    });
    return { version: 1, app: "personal-loan-ledger", exportedAt: now(), data, attachmentFiles, settings: getSettings() };
  };
  const getSettings = (): Settings => ({ politeEnding: "", promptPayId: "", ...JSON.parse(load("settings") ?? "{}") });
  // Today's file is rewritten after every change; older days are kept up to the limit.
  const writeDailyBackup = () => {
    try {
      mkdirSync(backupDir, { recursive: true });
      const target = join(backupDir, `backup-${today()}.json`);
      writeFileSync(target + ".tmp", JSON.stringify(buildBackup()));
      renameSync(target + ".tmp", target);
      const daily = readdirSync(backupDir).filter((name) => /^backup-\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort();
      for (const name of daily.slice(0, Math.max(0, daily.length - keepBackups)))
        rmSync(join(backupDir, name));
    } catch (error) {
      logError(error, "automatic backup");
    }
  };
  const mutate = <T>(fn: (data: LedgerData) => T): T => {
    db.exec("BEGIN IMMEDIATE");
    let result: T;
    try {
      const data = getData();
      result = fn(data);
      save("ledger", data);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    writeDailyBackup();
    return result;
  };
  // Sessions survive restarts; only a hash of each cookie token is stored.
  const sessions = {
    all: (): Record<string, Session> => JSON.parse(load("sessions") ?? "{}"),
    get(token: string): Session | undefined {
      return token ? this.all()[digest(token)] : undefined;
    },
    set(token: string, session: Session) {
      const time = clock().getTime();
      const live = Object.fromEntries(Object.entries(this.all()).filter(([, s]) => s.expires > time));
      save("sessions", { ...live, [digest(token)]: session });
    },
    delete(token: string) {
      const { [digest(token)]: _removed, ...rest } = this.all();
      save("sessions", rest);
    },
    clear: () => save("sessions", {}),
  };
  const sessionDays = 30;
  const attempts = new Map<string, { count: number; until: number }>();
  let resetToken: ResetToken | null = null;
  const smtpConfigured = Boolean(
    process.env.SMTP_HOST &&
      process.env.SMTP_FROM &&
      Boolean(process.env.SMTP_USER) === Boolean(process.env.SMTP_PASS),
  );
  let lastTimestamp = Math.max(
    0,
    ...getData().payments.map((p) => Date.parse(p.createdAt)),
    ...getData().adjustments.map((a) => Date.parse(a.createdAt)),
  );
  const now = () => {
    lastTimestamp = Math.max(clock().getTime(), lastTimestamp + 1);
    return new Date(lastTimestamp).toISOString();
  };
  const today = () =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Bangkok",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(clock());
  function readPayment(body: Record<string, unknown>, fixedLoanId?: string): Payment {
    if (typeof body.isPayoff !== "boolean")
      return fail(400, "ต้องระบุว่าปิดหนี้หรือรับชำระทั่วไป");
    if (body.payoffMode !== undefined && (body.isPayoff !== true || (body.payoffMode !== "owner" && body.payoffMode !== "formula")))
      return fail(400, "วิธีบันทึกปิดหนี้ไม่ถูกต้อง");
    if (body.dateEstimated !== undefined && typeof body.dateEstimated !== "boolean")
      return fail(400, "ต้องระบุสถานะวันที่รับชำระให้ถูกต้อง");
    if (fixedLoanId && body.loanId !== undefined && text(body.loanId, "รายการกู้", true) !== fixedLoanId)
      return fail(400, "การแก้ไขต้องเป็นรายการกู้เดิม");
    const payment: Payment = {
      id: randomUUID(), loanId: fixedLoanId ?? text(body.loanId, "รายการกู้", true),
      date: body.dateEstimated === true && body.date === undefined ? today() : date(body.date, "วันรับชำระ"),
      dateEstimated: body.dateEstimated === true,
      totalCents: integer(body.totalCents, "ยอดรับจริง"),
      principalCents: integer(body.principalCents, "คืนต้น"),
      interestCents: integer(body.interestCents, "ดอก"), note: text(body.note, "หมายเหตุ"),
      isPayoff: body.isPayoff,
      interestMode: body.isPayoff && body.payoffMode !== "owner" ? undefined : "owner",
      createdAt: now(), canceledAt: null, cancelReason: null,
    };
    if (payment.date > today()) return fail(400, "ไม่สามารถรับชำระล่วงหน้าได้");
    return payment;
  }
  const getLoan = (data: LedgerData, id: unknown) =>
    required(
      data.loans.find((l) => l.id === text(id, "รายการกู้", true) && l.recordStatus !== "trashed-test"),
      "รายการกู้",
    );
  const ledger = (data: LedgerData, loan: Loan, asOf = today()) =>
    calculateLedger({
      loan,
      payments: data.payments,
      adjustments: data.adjustments,
      rateChanges: data.rateChanges,
      asOf,
    });
  const audit = (
    data: LedgerData,
    action: string,
    entityId: string,
    detail: string,
  ) =>
    data.audit.push({ id: randomUUID(), at: now(), action, entityId, detail });
  function replay(data: LedgerData, loan: Loan) {
    for (const adjustment of data.adjustments.filter(
      (a) => a.loanId === loan.id && !a.canceledAt,
    )) {
      const prior = (event: Payment | Adjustment) =>
        compareEvents(event, adjustment) < 0;
      const balance = ledger(
        {
          ...data,
          payments: data.payments.filter(prior),
          adjustments: data.adjustments.filter(prior),
        },
        loan,
        adjustment.date,
      );
      if (
        balance.principalCents + adjustment.principalDeltaCents < 0 ||
        balance.payoffInterestCents + adjustment.interestDeltaCents < 0
      )
        return fail(400, "การแก้รายการทำให้รายการปรับปรุงภายหลังมียอดติดลบ");
    }
    const payments = data.payments
      .filter((p) => p.loanId === loan.id && !p.canceledAt)
      .sort(compareEvents);
    for (const payment of payments)
      validatePayment({
        loan,
        payments: data.payments,
        adjustments: data.adjustments,
        rateChanges: data.rateChanges,
        payment,
      });
    for (const asOf of [
      today(),
      ...data.adjustments
        .filter((a) => a.loanId === loan.id && !a.canceledAt)
        .map((a) => a.date),
    ]) {
      const result = ledger(data, loan, asOf);
      if (result.principalCents < 0)
        return fail(400, "การแก้รายการทำให้เงินต้นติดลบ");
    }
  }
  function setSession(response: ServerResponse) {
    const token = randomBytes(32).toString("hex"),
      csrf = randomBytes(32).toString("hex");
    sessions.set(token, { csrf, expires: clock().getTime() + sessionDays * 86400000 });
    response.setHeader(
      "Set-Cookie",
      `loan_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${sessionDays * 86400}`,
    );
    return csrf;
  }
  const server = createServer(async (request, response) => {
    try {
      const host = (request.headers.host ?? "").toLowerCase();
      const localHost = /^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host);
      // Phone access arrives through `tailscale serve`, which proxies the owner's own HTTPS address here.
      const phoneHost = allowedHosts.includes(host);
      if (!localHost && !phoneHost)
        return fail(403, "โฮสต์ไม่อยู่ในเครื่องนี้");
      const url = new URL(request.url ?? "/", `http://${host}`),
        path = url.pathname,
        method = request.method ?? "GET";
      if (method !== "GET" && method !== "HEAD") {
        const allowed = new Set([
          localHost ? `http://${host}` : `https://${host}`,
          process.env.APP_ORIGIN,
          "http://127.0.0.1:5173",
          "http://localhost:5173",
        ]);
        if (!request.headers.origin || !allowed.has(request.headers.origin))
          return fail(403, "ไม่อนุญาตคำขอจากเว็บไซต์อื่น");
      }
      const token =
        (request.headers.cookie ?? "")
          .split(";")
          .map((c) => c.trim())
          .find((c) => c.startsWith("loan_session="))
          ?.slice(13) ?? "";
      let session = sessions.get(token);
      if (session && session.expires <= clock().getTime()) {
        sessions.delete(token);
        session = undefined;
      }
      if (path === "/api/health")
        return json(response, 200, { ok: true, app: "personal-loan-ledger" });
      if (path === "/api/auth/status" && method === "GET")
        return json(response, 200, {
          setupRequired: !getOwner(),
          user: session ? { email: getOwner()?.email } : null,
          csrfToken: session?.csrf,
          smtpConfigured,
        });
      if (
        ["/api/auth/login", "/api/auth/forgot", "/api/auth/reset"].includes(
          path,
        )
      ) {
        const key = `${request.socket.remoteAddress}:${path}`,
          time = clock().getTime();
        let entry = attempts.get(key);
        if (!entry || entry.until < time) {
          entry = { count: 0, until: time + 15 * 60000 };
          attempts.set(key, entry);
        }
        if (++entry.count > 20)
          return fail(429, "ลองหลายครั้งเกินไป กรุณารอ 15 นาที");
      }
      const authPath = path.startsWith("/api/auth/");
      if (path.startsWith("/api/") && !authPath) {
        if (!session) return fail(401, "กรุณาเข้าสู่ระบบ");
        if (
          method !== "GET" &&
          request.headers["x-csrf-token"] !== session.csrf
        )
          return fail(403, "คำขอหมดอายุ กรุณาเปิดแอปใหม่");
      }
      if (path === "/api/attachments" && method === "POST") {
        const bytes = await readBody(request, 10 * 1024 * 1024),
          mime = (request.headers["content-type"] ?? "").split(";")[0];
        const matches =
          mime === "application/pdf"
            ? bytes.subarray(0, 5).toString() === "%PDF-"
            : mime === "image/jpeg"
              ? bytes.length >= 3 &&
                bytes[0] === 255 &&
                bytes[1] === 216 &&
                bytes[2] === 255
              : mime === "image/png"
                ? bytes
                    .subarray(0, 8)
                    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
                : mime === "image/webp"
                  ? bytes.subarray(0, 4).toString() === "RIFF" &&
                    bytes.subarray(8, 12).toString() === "WEBP"
                  : false;
        if (!matches)
          return fail(
            400,
            "รองรับไฟล์ JPEG, PNG, WebP หรือ PDF ที่ชนิดตรงกับไฟล์จริง",
          );
        const filename = request.headers["x-filename"];
        if (typeof filename !== "string") return fail(400, "ต้องระบุชื่อไฟล์");
        const name = text(parseInput(() => decodeURIComponent(filename), "ชื่อไฟล์ไม่ถูกต้อง"), "ชื่อไฟล์", true, 250);
        if (/[\u0000-\u001f]/.test(name))
          return fail(400, "ชื่อไฟล์ไม่ถูกต้อง");
        const attachment: Attachment = {
          id: randomUUID(),
          borrowerId: url.searchParams.get("borrowerId"),
          loanId: url.searchParams.get("loanId"),
          paymentId: url.searchParams.get("paymentId"),
          name,
          mime,
          size: bytes.length,
          createdAt: now(),
        };
        mutate((data) => {
          const payment = attachment.paymentId
            ? required(
                data.payments.find((p) => p.id === attachment.paymentId),
                "รายการรับชำระ",
              )
            : undefined;
          if (
            payment &&
            attachment.loanId &&
            payment.loanId !== attachment.loanId
          )
            return fail(400, "หลักฐานกับรายการรับชำระไม่ตรงกัน");
          if (payment) attachment.loanId = payment.loanId;
          const loan = attachment.loanId
            ? getLoan(data, attachment.loanId)
            : undefined;
          if (
            loan &&
            attachment.borrowerId &&
            loan.borrowerId !== attachment.borrowerId
          )
            return fail(400, "หลักฐานกับผู้กู้ไม่ตรงกัน");
          if (loan) attachment.borrowerId = loan.borrowerId;
          if (!attachment.borrowerId)
            return fail(400, "ต้องระบุผู้กู้หรือรายการกู้ของหลักฐาน");
          required(
            data.borrowers.find((b) => b.id === attachment.borrowerId),
            "ผู้กู้",
          );
          db.prepare("INSERT INTO files (id,bytes) VALUES (?,?)").run(
            attachment.id,
            bytes,
          );
          data.attachments.push(attachment);
          audit(data, "attachment.create", attachment.id, name);
        });
        return json(response, 201, attachment);
      }
      if (path.startsWith("/api/attachments/") && method === "GET") {
        const attachment = required(
          getData().attachments.find(
            (a) => a.id === path.slice("/api/attachments/".length),
          ),
          "หลักฐาน",
        );
        const row = db
          .prepare("SELECT bytes FROM files WHERE id=?")
          .get(attachment.id);
        if (!row || !(row.bytes instanceof Uint8Array))
          return fail(404, "ไม่พบไฟล์หลักฐาน");
        response.writeHead(200, {
          "Content-Type": attachment.mime,
          "Content-Length": row.bytes.byteLength,
          "Content-Disposition": `attachment; filename="attachment"; filename*=UTF-8''${encodeURIComponent(attachment.name).replace(/'/g, "%27")}`,
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "no-store",
        });
        response.end(row.bytes);
        return;
      }
      if (path === "/api/backup" && method === "GET") {
        db.exec("BEGIN");
        try {
          const backup = buildBackup();
          db.exec("COMMIT");
          return json(response, 200, backup);
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      }
      if (path === "/api/export" && method === "GET") {
        response.writeHead(200, {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="loan-ledger.csv"',
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        });
        response.end(createLedgerCsv(getData(), today()));
        return;
      }
      if (path === "/api/restore" && method === "POST") {
        const raw = await readBody(request, 300 * 1024 * 1024);
        const invalid = "ไฟล์นี้ไม่ใช่ไฟล์สำรองของบัญชีเงินกู้ หรือไฟล์เสียหาย";
        const backup = object(parseInput(() => JSON.parse(raw.toString()), invalid));
        const data = object(backup.data);
        const keys = ["borrowers", "loans", "payments", "rateChanges", "adjustments", "contacts", "attachments", "audit"] as const;
        if (backup.app !== "personal-loan-ledger" || backup.version !== 1 || keys.some((key) => !Array.isArray(data[key])) ||
          !Array.isArray(backup.attachmentFiles))
          return fail(400, invalid);
        const restored = data as unknown as LedgerData;
        const files = new Map((backup.attachmentFiles as unknown[]).map((entry) => {
          const file = object(entry);
          return [text(file.id, "ไฟล์แนบ", true), Buffer.from(text(file.base64, "ไฟล์แนบ", true), "base64")] as const;
        }));
        if (restored.attachments.some((attachment) => !files.has(attachment.id)))
          return fail(400, "ไฟล์สำรองมีหลักฐานแนบไม่ครบ");
        parseInput(() => restored.loans.forEach((loan) => ledger(restored, loan)), invalid);
        mkdirSync(backupDir, { recursive: true });
        writeFileSync(join(backupDir, `before-restore-${now().replace(/[:.]/g, "-")}.json`), JSON.stringify(buildBackup()));
        db.exec("BEGIN IMMEDIATE");
        try {
          db.exec("DELETE FROM files");
          const insert = db.prepare("INSERT INTO files (id, bytes) VALUES (?, ?)");
          for (const attachment of restored.attachments) insert.run(attachment.id, files.get(attachment.id)!);
          if (backup.settings !== undefined) {
            const settings = object(backup.settings);
            save("settings", { politeEnding: text(settings.politeEnding, invalid), promptPayId: text(settings.promptPayId, invalid) });
          }
          audit(restored, "backup.restore", "ledger", `นำข้อมูลสำรองวันที่ ${String(backup.exportedAt ?? "")} กลับมาใช้`);
          save("ledger", restored);
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
        writeDailyBackup();
        return json(response, 200, { ok: true, borrowers: restored.borrowers.length, loans: restored.loans.length });
      }
      const body =
        method === "POST" || method === "PATCH" || method === "PUT"
          ? await readBody(request).then((raw) =>
              object(parseInput(() => JSON.parse(raw.toString() || "{}"), "ข้อมูลไม่ถูกต้อง")))
          : {};
      if (path === "/api/auth/logout" && method === "POST") {
        if (!session) return fail(401, "กรุณาเข้าสู่ระบบ");
        if (request.headers["x-csrf-token"] !== session.csrf)
          return fail(403, "คำขอหมดอายุ กรุณาเปิดแอปใหม่");
        sessions.delete(token);
        response.setHeader(
          "Set-Cookie",
          "loan_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
        );
        return json(response, 200, { ok: true });
      }
      if (path === "/api/auth/forgot" && method === "POST") {
        if (!smtpConfigured)
          return fail(
            503,
            "ยังไม่ได้ตั้งค่าอีเมล ใช้รหัสกู้คืนที่ได้รับตอนสร้างบัญชี",
          );
        const email = text(body.email, "อีเมล", true).toLowerCase(),
          owner = getOwner();
        if (owner?.email === email) {
          const tokenValue = randomBytes(32).toString("hex");
          const { default: nodemailer } = await import("nodemailer");
          const port = Number(process.env.SMTP_PORT || 587);
          const transport = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port,
            secure: port === 465,
            requireTLS: port !== 465,
            auth: process.env.SMTP_USER
              ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
              : undefined,
            connectionTimeout: 10000,
            greetingTimeout: 10000,
            socketTimeout: 10000,
          });
          try {
            await transport.sendMail({
              from: process.env.SMTP_FROM,
              to: owner.email,
              subject: "ตั้งรหัสผ่านใหม่สำหรับบัญชีเงินกู้",
              text: `รหัสตั้งรหัสผ่านใหม่: ${tokenValue}\nใช้ภายใน 30 นาที โดยกรอกรหัสนี้ในหน้าลืมรหัสผ่านของแอป`,
            });
          } catch {
            return fail(
              503,
              "ส่งอีเมลไม่สำเร็จ กรุณาตรวจการตั้งค่า SMTP หรือใช้รหัสกู้คืน",
            );
          }
          resetToken = {
            hash: digest(tokenValue),
            expires: clock().getTime() + 30 * 60000,
          };
        }
        return json(response, 200, {
          message: "ถ้าอีเมลตรงกับบัญชี ระบบจะส่งวิธีตั้งรหัสผ่านใหม่",
        });
      }
      if (path === "/api/auth/reset" && method === "POST") {
        const owner = getOwner(),
          email = text(body.email, "อีเมล", true).toLowerCase(),
          password = text(body.password, "รหัสผ่าน", true);
        const recovery = text(body.recoveryCode, "รหัสกู้คืน"),
          reset = text(body.token, "รหัสอีเมล");
        const correctRecovery =
          owner &&
          recovery &&
          timingSafeEqual(
            Buffer.from(digest(recovery), "hex"),
            Buffer.from(owner.recoveryHash, "hex"),
          );
        const correctToken =
          resetToken &&
          resetToken.expires > clock().getTime() &&
          reset &&
          timingSafeEqual(
            Buffer.from(digest(reset), "hex"),
            Buffer.from(resetToken.hash, "hex"),
          );
        if (
          !owner ||
          owner.email !== email ||
          (!correctRecovery && !correctToken)
        )
          return fail(400, "อีเมลหรือรหัสกู้คืนไม่ถูกต้องหรือหมดอายุ");
        if (password.length < 12)
          return fail(400, "รหัสผ่านต้องมีอย่างน้อย 12 ตัว");
        const salt = randomBytes(16).toString("hex"),
          hashed = await hashPassword(password, salt, 64);
        if (
          getOwner()?.passwordHash !== owner.passwordHash ||
          (!correctRecovery &&
            (!resetToken ||
              !reset ||
              resetToken.hash !== digest(reset) ||
              resetToken.expires <= clock().getTime()))
        )
          return fail(400, "รหัสตั้งรหัสผ่านใหม่ถูกใช้ไปแล้ว");
        save("owner", { ...owner, salt, passwordHash: hashed.toString("hex") });
        sessions.clear();
        resetToken = null;
        return json(response, 200, { ok: true });
      }
      if (path === "/api/auth/setup" && method === "POST") {
        const address = request.socket.remoteAddress;
        if (!localHost || !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address ?? ""))
          return fail(403, "สร้างบัญชีได้จากเครื่องนี้เท่านั้น");
        if (getOwner()) return fail(409, "มีบัญชีเจ้าของแล้ว");
        const email = text(body.email, "อีเมล", true).toLowerCase(),
          password = text(body.password, "รหัสผ่าน", true);
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12)
          return fail(400, "ใช้อีเมลที่ถูกต้องและรหัสผ่านอย่างน้อย 12 ตัว");
        const salt = randomBytes(16).toString("hex"),
          recoveryCode = randomBytes(24).toString("hex");
        const hashed = await hashPassword(password, salt, 64);
        db.exec("BEGIN IMMEDIATE");
        try {
          if (getOwner()) return fail(409, "มีบัญชีเจ้าของแล้ว");
          save("owner", {
            email,
            salt,
            passwordHash: hashed.toString("hex"),
            recoveryHash: digest(recoveryCode),
          });
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
        return json(response, 201, {
          email,
          recoveryCode,
          csrfToken: setSession(response),
        });
      }
      if (path === "/api/auth/login" && method === "POST") {
        const owner = getOwner(),
          email = text(body.email, "อีเมล", true).toLowerCase(),
          password = text(body.password, "รหัสผ่าน", true);
        const hashed = await hashPassword(
          password,
          owner?.salt ?? "absent-owner",
          64,
        );
        if (
          !owner ||
          owner.email !== email ||
          getOwner()?.passwordHash !== owner.passwordHash ||
          !timingSafeEqual(hashed, Buffer.from(owner.passwordHash, "hex"))
        )
          return fail(401, "อีเมลหรือรหัสผ่านไม่ถูกต้อง");
        return json(response, 200, {
          email: owner.email,
          csrfToken: setSession(response),
        });
      }
      if (path === "/api/settings" && method === "GET")
        return json(response, 200, getSettings());
      if (path === "/api/settings" && method === "PUT") {
        const politeEnding = text(body.politeEnding, "คำลงท้าย", false, 20);
        if (!["", "ครับ", "ค่ะ"].includes(politeEnding)) return fail(400, "คำลงท้ายต้องเป็น ครับ หรือ ค่ะ");
        const promptPayId = text(body.promptPayId, "พร้อมเพย์", false, 40).replace(/[\s-]/g, "");
        if (promptPayId && !/^(0\d{9}|\d{13})$/.test(promptPayId))
          return fail(400, "พร้อมเพย์ต้องเป็นเบอร์มือถือ 10 หลัก หรือเลขบัตรประชาชน 13 หลัก");
        const settings: Settings = { politeEnding, promptPayId };
        save("settings", settings);
        return json(response, 200, settings);
      }
      if (path === "/api/data" && method === "GET")
        return json(response, 200, getData());
      if (path === "/api/borrowers" && method === "POST") {
        const borrower: Borrower = {
          id: randomUUID(),
          name: text(body.name, "ชื่อ", true, 200),
          nickname: text(body.nickname, "ชื่อเรียก", false, 200),
          phone: text(body.phone, "เบอร์โทร", false, 100),
          lineId: text(body.lineId, "LINE", false, 200),
          facebookUrl: facebookUrl(body.facebookUrl),
          notes: text(body.notes, "หมายเหตุ"),
          createdAt: now(),
        };
        mutate((data) => {
          data.borrowers.push(borrower);
          data.audit.push({
            id: randomUUID(),
            at: now(),
            action: "borrower.create",
            entityId: borrower.id,
            detail: "เพิ่มผู้กู้",
          });
        });
        return json(response, 201, borrower);
      }
      if (path.startsWith("/api/borrowers/") && method === "PATCH") {
        const borrower = mutate((data) => {
          const existing = required(
            data.borrowers.find(
              (b) => b.id === path.slice("/api/borrowers/".length),
            ),
            "ผู้กู้",
          );
          for (const key of [
            "name",
            "nickname",
            "phone",
            "lineId",
            "facebookUrl",
            "notes",
          ] satisfies Array<keyof Borrower>) {
            if (body[key] !== undefined)
              existing[key] =
                key === "facebookUrl"
                  ? facebookUrl(body[key])
                  : text(
                      body[key],
                      key,
                      key === "name",
                      key === "notes" ? 10000 : 2000,
                    );
          }
          audit(data, "borrower.update", existing.id, "แก้ข้อมูลผู้กู้");
          return existing;
        });
        return json(response, 200, borrower);
      }
      if (path === "/api/loans" && method === "POST") {
        if (body.isTest !== undefined && typeof body.isTest !== "boolean")
          return fail(400, "ต้องระบุสถานะสัญญาทดลองให้ถูกต้อง");
        if (body.source !== "new" && body.source !== "existing")
          return fail(400, "ประเภทรายการกู้ไม่ถูกต้อง");
        const loan: Loan = {
          id: randomUUID(),
          borrowerId: text(body.borrowerId, "ผู้กู้", true),
          source: body.source,
          ...(body.isTest === true ? { recordStatus: "test" } : {}),
          principalCents: integer(body.principalCents, "เงินต้น"),
          openingInterestCents: integer(
            body.openingInterestCents ?? 0,
            "ดอกยกมา",
          ),
          rateBps: integer(body.rateBps, "อัตราดอก"),
          startDate: date(body.startDate, "วันเริ่มนับยอด"),
          cycleStartDate: date(body.cycleStartDate, "วันเริ่มรอบ"),
          firstCycleEndDate: date(body.firstCycleEndDate, "วันตัดรอบถัดไป"),
          anchorDay: integer(body.anchorDay, "วันตัดรอบ"),
          dueDate: date(body.dueDate, "วันนัดชำระ"),
          purpose: text(body.purpose, "ชื่อรายการ", false, 200),
          notes: text(body.notes, "หมายเหตุ"),
          createdAt: now(),
        };
        if (
          loan.principalCents <= 0 ||
          loan.startDate > today() ||
          loan.cycleStartDate > loan.startDate ||
          loan.firstCycleEndDate <= loan.startDate ||
          loan.dueDate < loan.startDate ||
          loan.anchorDay < 1 ||
          loan.anchorDay > 31 ||
          addMonths(loan.cycleStartDate, 1, loan.anchorDay) !==
            loan.firstCycleEndDate
        )
          return fail(400, "ยอดเงินหรือวันรอบกู้ไม่ถูกต้อง");
        if (
          loan.source === "new" &&
          (loan.openingInterestCents !== 0 ||
            loan.cycleStartDate !== loan.startDate)
        )
          return fail(
            400,
            "กู้ใหม่ต้องไม่มีดอกยกมา และวันเริ่มรอบต้องตรงกับวันที่ให้กู้",
          );
        mutate((data) => {
          required(
            data.borrowers.find((b) => b.id === loan.borrowerId),
            "ผู้กู้",
          );
          ledger(data, loan);
          data.loans.push(loan);
          audit(data, "loan.create", loan.id, loan.notes || "เพิ่มรายการกู้");
        });
        return json(response, 201, loan);
      }
      const recordStatus = path.match(/^\/api\/loans\/([^/]+)\/record-status$/);
      if (recordStatus && method === "POST") {
        const action = body.action;
        if (action !== "mark-test" && action !== "mark-real" && action !== "trash-test" && action !== "restore-test")
          return fail(400, "คำสั่งจัดหมวดสัญญาไม่ถูกต้อง");
        const reason = text(body.reason, "เหตุผล", true);
        const updated = mutate(data => {
          const loan = required(data.loans.find(entry => entry.id === recordStatus[1]), "รายการกู้");
          const before = loan.recordStatus ?? "real";
          changeLoanRecordStatus(loan, action);
          if (before !== (loan.recordStatus ?? "real"))
            audit(data, "loan.record-status", loan.id, JSON.stringify({ action, reason, before, after: loan.recordStatus ?? "real" }));
          return loan;
        });
        return json(response, 200, updated);
      }
      if (path.startsWith("/api/loans/") && method === "PATCH") {
        const loan = mutate((data) => {
          const loan = getLoan(data, path.slice("/api/loans/".length));
          const reason = text(body.reason, "เหตุผล", true);
          if (
            Object.keys(body).some(
              (key) => !["dueDate", "notes", "reason", "statusOverride", "purpose"].includes(key),
            )
          )
            return fail(400, "เปลี่ยนได้เฉพาะวันนัดชำระ ชื่อรายการ หมายเหตุ และสถานะ");
          const dueDate = body.dueDate === undefined ? loan.dueDate : date(body.dueDate, "วันนัดชำระ");
          if (dueDate < loan.startDate)
            return fail(400, "วันนัดชำระต้องไม่ก่อนวันเริ่มนับยอด");
          const before = { dueDate: loan.dueDate, notes: loan.notes, statusOverride: loan.statusOverride, purpose: loan.purpose };
          if (body.statusOverride !== undefined) {
            if (body.statusOverride !== "normal" && body.statusOverride !== "auto")
              return fail(400, "สถานะต้องเป็นปกติหรือตามวันนัด");
            if (body.statusOverride === "normal") loan.statusOverride = "normal";
            else delete loan.statusOverride;
          }
          loan.dueDate = dueDate;
          if (body.purpose !== undefined) loan.purpose = text(body.purpose, "ชื่อรายการ", false, 200);
          if (body.notes !== undefined)
            loan.notes = text(body.notes, "หมายเหตุ");
          audit(
            data,
            "loan.update",
            loan.id,
            JSON.stringify({
              reason,
              before,
              after: { dueDate: loan.dueDate, notes: loan.notes, statusOverride: loan.statusOverride, purpose: loan.purpose },
            }),
          );
          return loan;
        });
        return json(response, 200, loan);
      }
      if (path === "/api/payments" && method === "POST") {
        const payment = readPayment(body);
        mutate((data) => {
          const loan = getLoan(data, payment.loanId);
          data.payments.push(payment);
          replay(data, loan);
          audit(data, "payment.create", payment.id, payment.note || "รับชำระ");
        });
        return json(response, 201, payment);
      }
      const correctLoan = path.match(/^\/api\/loans\/([^/]+)\/correction$/);
      if (correctLoan && method === "POST") {
        const corrected = mutate((data) => {
          const loan = getLoan(data, correctLoan[1]);
          if (Object.keys(body).some(key => !["rateBps", "dueDate", "reason", "cancelRateChangeIds", "remainingPrincipalCents"].includes(key)))
            return fail(400, "แก้ได้เฉพาะต้นคงเหลือ อัตราเดิม และวันนัดชำระ");
          const reason = text(body.reason, "เหตุผลที่แก้ไข", true);
          const rateBps = integer(body.rateBps, "อัตราดอกที่ถูกต้อง");
          const dueDate = date(body.dueDate, "วันนัดชำระ");
          if (dueDate < loan.startDate) return fail(400, "วันนัดชำระต้องไม่ก่อนวันเริ่มนับยอด");
          const requested = body.cancelRateChangeIds ?? [];
          if (!Array.isArray(requested) || requested.some(id => typeof id !== "string"))
            return fail(400, "รายการอัตราที่จะยกเลิกไม่ถูกต้อง");
          const remainingPrincipalCents = body.remainingPrincipalCents === undefined
            ? undefined : integer(body.remainingPrincipalCents, "เงินต้นคงเหลือที่ถูกต้อง");
          const before = { rateBps: loan.rateBps, dueDate: loan.dueDate, remainingPrincipalCents: ledger(data, loan).principalCents };
          for (const id of new Set(requested)) {
            const change = required(data.rateChanges.find(r => r.id === id && r.loanId === loan.id), "รายการอัตรา");
            if (change.effectiveDate <= today()) return fail(400, "ยกเลิกได้เฉพาะอัตราที่ตั้งล่วงหน้า");
            if (!change.canceledAt) {
              change.canceledAt = now();
              change.cancelReason = reason;
            }
          }
          loan.rateBps = rateBps;
          loan.dueDate = dueDate;
          let principalAdjustmentId: string | undefined;
          if (remainingPrincipalCents !== undefined && remainingPrincipalCents !== before.remainingPrincipalCents) {
            const adjustment: Adjustment = { id: randomUUID(), loanId: loan.id, date: today(),
              principalDeltaCents: remainingPrincipalCents - before.remainingPrincipalCents, interestDeltaCents: 0,
              reason, createdAt: now(), canceledAt: null, cancelReason: null };
            data.adjustments.push(adjustment);
            principalAdjustmentId = adjustment.id;
          }
          replay(data, loan);
          audit(data, "loan.correct", loan.id, JSON.stringify({ reason, before,
            after: { rateBps: loan.rateBps, dueDate: loan.dueDate, remainingPrincipalCents: ledger(data, loan).principalCents },
            principalAdjustmentId, cancelRateChangeIds: requested }));
          return loan;
        });
        return json(response, 200, corrected);
      }
      const editPayment = path.match(/^\/api\/payments\/([^/]+)$/);
      if (editPayment && method === "PATCH") {
        const replacement = mutate((data) => {
          const original = required(data.payments.find(p => p.id === editPayment[1]), "รายการรับชำระ");
          if (original.canceledAt) return fail(409, "รายการนี้ถูกยกเลิกหรือแก้ไขแล้ว ให้เปิดรายการล่าสุด");
          const reason = text(body.editReason, "เหตุผลที่แก้ไข") || "เจ้าของแก้ไขรายการรับชำระ";
          const updated = { ...readPayment(body, original.loanId), replacesPaymentId: original.id };
          original.canceledAt = now();
          original.cancelReason = `แก้ไขรายการ: ${reason}`;
          data.payments.push(updated);
          replay(data, getLoan(data, original.loanId));
          audit(data, "payment.edit", updated.id, JSON.stringify({ previousPaymentId: original.id, reason }));
          return updated;
        });
        return json(response, 200, replacement);
      }
      const cancelPayment = path.match(/^\/api\/payments\/([^/]+)\/cancel$/);
      if (cancelPayment && method === "POST") {
        mutate((data) => {
          const payment = required(
            data.payments.find((p) => p.id === cancelPayment[1]),
            "รายการรับชำระ",
          );
          const reason = text(body.reason, "เหตุผล", true);
          if (payment.canceledAt) return;
          payment.canceledAt = now();
          payment.cancelReason = reason;
          replay(data, getLoan(data, payment.loanId));
          audit(data, "payment.cancel", payment.id, reason);
        });
        return json(response, 200, { ok: true });
      }
      if (path === "/api/rate-changes" && method === "POST") {
        const change: RateChange = {
          id: randomUUID(),
          loanId: text(body.loanId, "รายการกู้", true),
          effectiveDate: date(body.effectiveDate, "งวดเริ่มใช้"),
          rateBps: integer(body.rateBps, "อัตราดอก"),
          reason: text(body.reason, "เหตุผล", true),
          createdAt: now(),
        };
        mutate((data) => {
          const loan = getLoan(data, change.loanId),
            balance = ledger(data, loan);
          if (balance.closed || balance.principalCents === 0)
            return fail(400, "รายการนี้คืนต้นครบแล้ว");
          if (change.effectiveDate <= today())
            return fail(400, "เปลี่ยนอัตราได้ตั้งแต่งวดถัดไป");
          let boundary = loan.firstCycleEndDate;
          while (boundary < change.effectiveDate)
            boundary = addMonths(boundary, 1, loan.anchorDay);
          if (
            boundary !== change.effectiveDate ||
            data.rateChanges.some(
              (r) =>
                r.loanId === loan.id &&
                !r.canceledAt &&
                r.effectiveDate === change.effectiveDate,
            )
          )
            return fail(
              400,
              "วันที่ต้องเป็นวันเริ่มรอบที่ยังไม่มีการเปลี่ยนอัตรา",
            );
          data.rateChanges.push(change);
          replay(data, loan);
          audit(data, "rate.change", change.id, change.reason);
        });
        return json(response, 201, change);
      }
      if (path === "/api/adjustments" && method === "POST") {
        const adjustment: Adjustment = {
          id: randomUUID(),
          loanId: text(body.loanId, "รายการกู้", true),
          date: date(body.date, "วันที่ปรับปรุง"),
          principalDeltaCents: integer(
            body.principalDeltaCents,
            "ปรับต้น",
            true,
          ),
          interestDeltaCents: integer(body.interestDeltaCents, "ปรับดอก", true),
          reason: text(body.reason, "เหตุผล", true),
          createdAt: now(),
          canceledAt: null,
          cancelReason: null,
        };
        mutate((data) => {
          const loan = getLoan(data, adjustment.loanId);
          if (adjustment.date < loan.startDate || adjustment.date > today())
            return fail(
              400,
              "วันที่ปรับปรุงต้องอยู่ระหว่างเริ่มนับยอดกับวันนี้",
            );
          const current = ledger(data, loan),
            before = ledger(data, loan, adjustment.date);
          if (current.closed || current.principalCents === 0)
            return fail(400, "ต้องยกเลิกรายการคืนต้นสุดท้ายก่อนปรับยอด");
          if (
            before.principalCents + adjustment.principalDeltaCents < 0 ||
            before.payoffInterestCents + adjustment.interestDeltaCents < 0
          )
            return fail(400, "การปรับปรุงทำให้ยอดติดลบ");
          data.adjustments.push(adjustment);
          replay(data, loan);
          audit(data, "adjustment.create", adjustment.id, adjustment.reason);
        });
        return json(response, 201, adjustment);
      }
      const cancelAdjustment = path.match(
        /^\/api\/adjustments\/([^/]+)\/cancel$/,
      );
      if (cancelAdjustment && method === "POST") {
        mutate((data) => {
          const adjustment = required(
              data.adjustments.find((a) => a.id === cancelAdjustment[1]),
              "รายการปรับปรุง",
            ),
            reason = text(body.reason, "เหตุผล", true);
          if (adjustment.canceledAt) return;
          if (
            ledger(data, getLoan(data, adjustment.loanId)).principalCents === 0
          )
            return fail(
              400,
              "ต้องยกเลิกรายการคืนต้นสุดท้ายก่อนยกเลิกการปรับยอด",
            );
          adjustment.canceledAt = now();
          adjustment.cancelReason = reason;
          replay(data, getLoan(data, adjustment.loanId));
          audit(data, "adjustment.cancel", adjustment.id, reason);
        });
        return json(response, 200, { ok: true });
      }
      if (path === "/api/contacts" && method === "POST") {
        if (body.channel !== "LINE" && body.channel !== "Facebook")
          return fail(400, "ช่องทางส่งไม่ถูกต้อง");
        const contact = {
          id: randomUUID(),
          loanId: text(body.loanId, "รายการกู้", true),
          date: now(),
          channel: body.channel,
          message: text(body.message, "ข้อความ", true),
        } satisfies import("../src/domain/types.js").Contact;
        mutate((data) => {
          getLoan(data, contact.loanId);
          data.contacts.push(contact);
          audit(
            data,
            "contact.sent",
            contact.id,
            "เจ้าของยืนยันว่าส่งข้อความแล้ว",
          );
        });
        return json(response, 201, contact);
      }
      if (path === "/api/reminders" && method === "GET") {
        const data = realLedgerData(getData()),
          currentDate = today();
        const items = data.loans
          .filter(
            (loan) =>
              !ledger(data, loan).closed &&
              daysBetween(currentDate, loan.dueDate) <= 1 &&
              (loan.dueDate >= currentDate || isLoanOverdue(loan, currentDate)),
          )
          .map((loan) => ({
            loanId: loan.id,
            borrowerName: loanDisplayName(data.borrowers.find((b) => b.id === loan.borrowerId)?.name ?? "", loan),
            dueDate: loan.dueDate,
            kind:
              loan.dueDate === currentDate
                ? "today"
                : isLoanOverdue(loan, currentDate)
                  ? "overdue"
                  : "tomorrow",
          }));
        return json(response, 200, {
          items,
          serverTime: clock().toISOString(),
        });
      }
      if (
        !path.startsWith("/api/") &&
        staticDir &&
        (method === "GET" || method === "HEAD")
      ) {
        const root = resolve(staticDir),
          decoded = parseInput(() => decodeURIComponent(path), "ไม่พบหน้า");
        if (
          decoded.split("/").some((part) => part.startsWith(".")) ||
          decoded.includes("\\")
        )
          return fail(404, "ไม่พบหน้า");
        let target = resolve(root, "." + decoded);
        if (target !== root && !target.startsWith(root + sep))
          return fail(404, "ไม่พบหน้า");
        if (!existsSync(target) || !statSync(target).isFile()) {
          if (extname(decoded)) return fail(404, "ไม่พบไฟล์");
          target = join(root, "index.html");
        }
        if (!existsSync(target)) return fail(404, "ยังไม่ได้สร้างหน้าแอป");
        const mimes: Record<string, string> = {
          ".html": "text/html; charset=utf-8",
          ".js": "text/javascript; charset=utf-8",
          ".css": "text/css; charset=utf-8",
          ".json": "application/json; charset=utf-8",
          ".png": "image/png",
          ".jpg": "image/jpeg",
          ".jpeg": "image/jpeg",
          ".svg": "image/svg+xml",
          ".ico": "image/x-icon",
          ".woff": "font/woff",
          ".woff2": "font/woff2",
        };
        response.writeHead(200, {
          "Content-Type": mimes[extname(target)] ?? "application/octet-stream",
          "Cache-Control":
            extname(target) === ".html" ? "no-cache" : "public, max-age=3600",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy":
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
          "Referrer-Policy": "same-origin",
        });
        response.end(method === "HEAD" ? undefined : readFileSync(target));
        return;
      }
      return fail(404, "ไม่พบรายการหรือเส้นทางนี้");
    } catch (error) {
      const unexpected = isUnexpected(error);
      if (unexpected) logError(error, `${request.method} ${request.url}`);
      if (!response.headersSent)
        json(response, unexpected ? 500 : error instanceof HttpError ? error.status : 400, {
          error: unexpected
            ? "ระบบขัดข้อง บันทึกรายละเอียดไว้ในไฟล์ log แล้ว"
            : error instanceof Error ? error.message : "ดำเนินการไม่สำเร็จ",
        });
      else response.destroy();
    }
  });
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await new Promise<void>((resolve) => {
      if (!server.listening) resolve();
      else server.close(() => resolve());
    });
    db.close();
  };
  return { server, close };
}
