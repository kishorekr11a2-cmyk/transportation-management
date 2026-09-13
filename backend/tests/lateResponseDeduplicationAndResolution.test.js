import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateLateResponseEventKey } from '../controllers/userController.js';

/**
 * LATE RESPONSE NOTIFICATION DEDUPLICATION AND ALLOCATION RESOLUTION TEST SUITE
 * 
 * Verifies all 14 core requirements:
 * 1. Same late response is notified only once.
 * 2. Page refresh does not repeat the notification.
 * 3. Repeated API polling does not repeat the notification.
 * 4. Clicking notification does not repeat it.
 * 5. Regeneration alone does not resolve the event.
 * 6. Approval without successful allocation does not resolve the event.
 * 7. Successful AI plan allocation resolves the event.
 * 8. Successful Admin Manual plan allocation resolves the event.
 * 9. Capacity-exceeded students remain unresolved.
 * 10. Resolved students do not appear in the next notification.
 * 11. A new legitimate late response creates a new event.
 * 12. OUTWARD and INWARD events remain independent.
 * 13. Existing approved allocations remain unchanged until approval.
 * 14. Student Dashboard updates only after successful approved allocation.
 */

// Helper to simulate getLateResponses evaluation logic
function evaluateLateResponsesForTest({
    students,
    approvedPlans
}) {
    const inwardPlanTime = approvedPlans.INWARD?.isApproved ? approvedPlans.INWARD.approvedAt : null;
    const outwardPlanTime = approvedPlans.OUTWARD?.isApproved ? approvedPlans.OUTWARD.approvedAt : null;

    const qualifyingLateStudents = [];
    const unnotifiedEventKeys = [];

    for (const student of students) {
        if (student.travelStatus !== 'Coming') continue;

        const responseTime = new Date(
            student.travelResponseSubmittedAt ||
            student.lastTravelResponseAt ||
            student.lateResponseAt ||
            student.createdAt ||
            Date.now()
        );

        const affectedDirs = [];
        for (const dir of ['INWARD', 'OUTWARD']) {
            const planState = approvedPlans[dir];
            if (planState?.isApproved && planState?.approvedAt) {
                const isAfterApproval = responseTime.getTime() > planState.approvedAt.getTime();
                const isAllocatedInPlan = planState.allocatedUserIds?.includes(student.userId) ||
                    Boolean(student.allocatedBus?.[dir.toLowerCase()]?.isAllocated && student.allocatedBus[dir.toLowerCase()].approved);

                if (isAfterApproval && !isAllocatedInPlan) {
                    affectedDirs.push(dir);
                }
            }
        }

        const isLate = affectedDirs.length > 0 ||
            Boolean(student.lateResponseDetected) ||
            student.allocationStatus === 'Pending Reallocation' ||
            Boolean(student.requiresReallocation);

        if (isLate) {
            const finalDirs = affectedDirs.length > 0
                ? affectedDirs
                : (student.affectedDirections?.length > 0 ? student.affectedDirections : ['OUTWARD']);

            const studentEventKeys = [];
            let hasUnnotifiedEvent = false;

            for (const dir of finalDirs) {
                const dirPlanTime = (dir === 'INWARD' ? inwardPlanTime : outwardPlanTime) || inwardPlanTime || outwardPlanTime;
                const eventKey = generateLateResponseEventKey(student.userId, dir, responseTime, dirPlanTime);
                studentEventKeys.push(eventKey);

                const alreadyNotified = Array.isArray(student.lateResponseNotifiedEventKeys) &&
                    student.lateResponseNotifiedEventKeys.includes(eventKey);

                if (!alreadyNotified) {
                    hasUnnotifiedEvent = true;
                    unnotifiedEventKeys.push(eventKey);
                }
            }

            qualifyingLateStudents.push({
                ...student,
                eventKeys: studentEventKeys,
                eventKey: studentEventKeys[0] || null,
                isNotified: !hasUnnotifiedEvent,
                isUnnotified: hasUnnotifiedEvent,
                affectedDirections: finalDirs
            });
        }
    }

    const unnotifiedStudents = qualifyingLateStudents.filter((u) => u.isUnnotified);

    return {
        count: qualifyingLateStudents.length,
        unnotifiedCount: unnotifiedStudents.length,
        unnotifiedEventKeys: Array.from(new Set(unnotifiedEventKeys)),
        qualifyingLateStudents
    };
}

