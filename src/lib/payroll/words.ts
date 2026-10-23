/**
 * Amounts in words using the Indian numbering system (thousand, lakh, crore).
 * Pure helpers shared by the invoice and payslip documents.
 */
const ONES = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

function belowHundred(n: number): string {
  if (n < 20) return ONES[n];
  const tens = TENS[Math.floor(n / 10)];
  return n % 10 === 0 ? tens : `${tens}-${ONES[n % 10]}`;
}

function belowThousand(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (hundreds > 0) parts.push(`${ONES[hundreds]} hundred`);
  if (rest > 0) parts.push(belowHundred(rest));
  return parts.join(" ");
}

/** Whole number in words, e.g. 513300 → "five lakh thirteen thousand three hundred". */
export function integerInWords(value: number): string {
  let n = Math.floor(Math.abs(value));
  if (n === 0) return "zero";
  const parts: string[] = [];
  const crore = Math.floor(n / 10_000_000);
  if (crore > 0) {
    parts.push(`${integerInWords(crore)} crore`);
    n %= 10_000_000;
  }
  const lakh = Math.floor(n / 100_000);
  if (lakh > 0) {
    parts.push(`${belowHundred(lakh)} lakh`);
    n %= 100_000;
  }
  const thousand = Math.floor(n / 1000);
  if (thousand > 0) {
    parts.push(`${belowHundred(thousand)} thousand`);
    n %= 1000;
  }
  if (n > 0) parts.push(belowThousand(n));
  return parts.join(" ");
}

/** "Rupees five lakh thirteen thousand three hundred and fifty paise only". */
export function rupeesInWords(amount: number): string {
  const safe = Number.isFinite(amount) ? Math.abs(amount) : 0;
  const rupees = Math.floor(safe + 1e-9);
  const paise = Math.round((safe - rupees) * 100);
  const carry = paise === 100;
  const r = carry ? rupees + 1 : rupees;
  const p = carry ? 0 : paise;
  const base = `Rupees ${integerInWords(r)}`;
  return p > 0 ? `${base} and ${integerInWords(p)} paise only` : `${base} only`;
}
