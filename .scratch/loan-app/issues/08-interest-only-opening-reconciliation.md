# Interest-only receipt blocked for an imported full installment

Status: resolved
Blocked by: none

Policy update: [09-owner-payments-and-normal-status.md](09-owner-payments-and-normal-status.md) supersedes the interest ceiling for new ordinary receipts. The confirmed opening adjustment remains part of the historical record. This document describes the earlier rejection and its original fix.

User reported a 200-baht interest-only receipt on October 13 could not be saved. Confirmed it belongs to the 2,000-baht loan and covers the full installment ending October 13, rather than future interest. Do not save the owner's pending receipt automatically.

## Experiment ledger

1. Read the live ledger without changing it: affected loan starts October 10, calendar cycle September 13–October 13, opening interest zero, monthly interest 200 baht, no posted receipts. `calculateLedger` yields 20 baht payable on October 13; `validatePayment` rejects the 200-baht receipt reliably.
2. Trace: payment form → same-origin API → chronological replay → `validatePayment` excess-interest check. No debugger hook was available for this pure-domain reproduction; direct source and test trace reaches the exact rejection. UI receives the error normally; the parent rethrows errors rather than swallowing them.
3. Ranked hypotheses: missing historical cycle interest; wrong loan among same-name loans; mismatched allocations; button/network failure. Owner confirmed loan identity. Allocation is 200 = 0 + 200. The pure validator reproduces the rejection without a network.
4. Falsification: identical receipt at 20 baht passes; at 200 baht with no correction fails; with a documented 180-baht historical interest adjustment it passes. Principal stays 2,000 and the next cycle stays 200. Excess receipts remain rejected. API replay prevents canceling the adjustment after a dependent receipt.
5. Real correction: private idempotent transaction adds only the owner's confirmed 180-baht opening interest adjustment and audit entry, with pre-change ledger backup. It does not change loan principal, rate, other loans, authentication, or create a receipt. Details and backup remain in ignored `.data/corrections/`.
6. UI reproduction: the first proposed placement immediately before the sticky footer still left the excess-interest message covered by that footer. Move the error inside the sticky footer with a full-width row; show the selected loan and payable-interest amount before submission. Add a numeric explanation before calling the API when entered interest exceeds the selected date's balance.
7. Regression checks: pure-domain example and isolated HTTP workflow pass. Full suite: 46 tests in 5 files; production build/type check passes. Browser validation uses a separate database and owner on port 4312.

## Post-mortem

### Summary

A full historical interest installment could not be recorded because the imported opening balance omitted the interest earned before the recording date. The owner confirmed the full installment. Reconcile the missing historical interest through a dated adjustment, retaining the original import, and show the payable amount and visible rejection reason in the payment form.

### Root cause

`calculateLedger` correctly starts an imported loan's new accrual at `loan.startDate`. For a 2,000-baht loan at 10% monthly, the calendar cycle September 13–October 13 has 30 days. The October 10 opening date leaves three chargeable days, producing 20 baht. The imported `openingInterestCents: 0` omitted the preceding 180 baht that the owner later confirmed belongs to this full installment. `validatePayment` therefore rejected 200 baht as excess interest. Correct arithmetic alone did not validate whether the imported opening information represented the owner's intended installment.

`ModalView.handle` catches the rejection, but its original message lived in the scrolling body. During UI verification, moving it immediately before the footer still produced a 69-pixel alert rectangle overlapped by the sticky footer. The final placement inside that footer prevents the concealment. The parent `submit` callback rethrows API errors correctly; swallowing was ruled out.

### Fix

Commit `2432efc` on `main`: `src/components/modal.tsx` displays the selected loan, payment-date interest allowance, and a numeric excess-interest explanation. Errors now belong to a full-width row inside the sticky footer; `src/styles.css` wraps footer content so the message stays above its buttons.

The owner-confirmed live-data correction adds one interest-only adjustment at the opening date, with audit reason and a pre-change ledger backup. A private guarded transaction validates the pending receipt and unchanged principal before committing. A deterministic adjustment ID prevents reapplication. No live receipt was created by the agent, and no other loan was changed. No blanket overpayment exception was introduced.

### Why it slipped through

The initial import treated zero overdue interest as a complete opening-interest value. The previous arithmetic audit proved consistency with those stored inputs, but did not reconcile them against an actual full installment receipt. UI checks also did not exercise an excess-interest error while the body was scrolled under the sticky footer.

### Validation

`tests/opening-interest-payment.test.ts` proves the 20-baht uncorrected balance, rejection of an unsupported 200-baht payment, acceptance after the confirmed correction, unchanged principal, and unchanged next-cycle interest. The HTTP regression proves receipt creation, excess-repeat rejection, and chronological rejection of canceling a correction required by a later receipt. All 46 tests across five suites passed; production build/type check passed.

In-app browser, isolated port 4312: enter October 13, total 201, principal 0, interest 201 → visible numeric alert inside the footer. Alert geometry is within the footer on desktop and a 390×844 viewport; no document horizontal overflow. Then total 200, principal 0, interest 200 → modal closes, success notice appears, receipt history shows exactly 200 interest and 0 principal, and remaining principal is 2,000. No console warnings/errors. Owner's live receipt remains for the owner to submit; the browser test database is separate. Physical iPhone testing is outside this verification.

Follow-up: other imported borrowers require their own confirmed opening-interest reconciliation before treating a full historical installment as payable; this correction is intentionally specific to the confirmed loan.
