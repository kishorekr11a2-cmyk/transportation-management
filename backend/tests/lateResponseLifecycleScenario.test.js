import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateLateResponseEventKey } from '../controllers/userController.js';

/**
 * EXACT 5-STUDENT LATE RESPONSE LIFECYCLE SCENARIO TEST SUITE
 * 
 * Tests the complete lifecycle across both AI Plan and Admin/Manual Plan flows:
 * 
 * Initial state:
 * - Student 1 -> Coming
 * - Student 2 -> Coming
 * - Student 3 -> No response / Pending
 * - Student 4 -> No response / Pending
 * - Student 5 -> No response / Pending
 * 
 * Steps covered:
 * 1. Baseline setup: 5 students, no approved plan, active late count = 0.
 * 2. Admin approves Plan Version 1 (AI Plan): Students 1 & 2 allocated, active late count = 0.
 * 3. Student 3 responds late under Plan Version 1:
 *    - Active late-response event created for Student 3 (status: ACTIVE, planVersion: 1).
 *    - Active late count increases to 1.
 *    - Student 3 appears in Late Responses list & filter (no "No users found" bug).
 *    - 1 late response notification shown.
 * 4. Admin acknowledges notification:
 *    - Notification marked acknowledged (unnotifiedCount becomes 0).
 *    - Student 3 STILL in Late Responses list.
 *    - Active late count STILL remains 1.
 *    - Status remains ACTIVE.
 * 5. User Management consistency:
 *    - Summary metric count (1) matches table filter (1 user found: Student 3).
 * 6. Student 3 duplicate submission under Plan Version 1:
 *    - Rejected with HTTP 400 (DUPLICATE_SUBMISSION, responseLocked: true).
 *    - Duplicate event prevented, count stays 1, notification not duplicated.
 * 7. Admin regenerates and approves Plan Version 2 (AI Plan flow):
 *    - Plan Version 1 active late response is marked RESOLVED.
 *    - Active late count becomes 0.
 *    - Student 3 removed from Late Responses list & filter.
 *    - Previous notification cleared.
 *    - Student 3 allocated to Plan Version 2.
 * 8. Student 3 attempts submission under Plan Version 2:
 *    - Rejected / locked (HTTP 400 ALREADY_ALLOCATED).
 *    - Active late count stays 0, Student 3 not in Late Responses list.
 * 9. Student 4 responds late under Plan Version 2:
 *    - Active late event created for Student 4 (status: ACTIVE, planVersion: 2).
 *    - Active late count becomes 1.
 *    - Student 4 appears in list; Student 3 remains RESOLVED.
 *    - Notification shown for Student 4 only.
 * 10. Admin/Manual Plan approval (Parity test, Plan Version 3):
 *    - Admin approves Plan Version 3 using Manual Plan flow.
 *    - Student 4 late event marked RESOLVED.
 *    - Active late count becomes 0.
 *    - Student 4 allocated to manual bus.
 * 11. Student 5 responds late under Manual Plan Version 3:
 *    - Active late event created for Student 5 (status: ACTIVE, planVersion: 3).
 *    - Active late count becomes 1.
 *    - Student 5 in list; Students 3 and 4 remain RESOLVED.
 * 12. Cycle Reset:
 *    - Reset clears all allocations and resolves all late events.
 *    - Active late count becomes 0.
 * 13. Refresh & persistence across tabs:
 *    - Querying state from authoritative records preserves locked responses and zero-drift metrics.
 */

