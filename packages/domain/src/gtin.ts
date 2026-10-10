/** GS1 check digit for GTIN-8, UPC-A (12), EAN-13 and GTIN-14. */
export function validGtin(value: string): boolean {
  if (!/^\d+$/.test(value) || ![8, 12, 13, 14].includes(value.length)) return false;
  const digits = [...value].map(Number);
  const check = digits.pop() as number;
  let sum = 0;
  for (let index = digits.length - 1, position = 0; index >= 0; index -= 1, position += 1) {
    sum += (digits[index] as number) * (position % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10 === check;
}

/**
 * A store's barcode (UPC, EAN or GTIN) as one 14-digit GTIN, so the same item
 * reads the same at every store: UPC 196214106614 and EAN 0196214106614 are
 * both 00196214106614. Anything without a valid check digit is "".
 */
export function normalizeGtin(value: unknown): string {
  const digits = String(value ?? "").replace(/[\s-]/g, "");
  if (!validGtin(digits)) return "";
  const gtin = digits.padStart(14, "0");
  // All zeros past the padding is no barcode at all.
  return /^0+$/.test(gtin.slice(0, 13)) ? "" : gtin;
}
