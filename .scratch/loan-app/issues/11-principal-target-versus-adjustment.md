# Principal target mistaken for an adjustment delta

Status: resolved
Blocked by: none

The owner confirmed that the displayed 60,000-baht principal should be 20,000 baht. The affected loan is the new October 19 record, not the same borrower's separate 40,000-baht imported loan.

## Experiment ledger

1. Read-only replay reproduces 60,000 exactly: opening principal 20,000 plus two active principal adjustments of 20,000 each. The first reason is “เปลี่ยนวัน” and the second is “ยอดมันแค่ 20000”. There are no receipts for this loan. The first adjustment also contains 10 baht interest.
2. Trace: the advanced adjustment form passes the entered number directly to `principalDeltaCents`; the ledger adds that delta. Ranked hypotheses were duplicate loan aggregation, a calculation error, and confusing a target balance with a signed adjustment. Calculation filters the exact loan ID, and the independent oracle reproduces the same result. Both alternatives are ruled out. No debugger attachment tool is available, so the exact history and HTTP reproduction establish the path.
3. A new isolated HTTP regression requests a target remaining principal of 20,000. It initially fails with HTTP 400 because the correction endpoint has no target-principal field. Adding another positive 20,000 would increase the balance again, so changing the label alone is insufficient.
4. Added `remainingPrincipalCents` to the correction workflow. The server computes a dated principal-only adjustment from the latest balance, validates the candidate history, and records both balances in the audit. Repeating the target does not add another adjustment. A correction after exact payoff rejects and leaves all entries unchanged.
5. The normal action is now “แก้ต้น / ดอก / วันนัด”. It accepts the final balance and previews current versus target amounts. The old delta form is labeled “เพิ่ม/ลดยอด (ขั้นสูง)” and explains positive and negative inputs.
6. Full suite passes 60 tests in 8 files, and production build passes. The pure-domain regression reproduces 60,000 before correction and 20,000 after correction, unchanged interest adjustment and zero principal receipts. The independent oracle agrees, including the next cycle.
7. Live correction uses the owner's authenticated local app and its existing adjustment API. A private pre-change ledger backup is saved first. One -40,000-baht principal-only adjustment restores 20,000. The 10-baht interest adjustment is preserved because the user requested a principal correction. There is no receipt and no rate or due-date change. Existing entries remain intact.
8. Compared the stored ledger with the private backup: only the new adjustment and audit records differ. Browser proof shows the exact affected loan at principal 20,000 and forecast full-cycle interest 2,000. Isolated browser QA on port 4312 also exercises the new target-balance form from 60,000 to 20,000 with retained history, zero receipts, and no console warnings or errors. Synthetic data is separate from the live ledger.
9. Restarted the live application on port 4310 with the updated build. Health passes and hashes confirm the corrected ledger and owner records survive unchanged. The read-only audit of all 20 loans matches the independent calculator. The temporary test tab and database are removed.

## Root cause and prevention

The form named an additive field “ปรับต้น”, but the owner's task was to set a final balance. The earlier correction page supported rate and due-date errors while omitting remaining principal. The ledger added exactly what was entered. The missing target-balance workflow and ambiguous field label caused the repeated additions.

The normal correction form now accepts the desired result. The server derives the delta once and retains the prior records. Advanced signed adjustments remain available with explicit labels. Tests assert the target, repeat behavior, retained interest, and absence of invented repayments.
