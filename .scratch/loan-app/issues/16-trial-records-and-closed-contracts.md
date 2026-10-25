# Separate trial data and closed real contracts

Status: resolved
Blocked by: none

The owner identified the boom contract as practice data and requested removal of its principal repayment from real totals, deletion controls for trial contracts, and a separate category for paid-off real contracts.

## Changes

Added a record classification independent from ledger closure. Real contracts remain the default for old data. Trial and trashed trial records remain inspectable or recoverable but are excluded through one real-account projection from principal, received principal, received interest, cash history, Excel, reminders, and forecast displays. Closed real receipts remain in lifetime received totals, and closed contracts have their own table category. Active real contracts supply dashboard forecast cards.

Creation has a trial checkbox. Existing contracts can be marked trial with reason and audit. Trial contracts have a delete control that moves the entire record and dependent history to a recoverable trash category. Restoration returns to trial without adding real money. Normal mutations reject trashed records. Backups retain all original records and files.

## Verification

69 tests across 9 files passed, including real HTTP integration, real ledger calculations, and a rendered forecast component with a deliberately broader forecast map. Type checks and production build passed. Tests cover closed real receipts retained, all trial receipt/balance effects excluded, CSV/reminders, authenticated mutation, required reason, deletion protection for real records, reversible deletion, retained backup/history, and rollback of attempted edits to trash.

Isolated browser at localhost:4312 used synthetic records. Initial real received principal was 6,000, comprising a 4,000 real closure and a 2,000 practice closure. Marking the practice contract trial changed received principal to 4,000 while received interest stayed 400 and real remaining principal stayed 10,000. A separate 90,000 trial balance never entered totals, forecast cards, or reminders. Trial deletion and restoration worked through their dialogs. History showed only the real 4,400 receipt. Closed category showed only the real closed contract. Creating a new 5,000 trial from the form selected its category and left every real total unchanged. Browser console contained no errors or warnings.

Screenshot outside the repo: `trial-contract-categories.png` in the task visualization directory.

## Confirmed live correction

Read-only inspection identified exactly one boom contract, opening principal 2,000, monthly rate 0.1%, and one 2,000 principal-only payoff dated October 25 with note "ทดลอง". A guarded private script under ignored `.data/corrections/` requires those exact identities/values and makes an atomic transition through trial into trial trash. It saves the original ledger before writing, retains every receipt, checks all other loan/history records unchanged, and verifies owner data unchanged. A repeated run reports already applied without writing.

After applying: real received principal changed from 6,000 to 4,000; real received interest stayed 600; remaining real principal stayed 552,820. The updated app restarted on 4310 and passed health checks. The owner must sign in normally after the session restart. Other user-provided contracts were not classified by guessing from names or amounts.
