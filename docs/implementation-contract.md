# Implementation contract

Approved product spec: APP-SPEC.md. Local-PC phase supersedes cloud storage: the user's PC stores SQLite database and attachments, email/password login, desktop browser first. iPhone connection and live iPhone Push are deferred explicitly by the user. No Supabase project or cloud site is to be created. Owner notifications are in-app and optional desktop browser notifications at 13:00 Asia/Bangkok while the PC/server runs. Password reset supports a setup-time recovery code and optional SMTP email; never claim email was sent when unconfigured.

Shared models: src/domain/types.ts. All money is integer satang. Rate basis points: 100 = 1% monthly, 1000 = 10%. Creation, initial-rate correction, and future rate changes record the owner's actual nonnegative safe-integer rate for either loan source, including zero. Do not clamp, scale, or change source to bypass a rate restriction. A shared percent input explains that 10 means 10% and 7.5 means 7.5%. Above 1.25% monthly, show a nonblocking advisory with the official PRD source: https://personal.prd.go.th/th/content/category/detail/id/1824/cid/1825/iid/296636 . Recording does not certify a legal right to collect that rate. New loans still require zero opening interest and cycle start equal to opening date.

`Loan.purpose?: string` labels an individual loan without changing borrower identity. Creation and the existing loan PATCH accept trimmed text up to 200 characters. An empty value clears the label. Existing loans without the field keep their current display. The loan header offers a separate metadata-only “ตั้งชื่อรายการกู้” modal, so naming does not require submitting money fields. `loanDisplayName` adds a nonempty purpose in parentheses for loan-specific screens, contact drafts, reminders, and CSV names. Borrower cards and totals still group by borrower ID. Loan edits audit the prior and new purpose alongside existing metadata. Backups preserve the optional field naturally.

The owner's October 19 clarification adds correction of an incorrectly entered initial rate, separately from agreeing to a new future rate. `POST /api/loans/:id/correction` records the owner-supplied actual initial rate and due date with a required reason, for either loan source. The October 25 rate-input fix extends actual-rate recording to creation and future scheduling without changing source classification. The correction stores before and after values in audit history and replays all dependent events atomically. It does not rewrite opening principal, opening interest, or cycle dates. Any incompatible later exact payoff rejects the entire correction.

Optional `remainingPrincipalCents` is the target current remaining balance, not a delta. The server computes target minus the current replayed principal and appends a principal-only adjustment dated today, preserving the opening record and prior entries. The audit links the adjustment and records before and after balances. Submitting the same target again adds no adjustment. This correction never creates a receipt or changes `principalPaidCents`. The ordinary form labels the target balance and previews current-to-target amounts. The separate advanced adjustment form explicitly accepts signed deltas.

Optional `cancelRateChangeIds` explicitly selects mistaken future rate entries belonging to the same loan. They must start after today. Canceled entries retain `canceledAt` and `cancelReason` and are excluded from balances, forecasts, and duplicate-date checks. Unselected future rates remain active. Corrections do not silently replace scheduled rates. The form previews entered percent and nominal monthly interest, labels 10 as 10%, and distinguishes correction from future scheduling. Future scheduling offers up to 24 valid cycle boundaries, excluding occupied dates.

## Real and trial records

`Loan.recordStatus?: "test" | "trashed-test"` classifies records independently from financial closure. Missing status means real, preserving all existing records. `loanCategory` returns active/closed for real records and the explicit status for trial records. Creation accepts optional boolean `isTest`; it does not infer trial status from a borrower name or payment note.

`realLedgerData` is the common real-account projection for totals, cash history, CSV, and reminders. It excludes all trial loans and their payments, adjustments, rate changes, contacts, and loan/payment attachments without mutating stored history. Closed real receipts remain in lifetime real received totals. InterestOverview receives only active real loans and scopes both person cards and aggregate forecast values to those loan IDs even if its forecast map contains other records. Individual trial details can still show practice calculations.

`POST /api/loans/:id/record-status { action, reason }` requires normal owner session and CSRF protection. Actions are mark-test, mark-real, trash-test, restore-test. Real records must first be explicitly marked trial before they can be trashed. Restore returns only to trial; changing a trashed record directly to real is rejected. Each transition stores before/after/action/reason in audit. Repeated trash requests are idempotent. Normal mutation endpoints cannot edit trashed loans or their receipts. Backups retain all original history and attachment bytes. No physical deletion is involved.

Overview and borrower tables use four category controls with counts; active is the default. Trial rows offer deletion, trash rows offer restoration, and loan details offer explicit real/trial conversion. Creation selects the new record's category after saving. Deletion returns to the trial category. The owner-confirmed boom record is trashed with a pre-change backup and unchanged receipts, excluding its 2,000-baht practice repayment from real totals.

## Calculation interface

