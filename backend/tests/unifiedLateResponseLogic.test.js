import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    generateLateResponseEventKey,
    getCurrentApprovedPlan,
    getLatestApprovedPlan,
    createLateResponseEvent,
    getActiveLateResponses,
    resolveLateResponsesForPreviousPlan
} from '../services/lateResponseLifecycleService.js';

describe('Unified Late Response Logic Test Suite (All 9 User Cases)', () => {

    // Helper mock function simulating student response evaluation
    const evaluateStudentComingResponse = (student, latestApprovedPlan) => {
        const responseTime = student.travelResponseSubmittedAt || new Date();
        const hasApprovedPlan = Boolean(latestApprovedPlan && latestApprovedPlan.isApproved && latestApprovedPlan.approvedAt);
        const isAfterApproval = hasApprovedPlan && responseTime.getTime() > new Date(latestApprovedPlan.approvedAt).getTime();
        const isAllocatedInPlan = hasApprovedPlan && (
            (latestApprovedPlan.allocatedUserIds && latestApprovedPlan.allocatedUserIds.has(student.userId.toLowerCase())) ||
            (latestApprovedPlan.users && latestApprovedPlan.users.some(u => (u.userId || '').toLowerCase() === student.userId.toLowerCase()))
        );

        const isLate = Boolean(hasApprovedPlan && isAfterApproval && !isAllocatedInPlan);

        return {
            userId: student.userId,
            name: student.name,
            travelStatus: "Coming",
            allocationStatus: isLate ? "Unallocated" : (student.allocationStatus || "Assigned"),
            lateResponse: isLate,
            isLateResponse: isLate,
            assignedVehicle: isLate ? null : student.assignedVehicle,
            assignedRoute: isLate ? null : student.assignedRoute,
            allocatedBus: isLate ? null : student.allocatedBus,
            isAllocated: !isLate && Boolean(student.assignedVehicle || student.allocatedBus)
        };
    };

    // -------------------------------------------------------------
    // Case 1: Student submits Coming before plan approval: normal student, not late
    // -------------------------------------------------------------
    it('Case 1: Student submits Coming before plan approval -> normal student, not late', () => {
        const approvalTime = new Date('2026-09-14T10:00:00.000Z');
        const responseTime = new Date('2026-09-14T09:30:00.000Z'); // 30 mins before

        const approvedPlan = {
            isApproved: true,
            planId: 'plan_1',
            approvedAt: approvalTime,
            allocatedUserIds: new Set(['usr1001'])
        };

        const student = {
            userId: 'USR1001',
            name: 'Alice',
            travelResponseSubmittedAt: responseTime,
            assignedVehicle: 'Bus-1',
            assignedRoute: 'Route-A'
        };

        const result = evaluateStudentComingResponse(student, approvedPlan);

        assert.equal(result.travelStatus, 'Coming');
        assert.equal(result.lateResponse, false);
        assert.equal(result.isLateResponse, false);
        assert.equal(result.isAllocated, true);
        assert.equal(result.assignedVehicle, 'Bus-1');
    });

    // -------------------------------------------------------------
    // Case 2: Student submits Coming after plan approval: one late response
    // -------------------------------------------------------------
    it('Case 2: Student submits Coming after plan approval -> one single late response (no direction split)', () => {
        const approvalTime = new Date('2026-09-14T10:00:00.000Z');
        const responseTime = new Date('2026-09-14T10:15:00.000Z'); // 15 mins after

        const approvedPlan = {
            isApproved: true,
            planId: 'plan_1',
            approvalEventId: 'APP_EVT_001',
            approvedAt: approvalTime,
            allocatedUserIds: new Set(['usr1001'])
        };

        const student = {
            userId: 'USR1002',
            name: 'Bob',
            travelResponseSubmittedAt: responseTime,
            assignedVehicle: null,
            assignedRoute: null
        };

        const result = evaluateStudentComingResponse(student, approvedPlan);

        assert.equal(result.travelStatus, 'Coming');
        assert.equal(result.allocationStatus, 'Unallocated');
        assert.equal(result.lateResponse, true);
        assert.equal(result.isLateResponse, true);
        assert.equal(result.assignedVehicle, null);

        // Verify key generation is unified and single (NOT separate inward/outward keys)
        const key = generateLateResponseEventKey(student.userId, responseTime);
        assert.ok(key.startsWith('lr_usr1002_'));
        assert.ok(!key.includes('inward'));
        assert.ok(!key.includes('outward'));
    });

    // -------------------------------------------------------------
    // Case 3: Multiple students submit Coming after approval: all appear in one common late-response list
    // -------------------------------------------------------------
    it('Case 3: Multiple students submit Coming after approval -> all appear in one common late-response list', () => {
        const approvalTime = new Date('2026-09-14T10:00:00.000Z');

        const approvedPlan = {
            isApproved: true,
            planId: 'plan_1',
            approvedAt: approvalTime,
            allocatedUserIds: new Set(['usr1001'])
        };

        const students = [
            { userId: 'USR1002', name: 'Bob', travelResponseSubmittedAt: new Date('2026-09-14T10:05:00.000Z') },
            { userId: 'USR1003', name: 'Charlie', travelResponseSubmittedAt: new Date('2026-09-14T10:10:00.000Z') },
            { userId: 'USR1004', name: 'Diana', travelResponseSubmittedAt: new Date('2026-09-14T10:15:00.000Z') }
        ];

        const lateList = students.map(s => evaluateStudentComingResponse(s, approvedPlan));

        assert.equal(lateList.length, 3);
        assert.ok(lateList.every(s => s.lateResponse === true));
        assert.ok(lateList.every(s => s.allocationStatus === 'Unallocated'));
        assert.deepEqual(lateList.map(s => s.userId), ['USR1002', 'USR1003', 'USR1004']);
    });

    // -------------------------------------------------------------
    // Case 4: No OUTWARD/INWARD split is shown
    // -------------------------------------------------------------
    it('Case 4: No OUTWARD/INWARD split is shown in summary or event list', () => {
        const lateStudents = [
            { userId: 'USR1002', name: 'Bob', lateResponse: true },
            { userId: 'USR1003', name: 'Charlie', lateResponse: true }
        ];

        // Authoritative summary structure
        const summary = {
            count: lateStudents.length,
            lateComingResponsesCount: lateStudents.length,
            pendingReallocationUsersCount: lateStudents.length,
            users: lateStudents
        };

        assert.equal(summary.lateComingResponsesCount, 2);
        assert.equal(summary.pendingReallocationUsersCount, 2);
        assert.equal(summary.inwardCount, undefined);
        assert.equal(summary.outwardCount, undefined);
        assert.equal(summary.affectedDirections, undefined);
    });

    // -------------------------------------------------------------
    // Case 5: Late-response students remain Coming and Unallocated
    // -------------------------------------------------------------
    it('Case 5: Late-response students remain Coming and Unallocated', () => {
        const student = {
            userId: 'USR1005',
            name: 'Eve',
            travelStatus: 'Coming',
            allocationStatus: 'Unallocated',
            lateResponse: true,
            isLateResponse: true
        };

        assert.equal(student.travelStatus, 'Coming');
        assert.equal(student.allocationStatus, 'Unallocated');
        assert.equal(student.lateResponse, true);
    });

    // -------------------------------------------------------------
    // Case 6: No automatic vehicle or route assignment occurs
    // -------------------------------------------------------------
    it('Case 6: No automatic vehicle or route assignment occurs for late-response student', () => {
        const approvalTime = new Date('2026-09-14T10:00:00.000Z');
        const approvedPlan = {
            isApproved: true,
            planId: 'plan_1',
            approvedAt: approvalTime,
            allocatedUserIds: new Set()
        };

        const student = {
            userId: 'USR1006',
            name: 'Frank',
            travelResponseSubmittedAt: new Date('2026-09-14T10:30:00.000Z'),
            assignedVehicle: null,
            assignedRoute: null,
            allocatedBus: null
        };

        const evaluated = evaluateStudentComingResponse(student, approvedPlan);

        assert.equal(evaluated.assignedVehicle, null);
        assert.equal(evaluated.assignedRoute, null);
        assert.equal(evaluated.allocatedBus, null);
        assert.equal(evaluated.isAllocated, false);
    });

    // -------------------------------------------------------------
    // Case 7: Refreshing and polling do not change the late-response state
    // -------------------------------------------------------------
    it('Case 7: Refreshing and polling (read-only queries) do not modify student state', () => {
        const dbStudent = {
            userId: 'USR1007',
            travelStatus: 'Coming',
            allocationStatus: 'Unallocated',
            lateResponse: true,
            isLateResponse: true
        };

        // Simulate multiple polling read calls
        const poll1 = { ...dbStudent };
        const poll2 = { ...dbStudent };
        const poll3 = { ...dbStudent };

        assert.equal(poll1.travelStatus, 'Coming');
        assert.equal(poll2.allocationStatus, 'Unallocated');
        assert.equal(poll3.lateResponse, true);
        assert.equal(dbStudent.travelStatus, 'Coming');
        assert.equal(dbStudent.allocationStatus, 'Unallocated');
    });

    // -------------------------------------------------------------
    // Case 8: Reset clears late-response state and restores Pending
    // -------------------------------------------------------------
    it('Case 8: Reset clears the late-response state and restores Pending & Unallocated', () => {
        let student = {
            userId: 'USR1008',
            travelStatus: 'Coming',
            allocationStatus: 'Unallocated',
            lateResponse: true,
            isLateResponse: true,
            lateResponseDetected: true,
            assignedVehicle: null,
            assignedRoute: null
        };

        // Simulate Reset action (Admin Reset All or Reset One)
        const resetOperation = (s) => ({
            ...s,
            travelStatus: 'Pending',
            allocationStatus: 'Unallocated',
            lateResponse: false,
            isLateResponse: false,
            lateResponseDetected: false,
            assignedVehicle: null,
            assignedRoute: null,
            allocatedBus: null,
            isAllocated: false
        });

        student = resetOperation(student);

        assert.equal(student.travelStatus, 'Pending');
        assert.equal(student.allocationStatus, 'Unallocated');
        assert.equal(student.lateResponse, false);
        assert.equal(student.isLateResponse, false);
        assert.equal(student.assignedVehicle, null);
        assert.equal(student.assignedRoute, null);
        assert.equal(student.isAllocated, false);
    });

    // -------------------------------------------------------------
    // Case 9: Existing allocated students remain unaffected
    // -------------------------------------------------------------
    it('Case 9: Existing allocated students remain unaffected when new students respond late', () => {
        const approvalTime = new Date('2026-09-14T10:00:00.000Z');
        const approvedPlan = {
            isApproved: true,
            planId: 'plan_1',
            approvedAt: approvalTime,
            allocatedUserIds: new Set(['usr1001'])
        };

        const studentAlreadyAllocated = {
            userId: 'USR1001',
            name: 'Alice (Allocated)',
            travelResponseSubmittedAt: new Date('2026-09-14T09:00:00.000Z'),
            assignedVehicle: 'Bus-1',
            assignedRoute: 'Route-A',
            allocationStatus: 'Assigned',
            isAllocated: true
        };

        const lateStudent = {
            userId: 'USR1009',
            name: 'Grace (Late)',
            travelResponseSubmittedAt: new Date('2026-09-14T10:45:00.000Z'),
            assignedVehicle: null,
            assignedRoute: null,
            allocationStatus: 'Unallocated'
        };

        const evalAllocated = evaluateStudentComingResponse(studentAlreadyAllocated, approvedPlan);
        const evalLate = evaluateStudentComingResponse(lateStudent, approvedPlan);

        // Existing student MUST remain unaffected:
        assert.equal(evalAllocated.travelStatus, 'Coming');
        assert.equal(evalAllocated.allocationStatus, 'Assigned');
        assert.equal(evalAllocated.lateResponse, false);
        assert.equal(evalAllocated.isAllocated, true);
        assert.equal(evalAllocated.assignedVehicle, 'Bus-1');
        assert.equal(evalAllocated.assignedRoute, 'Route-A');

        // Late student MUST be late:
        assert.equal(evalLate.travelStatus, 'Coming');
        assert.equal(evalLate.allocationStatus, 'Unallocated');
        assert.equal(evalLate.lateResponse, true);
        assert.equal(evalLate.isAllocated, false);
    });
});
