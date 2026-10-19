# Separate labels for one borrower's loans

Status: complete
Blocked by: none

The owner wants to distinguish loans by use, such as ตอง (ค่าเหล้า), ตอง (คอนเนคชั่นเอาไปปล่อยต่อ), and ตอง (กู้เอง), while keeping one borrower.

Each loan now has optional `purpose` metadata. A button at the top of the loan detail opens a form that accepts only the parenthetical text, previews the full name, and can clear the label. Loan creation also accepts the label. The API trims and validates 200 characters and audits edits. This workflow does not submit principal, interest, or due-date changes.

The shared `loanDisplayName` formatter appears in loan tables and headings, per-loan interest breakdowns, receipt history, reminders, contact drafts, and CSV exports. Loan search includes the purpose. Borrower cards still group by borrower ID, and financial calculations do not read the purpose.

Validation:

- Full suite: 61 tests in 8 files pass. The new HTTP regression creates two labels for one borrower, edits and clears one label, checks independent labels and unchanged money history, rejects invalid or oversized values, and checks CSV and reminders.
- Production frontend and server builds pass.
- Isolated browser QA at localhost:4312 uses three synthetic loans for one borrower. Setting the blank label to ค่าเหล้า changes only that loan, survives reload, and leaves one borrower with three distinct names. Screenshot evidence shows all three rows. The existing label is prefilled when reopening the form.
- At 390×844 the long connection-purpose label wraps without document overflow. No console warnings or errors appear. The viewport is reset, and the test tab and synthetic database are removed.
- Live port 4310 passes health after restart. Ledger and owner-record hashes match before and after deployment. No live loan labels are assigned by the agent because the examples do not identify which actual contract receives each label.
