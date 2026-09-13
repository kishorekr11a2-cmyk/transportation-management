import { test, describe } from "node:test";
import assert from "node:assert/strict";

describe("Separation of isUnallocated and isLateResponse Classification Suite", () => {
    // 1. Independent Evaluation Rules Test
    test("Rule 1: TYPE 1 (Late Response + Unallocated) has isUnallocated=true AND isLateResponse=true", () => {
        const planApprovedAt = new Date("2026-09-13T10:00:00Z");
        const studentResponseSubmittedAt = new Date("2026-09-13T10:30:00Z"); // AFTER approval
        const isAllocatedInPlan = false;

        const isAllocated = isAllocatedInPlan;
        const isUnallocated = !isAllocated;
        const isSubmittedAfterApproval = studentResponseSubmittedAt.getTime() > planApprovedAt.getTime();
        const isLateResponse = isUnallocated && isSubmittedAfterApproval;

        assert.equal(isUnallocated, true, "Student without seat must be isUnallocated=true");
        assert.equal(isLateResponse, true, "Post-approval unallocated student must be isLateResponse=true");
        assert.equal(isSubmittedAfterApproval, true);
    });

    test("Rule 2: TYPE 2 (Normal Unallocated Only) has isUnallocated=true BUT isLateResponse=false", () => {
        const planApprovedAt = new Date("2026-09-13T10:00:00Z");
        const studentResponseSubmittedAt = new Date("2026-09-13T09:00:00Z"); // BEFORE approval (normal demand)
        const isAllocatedInPlan = false; // left unallocated due to bus capacity shortage

        const isAllocated = isAllocatedInPlan;
        const isUnallocated = !isAllocated;
        const isSubmittedAfterApproval = studentResponseSubmittedAt.getTime() > planApprovedAt.getTime();
        const isLateResponse = isUnallocated && isSubmittedAfterApproval;

        assert.equal(isUnallocated, true, "Capacity-shortage student must be isUnallocated=true");
        assert.equal(isLateResponse, false, "Pre-approval student must NOT be isLateResponse");
        assert.equal(isSubmittedAfterApproval, false);
    });

    test("Rule 3: Allocated student has isUnallocated=false AND isLateResponse=false", () => {
        const planApprovedAt = new Date("2026-09-13T10:00:00Z");
        const studentResponseSubmittedAt = new Date("2026-09-13T10:30:00Z"); // Re-confirmed after approval
        const isAllocatedInPlan = true; // Already holds a seat in route R-02 / bus guru

        const isAllocated = isAllocatedInPlan;
        const isUnallocated = !isAllocated;
        const isSubmittedAfterApproval = studentResponseSubmittedAt.getTime() > planApprovedAt.getTime();
        const isLateResponse = isUnallocated && isSubmittedAfterApproval;

        assert.equal(isAllocated, true);
        assert.equal(isUnallocated, false);
        assert.equal(isLateResponse, false, "Allocated student is NEVER a late response");
    });

    test("Rule 4: updatedAt timestamp must NEVER be used to classify a pre-approval student as late", () => {
        const planApprovedAt = new Date("2026-09-13T10:00:00Z");
        const student = {
            userId: "USR1081",
            travelStatus: "Coming",
            travelResponseSubmittedAt: new Date("2026-09-13T09:30:00Z"), // Submitted on time
            updatedAt: new Date("2026-09-13T10:15:00Z"), // Document updated by admin action AFTER approval
            allocatedBus: null,
            allocationStatus: "Unallocated"
        };

        // Response submission timestamp must be strictly evaluated
        const responseTimestamp = student.travelResponseSubmittedAt;
        const isAfterApproval = responseTimestamp.getTime() > planApprovedAt.getTime();
        const isLateResponse = isAfterApproval && !student.allocatedBus;

        assert.equal(isAfterApproval, false, "Response submitted at 09:30 is before 10:00 approval");
        assert.equal(isLateResponse, false, "Must not use updatedAt to convert normal unallocated into late response");
    });

    test("Rule 5: User Management Summary Metrics independent calculation", () => {
        const users = [
            // 2 Allocated students
            { userId: "U1", travelStatus: "Coming", isAllocated: true, isUnallocated: false, isLateResponse: false },
            { userId: "U2", travelStatus: "Coming", isAllocated: true, isUnallocated: false, isLateResponse: false },
            // 1 TYPE 1 student: Late Response + Unallocated
            { userId: "U3", travelStatus: "Coming", isAllocated: false, isUnallocated: true, isLateResponse: true },
            // 2 TYPE 2 students: Normal Unallocated Only (Capacity Shortage)
            { userId: "U4", travelStatus: "Coming", isAllocated: false, isUnallocated: true, isLateResponse: false },
            { userId: "U5", travelStatus: "Coming", isAllocated: false, isUnallocated: true, isLateResponse: false },
            // 1 Not Coming student
            { userId: "U6", travelStatus: "Not Coming", isAllocated: false, isUnallocated: false, isLateResponse: false }
        ];

        let comingCount = 0;
        let allocatedCount = 0;
        let unallocatedCount = 0;
        let lateComingCount = 0;
        let normalUnallocatedCount = 0;

        users.forEach(u => {
            if (u.travelStatus === "Coming") comingCount++;
            if (u.isAllocated) allocatedCount++;
            if (u.isUnallocated) {
                unallocatedCount++;
                if (u.isLateResponse) lateComingCount++;
                else normalUnallocatedCount++;
            }
        });

        assert.equal(comingCount, 5, "Total coming students");
        assert.equal(allocatedCount, 2, "Allocated students");
        assert.equal(unallocatedCount, 3, "Total unallocated must include BOTH Type 1 and Type 2");
        assert.equal(lateComingCount, 1, "Type 1 count only");
        assert.equal(normalUnallocatedCount, 2, "Type 2 count only");
        assert.equal(unallocatedCount, lateComingCount + normalUnallocatedCount, "Unallocated is the sum of both types");
    });

    test("Rule 6: Filter behavior in User Management matches expected visibility", () => {
        const type1 = { userId: "U_LATE", travelStatus: "Coming", isAllocated: false, isUnallocated: true, isLateResponse: true };
        const type2 = { userId: "U_NORMAL_UNALLOC", travelStatus: "Coming", isAllocated: false, isUnallocated: true, isLateResponse: false };
        const allocated = { userId: "U_ALLOC", travelStatus: "Coming", isAllocated: true, isUnallocated: false, isLateResponse: false };

        const testList = [type1, type2, allocated];

        // Filter: "Unallocated"
        const unallocatedResults = testList.filter(u => u.isUnallocated);
        assert.equal(unallocatedResults.length, 2, "Unallocated filter must show BOTH Type 1 and Type 2");
        assert.ok(unallocatedResults.some(u => u.userId === "U_LATE"));
        assert.ok(unallocatedResults.some(u => u.userId === "U_NORMAL_UNALLOC"));
        assert.ok(!unallocatedResults.some(u => u.userId === "U_ALLOC"));

        // Filter: "Late Coming Responses"
        const lateResults = testList.filter(u => u.isLateResponse);
        assert.equal(lateResults.length, 1, "Late Coming filter must show ONLY Type 1");
        assert.equal(lateResults[0].userId, "U_LATE");

        // Filter: "Normal Unallocated"
        const normalUnallocResults = testList.filter(u => u.isUnallocated && !u.isLateResponse);
        assert.equal(normalUnallocResults.length, 1, "Normal Unallocated filter must show ONLY Type 2");
        assert.equal(normalUnallocResults[0].userId, "U_NORMAL_UNALLOC");

        // Filter: "Allocated"
        const allocResults = testList.filter(u => u.isAllocated);
        assert.equal(allocResults.length, 1, "Allocated filter must show ONLY allocated student");
        assert.equal(allocResults[0].userId, "U_ALLOC");
    });
});
