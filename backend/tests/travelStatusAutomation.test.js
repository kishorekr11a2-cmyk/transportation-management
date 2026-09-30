import assert from "node:assert/strict";
import test from "node:test";
import {
    isValidPhoneNumber,
    generateTravelStatusMessage
} from "../services/travelStatusAutomationService.js";

test("Travel Status Automation: isValidPhoneNumber validation rules", () => {
    // Valid phone numbers
    assert.equal(isValidPhoneNumber("9876543210"), true, "Standard 10-digit number is valid");
    assert.equal(isValidPhoneNumber("+919876543210"), true, "+91 format is valid");
    assert.equal(isValidPhoneNumber("91 98765 43210"), true, "Formatted spaces are valid");
    assert.equal(isValidPhoneNumber("09876543210"), true, "11-digit with leading zero is valid");
    assert.equal(isValidPhoneNumber("123456789012345"), true, "15-digit international format is valid");

    // Invalid phone numbers
    assert.equal(isValidPhoneNumber(null), false, "null is invalid");
    assert.equal(isValidPhoneNumber(undefined), false, "undefined is invalid");
    assert.equal(isValidPhoneNumber(""), false, "empty string is invalid");
    assert.equal(isValidPhoneNumber("12345"), false, "Less than 10 digits is invalid");
    assert.equal(isValidPhoneNumber("abcdefghij"), false, "No digits is invalid");
    assert.equal(isValidPhoneNumber("1234567890123456"), false, "More than 15 digits is invalid");
});

test("Travel Status Automation: generateTravelStatusMessage personalization", () => {
    // User with normal name
    const msg1 = generateTravelStatusMessage({ name: "Kishore", userId: "USR1001" });
    assert.ok(msg1.includes("Hello Kishore,"), "Message should greet by name");
    assert.ok(msg1.includes("update your travel status"), "Message should mention updating travel status");

    // User with short name fallback to userId
    const msg2 = generateTravelStatusMessage({ name: "K", userId: "USR1002" });
    assert.ok(msg2.includes("Hello USR1002,"), "Short name (< 3 chars) falls back to userId");

    // User without name or userId fallback to User
    const msg3 = generateTravelStatusMessage({});
    assert.ok(msg3.includes("Hello User,"), "Empty user fallback to User");
});
