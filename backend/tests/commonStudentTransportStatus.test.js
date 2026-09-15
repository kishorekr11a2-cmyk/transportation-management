import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    getCurrentStudentTransportStatus,
    calculateStudentTransportStatusSync,
    batchCalculateStudentTransportStatuses,
    validateStudentResponse,
    getActiveAllocationForStudent
} from '../services/studentTransportStatusService.js';

describe('Common Student Transport Status Service Test Suite', () => {

    // =========================================================================
    // 1. PRIORITY ORDER VERIFICATION
    // Priority 1: Current active approved allocation (wins over everything)
    // Priority 2: Current submitted travel response
    // Priority 3: Pending response
    // Priority 4: Not assigned default state
    // =========================================================================

    it('Priority 1: Active approved allocation strictly overrides pending reallocation and stale flags', () => {
        const student = {
            userId: 'USR1003',
            name: 'Student 3',
            stoppings: 'Anna Nagar West',
            travelStatus: 'Coming',
            allocationStatus: 'Pending Reallocation', // Stale flag
            requiresReallocation: true,              // Stale flag
            lateResponseDetected: true               // Stale flag
        };

        const activePlan = {
            _id: 'plan_v2_ai',
            version: 2,
            planType: 'AI',
            direction: 'INWARD',
            adminApprovalStatus: 'Approved',
            approvalEventId: 'evt_v2_ai',
            approvedAt: new Date('2026-09-14T09:00:00.000Z'),
            buses: [
                {
                    vehicleName: 'BUS-08',
                    vehicleNumber: 'TN-01-AB-1234',
                    routeCode: 'R-08',
                    routeName: 'West Corridor Line',
                    capacity: 50,
                    assignedUsers: ['usr1003'],
                    allocatedStudents: [
                        { userId: 'usr1003', name: 'Student 3', stopName: 'Anna Nagar West', seatNumber: 14 }
                    ],
                    stops: [
                        { stopName: 'Anna Nagar West', stopOrder: 1 }
                    ]
                }
            ]
        };

        const result = calculateStudentTransportStatusSync(student, [activePlan]);

        // Priority 1 asserts
        assert.equal(result.isAllocated, true, 'Student must be marked allocated');
        assert.equal(result.allocationStatus, 'Assigned', 'allocationStatus must be Assigned');
        assert.equal(result.travelStatus, 'Coming', 'travelStatus must be Coming');
        assert.equal(result.allocatedVehicle, 'BUS-08', 'Vehicle name must match active plan');
        assert.equal(result.allocatedRoute, 'R-08', 'Route code must match active plan');
        assert.equal(result.activePlanVersion, 2, 'Active plan version must be 2');
        assert.equal(result.activePlanType, 'AI', 'Plan type must be AI');
        assert.equal(result.submissionLocked, true, 'Submission must be locked once allocated');
        assert.equal(result.lateResponse, false, 'lateResponse must be false once allocated in new plan');
        assert.equal(result.requiresReallocation, false, 'requiresReallocation must be false');
        assert.deepEqual(result.affectedDirections, [], 'affectedDirections must be empty');
        assert.equal(result.allocatedBus.seatNumber, 14, 'Seat number must match allocation');
    });

    it('Priority 2a: Student with travelStatus = "Not Coming" is unallocated and Not Assigned', () => {
        const student = {
            userId: 'USR1002',
            name: 'Student 2',
            stoppings: 'Central Station',
            travelStatus: 'Not Coming',
            allocationStatus: 'Not Assigned',
            travelResponseSubmittedAt: new Date('2026-09-14T08:15:00.000Z'),
            submittedPlanVersion: 1
        };

        const result = calculateStudentTransportStatusSync(student, []);

        assert.equal(result.isAllocated, false);
        assert.equal(result.travelStatus, 'Not Coming');
        assert.equal(result.allocationStatus, 'Unallocated');
        assert.equal(result.allocatedVehicle, null);
        assert.equal(result.allocatedRoute, null);
        assert.equal(result.submissionLocked, false);
        assert.equal(result.lateResponse, false);
    });

    it('Priority 2b: Student with late Coming submission is Unallocated and requires admin reallocation', () => {
        const student = {
            userId: 'USR1003',
            name: 'Student 3',
            stoppings: 'North Gateway',
            travelStatus: 'Coming',
            allocationStatus: 'Unallocated',
            requiresReallocation: true,
            lateResponseDetected: true,
            lateResponseAt: new Date('2026-09-14T09:30:00.000Z'),
            travelResponseSubmittedAt: new Date('2026-09-14T09:30:00.000Z')
        };

        const activePlanV1 = {
            _id: 'plan_v1_ai',
            version: 1,
            direction: 'INWARD',
            adminApprovalStatus: 'Approved',
            approvedAt: new Date('2026-09-14T09:00:00.000Z'),
            buses: []
        };

        const result = calculateStudentTransportStatusSync(student, [activePlanV1]);

        assert.equal(result.isAllocated, false);
        assert.equal(result.travelStatus, 'Coming');
        assert.equal(result.allocationStatus, 'Unallocated');
        assert.equal(result.lateResponse, true);
        assert.equal(result.submissionLocked, false);
        assert.equal(result.allocatedVehicle, null);
    });

    it('Priority 2c: Student with on-time Coming submission but unallocated due to capacity is Unallocated', () => {
        const student = {
            userId: 'USR1005',
            name: 'Student 5',
            stoppings: 'East Coast Road',
            travelStatus: 'Coming',
            allocationStatus: 'Unallocated',
            travelResponseSubmittedAt: new Date('2026-09-14T08:00:00.000Z'),
            submittedPlanVersion: 1
        };

        const activePlanV1 = {
            _id: 'plan_v1_ai',
            version: 1,
            direction: 'INWARD',
            adminApprovalStatus: 'Approved',
            approvedAt: new Date('2026-09-14T09:00:00.000Z'),
            buses: []
        };

        const result = calculateStudentTransportStatusSync(student, [activePlanV1]);

        assert.equal(result.isAllocated, false);
        assert.equal(result.travelStatus, 'Coming');
        assert.equal(result.allocationStatus, 'Unallocated');
        assert.equal(result.lateResponse, false, 'On-time response before plan approval is NOT a late response');
        assert.equal(result.requiresReallocation, false);
        assert.equal(result.submissionLocked, false);
    });

    it('Priority 3: Student with Pending response is Unallocated and submission is unlocked', () => {
        const student = {
            userId: 'USR1004',
            name: 'Student 4',
            stoppings: 'Airport Road',
            travelStatus: 'Pending',
            allocationStatus: 'Unallocated',
            travelResponseSubmittedAt: null
        };

        const result = calculateStudentTransportStatusSync(student, []);

        assert.equal(result.isAllocated, false);
        assert.equal(result.travelStatus, 'Pending');
        assert.equal(result.allocationStatus, 'Unallocated');
        assert.equal(result.submissionLocked, false, 'Pending student must be unlocked to submit response');
        assert.equal(result.allocatedVehicle, null);
        assert.equal(result.allocatedRoute, null);
    });

    // =========================================================================
    // 2. MULTI-STUDENT AND DYNAMIC ID VERIFICATION (NO HARDCODING)
    // Works identically for USR1001, USR1002, USR1003, USR1004, USR1005, and
    // newly generated random student IDs
    // =========================================================================

    it('Universal logic works identically for any arbitrary student ID (USR1001, USR1002, USR1003, newly created)', () => {
        const randomId = `USR_DYNAMIC_${Math.floor(Math.random() * 1000000)}`;
        const testStudentIds = ['USR1001', 'USR1002', 'USR1003', 'USR1004', 'USR1005', randomId];

        const mockPlan = {
            _id: 'plan_dynamic',
            version: 1,
            planType: 'AI',
            adminApprovalStatus: 'Approved',
            buses: [
                {
                    vehicleName: 'BUS-FLEET-99',
                    routeCode: 'R-DYNAMIC-01',
                    assignedUsers: testStudentIds.map((id) => id.toLowerCase()),
                    allocatedStudents: testStudentIds.map((id, idx) => ({
                        userId: id.toLowerCase(),
                        seatNumber: idx + 1
                    }))
                }
            ]
        };

        for (const sId of testStudentIds) {
            const student = {
                userId: sId,
                name: `Test User ${sId}`,
                travelStatus: 'Coming',
                allocationStatus: 'Not Assigned'
            };

            const status = calculateStudentTransportStatusSync(student, [mockPlan]);

            assert.equal(status.isAllocated, true, `Student ${sId} must be allocated`);
            assert.equal(status.allocationStatus, 'Assigned', `Student ${sId} allocationStatus must be Assigned`);
            assert.equal(status.allocatedVehicle, 'BUS-FLEET-99');
            assert.equal(status.allocatedRoute, 'R-DYNAMIC-01');
            assert.equal(status.submissionLocked, true);
        }
    });

    // =========================================================================
    // 3. AI PLAN VS ADMIN / MANUAL PLAN PARITY
    // Admin/Manual plans use the exact same common logic and rules as AI plans
    // =========================================================================

    it('Parity: Admin/Manual plan produces identical status and allocation fields as AI plan', () => {
        const studentAi = {
            userId: 'STUDENT_AI_TEST',
            name: 'AI Test Student',
            travelStatus: 'Coming'
        };

        const studentManual = {
            userId: 'STUDENT_MANUAL_TEST',
            name: 'Manual Test Student',
            travelStatus: 'Coming'
        };

        const aiPlan = {
            _id: 'ai_plan_doc',
            version: 1,
            planType: 'AI',
            adminApprovalStatus: 'Approved',
            buses: [{
                vehicleName: 'AI-BUS-10',
                routeCode: 'AI-R-10',
                assignedUsers: ['student_ai_test'],
                allocatedStudents: [{ userId: 'student_ai_test', seatNumber: 5 }]
            }]
        };

        const manualPlan = {
            _id: 'manual_plan_doc',
            version: 1,
            planType: 'MANUAL',
            adminApprovalStatus: 'Approved',
            buses: [{
                vehicleName: 'MANUAL-BUS-20',
                routeCode: 'MANUAL-R-20',
                assignedUsers: ['student_manual_test'],
                allocatedStudents: [{ userId: 'student_manual_test', seatNumber: 8 }]
            }]
        };

        const aiResult = calculateStudentTransportStatusSync(studentAi, [aiPlan]);
        const manualResult = calculateStudentTransportStatusSync(studentManual, [manualPlan]);

        // Verify structural and behavioral parity
        assert.equal(aiResult.isAllocated, true);
        assert.equal(manualResult.isAllocated, true);
        assert.equal(aiResult.allocationStatus, 'Assigned');
        assert.equal(manualResult.allocationStatus, 'Assigned');
        assert.equal(aiResult.activePlanType, 'AI');
        assert.equal(manualResult.activePlanType, 'MANUAL');
        assert.equal(aiResult.allocatedVehicle, 'AI-BUS-10');
        assert.equal(manualResult.allocatedVehicle, 'MANUAL-BUS-20');
        assert.equal(aiResult.allocatedRoute, 'AI-R-10');
        assert.equal(manualResult.allocatedRoute, 'MANUAL-R-20');
        assert.equal(aiResult.submissionLocked, true);
        assert.equal(manualResult.submissionLocked, true);
    });

    // =========================================================================
    // 4. RESPONSE RULE: ONE STUDENT + ONE PLAN VERSION = ONE RESPONSE ONLY
    // =========================================================================

    it('Response Rule: Rejects duplicate response submission for same plan version', async () => {
        const user = {
            userId: 'USR1003',
            travelStatus: 'Coming',
            submittedPlanVersion: 1,
            submittedApprovalEventId: 'evt_plan_v1'
        };

        const activePlan = {
            planVersion: 1,
            version: 1,
            approvalEventId: 'evt_plan_v1',
            allocatedUserIds: new Set()
        };

        const validation = await validateStudentResponse({
            user,
            activePlan,
            travelStatus: 'Coming'
        });

        assert.equal(validation.allowed, false, 'Duplicate response must be rejected');
        assert.equal(validation.code, 'DUPLICATE_SUBMISSION');
    });

    it('Response Rule: Rejects response submission if student is already allocated in active plan', async () => {
        const user = {
            userId: 'USR1003',
            travelStatus: 'Coming',
            isAllocated: true,
            allocatedBus: {
                isAllocated: true,
                approved: true,
                vehicleName: 'BUS-08'
            }
        };

        const activePlan = {
            planVersion: 2,
            version: 2,
            approvalEventId: 'evt_plan_v2',
            allocatedUserIds: new Set(['usr1003'])
        };

        const validation = await validateStudentResponse({
            user,
            activePlan,
            travelStatus: 'Not Coming'
        });

        assert.equal(validation.allowed, false, 'Already allocated student must be locked from submitting responses');
        assert.equal(validation.code, 'ALREADY_ALLOCATED');
    });

    it('Response Rule: Allows response submission when new plan version is approved and student is not yet allocated', async () => {
        const user = {
            userId: 'USR1004',
            travelStatus: 'Pending',
            submittedPlanVersion: 1, // submitted under V1
            submittedApprovalEventId: 'evt_plan_v1'
        };

        const activePlanV2 = {
            planVersion: 2,
            version: 2,
            approvalEventId: 'evt_plan_v2',
            allocatedUserIds: new Set() // not yet allocated in V2
        };

        const validation = await validateStudentResponse({
            user,
            activePlan: activePlanV2,
            travelStatus: 'Coming'
        });

        assert.equal(validation.allowed, true, 'Must allow submission for newly approved plan version 2');
    });

    // =========================================================================
    // 5. LATE RESPONSE LIFECYCLE PROGRESSION ACROSS PLAN VERSIONS (V1 -> V2)
    // Approval of new plan version resolves old late responses, resets count to 0,
    // and locks newly allocated students.
    // =========================================================================

    it('Lifecycle: Approval of Plan Version 2 resolves Plan Version 1 late responses and locks allocated student', () => {
        // Step A: Student USR1003 submitted late under Plan V1
        const studentV1 = {
            userId: 'USR1003',
            name: 'Student 3',
            travelStatus: 'Coming',
            allocationStatus: 'Pending Reallocation',
            requiresReallocation: true,
            lateResponseDetected: true,
            lateResponseAt: new Date('2026-09-14T09:30:00.000Z'),
            submittedPlanVersion: 1
        };

        const planV1 = {
            _id: 'plan_v1',
            version: 1,
            adminApprovalStatus: 'Approved',
            approvedAt: new Date('2026-09-14T09:00:00.000Z'),
            buses: []
        };

        const statusV1 = calculateStudentTransportStatusSync(studentV1, [planV1]);
        assert.equal(statusV1.isAllocated, false);
        assert.equal(statusV1.allocationStatus, 'Unallocated');
        assert.equal(statusV1.lateResponse, true);

        // Step B: Admin approves Plan Version 2 which allocates USR1003 to BUS-08
        const planV2 = {
            _id: 'plan_v2',
            version: 2,
            adminApprovalStatus: 'Approved',
            approvedAt: new Date('2026-09-14T10:00:00.000Z'),
            buses: [
                {
                    vehicleName: 'BUS-08',
                    routeCode: 'R-08',
                    assignedUsers: ['usr1003'],
                    allocatedStudents: [{ userId: 'usr1003', seatNumber: 12 }]
                }
            ]
        };

        // Note: Even if the student record still has stale V1 flags, calculateStudentTransportStatusSync
        // authoritatively resolves status using the active approved plan!
        const statusV2 = calculateStudentTransportStatusSync(studentV1, [planV2]);
        assert.equal(statusV2.isAllocated, true, 'Must now be allocated in Plan V2');
        assert.equal(statusV2.allocationStatus, 'Assigned');
        assert.equal(statusV2.allocatedVehicle, 'BUS-08');
        assert.equal(statusV2.allocatedRoute, 'R-08');
        assert.equal(statusV2.activePlanVersion, 2);
        assert.equal(statusV2.lateResponse, false, 'Late response resolved by Plan V2 allocation');
        assert.equal(statusV2.requiresReallocation, false);
        assert.equal(statusV2.submissionLocked, true, 'Submission is now locked for USR1003');
    });

    // =========================================================================
    // 6. BATCH CALCULATION CONSISTENCY (STUDENT DASHBOARD & USER MANAGEMENT)
    // Ensures User Management table and metric counts match Student Dashboard
    // =========================================================================

    it('Consistency: Batch calculation across all students produces exact matching counts and statuses', async () => {
        const studentList = [
            { userId: 'USR1001', name: 'User 1', travelStatus: 'Coming' },
            { userId: 'USR1002', name: 'User 2', travelStatus: 'Not Coming' },
            { userId: 'USR1003', name: 'User 3', travelStatus: 'Coming', allocationStatus: 'Pending Reallocation', requiresReallocation: true, lateResponseDetected: true },
            { userId: 'USR1004', name: 'User 4', travelStatus: 'Pending' },
            { userId: 'USR1005', name: 'User 5', travelStatus: 'Coming' }
        ];

        const activePlan = {
            _id: 'plan_batch_test',
            version: 2,
            adminApprovalStatus: 'Approved',
            buses: [
                {
                    vehicleName: 'BUS-01',
                    routeCode: 'R-01',
                    assignedUsers: ['usr1001', 'usr1003'],
                    allocatedStudents: [
                        { userId: 'usr1001', seatNumber: 1 },
                        { userId: 'usr1003', seatNumber: 2 }
                    ]
                }
            ]
        };

        const batchResults = studentList.map((st) => calculateStudentTransportStatusSync(st, [activePlan]));

        // Calculate User Management summary metrics
        let allocatedCount = 0;
        let unallocatedCount = 0;
        let lateComingCount = 0;
        let comingCount = 0;
        let notComingCount = 0;
        let pendingCount = 0;

        for (const st of batchResults) {
            if (st.travelStatus === 'Coming') comingCount++;
            else if (st.travelStatus === 'Not Coming') notComingCount++;
            else pendingCount++;

            if (st.isAllocated) allocatedCount++;
            if (st.travelStatus === 'Coming' && !st.isAllocated) unallocatedCount++;
            if (st.travelStatus === 'Coming' && !st.isAllocated && st.lateResponse) lateComingCount++;
        }

        // Metrics verification
        assert.equal(comingCount, 3, 'USR1001, USR1003, USR1005 are Coming');
        assert.equal(notComingCount, 1, 'USR1002 is Not Coming');
        assert.equal(pendingCount, 1, 'USR1004 is Pending');
        assert.equal(allocatedCount, 2, 'USR1001 and USR1003 are allocated');
        assert.equal(unallocatedCount, 1, 'USR1005 is Coming but unallocated');
        assert.equal(lateComingCount, 0, 'Late responses are 0 because USR1003 was allocated in Plan V2');

        // Individual student dashboard matching
        const usr1003Result = batchResults.find((u) => u.userId === 'USR1003');
        assert.equal(usr1003Result.isAllocated, true);
        assert.equal(usr1003Result.allocationStatus, 'Assigned');
        assert.equal(usr1003Result.allocatedVehicle, 'BUS-01');
        assert.equal(usr1003Result.submissionLocked, true);
    });
});