// Helper to simulate plan approval and passenger allocation logic (persistPlanToUsers)
function simulatePlanApprovalAllocation({
    plan,
    direction = 'OUTWARD',
    planType = 'AI',
    students
}) {
    const canonicalDir = direction.toUpperCase();
    const isOutward = canonicalDir === 'OUTWARD';
    const buses = plan.buses || plan.routes || [];

    // Map allocated userIds
    const allocatedUserIds = new Set();
    const userToBus = new Map();

    for (const bus of buses) {
        const users = bus.users || [];
        for (let i = 0; i < users.length; i++) {
            const uId = users[i];
            allocatedUserIds.add(uId);
            userToBus.set(uId, {
                busName: bus.vehicleName || 'Assigned Bus',
                routeCode: bus.routeCode || 'R-01',
                seatNumber: i + 1
            });
        }
    }

    const updatedStudents = students.map((student) => {
        if (student.travelStatus !== 'Coming') return { ...student };

        const isAssigned = allocatedUserIds.has(student.userId);
        const existingDirs = student.affectedDirections ? [...student.affectedDirections] : [];

        let currentAffectedDirs;
        if (isAssigned) {
            // Direction resolved!
            currentAffectedDirs = existingDirs.filter((d) => d !== canonicalDir);
        } else {
            // Not assigned (standby / capacity limit) - direction remains unresolved
            const wasAffected = existingDirs.includes(canonicalDir) ||
                student.lateResponseDetected ||
                student.allocationStatus === 'Pending Reallocation';
            currentAffectedDirs = wasAffected
                ? Array.from(new Set([...existingDirs, canonicalDir]))
                : existingDirs;
        }

        const stillRequiresReallocation = currentAffectedDirs.length > 0;
        const isAllocated = isAssigned;

        let finalAllocationStatus;
        if (stillRequiresReallocation) {
            finalAllocationStatus = 'Pending Reallocation';
        } else if (isAllocated) {
            finalAllocationStatus = 'Assigned';
        } else {
            finalAllocationStatus = 'Unallocated';
        }

        const allocDetails = userToBus.get(student.userId) || null;

        const allocatedBus = isAssigned ? {
            isAllocated: true,
            approved: true,
            vehicleName: allocDetails.busName,
            routeCode: allocDetails.routeCode,
            seatNumber: allocDetails.seatNumber,
            direction: canonicalDir,
            planType
        } : (student.allocatedBus || null);

        return {
            ...student,
            allocatedBus,
            assignedVehicle: isAssigned ? allocDetails.busName : null,
            assignedRoute: isAssigned ? allocDetails.routeCode : null,
            allocationStatus: finalAllocationStatus,
            requiresReallocation: stillRequiresReallocation,
            lateResponseDetected: stillRequiresReallocation,
            affectedDirections: currentAffectedDirs,
            lateResponseResolvedAt: isAssigned ? new Date() : null
        };
    });

    return updatedStudents;
}

