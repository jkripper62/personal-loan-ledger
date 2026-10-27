import { expect, it } from "vitest";
import { crc16, promptPayPayload } from "../src/domain/promptpay";

it("uses CRC-16/CCITT-FALSE, matching the standard check value", () => {
  expect(crc16("123456789")).toBe("29B1");
});

it("encodes a mobile number with a fixed amount as a one-time PromptPay QR", () => {
  const payload = promptPayPayload("0812345678", 150000);
  expect(payload.slice(0, -4)).toBe(
    "000201" + // payload format
    "010212" + // dynamic QR: amount fixed for this transfer
    "2937" + "0016A000000677010111" + "01130066812345678" + // PromptPay AID + mobile as 0066 + number without 0
    "5802TH" + "5303764" + // country, Thai baht
    "54071500.00" + // amount
    "6304",
  );
  expect(payload.slice(-4)).toBe(crc16(payload.slice(0, -4)));
});

it("encodes a national ID without an amount as a reusable QR", () => {
  expect(promptPayPayload("1234567890123", 0).slice(0, -4)).toBe(
    "000201" + "010211" + "2937" + "0016A000000677010111" + "02131234567890123" + "5802TH" + "5303764" + "6304",
  );
});
