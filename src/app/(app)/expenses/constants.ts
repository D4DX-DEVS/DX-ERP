/** How the expense was paid at the time (informational). */
export const EXPENSE_PAYMENT_MODES = ["Cash", "UPI", "Card", "Bank transfer", "Company card", "Other"] as const;

/** How a reimbursement / company payment is recorded by Finance. */
export const EXPENSE_PAY_METHODS = ["Bank transfer", "UPI", "Cheque", "Cash", "Other"] as const;

export const EXPENSE_TYPE_LABEL = { reimbursable: "Claim", company: "Company paid" } as const;