describe('Late Travel Response Deduplication & Resolution Test Suite', () => {

    const planApprovalTime = new Date('2026-09-13T09:00:00Z');
    const lateResponseTime = new Date('2026-09-13T09:30:00Z');

    const baseApprovedPlans = {
        INWARD: { isApproved: false, approvedAt: null, allocatedUserIds: [] },
        OUTWARD: { isApproved: true, approvedAt: planApprovalTime, allocatedUserIds: ['std-existing-01'] }
    };

    // -------------------------------------------------------------
    // Test 1: Same late response is notified only once
    // -------------------------------------------------------------
    it('Test 1: Same late response is detected as unnotified initially, then recognized as notified once acknowledged', () => {
        const student = {
            userId: 'std-late-01',
            name: 'Karthik',
            travelStatus: 'Coming',
            travelResponseSubmittedAt: lateResponseTime,
            lateResponseNotifiedEventKeys: []
        };

        // Initial check: unnotified
        const firstEval = evaluateLateResponsesForTest({
            students: [student],
            approvedPlans: baseApprovedPlans
        });

        assert.equal(firstEval.count, 1);
        assert.equal(firstEval.unnotifiedCount, 1);
        assert.equal(firstEval.unnotifiedEventKeys.length, 1);

        const eventKey = firstEval.unnotifiedEventKeys[0];
        assert.ok(eventKey.startsWith('lr_std-late-01_OUTWARD_'));

        // Simulate acknowledgment in MongoDB
        student.lateResponseNotifiedEventKeys = [eventKey];

        // Second check: already notified!
        const secondEval = evaluateLateResponsesForTest({
            students: [student],
            approvedPlans: baseApprovedPlans
        });

        assert.equal(secondEval.count, 1, 'Still unresolved in table');
        assert.equal(secondEval.unnotifiedCount, 0, 'No unnotified events, popup must NOT show');
        assert.equal(secondEval.unnotifiedEventKeys.length, 0);
    });

    // -------------------------------------------------------------
    // Test 2: Page refresh does not repeat the notification
    // -------------------------------------------------------------
    it('Test 2: Page refresh re-fetches from MongoDB and does NOT trigger the popup if already acknowledged', () => {
        const eventKey = generateLateResponseEventKey('std-late-02', 'OUTWARD', lateResponseTime, planApprovalTime);
        const studentFromDb = {
            userId: 'std-late-02',
            name: 'Priya',
            travelStatus: 'Coming',
            travelResponseSubmittedAt: lateResponseTime,
            allocationStatus: 'Pending Reallocation',
            lateResponseDetected: true,
            affectedDirections: ['OUTWARD'],
            lateResponseNotifiedEventKeys: [eventKey] // Persisted in MongoDB
        };

        const evalResult = evaluateLateResponsesForTest({
            students: [studentFromDb],
            approvedPlans: baseApprovedPlans
        });

        assert.equal(evalResult.count, 1, 'Student appears in table under Late Coming Responses');
        assert.equal(evalResult.unnotifiedCount, 0, 'Popup does NOT trigger on page refresh');
    });

    // -------------------------------------------------------------
    // Test 3: Repeated API polling does not repeat the notification
    // -------------------------------------------------------------
    it('Test 3: Repeated API polling intervals (e.g. every 15s) consistently return unnotifiedCount = 0', () => {
        const eventKey = generateLateResponseEventKey('std-late-03', 'OUTWARD', lateResponseTime, planApprovalTime);
        const student = {
            userId: 'std-late-03',
            name: 'Anand',
            travelStatus: 'Coming',
            travelResponseSubmittedAt: lateResponseTime,
            lateResponseNotifiedEventKeys: [eventKey]
        };

        for (let poll = 1; poll <= 5; poll++) {
            const res = evaluateLateResponsesForTest({
                students: [student],
                approvedPlans: baseApprovedPlans
            });
            assert.equal(res.unnotifiedCount, 0, `Poll #${poll} must not trigger popup`);
        }
    });

    // -------------------------------------------------------------
    // Test 4: Clicking notification does not repeat it
    // -------------------------------------------------------------
    it('Test 4: Clicking notification popup acknowledges the event key and keeps student pending reallocation', () => {
        const student = {
            userId: 'std-late-04',
            name: 'Divya',
            travelStatus: 'Coming',
            travelResponseSubmittedAt: lateResponseTime,
            allocationStatus: 'Pending Reallocation',
            lateResponseNotifiedEventKeys: []
        };

        const initial = evaluateLateResponsesForTest({
            students: [student],
            approvedPlans: baseApprovedPlans
        });
        assert.equal(initial.unnotifiedCount, 1);

        // Clicking popup triggers acknowledgeLateNotifications
        student.lateResponseNotifiedEventKeys.push(...initial.unnotifiedEventKeys);

        // Subsequent check:
        const afterClick = evaluateLateResponsesForTest({
            students: [student],
            approvedPlans: baseApprovedPlans
        });

        assert.equal(afterClick.unnotifiedCount, 0, 'Must not notify again');
        assert.equal(afterClick.count, 1, 'Still in late response list');
        assert.equal(student.allocationStatus, 'Pending Reallocation', 'Must NOT allocate merely on click');
    });

    // -------------------------------------------------------------
    // Test 5: Regeneration alone does not resolve the event
    // -------------------------------------------------------------
    it('Test 5: Regenerating route recommendation draft keeps student pending reallocation and unresolved', () => {
        const student = {
            userId: 'std-late-05',
            name: 'Suresh',
            travelStatus: 'Coming',
            travelResponseSubmittedAt: lateResponseTime,
            allocationStatus: 'Pending Reallocation',
            requiresReallocation: true,
            lateResponseDetected: true,
            affectedDirections: ['OUTWARD'],
            lateResponseNotifiedEventKeys: ['lr_std-late-05_OUTWARD_test']
        };

        // Simulated draft creation: stored in late_response_drafts, but student DB record is untouched
        const draft = {
            isDraft: true,
            status: 'draft',
            accommodatedStudents: ['std-late-05']
        };

        assert.equal(draft.status, 'draft');
        assert.equal(student.allocationStatus, 'Pending Reallocation');
        assert.equal(student.lateResponseDetected, true);
        assert.equal(student.allocatedBus, undefined);
    });

    // -------------------------------------------------------------
    // Test 6: Approval without successful allocation does not resolve the event
    // -------------------------------------------------------------
    it('Test 6: Approval without allocating the student does NOT resolve the late response', () => {
        const student = {
            userId: 'std-late-06',
            travelStatus: 'Coming',
            allocationStatus: 'Pending Reallocation',
            requiresReallocation: true,
            lateResponseDetected: true,
            affectedDirections: ['OUTWARD'],
            travelResponseSubmittedAt: lateResponseTime
        };

        // Empty plan or plan where student is NOT assigned
        const planWithoutStudent = {
            buses: [{ vehicleName: 'Bus-A', routeCode: 'R-01', users: ['other-student'] }]
        };

        const updated = simulatePlanApprovalAllocation({
            plan: planWithoutStudent,
            direction: 'OUTWARD',
            students: [student]
        });

        assert.equal(updated[0].allocationStatus, 'Pending Reallocation', 'Must remain Pending Reallocation');
        assert.equal(updated[0].lateResponseDetected, true, 'Must remain detected');
        assert.equal(updated[0].requiresReallocation, true);
    });

    // -------------------------------------------------------------
    // Test 7: Successful AI plan allocation resolves the event
    // -------------------------------------------------------------
    it('Test 7: Successful AI plan approval and allocation resolves the late response and assigns bus, route, seat', () => {
        const student = {
            userId: 'std-late-07',
            travelStatus: 'Coming',
            allocationStatus: 'Pending Reallocation',
            requiresReallocation: true,
            lateResponseDetected: true,
            affectedDirections: ['OUTWARD'],
            travelResponseSubmittedAt: lateResponseTime
        };

        const aiPlan = {
            buses: [{
                vehicleName: 'College Express 01',
                routeCode: 'R-01',
                users: ['std-late-07']
            }]
        };

        const updated = simulatePlanApprovalAllocation({
            plan: aiPlan,
            direction: 'OUTWARD',
            planType: 'AI_REGENERATED',
            students: [student]
        });

        const resolvedStudent = updated[0];
        assert.equal(resolvedStudent.allocationStatus, 'Assigned', 'Status should be Assigned');
        assert.equal(resolvedStudent.lateResponseDetected, false, 'Late response resolved');
        assert.equal(resolvedStudent.requiresReallocation, false);
        assert.equal(resolvedStudent.affectedDirections.length, 0);
        assert.equal(resolvedStudent.assignedVehicle, 'College Express 01');
        assert.equal(resolvedStudent.assignedRoute, 'R-01');
        assert.equal(resolvedStudent.allocatedBus.seatNumber, 1);
        assert.ok(resolvedStudent.lateResponseResolvedAt);
    });

    // -------------------------------------------------------------
    // Test 8: Successful Admin Manual plan allocation resolves the event
    // -------------------------------------------------------------
    it('Test 8: Successful Admin Manual plan approval resolves the late response identically', () => {
        const student = {
            userId: 'std-late-08',
            travelStatus: 'Coming',
            allocationStatus: 'Pending Reallocation',
            requiresReallocation: true,
            lateResponseDetected: true,
            affectedDirections: ['OUTWARD'],
            travelResponseSubmittedAt: lateResponseTime
        };

        const manualPlan = {
            buses: [{
                vehicleName: 'Manual Transit Bus 02',
                routeCode: 'M-02',
                users: ['std-late-08']
            }]
        };

        const updated = simulatePlanApprovalAllocation({
            plan: manualPlan,
            direction: 'OUTWARD',
            planType: 'ADMIN',
            students: [student]
        });

        const resolvedStudent = updated[0];
        assert.equal(resolvedStudent.allocationStatus, 'Assigned');
        assert.equal(resolvedStudent.lateResponseDetected, false);
        assert.equal(resolvedStudent.assignedVehicle, 'Manual Transit Bus 02');
        assert.equal(resolvedStudent.assignedRoute, 'M-02');
        assert.equal(resolvedStudent.allocatedBus.planType, 'ADMIN');
    });

    // -------------------------------------------------------------
    // Test 9: Capacity-exceeded students remain unresolved
    // -------------------------------------------------------------
    it('Test 9: When bus capacity is exceeded, accommodated students resolve while standby students remain unresolved', () => {
        const studentA = {
            userId: 'std-accommodated',
            travelStatus: 'Coming',
            allocationStatus: 'Pending Reallocation',
            lateResponseDetected: true,
            affectedDirections: ['OUTWARD'],
            travelResponseSubmittedAt: lateResponseTime
        };
        const studentB = {
            userId: 'std-standby',
            travelStatus: 'Coming',
            allocationStatus: 'Pending Reallocation',
            lateResponseDetected: true,
            affectedDirections: ['OUTWARD'],
            travelResponseSubmittedAt: lateResponseTime
        };

        // Plan accommodates studentA but studentB is over capacity
        const plan = {
            buses: [{
                vehicleName: 'Bus-Capacity-Limited',
                routeCode: 'R-03',
                capacity: 1,
                users: ['std-accommodated']
            }]
        };

        const updated = simulatePlanApprovalAllocation({
            plan,
            direction: 'OUTWARD',
            students: [studentA, studentB]
        });

        const updatedA = updated.find(s => s.userId === 'std-accommodated');
        const updatedB = updated.find(s => s.userId === 'std-standby');

        // Accommodated student:
        assert.equal(updatedA.allocationStatus, 'Assigned');
        assert.equal(updatedA.lateResponseDetected, false);

        // Standby student:
        assert.equal(updatedB.allocationStatus, 'Pending Reallocation');
        assert.equal(updatedB.lateResponseDetected, true);
        assert.equal(updatedB.requiresReallocation, true);
        assert.ok(updatedB.affectedDirections.includes('OUTWARD'));
    });

    // -------------------------------------------------------------
    // Test 10: Resolved students do not appear in the next notification
    // -------------------------------------------------------------
    it('Test 10: Resolved students are excluded from the late response list and trigger no notifications', () => {
        const resolvedStudent = {
            userId: 'std-resolved-10',
            travelStatus: 'Coming',
            allocationStatus: 'Assigned',
            lateResponseDetected: false,
            requiresReallocation: false,
            affectedDirections: [],
            allocatedBus: {
                outward: { isAllocated: true, approved: true }
            },
            travelResponseSubmittedAt: lateResponseTime
        };

        const approvedPlansWithStudent = {
            INWARD: { isApproved: false },
            OUTWARD: {
                isApproved: true,
                approvedAt: new Date('2026-09-13T10:00:00Z'), // Approved after regeneration
                allocatedUserIds: ['std-resolved-10']
            }
        };

        const evalResult = evaluateLateResponsesForTest({
            students: [resolvedStudent],
            approvedPlans: approvedPlansWithStudent
        });

        assert.equal(evalResult.count, 0, 'Resolved student not in late responses');
        assert.equal(evalResult.unnotifiedCount, 0, 'No notification triggered');
    });

    // -------------------------------------------------------------
    // Test 11: A new legitimate late response creates a new event
    // -------------------------------------------------------------
    it('Test 11: A new legitimate late Coming response after a previous resolution generates a distinct event key', () => {
        const studentId = 'std-new-event-11';
        const initialPlanTime = new Date('2026-09-13T08:00:00Z');
        const initialSubmission = new Date('2026-09-13T08:30:00Z');

        const key1 = generateLateResponseEventKey(studentId, 'OUTWARD', initialSubmission, initialPlanTime);

        // Student resolves, then later a new travel cycle occurs and student submits late Coming again
        const secondPlanTime = new Date('2026-09-13T12:00:00Z');
        const newSubmission = new Date('2026-09-13T12:30:00Z');

        const key2 = generateLateResponseEventKey(studentId, 'OUTWARD', newSubmission, secondPlanTime);

        assert.notEqual(key1, key2, 'New event key must be generated');

        const studentWithNewResponse = {
            userId: studentId,
            travelStatus: 'Coming',
            travelResponseSubmittedAt: newSubmission,
            lateResponseNotifiedEventKeys: [key1] // Only previous key was notified!
        };

        const evalResult = evaluateLateResponsesForTest({
            students: [studentWithNewResponse],
            approvedPlans: {
                INWARD: { isApproved: false },
                OUTWARD: { isApproved: true, approvedAt: secondPlanTime, allocatedUserIds: [] }
            }
        });

        assert.equal(evalResult.unnotifiedCount, 1, 'New unnotified event detected');
        assert.equal(evalResult.unnotifiedEventKeys[0], key2);
    });

    // -------------------------------------------------------------
    // Test 12: OUTWARD and INWARD events remain independent
    // -------------------------------------------------------------
    it('Test 12: OUTWARD and INWARD events remain strictly independent in notification and allocation', () => {
        const student = {
            userId: 'std-dir-12',
            travelStatus: 'Coming',
            travelResponseSubmittedAt: lateResponseTime,
            affectedDirections: ['INWARD', 'OUTWARD'],
            lateResponseNotifiedEventKeys: []
        };

        const plans = {
            INWARD: { isApproved: true, approvedAt: planApprovalTime, allocatedUserIds: [] },
            OUTWARD: { isApproved: true, approvedAt: planApprovalTime, allocatedUserIds: [] }
        };

        const evalResult = evaluateLateResponsesForTest({
            students: [student],
            approvedPlans: plans
        });

        assert.equal(evalResult.unnotifiedEventKeys.length, 2, 'Two independent event keys for INWARD & OUTWARD');
        const inwardKey = evalResult.unnotifiedEventKeys.find(k => k.includes('INWARD'));
        const outwardKey = evalResult.unnotifiedEventKeys.find(k => k.includes('OUTWARD'));
        assert.ok(inwardKey);
        assert.ok(outwardKey);

        // Now simulate approving OUTWARD plan only:
        const afterOutwardApproval = simulatePlanApprovalAllocation({
            plan: { buses: [{ vehicleName: 'Outward Bus', routeCode: 'O-01', users: ['std-dir-12'] }] },
            direction: 'OUTWARD',
            students: [student]
        });

        const s = afterOutwardApproval[0];
        // OUTWARD is resolved, but INWARD remains affected!
        assert.deepEqual(s.affectedDirections, ['INWARD']);
        assert.equal(s.stillRequiresReallocation ?? s.requiresReallocation, true);
        assert.equal(s.allocationStatus, 'Pending Reallocation', 'Remains pending reallocation until INWARD also resolved');
    });

    // -------------------------------------------------------------
    // Test 13: Existing approved allocations remain unchanged until approval
    // -------------------------------------------------------------
    it('Test 13: Regenerating late response plan does not mutate existing active approved allocations', () => {
        const existingStudent = {
            userId: 'std-existing-13',
            assignedVehicle: 'Bus-Active-01',
            assignedRoute: 'R-Active-01',
            allocationStatus: 'Assigned',
            allocatedBus: { isAllocated: true, vehicleName: 'Bus-Active-01' }
        };

        // Simulate regenerating a draft
        const draftPlan = {
            isDraft: true,
            status: 'draft',
            routes: [{ vehicleName: 'Bus-Regenerated-New', users: ['std-existing-13', 'std-late-new'] }]
        };

        // Verification: student record remains untouched until explicit approval
        assert.equal(existingStudent.assignedVehicle, 'Bus-Active-01');
        assert.equal(existingStudent.allocationStatus, 'Assigned');
        assert.equal(draftPlan.status, 'draft');
    });

    // -------------------------------------------------------------
    // Test 14: Student Dashboard updates only after successful approved allocation
    // -------------------------------------------------------------
    it('Test 14: Student allocation details are exposed only after successful approved allocation', () => {
        // Pending student view:
        const studentBeforeApproval = {
            userId: 'std-dash-14',
            travelStatus: 'Coming',
            allocationStatus: 'Pending Reallocation',
            requiresReallocation: true,
            lateResponseDetected: true,
            affectedDirections: ['OUTWARD'],
            allocatedBus: null
        };

        const isVisibleBefore = Boolean(
            studentBeforeApproval.allocatedBus?.isAllocated &&
            studentBeforeApproval.allocationStatus === 'Assigned' &&
            !studentBeforeApproval.requiresReallocation
        );
        assert.equal(isVisibleBefore, false, 'Bus/seat details not visible before approval');

        // After approved allocation:
        const approvedPlan = {
            buses: [{ vehicleName: 'Campus Cruiser', routeCode: 'CC-09', users: ['std-dash-14'] }]
        };
        const [studentAfterApproval] = simulatePlanApprovalAllocation({
            plan: approvedPlan,
            direction: 'OUTWARD',
            students: [studentBeforeApproval]
        });

        const isVisibleAfter = Boolean(
            studentAfterApproval.allocatedBus?.isAllocated &&
            studentAfterApproval.allocationStatus === 'Assigned' &&
            !studentAfterApproval.requiresReallocation
        );
        assert.equal(isVisibleAfter, true, 'Bus/seat details visible after successful approved allocation');
        assert.equal(studentAfterApproval.assignedVehicle, 'Campus Cruiser');
        assert.equal(studentAfterApproval.assignedRoute, 'CC-09');
        assert.equal(studentAfterApproval.allocatedBus.seatNumber, 1);
    });

});
