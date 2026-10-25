# Formula payoff recorded instead of actual received interest

Status: resolved
Blocked by: none

## Summary

The owner confirmed a 4,400-baht final receipt for the 4,000-baht กอฟ loan: 4,000 principal and 400 interest. The old payoff form recorded 4,186.67 instead, substituting calculated interest of 186.67. The new payoff form requires actual interest before confirmation. The live receipt is corrected with retained original history.

## Symptom

The dashboard showed received interest of 386.67. Read-only inspection found one active 186.67-interest payoff on the 4,000 loan and a separate 200-interest receipt on the 2,000 loan. The dashboard correctly added those stored receipts. Its source data did not represent the confirmed cash receipt.

## Root cause

`ModalView.handle` used `submittedBalance.payoffTotalCents` and `payoffInterestCents` for the payoff branch. The earlier owner-entered receipt policy covered ordinary receipts but left payoff amounts under the formula contract. `readPayment` omitted the owner interest flag for every payoff, and `validatePayment` required the calculated interest exactly.

The imported loan starts October 10 within a September 25–October 25 cycle. The stored payoff date is October 24, giving 14 days from opening over the 30-day calendar cycle. The formula produces 400 × 14 / 30 = 186.67. That calculation is a reference value, not the owner's actual 400-baht receipt.

## Fix

Branch `main`, in the commit containing this record: the normal payoff form requires an empty-by-default actual-interest input and previews principal plus that entered amount. The API accepts an explicit owner-payoff mode. The ledger requires full principal, counts only actual interest as received, finalizes accrual, and closes the loan. Formula interest that the owner does not collect is tracked separately as `uncollectedInterestCents`; excess actual interest remains in actual received totals. Historical formula payoffs retain their prior validation.

Editing a payoff preserves `isPayoff` and marks the replacement as owner-entered. The original stays canceled with its reason and a replacement link. No duplicate receipt is counted.

A private guarded correction fixes only the owner-confirmed live payoff: original 4,186.67 / interest 186.67 becomes an active replacement 4,400 / interest 400, keeping the October 24 date. A pre-change ledger backup, cancellation reason, replacement link, and edit audit are retained under ignored `.data/corrections/`. Other loan snapshots are checked unchanged. No rate, principal allocation, due date, opening balance, or other receipt is changed. The corrected loan remains closed. The actual dashboard interest total changes from 386.67 to 600, consisting of 400 plus the separate 200 receipt.

## How it was found

1. Replayed the exact stored history and reproduced the 186.67 loan receipt and 386.67 dashboard aggregate.
2. Ranked hypotheses: the payoff path saved a formula amount, the dashboard reduced an actual 400 receipt, or aggregation combined separate loans incorrectly. The raw stored 186.67 disproves the latter two. The other 200 receipt explains the aggregate exactly.
3. Traced form submission through server parsing to exact-payoff validation. No debugger attachment tool is available, so deterministic source and history traces establish the path.
4. Added owner-payoff reproductions before fixing the implementation. Both the 4,400 actual receipt and a zero-interest agreed closure failed under exact-formula validation. Both now pass.

## Why it slipped through

The prior fix made ordinary receipts owner-entered and tested final principal repayment through that path. The separate payoff form still bypassed those entered amounts and used a calculated total. Existing tests explicitly protected formula payoffs but did not exercise actual interest differing from the formula through the payoff UI. Merely relabeling that form as formula-based did not prevent recording the wrong cash amount.

## Validation

- `npm.cmd test -- --no-file-parallelism`: 64 tests across 8 files pass.
- `npm.cmd run build`: production frontend and server build pass.
- Domain cases verify 4,000 principal, 400 actual interest, closed status, formula earnings 186.67, and excess actual interest 213.33. A separate zero-interest payoff closes without fabricating cash interest.
- Generated-history coverage compares 180 histories at nine dates against the independent oracle, including owner payoffs both above and below calculated interest. Legacy exact payoffs remain covered.
- Isolated HTTP coverage rejects partial-principal owner payoffs and invalid modes, corrects a formula receipt with retained history, verifies CSV allocations, rejects duplicate final receipts, and supports cancellation followed by zero-interest closure.
- Browser QA at localhost:4312 edits the synthetic 4,186.67 payoff to 4,400 and shows 400 received interest. The dashboard then shows 600 with the other 200 receipt. The new payoff button is disabled until actual interest is entered. Entering zero closes the separate synthetic loan without increasing its received interest. No console warnings or errors appear.
- The private live correction compares the updated receipt against the independent oracle, checks every other loan unchanged, and is idempotent. The full read-only live audit matches all 22 loans with zero discrepancies. Live port 4310 passes health after deployment.

Physical iPhone verification is outside this check. The temporary QA tab and database are removed after validation.
