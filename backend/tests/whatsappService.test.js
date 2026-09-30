import assert from "node:assert/strict";
import test from "node:test";
import { normalizePhoneNumber, formatWhatsAppJid } from "../whatsapp/whatsappService.js";

test("WhatsApp Normalization 1: Correctly normalizes 10-digit Indian phone number", () => {
  const result = normalizePhoneNumber("8903368790");
  assert.equal(result, "918903368790", "Must prepend 91 to 10-digit Indian number");
  assert.equal(formatWhatsAppJid("8903368790"), "918903368790@s.whatsapp.net");
});

test("WhatsApp Normalization 2: Does not double append 91 if number already has 91 prefix", () => {
  const result = normalizePhoneNumber("918903368790");
  assert.equal(result, "918903368790", "Must keep 918903368790 as is");
  assert.equal(formatWhatsAppJid("918903368790"), "918903368790@s.whatsapp.net");
});

test("WhatsApp Normalization 3: Handles +91 format with spaces or dashes", () => {
  assert.equal(normalizePhoneNumber("+91 89033 68790"), "918903368790");
  assert.equal(normalizePhoneNumber("+91-89033-68790"), "918903368790");
  assert.equal(normalizePhoneNumber("+918903368790"), "918903368790");
});

test("WhatsApp Normalization 4: Handles 11-digit number with leading zero", () => {
  assert.equal(normalizePhoneNumber("08903368790"), "918903368790", "Leading 0 should be replaced with 91");
});

test("WhatsApp Normalization 5: Handles already formatted WhatsApp JID", () => {
  assert.equal(normalizePhoneNumber("918903368790@s.whatsapp.net"), "918903368790");
  assert.equal(formatWhatsAppJid("918903368790@s.whatsapp.net"), "918903368790@s.whatsapp.net");
});

test("WhatsApp Normalization 6: Rejects invalid or null phone numbers", () => {
  assert.equal(normalizePhoneNumber(null), null);
  assert.equal(normalizePhoneNumber(""), null);
  assert.equal(normalizePhoneNumber("12345"), null, "Too short should return null");
  assert.equal(formatWhatsAppJid("abc"), null);
});