src/domain/ledger.ts exports calculateLedger({ loan, payments, rateChanges, adjustments, asOf }): LedgerSnapshot; validatePayment({ loan, payments, rateChanges, adjustments, payment }): void; addMonths(date, count, anchorDay?): string; daysBetween(start,end): number; todayBangkok(): string. Each calculation filters its own loan id. Business rejection throws Error with useful Thai message. New payment validation sees existing events strictly BEFORE this new payment, rejects negative or unsafe money, future dates, principal overpayments, allocation mismatch, dates before opening, and incorrect payoff totals. A payoff finalizes partial period once, stops accrual, cancellation resumes it. Any canceled entries are excluded. Round halfway up in integer satang.

Imported first partial cycle: loan.cycleStartDate is the previous full cycle boundary, startDate is the opening/as-of date, firstCycleEndDate is the next boundary. OpeningInterestCents covers all interest BEFORE startDate. First period's charge uses remaining days startDate..firstCycleEndDate divided by full cycle days. Opening principal is the period base for this imported cycle. Future cycles use anchorDay, preserving 31 after February.

New ordinary receipts use `Payment.interestMode: "owner"`. The owner enters actual received interest without a calculated-interest ceiling. Apply at most the calculated payable interest immediately before that receipt. Count the entire entered amount in actual received interest, and accumulate the excess in `manualInterestDifferenceCents`. Excess does not credit future interest, change principal, or change the rate. Unflagged historical receipts retain their original calculation and excess-interest validation. Interest forecasts describe gross calculated earnings, separately from actual receipts.

Owner-confirmed payoffs use `isPayoff: true` with `interestMode: "owner"`. The HTTP request sets `payoffMode: "owner"`; the server validates that mode and stores the existing interest-mode flag. Require the complete remaining principal and matching total allocation. The owner enters actual interest, which may differ from the formula, including zero. The ledger finalizes accrual once and closes the loan. Track any formula interest not collected in `uncollectedInterestCents`, separately from cash receipts. Higher actual interest remains actual received interest, with only the available formula amount applied to the calculated balance. Historical/formula payoffs without the owner flag retain exact-interest validation. Payment edits preserve payoff status when replacing an existing payoff.

The normal payoff form starts with an empty required actual-interest field and disables confirmation until an amount is entered. Its total uses remaining principal plus that entered amount. Do not substitute `payoffInterestCents` or `payoffTotalCents` into a recorded owner payoff.

Zero overdue interest does not prove zero earned interest in an unfinished imported cycle. If confirmed opening information is incomplete, retain the import and record a dated interest adjustment with the owner's reason. This remains available to correct calculated balances, but is no longer required to save an owner-entered ordinary receipt. Payment dialogs show the selected date's calculated interest for reference, identify the loan, explain excess treatment, and keep errors inside the sticky footer.

`Payment.dateEstimated: true` marks an unknown actual receipt date. New form entries use the recording date. Editing preserves the existing reference date unless the owner changes it. The history and CSV identify the estimate. Payment edits cancel the original with a reason and append a replacement with `replacesPaymentId`. Replay validates the candidate history atomically, so a failed edit leaves both the original and later entries unchanged. Attachments remain linked to their original historical record.

`Loan.statusOverride: "normal"` suppresses overdue classification without changing due dates, accrual, balances, or receipts. The override persists until the owner restores automatic status. `src/domain/status.ts` supplies the shared overdue predicate for badges, filters, and reminder lists. Closed loans remain closed. Scheduled reminders for today or tomorrow remain available.

## HTTP interface

Node server exports createApp({ dataDir, staticDir?, clock? }) -> { server, close } without listening, for real HTTP tests; index.ts starts on 127.0.0.1:4310. SQLite data directory default .data, override LOAN_DATA_DIR for isolated QA. Express not required. Session is HttpOnly SameSite=Strict, credentials same-origin. CSRF/origin protection on mutations. Only loopback may create initial owner. Session required for all data and attachment routes. Validate at server boundary.

