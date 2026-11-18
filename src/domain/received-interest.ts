import type { LedgerData, Loan } from "./types.js";
import { isRealLoan } from "./loan-records.js";

export interface ReceivedInterestPerson {
  borrowerId: string;
  name: string;
  nickname: string;
  loanCount: number;
  receivedCents: number;
  monthCents: number;
}

export function receivedInterestByPerson(data: LedgerData, asOf: string): ReceivedInterestPerson[] {
  const loans = new Map<string, Loan>();
  const counts = new Map<string, number>();
  for (const loan of data.loans) {
    if (!isRealLoan(loan)) continue;
    loans.set(loan.id, loan);
    counts.set(loan.borrowerId, (counts.get(loan.borrowerId) ?? 0) + 1);
  }
  const monthStart = asOf.slice(0, 7) + "-01";
  const totals = new Map<string, { receivedCents: number; monthCents: number }>();
  for (const payment of data.payments) {
    const loan = loans.get(payment.loanId);
    if (!loan || payment.canceledAt || payment.date > asOf) continue;
    const current = totals.get(loan.borrowerId) ?? { receivedCents: 0, monthCents: 0 };
    current.receivedCents += payment.interestCents;
    if (payment.date >= monthStart) current.monthCents += payment.interestCents;
    totals.set(loan.borrowerId, current);
  }
  return data.borrowers.filter(person => counts.has(person.id)).map(person => ({
    borrowerId: person.id,
    name: person.name,
    nickname: person.nickname,
    loanCount: counts.get(person.id) ?? 0,
    receivedCents: totals.get(person.id)?.receivedCents ?? 0,
    monthCents: totals.get(person.id)?.monthCents ?? 0,
  })).sort((a, b) => b.receivedCents - a.receivedCents || a.name.localeCompare(b.name, "th"));
}
