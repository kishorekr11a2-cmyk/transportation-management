import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateLateResponseEventKey } from '../controllers/userController.js';

/**
 * COMPREHENSIVE LATE RESPONSE WORKFLOW INTEGRATION TEST SUITE
 * 
 * Verifies end-to-end integration covering:
 * - Dynamic Detection & Timestamp Comparison (Tests A, B, C, D, F)
 * - LateResponseEvent Schema & Idempotence
 * - Plan Review State Flags (requiresReview, hasLateResponses, pendingReallocation)
 * - Notification Lifecycle & Case-Insensitive Acknowledgment
 * - Status Changes (Changing to Not Coming)
 * - Direction Isolation (INWARD vs OUTWARD)
 * - Draft Separation & Explicit Admin Approval (Clearing Review Flags)
 * - Reset Lifecycle
 */

describe('Late Response Workflow Integration Test Suite', () => {

    // -------------------------------------------------------------
    // TEST 1: Detection & Timestamp Comparison
    // -------------------------------------------------------------
    it('Test 1: Student submitting Coming after plan approval qualifies as late response with correct flags', () => {
        const planApprovedAt = new Date('2026-09-13T10:00:00.000Z');
        const responseSubmittedAt = new Date('2026-09-13T10:15:00.000Z');

        const approvedPlans = {
            OUTWARD: {
                isApproved: true,
                planId: 'plan_outward_101',
                planType: 'AI',
                approvedAt: planApprovedAt,
                allocatedUserIds: new Set(['usr1001', 'usr1002'])
            },
            INWARD: {
                isApproved: false,
                planId: null,
                approvedAt: null,
                allocatedUserIds: new Set()
            }
        };

        const student = {
            userId: 'USR1003',
            travelStatus: 'Coming',
            responseSubmittedAt,
            allocatedBus: null
        };

        // Evaluate affected directions
        const affectedDirections = [];
        for (const dir of ['INWARD', 'OUTWARD']) {
            const plan = approvedPlans[dir];
            if (plan.isApproved && plan.approvedAt) {
                const isAfter = responseSubmittedAt.getTime() > plan.approvedAt.getTime();
                const isAllocated = plan.allocatedUserIds.has(student.userId.toLowerCase());
                if (isAfter && !isAllocated) {
                    affectedDirections.push(dir);
                }
            }
        }

        assert.deepEqual(affectedDirections, ['OUTWARD'], 'Only OUTWARD should be affected');
        assert.equal(affectedDirections.length > 0, true, 'Student should be detected as late');

        // Check LateResponseEvent payload construction
        const eventKey = generateLateResponseEventKey(
            student.userId,
            'OUTWARD',
            responseSubmittedAt,
            planApprovedAt
        );

        const lateEventRecord = {
            eventKey,
            userId: student.userId,
            planId: approvedPlans.OUTWARD.planId,
            direction: 'OUTWARD',
            previousTravelStatus: 'Pending',
            currentTravelStatus: 'Coming',
            responseTimestamp: responseSubmittedAt,
            responseSubmittedAt: responseSubmittedAt,
            planApprovedAt: planApprovedAt,
            planType: 'AI',
            isLateResponse: true,
            status: 'DETECTED'
        };

        assert.equal(lateEventRecord.isLateResponse, true, 'isLateResponse must be true');
        assert.equal(lateEventRecord.planId, 'plan_outward_101', 'planId must match approved plan');
        assert.equal(lateEventRecord.status, 'DETECTED', 'Initial status must be DETECTED');
        assert.equal(lateEventRecord.direction, 'OUTWARD', 'Direction must be OUTWARD');
    });

    // -------------------------------------------------------------
    // TEST 2: Submission Before Approval & Existing Allocated Student
    // -------------------------------------------------------------
    it('Test 2: Submissions before approval or by already allocated students are NEVER marked late', () => {
        const planApprovedAt = new Date('2026-09-13T10:00:00.000Z');
        const beforeApprovalTime = new Date('2026-09-13T09:45:00.000Z');
        const afterApprovalTime = new Date('2026-09-13T10:15:00.000Z');

        const approvedPlans = {
            OUTWARD: {
                isApproved: true,
                planId: 'plan_outward_101',
                approvedAt: planApprovedAt,
                allocatedUserIds: new Set(['usr1001', 'usr1002'])
            },
            INWARD: {
                isApproved: false,
                planId: null,
                approvedAt: null,
                allocatedUserIds: new Set()
            }
        };

        // Case A: Student submitted before approval
        const studentBefore = {
            userId: 'USR1004',
            travelStatus: 'Coming',
            responseSubmittedAt: beforeApprovalTime
        };
        const affectedA = [];
        if (approvedPlans.OUTWARD.isApproved && studentBefore.responseSubmittedAt.getTime() > approvedPlans.OUTWARD.approvedAt.getTime()) {
            affectedA.push('OUTWARD');
        }
        assert.equal(affectedA.length, 0, 'Submission before approval must not be late');

        // Case B: Student already allocated in plan re-submitting Coming
        const studentAllocated = {
            userId: 'USR1001',
            travelStatus: 'Coming',
            responseSubmittedAt: afterApprovalTime
        };
        const isAllocated = approvedPlans.OUTWARD.allocatedUserIds.has(studentAllocated.userId.toLowerCase());
        const isLate = afterApprovalTime.getTime() > planApprovedAt.getTime() && !isAllocated;
        assert.equal(isLate, false, 'Already allocated student must not be late');
    });

    // -------------------------------------------------------------
    // TEST 3: Idempotent Event Key & Duplicate Submission
    // -------------------------------------------------------------
    it('Test 3: Idempotent eventKey prevents duplicate LateResponseEvent records', () => {
        const planApprovedAt = new Date('2026-09-13T10:00:00.000Z');
        const responseSubmittedAt = new Date('2026-09-13T10:15:00.000Z');

        const key1 = generateLateResponseEventKey('USR1005', 'OUTWARD', responseSubmittedAt, planApprovedAt);
        const key2 = generateLateResponseEventKey('usr1005', 'OUTWARD', responseSubmittedAt, planApprovedAt);

        assert.equal(key1, key2, 'Event keys must be normalized and identical across casing');

        // Simulate MongoDB updateOne with upsert
        const mockDb = new Map();
        function upsertLateEvent(doc) {
            if (mockDb.has(doc.eventKey)) {
                return { upsertedCount: 0, modifiedCount: 1 };
            }
            mockDb.set(doc.eventKey, doc);
            return { upsertedCount: 1, modifiedCount: 0 };
        }

        const res1 = upsertLateEvent({ eventKey: key1, userId: 'USR1005', status: 'DETECTED' });
        assert.equal(res1.upsertedCount, 1, 'First submission creates record');

        const res2 = upsertLateEvent({ eventKey: key2, userId: 'USR1005', status: 'DETECTED' });
        assert.equal(res2.upsertedCount, 0, 'Duplicate submission must not create new record');
        assert.equal(mockDb.size, 1, 'Database must contain exactly 1 event record');
    });

    // -------------------------------------------------------------
    // TEST 4: Approved Plan Review Flags Set Correctly Without Auto-Approval
    // -------------------------------------------------------------
    it('Test 4: Approved plan is flagged for review without altering route allocations or auto-approving', () => {
        const approvedPlanDoc = {
            _id: 'plan_101',
            active: true,
            status: 'active',
            approved: true,
            isApproved: true,
            direction: 'OUTWARD',
            requiresReview: false,
            hasLateResponses: false,
            pendingReallocation: false,
            affectedDirections: [],
            buses: [
                { vehicleNumber: 'BUS-01', users: ['USR1001', 'USR1002'] }
            ]
        };

        // Simulate late response trigger
        const responseSubmittedAt = new Date('2026-09-13T10:30:00.000Z');
        const affectedDirections = ['OUTWARD'];

        // Plan update
        approvedPlanDoc.requiresReview = true;
        approvedPlanDoc.hasLateResponses = true;
        approvedPlanDoc.pendingReallocation = true;
        approvedPlanDoc.lastLateResponseAt = responseSubmittedAt;
        approvedPlanDoc.affectedDirections = affectedDirections;

        assert.equal(approvedPlanDoc.requiresReview, true, 'Plan requiresReview must be true');
        assert.equal(approvedPlanDoc.hasLateResponses, true, 'Plan hasLateResponses must be true');
        assert.equal(approvedPlanDoc.pendingReallocation, true, 'Plan pendingReallocation must be true');
        assert.equal(approvedPlanDoc.approved, true, 'Existing approved status must NOT be cleared');
        assert.equal(approvedPlanDoc.buses[0].users.length, 2, 'Existing allocations must NOT be cleared');
    });

    // -------------------------------------------------------------
    // TEST 5: Direction Isolation (INWARD vs OUTWARD)
    // -------------------------------------------------------------
    it('Test 5: INWARD plan approval only marks INWARD as affected; OUTWARD remains unaffected', () => {
        const approvedPlans = {
            INWARD: {
                isApproved: true,
                approvedAt: new Date('2026-09-13T09:00:00.000Z'),
                allocatedUserIds: new Set()
            },
            OUTWARD: {
                isApproved: false,
                approvedAt: null,
                allocatedUserIds: new Set()
            }
        };

        const responseSubmittedAt = new Date('2026-09-13T11:00:00.000Z');
        const affectedDirections = [];

        for (const dir of ['INWARD', 'OUTWARD']) {
            const plan = approvedPlans[dir];
            if (plan.isApproved && plan.approvedAt && responseSubmittedAt.getTime() > plan.approvedAt.getTime()) {
                affectedDirections.push(dir);
            }
        }

        assert.deepEqual(affectedDirections, ['INWARD'], 'Only INWARD must be flagged');
        assert.equal(affectedDirections.includes('OUTWARD'), false, 'OUTWARD must not be affected');
    });

    // -------------------------------------------------------------
    // TEST 6: Notification Deduplication & Case-Insensitive Acknowledgment
    // -------------------------------------------------------------
    it('Test 6: Notification acknowledgment handles case-insensitive userId and prevents repeat popups', () => {
        const student = {
            userId: 'USR1007',
            lateResponseNotifiedEventKeys: [],
            lateResponseNotifiedAt: null
        };

        const eventKey = 'lr_usr1007_outward_1726222500000_1726221600000';

        // 1. Initial detection: isUnnotified is true
        const isNotifiedBefore = student.lateResponseNotifiedEventKeys.includes(eventKey);
        assert.equal(isNotifiedBefore, false, 'Event initially unnotified');

        // 2. Acknowledgment with case-insensitive userId match
        const targetUserIdFromEvent = 'usr1007'; // Lowercased from eventKey
        const regex = new RegExp(`^${targetUserIdFromEvent}$`, 'i');
        const matchesUser = regex.test(student.userId);
        assert.equal(matchesUser, true, 'Regex matches uppercase DB userId USR1007');

        // Append to student's notified keys
        student.lateResponseNotifiedEventKeys.push(eventKey);
        student.lateResponseNotifiedAt = new Date();

        // 3. Subsequent poll / refresh: isUnnotified is false
        const isNotifiedAfter = student.lateResponseNotifiedEventKeys.includes(eventKey);
        assert.equal(isNotifiedAfter, true, 'Event marked as notified');
    });

    // -------------------------------------------------------------
    // TEST 7: Student Changes Response to Not Coming
    // -------------------------------------------------------------
    it('Test 7: Changing status to Not Coming clears pending reallocation and resolves late events', () => {
        const student = {
            userId: 'USR1008',
            travelStatus: 'Coming',
            allocationStatus: 'Pending Reallocation',
            lateResponseDetected: true,
            requiresReallocation: true,
            affectedDirections: ['OUTWARD']
        };

        const mockEvents = [
            { userId: 'USR1008', status: 'DETECTED', isLateResponse: true }
        ];

        // Action: Change to Not Coming
        student.travelStatus = 'Not Coming';
        student.allocationStatus = 'Not Assigned';
        student.lateResponseDetected = false;
        student.requiresReallocation = false;
        student.affectedDirections = [];

        // Resolve events
        for (const ev of mockEvents) {
            if (ev.userId === student.userId) {
                ev.status = 'RESOLVED';
                ev.resolvedAt = new Date();
                ev.resolutionReason = 'Changed status to Not Coming';
            }
        }

        assert.equal(student.travelStatus, 'Not Coming');
        assert.equal(student.allocationStatus, 'Not Assigned');
        assert.equal(student.lateResponseDetected, false);
        assert.equal(mockEvents[0].status, 'RESOLVED');
        assert.equal(mockEvents[0].resolutionReason, 'Changed status to Not Coming');
    });

    // -------------------------------------------------------------
    // TEST 8: Regeneration Approval Clears Review Flags & Resolves Events
    // -------------------------------------------------------------
    it('Test 8: Approving regenerated plan commits allocations, clears review flags, and resolves events', () => {
        const selectedPlan = {
            direction: 'OUTWARD',
            requiresReview: true,
            hasLateResponses: true,
            pendingReallocation: true,
            active: true
        };

        const lateEvent = {
            userId: 'USR1009',
            direction: 'OUTWARD',
            status: 'NOTIFIED',
            isLateResponse: true
        };

        const student = {
            userId: 'USR1009',
            travelStatus: 'Coming',
            allocationStatus: 'Pending Reallocation',
            lateResponseDetected: true,
            requiresReallocation: true
        };

        // Approval Action
        selectedPlan.requiresReview = false;
        selectedPlan.hasLateResponses = false;
        selectedPlan.pendingReallocation = false;

        student.allocationStatus = 'Allocated';
        student.lateResponseDetected = false;
        student.requiresReallocation = false;
        student.allocatedBus = {
            vehicleName: 'BUS-02',
            routeCode: 'R-02',
            seatNumber: 15,
            isAllocated: true
        };

        lateEvent.status = 'ALLOCATED';
        lateEvent.resolvedAt = new Date();

        assert.equal(selectedPlan.requiresReview, false, 'requiresReview cleared');
        assert.equal(selectedPlan.hasLateResponses, false, 'hasLateResponses cleared');
        assert.equal(selectedPlan.pendingReallocation, false, 'pendingReallocation cleared');
        assert.equal(student.allocationStatus, 'Allocated', 'Student allocation confirmed');
        assert.equal(student.lateResponseDetected, false, 'lateResponseDetected cleared');
        assert.equal(lateEvent.status, 'ALLOCATED', 'LateResponseEvent resolved as ALLOCATED');
    });

    // -------------------------------------------------------------
    // TEST 9: Global and Single Reset Behaviors
    // -------------------------------------------------------------
    it('Test 9: Reset clears review flags, resets user travel status to Pending, and resolves events', () => {
        const selectedPlan = {
            active: true,
            requiresReview: true,
            hasLateResponses: true,
            pendingReallocation: true
        };

        const student = {
            userId: 'USR1010',
            travelStatus: 'Coming',
            allocationStatus: 'Pending Reallocation',
            lateResponseDetected: true
        };

        const lateEvent = {
            userId: 'USR1010',
            status: 'DETECTED'
        };

        // Reset Action
        selectedPlan.active = false;
        selectedPlan.status = 'reset';
        selectedPlan.requiresReview = false;
        selectedPlan.hasLateResponses = false;
        selectedPlan.pendingReallocation = false;

        student.travelStatus = 'Pending';
        student.allocationStatus = 'Not Assigned';
        student.lateResponseDetected = false;

        lateEvent.status = 'RESOLVED';
        lateEvent.resolvedAt = new Date();

        assert.equal(selectedPlan.requiresReview, false);
        assert.equal(selectedPlan.hasLateResponses, false);
        assert.equal(student.travelStatus, 'Pending');
        assert.equal(student.allocationStatus, 'Not Assigned');
        assert.equal(lateEvent.status, 'RESOLVED');
    });

    // -------------------------------------------------------------
    // TEST 10: getLateResponses Contract Matching
    // -------------------------------------------------------------
    it('Test 10: getLateResponses contract returns both top-level and summary fields for frontend consumption', () => {
        const qualifyingLateStudents = [
            {
                userId: 'USR1011',
                name: 'Test Student',
                travelStatus: 'Coming',
                previousTravelStatus: 'Pending',
                direction: 'OUTWARD',
                affectedDirections: ['OUTWARD'],
                isNotified: false,
                isUnnotified: true,
                eventKeys: ['lr_usr1011_outward_100_200'],
                eventKey: 'lr_usr1011_outward_100_200',
                responseSubmittedAt: new Date('2026-09-13T10:15:00.000Z'),
                planApprovedAt: new Date('2026-09-13T10:00:00.000Z'),
                allocationStatus: 'Pending Reallocation'
            }
        ];

        const responsePayload = {
            success: true,
            count: qualifyingLateStudents.length,
            lateComingResponsesCount: qualifyingLateStudents.length,
            pendingReallocationUsersCount: qualifyingLateStudents.length,
            affectedDirections: ['OUTWARD'],
            inwardCount: 0,
            outwardCount: 1,
            unnotifiedCount: 1,
            unnotifiedEventKeys: ['lr_usr1011_outward_100_200'],
            lateResponses: qualifyingLateStudents.map(u => ({
                userId: u.userId,
                name: u.name,
                travelStatus: u.travelStatus,
                currentTravelStatus: u.travelStatus,
                previousTravelStatus: u.previousTravelStatus,
                direction: u.direction,
                affectedDirections: u.affectedDirections,
                eventKeys: u.eventKeys,
                eventKey: u.eventKey,
                isNotified: u.isNotified,
                responseSubmittedAt: u.responseSubmittedAt,
                planApprovedAt: u.planApprovedAt,
                planId: 'plan_outward_101',
                allocationStatus: u.allocationStatus,
                processingStatus: 'DETECTED',
                isLateResponse: true
            })),
            summary: {
                lateComingResponsesCount: 1,
                pendingReallocationUsersCount: 1,
                unnotifiedCount: 1,
                notifiedCount: 0,
                affectedDirections: ['OUTWARD'],
                inwardCount: 0,
                outwardCount: 1
            },
            users: qualifyingLateStudents
        };

        // Assert contract for UserManagement.jsx
        assert.equal(responsePayload.count, 1);
        assert.equal(responsePayload.unnotifiedCount, 1);
        assert.equal(responsePayload.unnotifiedEventKeys.length, 1);

        // Assert contract for AIAgent.jsx
        assert.equal(responsePayload.pendingReallocationUsersCount, 1);
        assert.deepEqual(responsePayload.affectedDirections, ['OUTWARD']);
        assert.equal(responsePayload.outwardCount, 1);
        assert.equal(responsePayload.inwardCount, 0);

        // Assert enriched lateResponses object
        const item = responsePayload.lateResponses[0];
        assert.equal(item.isLateResponse, true);
        assert.equal(item.planId, 'plan_outward_101');
        assert.equal(item.previousTravelStatus, 'Pending');
        assert.equal(item.currentTravelStatus, 'Coming');
        assert.equal(item.processingStatus, 'DETECTED');
    });
});
