import { expect, it } from "vitest";
import { moveLoanOrder, orderedLoans } from "../src/domain/loan-order";
import type { LedgerData, Loan } from "../src/domain/types";

const loan = (id: string): Loan => ({ id, borrowerId: "x", source: "new", principalCents: 100000,
  openingInterestCents: 0, rateBps: 1000, startDate: "2026-09-01", cycleStartDate: "2026-09-01",
  firstCycleEndDate: "2026-10-01", anchorDay: 1, dueDate: "2026-10-01", notes: "", createdAt: "" });
const data = (): LedgerData => ({ borrowers: [], loans: ["a","b","c","d"].map(loan), payments: [],
  rateChanges: [], adjustments: [], contacts: [], attachments: [], audit: [] });

it("moves one loan before or after another while preserving the underlying financial loan collection", () => {
  const state = data();
  moveLoanOrder(state, "d", "b", "before");
  expect(orderedLoans(state).map(item => item.id)).toEqual(["a","d","b","c"]);
  moveLoanOrder(state, "a", "c", "after");
  expect(orderedLoans(state).map(item => item.id)).toEqual(["d","b","c","a"]);
  expect(state.loans.map(item => item.id)).toEqual(["a","b","c","d"]);
  expect(orderedLoans(JSON.parse(JSON.stringify(state))).map(item => item.id)).toEqual(["d","b","c","a"]);
});
it("preserves new loans added after saving a custom order and rejects invalid moves", () => {
  const state = data();
  moveLoanOrder(state, "c", "a", "before");
  state.loans.push(loan("new"));
  expect(orderedLoans(state).map(item => item.id)).toEqual(["c","a","b","d","new"]);
  expect(() => moveLoanOrder(state,"c","c","before")).toThrow();
  expect(() => moveLoanOrder(state,"missing","a","before")).toThrow();
  expect(() => moveLoanOrder(state,"a","b","sideways" as "before")).toThrow();
});
