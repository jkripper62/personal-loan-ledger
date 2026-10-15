# Owner-entered receipts and normal status

Status: implemented and verified
Blocked by: none

The owner needs to record actual interest even when a receipt date is forgotten or payment is late. A calculated-interest ceiling prevented that workflow. The owner also requested a way to replace an overdue badge with normal status.

## Receipt policy

New ordinary receipts carry `interestMode: "owner"`. The amount received remains exactly what the owner enters. Applied interest is limited to calculated payable interest at the receipt date. Any excess appears separately as agreed received interest, without becoming future credit. Principal, contractual rates, gross forecasts, and the absence of automatic penalties remain unchanged.

The form labels calculated interest as a reference and explains excess treatment. The unknown-date checkbox uses the recording date and marks the history. An edit can change the date, amounts, or note. The server cancels the original with a reason and appends a replacement linked by `replacesPaymentId`. Chronological replay must pass before either change is saved. Original evidence stays attached to the historical record.

Unflagged historical receipts keep their original behavior. Automatic payoff continues to require exact calculated amounts. Nonnegative amounts, safe integer satang, matching allocations, and principal limits remain enforced.

## Status policy

The owner can set `statusOverride: "normal"` and restore automatic status later. The shared overdue predicate controls badges, overdue filters, and reminder lists. Changing status preserves the original due date and every financial value. The override persists until explicitly restored. It does not move the next due date automatically.

## Validation

- `npm.cmd test -- --no-file-parallelism`: 55 tests across 7 files pass. The generated-history audit compares 180 histories at 9 observation dates against an independent oracle, including owner receipts above calculated interest.
- `npm.cmd run build`: frontend and server builds pass.
- Isolated HTTP tests cover editable receipts, estimated dates, retained originals, stale edits, rollback when an edit invalidates later payments, and reversible normal status with consistent reminders.
- Browser QA uses a separate database on port 4312. A 500-baht interest-only receipt saves while the reference balance is 12.90 baht. Editing it to 200 baht dated October 13 retains the canceled 500-baht original and counts only the replacement. The copied pre-existing 200-baht receipt remains independent, producing 400 baht total received interest. Principal remains 2,000 baht.
- The same copied loan displays normal status with its original October 13 due date. The normal-status screenshot is stored outside the repository. No browser console warnings or errors appear.
- At a 390×844 viewport, the payment form scrolls, keeps its actions visible, and has no document horizontal overflow. The temporary viewport is reset after verification.
- Restarted the live server on port 4310 and verified health. SHA-256 checks of both stored ledger and owner records match before and after restart. A read-only audit of 19 live loans across 13 borrowers matches the independent calculator with zero discrepancies, including forecasts.

The browser writes target disposable copied data only. No test receipts or status changes are applied to the owner's live ledger. Physical iPhone notification delivery is outside this verification.

## Reminder regression found during final inspection

1. Strengthened the HTTP check from “does not contain overdue” to “has no reminders” for a past-due loan overridden to normal. The test fails reliably: the API returns the old loan as `tomorrow`.
2. Source trace reaches `GET /api/reminders`: the filter admits every date at most one day ahead, including past dates. The new classifier no longer calls the normal loan overdue, so its fallback labels it tomorrow. The frontend already filters overridden past loans correctly. No attachable debugger is available in this tool session.
3. Ranked hypotheses: missing server filter, stale frontend state, changed due date. The isolated HTTP test has no browser state, and its response preserves October 13. These observations rule out the latter two. The boundary check must still permit normal loans due today or tomorrow, so filtering every overridden loan would be incorrect.
4. Added the shared overdue predicate to the server's admission filter, preserving today and tomorrow dates. The HTTP regression asserts an empty result for overridden past dates and dates more than one day ahead, plus correct reminders for today and tomorrow. Restoring automatic status brings the overdue reminder back.
