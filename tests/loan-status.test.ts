import { expect, it } from "vitest";
import { isLoanOverdue } from "../src/domain/status";
import type { Loan } from "../src/domain/types";

it("normal status suppresses overdue and automatic status restores the due-date comparison", () => {
  const loan: Loan = { id: "loan", borrowerId: "person", source: "existing", principalCents: 200000,
    openingInterestCents: 0, rateBps: 1000, startDate: "2026-10-10", cycleStartDate: "2026-09-13",
    firstCycleEndDate: "2026-10-13", anchorDay: 13, dueDate: "2026-10-13", createdAt: "", notes: "" };
  expect(isLoanOverdue(loan, "2026-10-15")).toBe(true);
  expect(isLoanOverdue({ ...loan, statusOverride: "normal" }, "2026-10-15")).toBe(false);
  expect(isLoanOverdue(loan, "2026-10-13")).toBe(false);
});
