import assert from "node:assert/strict";
import test from "node:test";
import xlsx from "xlsx";
import User from "../models/User.js";

// Helper replicating getFieldValue alias & phone logic from excelController.js
const getFieldValue = (row, ...keys) => {
    for (const key of keys) {
        if (row[key] !== undefined && row[key] !== null) {
            return row[key].toString().trim();
        }
        const lowerKey = key.toLowerCase().replace(/[\s_-]/g, "");
        const matched = Object.keys(row).find(
            (k) => k.toLowerCase().replace(/[\s_-]/g, "") === lowerKey
        );
        if (matched && row[matched] !== undefined && row[matched] !== null) {
            return row[matched].toString().trim();
        }
    }
    return "";
};

// Helper replicating REQUIRED_COLUMNS validation from excelController.js
const validateColumns = (sampleRow) => {
    const rowKeys = Object.keys(sampleRow).map((k) =>
        k.toLowerCase().replace(/[\s_-]/g, "")
    );

    const REQUIRED_COLUMNS = [
        { field: "userId", aliases: ["userid", "user_id", "id", "user id"] },
        { field: "name", aliases: ["name", "studentname", "username", "student name", "user name"] },
        { field: "stoppings", aliases: ["stoppings", "stopping", "stop", "stoppingarea", "stopping area"] }
    ];

    for (const reqCol of REQUIRED_COLUMNS) {
        const hasCol = reqCol.aliases.some((alias) => rowKeys.includes(alias.toLowerCase().replace(/[\s_-]/g, "")));
        if (!hasCol) {
            return { isValid: false, missing: reqCol.field };
        }
    }
    return { isValid: true };
};

test("Phone Number 1: User Schema includes optional phoneNumber with null default and trim", () => {
    const userWithoutPhone = new User({
        userId: "USR_TEST_01",
        name: "Test Student Without Phone"
    });

    assert.equal(userWithoutPhone.phoneNumber, null, "Default phoneNumber must be null");

    const userWithPhone = new User({
        userId: "USR_TEST_02",
        name: "Test Student With Phone",
        phoneNumber: "  +919876543210  "
    });

    assert.equal(userWithPhone.phoneNumber, "+919876543210", "phoneNumber must be trimmed and stored as string");
});

test("Phone Number 2: Excel Import with optional Phone Number column extracts phoneNumber", () => {
    const rowsWithPhone = [
        {
            userId: "USR1001",
            name: "Arun Kumar",
            stoppings: "Anna Nagar",
            "Phone Number": " 9876543210 "
        }
    ];

    const row = rowsWithPhone[0];
    const rawPhone = getFieldValue(row, "phoneNumber", "phone_number", "phone", "phoneno", "phonenumber", "mobile", "mobilenumber", "contact", "contactnumber", "phone number", "mobile number");
    const phoneNumber = rawPhone ? rawPhone.trim() : null;

    assert.equal(phoneNumber, "9876543210", "Excel Phone Number must be extracted and trimmed");
});

test("Phone Number 3: Excel Import without Phone Number column leaves phoneNumber null", () => {
    const rowsWithoutPhone = [
        {
            userId: "USR1002",
            name: "Priya Devi",
            stoppings: "Arappalayam"
        }
    ];

    const row = rowsWithoutPhone[0];
    const rawPhone = getFieldValue(row, "phoneNumber", "phone_number", "phone", "phoneno", "phonenumber", "mobile", "mobilenumber", "contact", "contactnumber", "phone number", "mobile number");
    const phoneNumber = rawPhone ? rawPhone.trim() : null;

    assert.equal(phoneNumber, null, "When Phone Number is absent from Excel, phoneNumber must be null");
});

test("Phone Number 4: Excel Import preserves existing phoneNumber when row has no phone", () => {
    const existing = { userId: "USR1003", phoneNumber: "9123456780" };
    const row = {
        userId: "USR1003",
        name: "Karthik Raj",
        stoppings: "Simmakkal"
    };

    const rawPhone = getFieldValue(row, "phoneNumber", "phone_number", "phone", "phoneno", "phonenumber", "mobile", "mobilenumber", "contact", "contactnumber", "phone number", "mobile number");
    const rowPhone = rawPhone ? rawPhone.trim() : null;
    const finalPhone = rowPhone !== null ? rowPhone : (existing?.phoneNumber || null);

    assert.equal(finalPhone, "9123456780", "Existing user's phoneNumber must NOT be wiped by Excel without phone column");
});