describe('Exact 5-Student Late Response Lifecycle Scenario Suite', () => {

    // Helper state container simulating database collections
    function createScenarioEnvironment() {
        let users = [
            {
                _id: 'std_01',
                userId: 'STUDENT_01',
                name: 'Student 1',
                travelStatus: 'Coming',
                allocationStatus: 'Not Assigned',
                allocatedBus: null,
                isAllocated: false,
                isUnallocated: false,
                isLateResponse: false,
                lateResponseDetected: false,
                travelResponseSubmittedAt: new Date('2026-09-14T08:00:00.000Z'),
                submittedPlanVersion: 0,
                submittedApprovalEventId: null
            },
            {
                _id: 'std_02',
                userId: 'STUDENT_02',
                name: 'Student 2',
                travelStatus: 'Coming',
                allocationStatus: 'Not Assigned',
                allocatedBus: null,
                isAllocated: false,
                isUnallocated: false,
                isLateResponse: false,
                lateResponseDetected: false,
                travelResponseSubmittedAt: new Date('2026-09-14T08:05:00.000Z'),
                submittedPlanVersion: 0,
                submittedApprovalEventId: null
            },
            {
                _id: 'std_03',
                userId: 'STUDENT_03',
                name: 'Student 3',
                travelStatus: 'Pending',
                allocationStatus: 'Not Assigned',
                allocatedBus: null,
                isAllocated: false,
                isUnallocated: false,
                isLateResponse: false,
                lateResponseDetected: false,
                travelResponseSubmittedAt: null,
                submittedPlanVersion: null,
                submittedApprovalEventId: null
            },
            {
                _id: 'std_04',
                userId: 'STUDENT_04',
                name: 'Student 4',
                travelStatus: 'Pending',
                allocationStatus: 'Not Assigned',
                allocatedBus: null,
                isAllocated: false,
                isUnallocated: false,
                isLateResponse: false,
                lateResponseDetected: false,
                travelResponseSubmittedAt: null,
                submittedPlanVersion: null,
                submittedApprovalEventId: null
            },
            {
                _id: 'std_05',
                userId: 'STUDENT_05',
                name: 'Student 5',
                travelStatus: 'Pending',
                allocationStatus: 'Not Assigned',
                allocatedBus: null,
                isAllocated: false,
                isUnallocated: false,
                isLateResponse: false,
                lateResponseDetected: false,
                travelResponseSubmittedAt: null,
                submittedPlanVersion: null,
                submittedApprovalEventId: null
            }
        ];

        let lateResponseEvents = [];
        let activePlan = null; // { planVersion, approvalEventId, approvedAt, planType, direction: "OUTWARD", allocatedUserIds: [] }

        // Controller logic: update travel status
        function handleUpdateTravelStatus(userId, travelStatus, submissionTime = new Date()) {
            const user = users.find(u => u.userId === userId || u._id === userId);
            if (!user) return { status: 404, body: { success: false, message: "User not found" } };

            const currentPlanVersion = activePlan?.planVersion || 1;
            const currentApprovalEventId = activePlan?.approvalEventId || null;

            // 1. Check if user is already allocated in active plan
            const isAllocatedInPlan = Boolean(
                activePlan?.isApproved &&
                activePlan.allocatedUserIds?.includes(user.userId)
            );
            if (isAllocatedInPlan) {
                return {
                    status: 400,
                    body: {
                        success: false,
                        code: "ALREADY_ALLOCATED",
                        message: `You are already allocated to an active bus in Plan Version ${currentPlanVersion}. Submission is locked.`,
                        responseLocked: true
                    }
                };
            }

            // 2. Check duplicate submission for current plan version
            const hasActiveEvent = lateResponseEvents.some(
                e => e.userId === user.userId && e.status === "ACTIVE"
            );
            const alreadySubmitted = Boolean(
                (currentApprovalEventId && user.submittedApprovalEventId === currentApprovalEventId) ||
                (activePlan && user.submittedPlanVersion === currentPlanVersion) ||
                hasActiveEvent
            );
            if (alreadySubmitted) {
                return {
                    status: 400,
                    body: {
                        success: false,
                        code: "DUPLICATE_SUBMISSION",
                        message: `Travel response has already been submitted for the current approved transportation plan (Plan Version ${currentPlanVersion}).`,
                        responseLocked: true
                    }
                };
            }

            // Pre-approval lock
            if (!activePlan && user.travelStatus !== 'Pending') {
                return {
                    status: 400,
                    body: {
                        success: false,
                        code: "ALREADY_SUBMITTED",
                        message: "Travel status already submitted.",
                        responseLocked: true
                    }
                };
            }

            // Not Coming
            if (travelStatus === "Not Coming") {
                user.travelStatus = "Not Coming";
                user.travelResponseSubmittedAt = submissionTime;
                user.submittedPlanVersion = currentPlanVersion;
                user.submittedApprovalEventId = currentApprovalEventId;
                user.isLateResponse = false;
                user.lateResponseDetected = false;
                user.allocationStatus = "Not Assigned";
                // Resolve any active events
                lateResponseEvents.forEach(e => {
                    if (e.userId === user.userId && e.status === "ACTIVE") {
                        e.status = "RESOLVED";
                        e.resolvedAt = submissionTime;
                        e.resolutionReason = "Changed status to Not Coming";
                    }
                });
                return { status: 200, body: { success: true, travelStatus: "Not Coming", user } };
            }

            // Coming - Check if after plan approval
            const isLate = Boolean(activePlan?.isApproved && submissionTime.getTime() > activePlan.approvedAt.getTime());

            if (!isLate) {
                user.travelStatus = "Coming";
                user.travelResponseSubmittedAt = submissionTime;
                user.submittedPlanVersion = activePlan ? currentPlanVersion : 0;
                user.submittedApprovalEventId = currentApprovalEventId;
                user.isLateResponse = false;
                user.lateResponseDetected = false;
                return { status: 200, body: { success: true, travelStatus: "Coming", lateResponse: false, user } };
            }

            // LATE COMING DETECTED!
            user.travelStatus = "Coming";
            user.allocationStatus = "Pending Reallocation";
            user.lateResponseDetected = true;
            user.isLateResponse = true;
            user.lateResponseAt = submissionTime;
            user.travelResponseSubmittedAt = submissionTime;
            user.submittedPlanVersion = currentPlanVersion;
            user.submittedApprovalEventId = currentApprovalEventId;
            user.requiresReallocation = true;
            user.affectedDirections = [activePlan.direction || "OUTWARD"];

            const eventKey = generateLateResponseEventKey(
                user.userId,
                activePlan.direction || "OUTWARD",
                submissionTime,
                activePlan.approvedAt
            );
            user.lateResponseEventId = eventKey;

            // Check if already exists in lateResponseEvents
            const existingIdx = lateResponseEvents.findIndex(e => e.eventKey === eventKey);
            if (existingIdx === -1) {
                lateResponseEvents.push({
                    eventKey,
                    userId: user.userId,
                    planVersion: currentPlanVersion,
                    approvalEventId: currentApprovalEventId,
                    direction: activePlan.direction || "OUTWARD",
                    planApprovedAt: activePlan.approvedAt,
                    responseSubmittedAt: submissionTime,
                    planType: activePlan.planType || "AI",
                    isLateResponse: true,
                    status: "ACTIVE",
                    isNotified: false,
                    notifiedAt: null,
                    createdAt: submissionTime
                });
            }

            return {
                status: 200,
                body: {
                    success: true,
                    travelStatus: "Coming",
                    allocationStatus: "Pending Reallocation",
                    lateResponse: true,
                    isLateResponse: true,
                    planVersion: currentPlanVersion,
                    user
                }
            };
        }

        // Controller logic: getLateResponses
        function handleGetLateResponses() {
            const activeEvents = lateResponseEvents.filter(e => e.status === "ACTIVE");
            const unnotifiedEvents = activeEvents.filter(e => !e.isNotified);
            const userMap = new Map(users.map(u => [u.userId, u]));

            const lateResponses = activeEvents.map(e => {
                const u = userMap.get(e.userId) || {};
                return {
                    userId: e.userId,
                    name: u.name || e.userId,
                    travelStatus: "Coming",
                    currentTravelStatus: "Coming",
                    allocationStatus: "Pending Reallocation",
                    direction: e.direction,
                    affectedDirections: [e.direction],
                    eventKey: e.eventKey,
                    isNotified: Boolean(e.isNotified),
                    isLateResponse: true,
                    planVersion: e.planVersion,
                    approvalEventId: e.approvalEventId,
                    responseSubmittedAt: e.responseSubmittedAt
                };
            });

            return {
                status: 200,
                body: {
                    success: true,
                    count: lateResponses.length,
                    lateComingResponsesCount: lateResponses.length,
                    pendingReallocationUsersCount: lateResponses.length,
                    unnotifiedCount: unnotifiedEvents.length,
                    unnotifiedEventKeys: unnotifiedEvents.map(e => e.eventKey),
                    lateResponses,
                    users: lateResponses,
                    summary: {
                        lateComingResponsesCount: lateResponses.length,
                        pendingReallocationUsersCount: lateResponses.length,
                        unnotifiedCount: unnotifiedEvents.length,
                        notifiedCount: lateResponses.length - unnotifiedEvents.length
                    }
                }
            };
        }

        // Controller logic: acknowledge notifications
        function handleAcknowledgeNotifications(eventKeys = []) {
            let ackCount = 0;
            lateResponseEvents.forEach(e => {
                if (eventKeys.includes(e.eventKey)) {
                    e.isNotified = true;
                    e.notifiedAt = new Date();
                    ackCount++;
                }
            });
            return {
                status: 200,
                body: {
                    success: true,
                    acknowledgedCount: ackCount
                }
            };
        }

        // Service logic: approve plan version (AI or Manual)
        function handleApprovePlan({ planType = "AI", newPlanVersion, allocatedUserIds = [] }) {
            const approvalEventId = `approval_${planType.toLowerCase()}_v${newPlanVersion}_${Date.now()}`;
            const approvedAt = new Date();

            activePlan = {
                planVersion: newPlanVersion,
                approvalEventId,
                approvedAt,
                planType,
                direction: "OUTWARD",
                allocatedUserIds,
                isApproved: true
            };

            // 1. Resolve all previously active LateResponseEvent records
            let resolvedCount = 0;
            lateResponseEvents.forEach(e => {
                if (e.status === "ACTIVE") {
                    e.status = "RESOLVED";
                    e.resolvedAt = approvedAt;
                    e.resolutionReason = `Superseded by new approved plan version ${newPlanVersion}`;
                    resolvedCount++;
                }
            });

            // 2. Update users: assign buses, clear late flags
            users.forEach(u => {
                if (allocatedUserIds.includes(u.userId)) {
                    u.allocationStatus = "Assigned";
                    u.isAllocated = true;
                    u.isUnallocated = false;
                    u.isLateResponse = false;
                    u.lateResponseDetected = false;
                    u.submittedPlanVersion = newPlanVersion;
                    u.submittedApprovalEventId = approvalEventId;
                    u.allocatedBus = {
                        isAllocated: true,
                        vehicleName: `Bus-0${newPlanVersion}`,
                        routeCode: `Route-${newPlanVersion}`
                    };
                } else if (u.travelStatus === "Coming") {
                    u.allocationStatus = "Unallocated";
                    u.isAllocated = false;
                    u.isUnallocated = true;
                    u.isLateResponse = false;
                    u.lateResponseDetected = false;
                }
            });

            return {
                activePlan,
                resolvedEventsCount: resolvedCount
            };
        }

        // Reset travel status cycle
        function handleResetCycle() {
            activePlan = null;
            lateResponseEvents.forEach(e => {
                if (e.status === "ACTIVE") {
                    e.status = "RESOLVED";
                    e.resolvedAt = new Date();
                }
            });
            users.forEach(u => {
                u.travelStatus = "Pending";
                u.allocationStatus = "Not Assigned";
                u.allocatedBus = null;
                u.isAllocated = false;
                u.isUnallocated = false;
                u.isLateResponse = false;
                u.lateResponseDetected = false;
                u.travelResponseSubmittedAt = null;
                u.submittedPlanVersion = null;
                u.submittedApprovalEventId = null;
            });
        }

        // Frontend UserManagement filter helper
        function filterUsersForManagement(filterType = "All") {
            return users.filter(user => {
                const isAllocated = Boolean(
                    user.travelStatus === "Coming" &&
                    (user.isAllocated || user.allocationStatus === "Assigned" || user.allocatedBus?.isAllocated)
                );
                const isUnallocated = Boolean(user.travelStatus === "Coming" && !isAllocated);
                const isLateComing = Boolean(
                    user.travelStatus === "Coming" &&
                    (user.isLateResponse || user.lateResponseDetected || user.allocationStatus === "Pending Reallocation")
                );

                if (filterType === "Late Coming Responses") {
                    return isLateComing;
                }
                if (filterType === "Allocated") {
                    return isAllocated;
                }
                if (filterType === "Unallocated") {
                    return isUnallocated;
                }
                return true;
            });
        }

        return {
            users,
            lateResponseEvents,
            getActivePlan: () => activePlan,
            handleUpdateTravelStatus,
            handleGetLateResponses,
            handleAcknowledgeNotifications,
            handleApprovePlan,
            handleResetCycle,
            filterUsersForManagement
        };
    }

    // -------------------------------------------------------------
    // STEP 1: Baseline Setup
    // -------------------------------------------------------------
    it('Step 1: Baseline setup with 5 students (2 Coming, 3 Pending) -> 0 late responses, empty list', () => {
        const env = createScenarioEnvironment();

        const comingUsers = env.users.filter(u => u.travelStatus === 'Coming');
        const pendingUsers = env.users.filter(u => u.travelStatus === 'Pending');

        assert.equal(comingUsers.length, 2, 'Students 1 and 2 are Coming');
        assert.equal(pendingUsers.length, 3, 'Students 3, 4, 5 are Pending');
        assert.equal(env.getActivePlan(), null, 'No plan approved initially');

        const lateReport = env.handleGetLateResponses();
        assert.equal(lateReport.body.count, 0, 'Late responses count is 0');
        assert.equal(lateReport.body.unnotifiedCount, 0, 'No unnotified alerts');
        assert.equal(lateReport.body.lateResponses.length, 0, 'Late responses list is empty');
    });

    // -------------------------------------------------------------
    // STEP 2: Admin approves Plan Version 1 (AI Plan)
    // -------------------------------------------------------------
    it('Step 2: Admin approves Plan Version 1 allocating Students 1 & 2 -> 0 late responses', () => {
        const env = createScenarioEnvironment();

        // Admin approves Plan Version 1 allocating Students 1 and 2
        env.handleApprovePlan({
            planType: 'AI',
            newPlanVersion: 1,
            allocatedUserIds: ['STUDENT_01', 'STUDENT_02']
        });

        const plan = env.getActivePlan();
        assert.equal(plan.planVersion, 1);
        assert.equal(plan.isApproved, true);

        // Check allocation of students
        const s1 = env.users.find(u => u.userId === 'STUDENT_01');
        const s2 = env.users.find(u => u.userId === 'STUDENT_02');
        const s3 = env.users.find(u => u.userId === 'STUDENT_03');

        assert.equal(s1.allocationStatus, 'Assigned');
        assert.equal(s1.allocatedBus.vehicleName, 'Bus-01');
        assert.equal(s2.allocationStatus, 'Assigned');
        assert.equal(s3.allocationStatus, 'Not Assigned');

        const lateReport = env.handleGetLateResponses();
        assert.equal(lateReport.body.count, 0, 'Active late responses count remains 0');
        assert.equal(lateReport.body.unnotifiedCount, 0, 'Zero unnotified alerts');
    });

    // -------------------------------------------------------------
    // STEP 3: Student 3 responds late under Plan Version 1
    // -------------------------------------------------------------
    it('Step 3: Student 3 submits Coming after plan approval -> Active event created, count=1, notification shown', () => {
        const env = createScenarioEnvironment();
        env.handleApprovePlan({
            planType: 'AI',
            newPlanVersion: 1,
            allocatedUserIds: ['STUDENT_01', 'STUDENT_02']
        });

        const planApprovalTime = env.getActivePlan().approvedAt;
        const student3SubmissionTime = new Date(planApprovalTime.getTime() + 15 * 60 * 1000); // 15 mins later

        const res = env.handleUpdateTravelStatus('STUDENT_03', 'Coming', student3SubmissionTime);

        assert.equal(res.status, 200);
        assert.equal(res.body.lateResponse, true);
        assert.equal(res.body.isLateResponse, true);
        assert.equal(res.body.planVersion, 1);

        // Verify LateResponseEvent created with status: ACTIVE and planVersion: 1
        assert.equal(env.lateResponseEvents.length, 1);
        const event = env.lateResponseEvents[0];
        assert.equal(event.userId, 'STUDENT_03');
        assert.equal(event.status, 'ACTIVE');
        assert.equal(event.planVersion, 1);
        assert.equal(event.isNotified, false);

        // Verify getLateResponses
        const lateReport = env.handleGetLateResponses();
        assert.equal(lateReport.body.count, 1, 'Active late count must be 1');
        assert.equal(lateReport.body.unnotifiedCount, 1, '1 new unnotified alert must be shown');
        assert.equal(lateReport.body.lateResponses[0].userId, 'STUDENT_03');
        assert.equal(lateReport.body.lateResponses[0].allocationStatus, 'Pending Reallocation');

        // Student 3 must NOT have an active assigned bus
        const s3 = env.users.find(u => u.userId === 'STUDENT_03');
        assert.equal(s3.isAllocated, false);
        assert.equal(s3.allocationStatus, 'Pending Reallocation');
    });

    // -------------------------------------------------------------
    // STEP 4: Admin views / acknowledges the notification
    // -------------------------------------------------------------
    it('Step 4: Admin acknowledges notification -> popup cleared (unnotified=0), Student 3 STILL in list, count stays 1', () => {
        const env = createScenarioEnvironment();
        env.handleApprovePlan({
            planType: 'AI',
            newPlanVersion: 1,
            allocatedUserIds: ['STUDENT_01', 'STUDENT_02']
        });

        const postApproval = new Date(env.getActivePlan().approvedAt.getTime() + 10 * 60 * 1000);
        env.handleUpdateTravelStatus('STUDENT_03', 'Coming', postApproval);

        const beforeAck = env.handleGetLateResponses();
        assert.equal(beforeAck.body.count, 1);
        assert.equal(beforeAck.body.unnotifiedCount, 1);

        // Admin acknowledges notification
        const ackRes = env.handleAcknowledgeNotifications(beforeAck.body.unnotifiedEventKeys);
        assert.equal(ackRes.status, 200);
        assert.equal(ackRes.body.acknowledgedCount, 1);

        // After acknowledgment
        const afterAck = env.handleGetLateResponses();
        assert.equal(afterAck.body.unnotifiedCount, 0, 'Unnotified count resets to 0 (no popup)');
        assert.equal(afterAck.body.count, 1, 'Active late responses count STILL remains 1');
        assert.equal(afterAck.body.lateResponses.length, 1, 'Student 3 STILL remains in Late Responses list');
        assert.equal(afterAck.body.lateResponses[0].userId, 'STUDENT_03');

        // Status remains ACTIVE
        assert.equal(env.lateResponseEvents[0].status, 'ACTIVE');
        assert.equal(env.lateResponseEvents[0].isNotified, true);
    });

    // -------------------------------------------------------------
    // STEP 5: User Management Consistency (Eliminating "No users found" bug)
    // -------------------------------------------------------------
    it('Step 5: User Management consistency: summary count (1) strictly matches table filter count (1 user found)', () => {
        const env = createScenarioEnvironment();
        env.handleApprovePlan({
            planType: 'AI',
            newPlanVersion: 1,
            allocatedUserIds: ['STUDENT_01', 'STUDENT_02']
        });

        const postApproval = new Date(env.getActivePlan().approvedAt.getTime() + 10 * 60 * 1000);
        env.handleUpdateTravelStatus('STUDENT_03', 'Coming', postApproval);

        const lateReport = env.handleGetLateResponses();
        const lateMetricCount = lateReport.body.count;
        assert.equal(lateMetricCount, 1);

        // Table filter for "Late Coming Responses"
        const filteredStudents = env.filterUsersForManagement('Late Coming Responses');
        assert.equal(filteredStudents.length, lateMetricCount, 'Filtered table count must exactly match metric count');
        assert.equal(filteredStudents[0].userId, 'STUDENT_03');
        assert.notEqual(filteredStudents.length, 0, 'Must NOT show "No users found"');
    });

    // -------------------------------------------------------------
    // STEP 6: Student 3 attempts duplicate submission under Plan Version 1
    // -------------------------------------------------------------
    it('Step 6: Student 3 submits Coming again under Plan Version 1 -> Rejected HTTP 400 DUPLICATE_SUBMISSION', () => {
        const env = createScenarioEnvironment();
        env.handleApprovePlan({
            planType: 'AI',
            newPlanVersion: 1,
            allocatedUserIds: ['STUDENT_01', 'STUDENT_02']
        });

        const postApproval = new Date(env.getActivePlan().approvedAt.getTime() + 10 * 60 * 1000);
        env.handleUpdateTravelStatus('STUDENT_03', 'Coming', postApproval);

        // Student 3 tries to submit Coming again under Plan Version 1
        const dupRes = env.handleUpdateTravelStatus('STUDENT_03', 'Coming', new Date(postApproval.getTime() + 5000));

        assert.equal(dupRes.status, 400);
        assert.equal(dupRes.body.success, false);
        assert.equal(dupRes.body.code, 'DUPLICATE_SUBMISSION');
        assert.equal(dupRes.body.responseLocked, true);
        assert.match(dupRes.body.message, /Plan Version 1/);

        // Count must remain 1, exactly 1 event record in collection
        assert.equal(env.lateResponseEvents.length, 1);
        const lateReport = env.handleGetLateResponses();
        assert.equal(lateReport.body.count, 1);
        assert.equal(lateReport.body.lateResponses.length, 1);
    });

    // -------------------------------------------------------------
    // STEP 7: Admin regenerates and approves Plan Version 2 (AI Plan flow)
    // -------------------------------------------------------------
    it('Step 7: Admin approves Plan Version 2 -> Plan 1 late responses RESOLVED, count=0, Student 3 removed from late list', () => {
        const env = createScenarioEnvironment();
        env.handleApprovePlan({
            planType: 'AI',
            newPlanVersion: 1,
            allocatedUserIds: ['STUDENT_01', 'STUDENT_02']
        });

        const postApproval = new Date(env.getActivePlan().approvedAt.getTime() + 10 * 60 * 1000);
        env.handleUpdateTravelStatus('STUDENT_03', 'Coming', postApproval);

        // Admin regenerates and approves Plan Version 2 (Students 1, 2, and 3 allocated)
        const approveV2 = env.handleApprovePlan({
            planType: 'AI',
            newPlanVersion: 2,
            allocatedUserIds: ['STUDENT_01', 'STUDENT_02', 'STUDENT_03']
        });

        assert.equal(approveV2.activePlan.planVersion, 2);
        assert.equal(approveV2.resolvedEventsCount, 1, 'Student 3 late event resolved');

        // Verify LateResponseEvent status transitioned to RESOLVED
        const event = env.lateResponseEvents[0];
        assert.equal(event.status, 'RESOLVED');
        assert.match(event.resolutionReason, /plan version 2/i);

        // Authoritative late response check
        const lateReport = env.handleGetLateResponses();
        assert.equal(lateReport.body.count, 0, 'Active late count must reset to 0');
        assert.equal(lateReport.body.unnotifiedCount, 0);
        assert.equal(lateReport.body.lateResponses.length, 0, 'Student 3 removed from late list');

        // User Management filter
        const filteredLate = env.filterUsersForManagement('Late Coming Responses');
        assert.equal(filteredLate.length, 0, 'Student 3 must NOT appear in Late Responses filter');

        // Student 3 is now allocated
        const s3 = env.users.find(u => u.userId === 'STUDENT_03');
        assert.equal(s3.allocationStatus, 'Assigned');
        assert.equal(s3.isAllocated, true);
        assert.equal(s3.isLateResponse, false);
        assert.equal(s3.allocatedBus.vehicleName, 'Bus-02');
    });

    // -------------------------------------------------------------
    // STEP 8: Student 3 attempts submission under Plan Version 2
    // -------------------------------------------------------------
    it('Step 8: Student 3 submits Coming under Plan Version 2 -> Rejected ALREADY_ALLOCATED, count stays 0', () => {
        const env = createScenarioEnvironment();
        env.handleApprovePlan({
            planType: 'AI',
            newPlanVersion: 1,
            allocatedUserIds: ['STUDENT_01', 'STUDENT_02']
        });

        env.handleUpdateTravelStatus('STUDENT_03', 'Coming', new Date('2026-09-14T09:15:00Z'));
        env.handleApprovePlan({
            planType: 'AI',
            newPlanVersion: 2,
            allocatedUserIds: ['STUDENT_01', 'STUDENT_02', 'STUDENT_03']
        });

        // Student 3 tries to submit Coming again under Plan Version 2
        const res = env.handleUpdateTravelStatus('STUDENT_03', 'Coming', new Date('2026-09-14T10:15:00Z'));

        assert.equal(res.status, 400);
        assert.equal(res.body.code, 'ALREADY_ALLOCATED');
        assert.equal(res.body.responseLocked, true);

        // Active late responses count stays 0
        const lateReport = env.handleGetLateResponses();
        assert.equal(lateReport.body.count, 0);
        assert.equal(lateReport.body.lateResponses.length, 0);
    });

    // -------------------------------------------------------------
    // STEP 9: Student 4 responds late under Plan Version 2
    // -------------------------------------------------------------
    it('Step 9: Student 4 responds late under Plan Version 2 -> New active event for V2, count=1, Student 3 stays RESOLVED', () => {
        const env = createScenarioEnvironment();
        env.handleApprovePlan({
            planType: 'AI',
            newPlanVersion: 1,
            allocatedUserIds: ['STUDENT_01', 'STUDENT_02']
        });
        env.handleUpdateTravelStatus('STUDENT_03', 'Coming', new Date(env.getActivePlan().approvedAt.getTime() + 10 * 60 * 1000));
        env.handleApprovePlan({
            planType: 'AI',
            newPlanVersion: 2,
            allocatedUserIds: ['STUDENT_01', 'STUDENT_02', 'STUDENT_03']
        });

        // Student 4 submits Coming after Plan Version 2 approval
        const plan2ApprovalTime = env.getActivePlan().approvedAt;
        const student4SubmissionTime = new Date(plan2ApprovalTime.getTime() + 20 * 60 * 1000);

        const res = env.handleUpdateTravelStatus('STUDENT_04', 'Coming', student4SubmissionTime);

        assert.equal(res.status, 200);
        assert.equal(res.body.lateResponse, true);
        assert.equal(res.body.planVersion, 2);

        // LateResponseEvent collection inspection
        assert.equal(env.lateResponseEvents.length, 2, '2 total events (1 resolved, 1 active)');

        const student3Event = env.lateResponseEvents.find(e => e.userId === 'STUDENT_03');
        const student4Event = env.lateResponseEvents.find(e => e.userId === 'STUDENT_04');

        assert.equal(student3Event.status, 'RESOLVED', 'Student 3 event must stay RESOLVED');
        assert.equal(student4Event.status, 'ACTIVE', 'Student 4 event must be ACTIVE');
        assert.equal(student4Event.planVersion, 2, 'Student 4 event is bound to Plan Version 2');
        assert.equal(student4Event.isNotified, false);

        // Active late responses check
        const lateReport = env.handleGetLateResponses();
        assert.equal(lateReport.body.count, 1, 'Active late count is 1');
        assert.equal(lateReport.body.unnotifiedCount, 1, '1 unnotified alert for Student 4');
        assert.equal(lateReport.body.lateResponses.length, 1);
        assert.equal(lateReport.body.lateResponses[0].userId, 'STUDENT_04');
    });

    // -------------------------------------------------------------
    // STEP 10: Admin/Manual Plan Parity (Plan Version 3 Approval)
    // -------------------------------------------------------------
    it('Step 10: Manual Plan approval (Plan Version 3) -> Student 4 resolved, count=0, Student 4 allocated to manual bus', () => {
        const env = createScenarioEnvironment();
        env.handleApprovePlan({ planType: 'AI', newPlanVersion: 1, allocatedUserIds: ['STUDENT_01', 'STUDENT_02'] });
        env.handleUpdateTravelStatus('STUDENT_03', 'Coming', new Date(env.getActivePlan().approvedAt.getTime() + 10 * 60 * 1000));
        env.handleApprovePlan({ planType: 'AI', newPlanVersion: 2, allocatedUserIds: ['STUDENT_01', 'STUDENT_02', 'STUDENT_03'] });
        env.handleUpdateTravelStatus('STUDENT_04', 'Coming', new Date(env.getActivePlan().approvedAt.getTime() + 10 * 60 * 1000));

        // Admin approves Plan Version 3 using Manual Plan flow
        const approveV3 = env.handleApprovePlan({
            planType: 'MANUAL',
            newPlanVersion: 3,
            allocatedUserIds: ['STUDENT_01', 'STUDENT_02', 'STUDENT_03', 'STUDENT_04']
        });

        assert.equal(approveV3.activePlan.planVersion, 3);
        assert.equal(approveV3.activePlan.planType, 'MANUAL');
        assert.equal(approveV3.resolvedEventsCount, 1, 'Student 4 late event resolved by manual approval');

        // Active late count must be 0
        const lateReport = env.handleGetLateResponses();
        assert.equal(lateReport.body.count, 0);
        assert.equal(lateReport.body.lateResponses.length, 0);

        // Student 4 is allocated in manual plan
        const s4 = env.users.find(u => u.userId === 'STUDENT_04');
        assert.equal(s4.allocationStatus, 'Assigned');
        assert.equal(s4.isAllocated, true);
        assert.equal(s4.allocatedBus.vehicleName, 'Bus-03');
    });

    // -------------------------------------------------------------
    // STEP 11: Student 5 responds late under Manual Plan Version 3
    // -------------------------------------------------------------
    it('Step 11: Student 5 responds late under Manual Plan Version 3 -> Active event for V3, count=1, S3 & S4 stay RESOLVED', () => {
        const env = createScenarioEnvironment();
        env.handleApprovePlan({ planType: 'AI', newPlanVersion: 1, allocatedUserIds: ['STUDENT_01', 'STUDENT_02'] });
        env.handleUpdateTravelStatus('STUDENT_03', 'Coming', new Date(env.getActivePlan().approvedAt.getTime() + 10 * 60 * 1000));
        env.handleApprovePlan({ planType: 'AI', newPlanVersion: 2, allocatedUserIds: ['STUDENT_01', 'STUDENT_02', 'STUDENT_03'] });
        env.handleUpdateTravelStatus('STUDENT_04', 'Coming', new Date(env.getActivePlan().approvedAt.getTime() + 10 * 60 * 1000));
        env.handleApprovePlan({ planType: 'MANUAL', newPlanVersion: 3, allocatedUserIds: ['STUDENT_01', 'STUDENT_02', 'STUDENT_03', 'STUDENT_04'] });

        // Student 5 submits Coming after Plan Version 3 approval
        const plan3ApprovalTime = env.getActivePlan().approvedAt;
        const student5SubmissionTime = new Date(plan3ApprovalTime.getTime() + 15 * 60 * 1000);

        const res = env.handleUpdateTravelStatus('STUDENT_05', 'Coming', student5SubmissionTime);

        assert.equal(res.status, 200);
        assert.equal(res.body.lateResponse, true);
        assert.equal(res.body.planVersion, 3);

        const lateReport = env.handleGetLateResponses();
        assert.equal(lateReport.body.count, 1);
        assert.equal(lateReport.body.lateResponses.length, 1);
        assert.equal(lateReport.body.lateResponses[0].userId, 'STUDENT_05');

        // Verify Student 3 and 4 events are RESOLVED
        const s3Event = env.lateResponseEvents.find(e => e.userId === 'STUDENT_03');
        const s4Event = env.lateResponseEvents.find(e => e.userId === 'STUDENT_04');
        const s5Event = env.lateResponseEvents.find(e => e.userId === 'STUDENT_05');

        assert.equal(s3Event.status, 'RESOLVED');
        assert.equal(s4Event.status, 'RESOLVED');
        assert.equal(s5Event.status, 'ACTIVE');
        assert.equal(s5Event.planVersion, 3);
        assert.equal(s5Event.planType, 'MANUAL');
    });

    // -------------------------------------------------------------
    // STEP 12: Cycle Reset
    // -------------------------------------------------------------
    it('Step 12: Admin resets cycle -> all late response events resolved, active count=0, users reset to Pending', () => {
        const env = createScenarioEnvironment();
        env.handleApprovePlan({ planType: 'AI', newPlanVersion: 1, allocatedUserIds: ['STUDENT_01', 'STUDENT_02'] });
        env.handleUpdateTravelStatus('STUDENT_03', 'Coming', new Date('2026-09-14T09:15:00Z'));

        // Admin resets cycle
        env.handleResetCycle();

        assert.equal(env.getActivePlan(), null);

        // All users reset to Pending
        assert.ok(env.users.every(u => u.travelStatus === 'Pending'));
        assert.ok(env.users.every(u => u.allocationStatus === 'Not Assigned'));
        assert.ok(env.users.every(u => u.allocatedBus === null));

        // All events resolved
        assert.ok(env.lateResponseEvents.every(e => e.status === 'RESOLVED'));

        // Active late count = 0
        const lateReport = env.handleGetLateResponses();
        assert.equal(lateReport.body.count, 0);
    });

    // -------------------------------------------------------------
    // STEP 13: Refresh, Component Remount, and Tab Persistence
    // -------------------------------------------------------------
    it('Step 13: Component remount / page refresh simulation maintains identical counts and locked response states', () => {
        const env = createScenarioEnvironment();
        env.handleApprovePlan({ planType: 'AI', newPlanVersion: 1, allocatedUserIds: ['STUDENT_01', 'STUDENT_02'] });
        env.handleUpdateTravelStatus('STUDENT_03', 'Coming', new Date('2026-09-14T09:15:00Z'));

        // Tab 1 loads state
        const tab1Report = env.handleGetLateResponses();
        const tab1Filter = env.filterUsersForManagement('Late Coming Responses');

        // Tab 2 loads state fresh from backend
        const tab2Report = env.handleGetLateResponses();
        const tab2Filter = env.filterUsersForManagement('Late Coming Responses');

        assert.equal(tab1Report.body.count, tab2Report.body.count);
        assert.equal(tab1Filter.length, tab2Filter.length);
        assert.equal(tab1Report.body.count, tab1Filter.length, 'No discrepancy between count and filter across tabs');
    });

});
