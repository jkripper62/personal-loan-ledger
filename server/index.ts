import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createApp } from "./app.js";

if (existsSync(".env")) process.loadEnvFile(".env");
const port = Number(process.env.PORT || 4310);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("PORT ไม่ถูกต้อง");
const app = createApp({
  dataDir: resolve(process.env.LOAN_DATA_DIR || ".data"),
  staticDir: resolve("dist"),
  ...(process.env.LOAN_BACKUP_DIR ? { backupDir: resolve(process.env.LOAN_BACKUP_DIR) } : {}),
  allowedHosts: (process.env.ALLOWED_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean),
});
app.server.on("error", (error) => {
  process.stderr.write(`เปิดแอปไม่ได้: ${error.message}\n`);
  process.exitCode = 1;
  void app.close();
});
app.server.listen(port, "127.0.0.1", () =>
  process.stdout.write(`บัญชีเงินกู้พร้อมใช้ที่ http://127.0.0.1:${port}\n`),
);
for (const signal of ["SIGINT", "SIGTERM"] satisfies NodeJS.Signals[])
  process.once(signal, () => {
    void app.close().then(() => {
      process.exitCode = 0;
    });
  });
