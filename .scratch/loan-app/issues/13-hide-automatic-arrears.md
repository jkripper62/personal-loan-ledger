# Hide automatic arrears and let the owner choose the collected interest

Status: complete
Blocked by: none

The owner requested removal of the outstanding-interest field because they decide whether to charge unpaid interest. This change removes automatic debt amounts from the normal presentation without deleting or forgiving historical records.

Removed the arrears summary card, loan-table column, loan-detail amount, reminder-row amount, contact-template amount, and CSV column. Detail summaries now show principal and actual receipts. Daily interest and month-end forecasts remain reference values. Ordinary receipt forms reference the current cycle's gross interest rather than cumulative arrears and retain owner-entered amounts. The formula payoff remains a separate explicit option with explanatory wording.

Validation:

- Full suite: 61 tests in 8 files pass. The CSV regression also asserts that the removed arrears column is absent. The production build passes.
- Synthetic browser QA at localhost:4312 deliberately creates a loan with a completed unpaid interest cycle. The overview has only three actual-balance/receipt cards and a four-column loan table, with no outstanding-interest field. The detail has no automatic payoff-total summary.
- The contact draft contains no automatic interest amount. The editable message accepts an owner-specified 50-baht example, without copying or sending it. A separate 50-baht interest-only receipt saves successfully in the test database, leaves principal at 10,000, and appears in actual receipt history. No real receipts are created by QA.
- Daily current-cycle earnings remain 774.19 and the full-cycle reference is 1,000 for the synthetic example. This confirms that removing the display does not erase the forecast.
- Desktop and 390×844 screenshots show the removed fields and intact actual receipts. No framework overlay, console warnings, console errors, or mobile horizontal overflow appear. Physical iPhone testing is outside this check.
- No loan balances, opening interest, rates, dates, receipts, or adjustments are changed in the live database by this implementation.
- Restarted the live application on port 4310. Health passes and ledger/owner hashes match before and after deployment. Temporary browser viewport settings are reset, and the QA tab and synthetic database are removed.
