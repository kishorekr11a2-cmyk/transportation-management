import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    calculateStudentTransportStatusSync,
    getActiveAllocationForStudent,
    validateStudentResponse,
    normalizeActivePlans
} from '../services/studentTransportStatusService.js';
import { generateLateResponseEventKey } from '../services/lateResponseLifecycleService.js';

describe('Student Travel Status and Late Response Comprehensive Test Suite (Cases A through F)', () => {

    const T1_BEFORE_PLAN = new Date('2026-09-15T08:00:00.000Z');
    const T2_PLAN_V1_APPROVED = new Date('2026-09-15T09:00:00.000Z');
    const T3_AFTER_PLAN = new Date('2026-09-15T09:30:00.000Z');
    const T4_PLAN_V2_REGEN_DRAFT = new Date('2026-09-15T10:00:00.000Z');
    const T5_PLAN_V2_APPROVED = new Date('2026-09-15T10:15:00.000Z');

    // Approved Plan Version 1
    const planV1 = {
        planId: 'plan_v1_ai',
        planVersion: 1,
        version: 1,
        approvalEventId: 'evt_plan_v1',
        planType: 'AI',
        direction: 'INWARD',
        isApproved: true,
        adminApprovalStatus: 'Approved',
        approvedAt: T2_PLAN_V1_APPROVED,
        buses: [
            {
                vehicleName: 'BUS-01',
                vehicleNumber: 'BUS-01',
                routeCode: 'R-01',
                routeName: 'Route 1: City Line',
                capacity: 50,
                users: ['std_01', 'std_02'],
                allocatedStudents: [
                    { userId: 'std_01', name: 'Student 1', seatNumber: 1 },
                    { userId: 'std_02', name: 'Student 2', seatNumber: 2 }
                ],
                stops: [
                    { name: 'Central', userIds: ['std_01'] },
                    { name: 'West End', userIds: ['std_02'] }
                ]
            }
        ]
    };

    // =========================================================================
    // CASE A: Pending -> Coming before plan approval
    // =========================================================================
    it('CASE A: Pending -> Coming before plan approval - Included in plan normally', async () => {
        const studentPending = {
            userId: 'std_case_a',
            name: 'Alice',
            stoppings: 'Central',
            travelStatus: 'Pending',
            allocationStatus: 'Unallocated',
            isAllocated: false,
            isUnallocated: true
        };

        // Student submits Coming BEFORE any plan is approved
        const validation = await validateStudentResponse({
            user: studentPending,
            activePlan: null,
            travelStatus: 'Coming',
            responseSubmittedAt: T1_BEFORE_PLAN
        });

        assert.equal(validation.allowed, true, 'Validation must allow submission');
        assert.equal(validation.isLate, false, 'Must not be late before plan approval');

        // Student status after submitting Coming (pre-approval)
        const studentComing = {
            ...studentPending,
            travelStatus: 'Coming',
            travelResponseSubmittedAt: T1_BEFORE_PLAN,
            isLateResponse: false,
            lateResponseDetected: false
        };

        // No plan approved yet
        const prePlanStatus = calculateStudentTransportStatusSync(studentComing, []);
        assert.equal(prePlanStatus.travelStatus, 'Coming');
        assert.equal(prePlanStatus.allocationStatus, 'Unallocated');
        assert.equal(prePlanStatus.isAllocated, false);
        assert.equal(prePlanStatus.lateResponse, false);

        // When plan is subsequently generated and approved with this student
        const planWithAlice = {
            ...planV1,
            buses: [
                {
                    ...planV1.buses[0],
                    users: ['std_01', 'std_02', 'std_case_a'],
                    allocatedStudents: [
                        ...planV1.buses[0].allocatedStudents,
                        { userId: 'std_case_a', name: 'Alice', seatNumber: 3 }
                    ]
                }
            ]
        };

        const postApprovalStatus = calculateStudentTransportStatusSync(studentComing, [planWithAlice]);
        assert.equal(postApprovalStatus.isAllocated, true, 'Student should be allocated normally in approved plan');
        assert.equal(postApprovalStatus.allocationStatus, 'Assigned');
        assert.equal(postApprovalStatus.vehicle, 'BUS-01');
        assert.equal(postApprovalStatus.lateResponse, false);
    });

    // =========================================================================
    // CASE B: Pending -> Coming after plan approval
    // =========================================================================
    it('CASE B: Pending -> Coming after plan approval - Marked as late response, remains unallocated, no auto allocation', async () => {
        const studentPending = {
            userId: 'std_case_b',
            name: 'Bob',
            stoppings: 'North Plaza',
            travelStatus: 'Pending',
            allocationStatus: 'Unallocated',
            isAllocated: false,
            isUnallocated: true
        };

        // Student submits Coming AFTER Plan V1 was approved
        const validation = await validateStudentResponse({
            user: studentPending,
            activePlan: planV1,
            travelStatus: 'Coming',
            responseSubmittedAt: T3_AFTER_PLAN
        });

        assert.equal(validation.allowed, true);
        assert.equal(validation.isLate, true, 'Must be flagged as late response');

        // Create single late-response record
        const eventKey = generateLateResponseEventKey(studentPending.userId, 'INWARD', T3_AFTER_PLAN, T2_PLAN_V1_APPROVED);
        assert.ok(eventKey, 'Event key must be generated');

        const studentLate = {
            ...studentPending,
            travelStatus: 'Coming',
            travelResponseSubmittedAt: T3_AFTER_PLAN,
            allocationStatus: 'Unallocated',
            isAllocated: false,
            isUnallocated: true,
            lateResponseDetected: true,
            isLateResponse: true,
            lateResponseAt: T3_AFTER_PLAN,
            requiresReallocation: true,
            submittedApprovalEventId: 'evt_plan_v1',
            submittedPlanVersion: 1
        };

        const activeLateUserIds = new Set(['std_case_b']);
        const lateStatus = calculateStudentTransportStatusSync(studentLate, [planV1], activeLateUserIds);

        assert.equal(lateStatus.travelStatus, 'Coming');
        assert.equal(lateStatus.isAllocated, false, 'Late response student must NOT be allocated');
        assert.equal(lateStatus.allocationStatus, 'Unallocated');
        assert.equal(lateStatus.isUnallocated, true);
        assert.equal(lateStatus.lateResponse, true);
        assert.equal(lateStatus.lateResponseDetected, true);
        assert.equal(lateStatus.vehicle, null, 'Must not be assigned any vehicle');
        assert.equal(lateStatus.route, null, 'Must not be assigned any route');
        assert.equal(lateStatus.allocatedBus, null, 'allocatedBus must be null');
        assert.equal(lateStatus.message, 'Your Coming response was submitted after the plan was approved. Please wait until the administrator regenerates and approves the plan.');
    });

    // =========================================================================
    // CASE C: Not Coming -> Coming
    // =========================================================================
    it('CASE C: Not Coming -> Coming - Backend strictly rejects, status remains Not Coming, no allocation, no late event', async () => {
        const studentNotComing = {
            userId: 'std_case_c',
            name: 'Charlie',
            stoppings: 'East Station',
            travelStatus: 'Not Coming',
            allocationStatus: 'Unallocated',
            isAllocated: false,
            isUnallocated: true
        };

        // Test validateStudentResponse rejection
        const validation = await validateStudentResponse({
            user: studentNotComing,
            activePlan: planV1,
            travelStatus: 'Coming',
            responseSubmittedAt: T3_AFTER_PLAN
        });

        assert.equal(validation.allowed, false, 'Must reject Not Coming -> Coming transition');
        assert.equal(validation.code, 'STATUS_CHANGE_NOT_ALLOWED');
        assert.equal(validation.message, 'You cannot change from Not Coming to Coming. Please contact the administrator.');

        // Verify status remains Not Coming
        const currentStatus = calculateStudentTransportStatusSync(studentNotComing, [planV1]);
        assert.equal(currentStatus.travelStatus, 'Not Coming');
        assert.equal(currentStatus.isAllocated, false);
        assert.equal(currentStatus.allocationStatus, 'Unallocated');
        assert.equal(currentStatus.lateResponse, false, 'No late response event or flag for rejected transition');
        assert.equal(currentStatus.allocatedBus, null);
    });

    // =========================================================================
    // CASE D: Coming student already allocated -> refresh/reload
    // =========================================================================
    it('CASE D: Coming student already allocated -> refresh/reload preserves allocation and creates no duplicate', async () => {
        const studentAllocated = {
            userId: 'std_01',
            name: 'Student 1',
            stoppings: 'Central',
            travelStatus: 'Coming',
            travelResponseSubmittedAt: T1_BEFORE_PLAN,
            allocationStatus: 'Assigned',
            isAllocated: true,
            isUnallocated: false,
            allocatedBus: {
                vehicleName: 'BUS-01',
                routeCode: 'R-01',
                isAllocated: true,
                approved: true
            }
        };

        // 1. Initial status check
        const initialStatus = calculateStudentTransportStatusSync(studentAllocated, [planV1]);
        assert.equal(initialStatus.isAllocated, true);
        assert.equal(initialStatus.allocationStatus, 'Assigned');
        assert.equal(initialStatus.vehicle, 'BUS-01');
        assert.equal(initialStatus.route, 'R-01');
        assert.equal(initialStatus.lateResponse, false);

        // 2. Simulate refresh / reload / repeated queries
        const refreshedStatus = calculateStudentTransportStatusSync(studentAllocated, [planV1]);
        assert.equal(refreshedStatus.isAllocated, true);
        assert.equal(refreshedStatus.allocationStatus, 'Assigned');
        assert.equal(refreshedStatus.vehicle, 'BUS-01');
        assert.equal(refreshedStatus.lateResponse, false);

        // 3. Attempting to resubmit is rejected (submission locked)
        const resubmitValidation = await validateStudentResponse({
            user: studentAllocated,
            activePlan: planV1,
            travelStatus: 'Coming',
            responseSubmittedAt: T3_AFTER_PLAN
        });
        assert.equal(resubmitValidation.allowed, false);
        assert.equal(resubmitValidation.code, 'ALREADY_ALLOCATED');
    });

    // =========================================================================
    // CASE E: Late-response student -> refresh/login/dashboard reload
    // =========================================================================
    it('CASE E: Late-response student -> refresh/login/dashboard reload remains unallocated with correct waiting message', () => {
        const studentLate = {
            userId: 'std_case_e',
            name: 'Diana',
            stoppings: 'Airport Road',
            travelStatus: 'Coming',
            travelResponseSubmittedAt: T3_AFTER_PLAN,
            allocationStatus: 'Unallocated',
            isAllocated: false,
            isUnallocated: true,
            lateResponseDetected: true,
            isLateResponse: true,
            lateResponseAt: T3_AFTER_PLAN,
            requiresReallocation: true,
            submittedApprovalEventId: 'evt_plan_v1',
            submittedPlanVersion: 1,
            // Even if stale fields leaked from an earlier session
            allocatedBus: {
                vehicleName: 'STALE-BUS',
                routeCode: 'STALE-ROUTE',
                isAllocated: true
            },
            assignedVehicle: 'STALE-BUS'
        };

        const activeLateUserIds = new Set(['std_case_e']);

        // 1. Dashboard load
        const dashStatus = calculateStudentTransportStatusSync(studentLate, [planV1], activeLateUserIds);
        assert.equal(dashStatus.isAllocated, false, 'Must remain unallocated on dashboard load');
        assert.equal(dashStatus.allocationStatus, 'Unallocated');
        assert.equal(dashStatus.lateResponse, true);
        assert.equal(dashStatus.vehicle, null);
        assert.equal(dashStatus.allocatedBus, null);
        assert.equal(dashStatus.message, 'Your Coming response was submitted after the plan was approved. Please wait until the administrator regenerates and approves the plan.');

        // 2. Refresh simulation 1 minute later
        const reloadStatus = calculateStudentTransportStatusSync(studentLate, [planV1], activeLateUserIds);
        assert.equal(reloadStatus.isAllocated, false, 'Must remain unallocated on reload');
        assert.equal(reloadStatus.allocationStatus, 'Unallocated');
        assert.equal(reloadStatus.lateResponse, true);
        assert.equal(reloadStatus.vehicle, null);

        // 3. Admin User Management table query
        const mgmtStatus = getActiveAllocationForStudent(studentLate, [planV1], { activeLateUserIds });
        assert.equal(mgmtStatus.isAllocated, false, 'Must remain unallocated in User Management');
        assert.equal(mgmtStatus.allocationStatus, 'Unallocated');
        assert.equal(mgmtStatus.vehicle, null);
    });

    // =========================================================================
    // CASE F: Late-response student -> admin reset/regenerate/approve
    // =========================================================================
    it('CASE F: Late-response student -> admin reset/regenerate/approve allocates student into new plan correctly', () => {
        const studentLate = {
            userId: 'std_case_f',
            name: 'Edward',
            stoppings: 'Hill View',
            travelStatus: 'Coming',
            travelResponseSubmittedAt: T3_AFTER_PLAN,
            allocationStatus: 'Unallocated',
            isAllocated: false,
            isUnallocated: true,
            lateResponseDetected: true,
            isLateResponse: true,
            lateResponseAt: T3_AFTER_PLAN,
            requiresReallocation: true
        };

        const activeLateUserIds = new Set(['std_case_f']);

        // 1. Admin generates Plan Version 2 (draft, NOT approved yet)
        const planV2Draft = {
            planId: 'plan_v2_draft',
            planVersion: 2,
            version: 2,
            planType: 'AI',
            direction: 'INWARD',
            isApproved: false, // DRAFT
            adminApprovalStatus: 'Draft',
            buses: [
                {
                    vehicleName: 'BUS-02',
                    routeCode: 'R-02',
                    users: ['std_01', 'std_02', 'std_case_f'],
                    allocatedStudents: [
                        { userId: 'std_01', name: 'Student 1', seatNumber: 1 },
                        { userId: 'std_02', name: 'Student 2', seatNumber: 2 },
                        { userId: 'std_case_f', name: 'Edward', seatNumber: 3 }
                    ]
                }
            ]
        };

        // In draft phase: student MUST STILL BE UNALLOCATED!
        const draftStatus = calculateStudentTransportStatusSync(studentLate, [planV1, planV2Draft], activeLateUserIds);
        assert.equal(draftStatus.isAllocated, false, 'Student must NOT be allocated before Plan V2 is approved');
        assert.equal(draftStatus.allocationStatus, 'Unallocated');
        assert.equal(draftStatus.lateResponse, true);

        // 2. Admin reviews and APPROVES Plan Version 2
        const planV2Approved = {
            ...planV2Draft,
            planId: 'plan_v2_approved',
            approvalEventId: 'evt_plan_v2',
            isApproved: true,
            adminApprovalStatus: 'Approved',
            approvedAt: T5_PLAN_V2_APPROVED
        };

        // Late response event is resolved on approval of Plan V2
        const emptyLateUserIds = new Set(); // Late event resolved
        const studentUpdated = {
            ...studentLate,
            isLateResponse: false,
            lateResponseDetected: false,
            requiresReallocation: false,
            submittedPlanVersion: 2,
            submittedApprovalEventId: 'evt_plan_v2'
        };

        // Post-approval status check
        const approvedStatus = calculateStudentTransportStatusSync(studentUpdated, [planV2Approved], emptyLateUserIds);
        assert.equal(approvedStatus.isAllocated, true, 'Student must be allocated after Plan V2 approval');
        assert.equal(approvedStatus.allocationStatus, 'Assigned');
        assert.equal(approvedStatus.vehicle, 'BUS-02');
        assert.equal(approvedStatus.route, 'R-02');
        assert.equal(approvedStatus.planVersion, 2);
        assert.equal(approvedStatus.lateResponse, false);

        // Refresh check after Plan V2 approval
        const refreshedPostApproval = calculateStudentTransportStatusSync(studentUpdated, [planV2Approved], emptyLateUserIds);
        assert.equal(refreshedPostApproval.isAllocated, true);
        assert.equal(refreshedPostApproval.vehicle, 'BUS-02');
    });

});