test("Phone Number 5: Excel Import updates phoneNumber when row provides a new phone", () => {
    const existing = { userId: "USR1004", phoneNumber: "9123456780" };
    const row = {
        userId: "USR1004",
        name: "Karthik Raj",
        stoppings: "Simmakkal",
        "Mobile": "9988776655"
    };

    const rawPhone = getFieldValue(row, "phoneNumber", "phone_number", "phone", "phoneno", "phonenumber", "mobile", "mobilenumber", "contact", "contactnumber", "phone number", "mobile number");
    const rowPhone = rawPhone ? rawPhone.trim() : null;
    const finalPhone = rowPhone !== null ? rowPhone : (existing?.phoneNumber || null);

    assert.equal(finalPhone, "9988776655", "User's phoneNumber must be updated when Excel provides a new phone number");
});

test("Excel 5-Column Dataset: Validates User ID, Name, Phone Number, Stopping Area, Travel Status without Email, City, or State", () => {
    const exampleExcelRow = {
        "User ID": "USR1001",
        "Name": "Kishore Kumar",
        "Phone Number": "9876543210",
        "Stopping Area": "Anna Nagar",
        "Travel Status": "Pending"
    };

    const validation = validateColumns(exampleExcelRow);
    assert.equal(validation.isValid, true, "5-column format must pass validation without Email, City, or State");

    const userId = getFieldValue(exampleExcelRow, "userId", "user_id", "id", "user id");
    const name = getFieldValue(exampleExcelRow, "name", "studentName", "userName", "student name", "user name");
    const stoppings = getFieldValue(exampleExcelRow, "stoppings", "stopping", "stop", "stoppingArea", "stopping area");
    const rawPhone = getFieldValue(exampleExcelRow, "phoneNumber", "phone_number", "phone", "phoneno", "phonenumber", "mobile", "mobilenumber", "contact", "contactnumber", "phone number", "mobile number");
    const phoneNumber = rawPhone ? rawPhone.trim() : null;

    const rawStatus = getFieldValue(exampleExcelRow, "travelStatus", "travel_status", "status", "travel status");
    let travelStatus = "Coming";
    if (rawStatus) {
        const s = rawStatus.toLowerCase().trim();
        if (s === "pending") travelStatus = "Pending";
        else if (s === "not coming" || s === "notcoming" || s === "not_coming") travelStatus = "Not Coming";
        else if (s === "coming") travelStatus = "Coming";
    }

    assert.equal(userId, "USR1001");
    assert.equal(name, "Kishore Kumar");
    assert.equal(stoppings, "Anna Nagar");
    assert.equal(phoneNumber, "9876543210");
    assert.equal(travelStatus, "Pending");
});

test("Excel 4-Column Dataset: Validates without Phone Number and accepts empty phone number", () => {
    const rowWithoutPhone = {
        "User ID": "USR1002",
        "Name": "Priya Devi",
        "Stopping Area": "Arappalayam",
        "Travel Status": "Coming"
    };

    const validation = validateColumns(rowWithoutPhone);
    assert.equal(validation.isValid, true);

    const rawPhone = getFieldValue(rowWithoutPhone, "phoneNumber", "phone_number", "phone", "phoneno", "phonenumber", "mobile", "mobilenumber", "contact", "contactnumber", "phone number", "mobile number");
    assert.equal(rawPhone ? rawPhone.trim() : null, null, "Phone number is optional and defaults to null");
});

test("Excel Import: Rejects rows missing required stopping area", () => {
    const missingStop = {
        "User ID": "USR1003",
        "Name": "Bad Student",
        "Phone Number": "9999999999"
    };

    const validation = validateColumns(missingStop);
    assert.equal(validation.isValid, false, "Must reject row missing Stopping Area");
    assert.equal(validation.missing, "stoppings");
});
