export interface Borrower {
  id: string; name: string; nickname: string; phone: string; lineId: string;
  facebookUrl: string; notes: string; createdAt: string;
}
export interface Loan {
  id: string; borrowerId: string; source: 'new' | 'existing';
  principalCents: number; openingInterestCents: number; rateBps: number;
  startDate: string; cycleStartDate: string; firstCycleEndDate: string;
  anchorDay: number; dueDate: string; notes: string; createdAt: string;
  statusOverride?: "normal";
}
export interface Payment {
  id: string; loanId: string; date: string; totalCents: number;
  principalCents: number; interestCents: number; note: string; createdAt: string;
  canceledAt: string | null; cancelReason: string | null;
  isPayoff: boolean;
  dateEstimated?: boolean;
  interestMode?: "owner";
  replacesPaymentId?: string;
}
export interface RateChange {
  id: string; loanId: string; effectiveDate: string; rateBps: number;
  reason: string; createdAt: string;
}
export interface Adjustment {
  id: string; loanId: string; date: string; principalDeltaCents: number;
  interestDeltaCents: number; reason: string; createdAt: string;
  canceledAt: string | null; cancelReason: string | null;
}
export interface Contact {
  id: string; loanId: string; date: string; channel: 'LINE' | 'Facebook';
  message: string;
}
export interface Attachment {
  id: string; borrowerId: string | null; loanId: string | null;
  paymentId: string | null; name: string; mime: string; size: number; createdAt: string;
}
export interface AuditEntry {
  id: string; at: string; action: string; entityId: string; detail: string;
}
export interface LedgerData {
  borrowers: Borrower[]; loans: Loan[]; payments: Payment[];
  rateChanges: RateChange[]; adjustments: Adjustment[];
  contacts: Contact[]; attachments: Attachment[]; audit: AuditEntry[];
}
export interface InterestPeriod {
  startDate: string; endDate: string; principalCents: number; rateBps: number;
  interestCents: number; days: number; fullDays: number;
}
export interface LedgerSnapshot {
  principalCents: number; interestCents: number; accruedInterestCents: number;
  payoffInterestCents: number; totalCents: number; payoffTotalCents: number;
  principalPaidCents: number; interestPaidCents: number;
  manualInterestDifferenceCents: number;
  currentRateBps: number; currentCycleStartDate: string; currentCycleEndDate: string;
  nextCycleInterestCents: number; periods: InterestPeriod[];
  earnedInterestCents: number;
  cycleInterest: CycleInterest;
  closed: boolean;
}
export interface CycleInterest {
  chargeStartDate: string; endDate: string; accrualEndDate: string; accruing: boolean;
  elapsedDays: number; fullDays: number;
  fullInterestCents: number; earnedInterestCents: number; forecastInterestCents: number;
}
export interface InterestForecast {
  cycle: CycleInterest;
  month: {
    startDate: string; endDate: string; earnedInterestCents: number;
    additionalInterestCents: number; forecastInterestCents: number;
  };
}
