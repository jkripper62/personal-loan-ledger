# Correct an entered rate and due date

Status: resolved
Blocked by: none

The owner reported that the rate form rejected an entry for 0.10 on October 19. The owner clarified that the original rate was entered incorrectly and should be 10%, with a changed payment due date. No replacement live due date has been provided. The feature leaves live records for the owner to edit.

## Experiment ledger

1. The screenshot shows the future-rate form, today's effective date, and the future-cycle rejection. A percent input of 0.10 means 0.10%, while the desired input is 10.
2. Read-only inspection finds two loans for the same borrower. The affected 20,000-baht loan has initial `rateBps: 100`, and an active November 10 scheduled rate of `10`. The 40,000-baht loan already has `rateBps: 1000`. Loan identity must be checked before editing.
3. Deterministic isolated HTTP reproduction accepts a future schedule but rejects today's date. The new initial-correction workflow initially fails with HTTP 404 because no such route exists. The failure is independent of browser state.
4. Source trace: rate modal always submits `/api/rate-changes`, whose guard requires a future cycle boundary. The loan update endpoint permits due dates and notes but has no initial-rate correction. No debugger attachment tool is available, so the HTTP differential and direct source trace supply the fail path.
5. Ranked hypotheses are using the future-change workflow for an input correction, percent-scale confusion, and a disabled button or network failure. Successful HTTP scheduling and the visible server error disprove the button/network hypothesis. The owner explicitly confirms the correction intent. Merely using a valid future date would preserve the wrong initial rate and the already scheduled wrong rate, so changing the date alone is insufficient.
6. Added a correction route with required reason, audited before/after values, and atomic replay. The new ordinary edit form accepts the actual entered rate for either source while preserving the separate creation and future-agreement ceilings. A selected mistaken future rate is retained as canceled, never deleted. Rate cancellation affects the independent oracle, forecasts, balances, and schedule duplicate checks.
7. The formerly failing HTTP reproduction passes. An exact payoff made incompatible by a correction rejects with all prior records unchanged. The full suite passes 58 tests. Canceled scheduled rates no longer alter forecasts, and the same effective date can be scheduled again.
8. Browser validation uses synthetic data on port 4312. On a copied-shape 20,000-baht test loan, entering 10 previews 2,000 baht. Saving with a November 20 example due date and explicit cancellation retains the canceled 0.1% entry, changes the initial rate to 10%, and preserves the November 10 cycle cutoff. The future-rate selector offers real unoccupied cycle dates instead of a free calendar date. The mobile viewport is 390×844 with no horizontal overflow or console warnings/errors. Example dates and records belong only to the disposable test database.
9. The live app on port 4310 loads the updated build and passes health checks. Hashes of the owner and ledger records match before and after restart. The read-only independent calculator audit matches all 20 live loans and their forecasts without discrepancies. The temporary browser viewport is reset, the test tab is closed, and its synthetic database is removed.

## Root cause and prevention

The original specification offered future rate changes and monetary adjustments, but no correction for an incorrectly entered initial rate. Both workflows appeared under a generic rate-change action. The form also accepted arbitrary dates even though its server required exact future cycle boundaries. The rejection worked as designed but left no usable path for the clarified task.

The detail page now separates “แก้ดอก / วันนัด” from “เปลี่ยนอัตรางวดถัดไป”. Percentage examples and a live nominal-interest preview expose scale mistakes before saving. Future dates are chosen from valid boundaries. Tests cover retained audit history and rollback instead of accepting a correction that invalidates later money records.
