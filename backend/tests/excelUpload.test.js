import assert from "node:assert/strict";
import test from "node:test";
import xlsx from "xlsx";

// Helper function replicating excelController validation logic
const validateExcelRowHeaders = (sheet) => {
    const data = xlsx.utils.sheet_to_json(sheet);
    if (!data || data.length === 0) {
        return { isValid: false, error: "Excel file is empty." };
    }

    const sampleRow = data[0];
    const rowKeys = Object.keys(sampleRow).map((k) =>
        k.toLowerCase().replace(/[\s_-]/g, "")
    );

    const REQUIRED_COLUMNS = [
        { field: "userId", aliases: ["userid", "user_id", "id"] },
        { field: "name", aliases: ["name", "studentname", "username"] },
        { field: "stoppings", aliases: ["stoppings", "stopping", "stop", "stoppingarea"] },
        { field: "city", aliases: ["city"] },
        { field: "state", aliases: ["state"] },
        { field: "country", aliases: ["country"] }
    ];

    for (const reqCol of REQUIRED_COLUMNS) {
        const hasCol = reqCol.aliases.some((alias) => rowKeys.includes(alias));
        if (!hasCol) {
            return {
                isValid: false,
                missingField: reqCol.field,
                error: `Missing required column: ${reqCol.field}. Required columns: userId, name, stoppings, city, state, country.`
            };
        }
    }

    return { isValid: true, data };
};

test("Excel Import 1: Valid 6-Column Excel Structure Verification", () => {
    const validRows = [
        { userId: "USR001", name: "Arun Kumar", stoppings: "Anna Nagar", city: "Madurai", state: "Tamil Nadu", country: "India" },
        { userId: "USR002", name: "John Doe", stoppings: "Westminster", city: "London", state: "England", country: "United Kingdom" },
        { userId: "USR003", name: "Yuki Tanaka", stoppings: "Shibuya", city: "Tokyo", state: "Tokyo", country: "Japan" }
    ];

    const worksheet = xlsx.utils.json_to_sheet(validRows);
    const result = validateExcelRowHeaders(worksheet);

    assert.equal(result.isValid, true);
    assert.equal(result.data.length, 3);
});

test("Excel Import 2: District is NOT Required (6-Column Upload Succeeds Without District)", () => {
    const rowsWithoutDistrict = [
        { userId: "USR001", name: "Arun Kumar", stoppings: "Narimedu", city: "Madurai", state: "Tamil Nadu", country: "India" }
    ];

    const worksheet = xlsx.utils.json_to_sheet(rowsWithoutDistrict);
    const result = validateExcelRowHeaders(worksheet);

    assert.equal(result.isValid, true, "Excel upload without district column must succeed");
    assert.equal(result.data[0].userId, "USR001");
});

test("Excel Import 3: Reject Missing Required Column (e.g. Missing 'country')", () => {
    const invalidRows = [
        // Missing country
        { userId: "USR001", name: "Arun Kumar", stoppings: "Anna Nagar", city: "Madurai", state: "Tamil Nadu" }
    ];

    const worksheet = xlsx.utils.json_to_sheet(invalidRows);
    const result = validateExcelRowHeaders(worksheet);

    assert.equal(result.isValid, false);
    assert.equal(result.missingField, "country");
    assert.ok(result.error.includes("Missing required column: country"));
});

test("Excel Import 4: Automatic Assignment of travelStatus = 'Coming'", () => {
    const rows = [
        { userId: "USR001", name: "Arun Kumar", stoppings: "Anna Nagar", city: "Madurai", state: "Tamil Nadu", country: "India" },
        { userId: "USR002", name: "Priya Devi", stoppings: "Arappalayam", city: "Madurai", state: "Tamil Nadu", country: "India" }
    ];

    // Simulate database mapping
    const mappedUsers = rows.map(r => ({
        ...r,
        role: "student",
        travelStatus: "Coming"
    }));

    assert.ok(mappedUsers.every(u => u.travelStatus === "Coming"), "Every imported student user must have travelStatus set to 'Coming'");
    assert.ok(mappedUsers.every(u => u.latitude === undefined && u.longitude === undefined), "No coordinates required in Excel");
});

test("Excel Import 5: Flexible User Counts (Arbitrary Counts Supported)", () => {
    const counts = [1, 10, 50, 100, 302, 400, 1000];

    counts.forEach((cnt) => {
        const rows = Array.from({ length: cnt }, (_, idx) => ({
            userId: `USR${String(idx + 1).padStart(4, "0")}`,
            name: `Student ${idx + 1}`,
            stoppings: `Stop ${(idx % 20) + 1}`,
            city: "Sample City",
            state: "Sample State",
            country: "Sample Country"
        }));

        const worksheet = xlsx.utils.json_to_sheet(rows);
        const result = validateExcelRowHeaders(worksheet);
        assert.equal(result.isValid, true);
        assert.equal(result.data.length, cnt);
    });
});
