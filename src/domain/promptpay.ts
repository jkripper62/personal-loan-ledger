// Thai QR payment (EMVCo merchant-presented QR) for PromptPay transfers.
const field = (id: string, value: string) => id + String(value.length).padStart(2, "0") + value;

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF), as uppercase hex. */
export function crc16(text: string): string {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(text)) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/** @param id mobile number (0XXXXXXXXX) or 13-digit national ID; @param amountCents 0 leaves the amount to the payer. */
export function promptPayPayload(id: string, amountCents: number): string {
  const account = id.length === 13 ? field("02", id) : field("01", ("0066" + id.slice(1)).padStart(13, "0"));
  const body =
    field("00", "01") +
    field("01", amountCents > 0 ? "12" : "11") +
    field("29", field("00", "A000000677010111") + account) +
    field("58", "TH") +
    field("53", "764") +
    (amountCents > 0 ? field("54", (amountCents / 100).toFixed(2)) : "") +
    "6304";
  return body + crc16(body);
}