- GET /api/auth/status -> { setupRequired, user: { email } | null, csrfToken?: string, smtpConfigured: boolean }
- POST /api/auth/setup { email,password } -> { email,recoveryCode,csrfToken }, sets session
- POST /api/auth/login { email,password } -> { email,csrfToken }, sets session
- POST /api/auth/logout -> { ok:true }
- POST /api/auth/forgot { email } -> { message }, email delivery only if SMTP configured, otherwise useful configuration error
- POST /api/auth/reset { email, token?, recoveryCode?, password } -> { ok:true }, revoke existing sessions
- GET /api/data -> LedgerData
- POST /api/borrowers -> Borrower (omit id/createdAt)
- PATCH /api/borrowers/:id -> Borrower
- POST /api/loans -> Loan (omit id/createdAt)
- PATCH /api/loans/:id { dueDate?, notes?, purpose?, statusOverride?: 'normal'|'auto', reason } -> Loan; audit before and after, 'auto' removes the override
- POST /api/loans/:id/correction { rateBps, dueDate, reason, remainingPrincipalCents?: number, cancelRateChangeIds?: string[] } -> Loan; retain audit, replay and commit atomically
- POST /api/payments -> Payment (omit generated/cancellation fields), validate real ledger
- PATCH /api/payments/:id -> replacement Payment; same receipt fields and optional editReason, cannot move loans or edit canceled originals, retain and cancel the original
- POST /api/payments/:id/cancel { reason } -> { ok:true }
- POST /api/rate-changes -> RateChange (omit generated fields); effectiveDate must be a cycle start, no silent retroactive rewrite
- POST /api/adjustments -> Adjustment (omit generated/cancellation fields), require reason and nonnegative resulting balances
- POST /api/adjustments/:id/cancel { reason } -> { ok:true }
- POST /api/contacts { loanId,channel,message } -> Contact
- POST /api/attachments?borrowerId=...&loanId=...&paymentId=... with raw File body and X-Filename encodedURIComponent(name), Content-Type approved image/pdf -> Attachment; 10MB max
- GET /api/attachments/:id -> authenticated attachment download
- GET /api/backup -> complete versioned JSON with ledger history AND base64 attachments, excludes auth passwords/session secrets
- GET /api/export -> BOM CSV safe against spreadsheet formula injection
- GET /api/reminders -> { items: [{loanId,borrowerName,dueDate,kind:'tomorrow'|'today'|'overdue'}], serverTime }
- GET /api/health -> {ok:true,app:'personal-loan-ledger'} no data

Use X-CSRF-Token header for authenticated writes, frontend obtains token from auth/status or login response. Auth requests need same-origin Origin check without csrf. API errors {error:string}, non-2xx. Do not swallow failed writes.

After any proposed payment/cancellation/adjustment mutation revalidate all active payments for the affected loan chronologically against the candidate history before committing, because a backdated mutation may invalidate later exact payoff allocations. Reject operations on finalized loans unless final principal/payment is canceled first. Loan source enum must be validated, never silently coerce arbitrary strings to existing. Rate changes must be future cycle boundaries (or explicitly justified adjustment, separate API). Index loads optional .env with process.loadEnvFile, and no secret is exposed in backup. Server public export createApp should support API-driven integration tests with clock; if ledger validator todayBangkok uses real clock tests use past fixed dates.

No seeded borrowers or real-looking fake balances in production. Browser QA uses a separate LOAN_DATA_DIR; remove QA data before handoff.

## Daily interest and forecasts

October 25 presentation change: do not display automatic arrears as a debt claim. Dashboard summaries, loan tables, loan details, reminder rows, and CSV omit the arrears amount. Detail summary cards show remaining principal and actual principal/interest receipts. Remove the automatic payoff-total summary as well. Contact drafts include the date and principal only; the owner can type agreed interest into the editable message. Do not insert a formula-derived interest amount automatically.

The ordinary receipt dialog references `cycleInterest.earnedInterestCents` for the selected date instead of cumulative `payoffInterestCents`. The amount remains owner-entered. Daily earnings and forecasts remain visible as reference values. The owner-payoff workflow described above supersedes the earlier formula-default form. Hiding fields does not rewrite historical data. CSV has 15 columns after removal of the arrears column and exports actual receipt amounts.

`calculateInterestForecast` projects confirmed history as of a Bangkok calendar date without saving any projected entries. Gross earned interest excludes opening interest and interest adjustments; paying interest does not reduce gross earnings. The payable ledger still deducts receipts normally. Display actual elapsed charge days and full cycle days, the full-cycle nominal interest, and the current cycle's expected charge (which is partial for imported balances and stops on final principal repayment).

Calendar-month earnings are the difference between cumulative earned interest now and at the month-start boundary (or opening date if later). Month-end projection uses the first day of the next month as an exclusive boundary, so the final calendar day is included. Ignore future payments/adjustments; honor scheduled rate changes. Assume no additional payments or adjustments. A mid-cycle principal payment preserves the current cycle base and lowers the next cycle. Forecasts are earnings, not guaranteed cash receipts; never combine opening arrears with forecast earnings.

Acceptance example: 3,000 baht full-cycle interest, 30 actual days, 10 elapsed days gives 1,000 baht earned and 3,000 baht projected through that complete cycle. A 31-day cycle instead gives 967.74 baht after ten days. The overview also shows a borrower-by-borrower breakdown and the distinct calendar-month projection.

The primary interest overview displays one card per borrower ID immediately, with current-cycle gross earnings, active full-cycle interest, and calendar-month forecast summed across only that person's loans. Name search filters cards, and each card expands to show each loan's dates and formula with navigation to its details. All-person totals are secondary and collapsed by default. Do not group borrowers by display name or hide the person view inside a loan table.
