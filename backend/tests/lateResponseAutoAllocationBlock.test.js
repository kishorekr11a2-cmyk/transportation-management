import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    calculateStudentTransportStatusSync,
    getActiveAllocationForStudent,
    normalizeActivePlans
} from '../services/studentTransportStatusService.js';
import { getUserAllocatedBus } from '../services/aiAgentService.js';

describe('Late Response Auto Allocation Block Test Suite (Final Correct Implementation)', () => {

    const T1_SUBMIT_COMING_1_2 = new Date('2026-09-14T09:00:00.000Z');
    const T2_PLAN_V1_APPROVED = new Date('2026-09-14T09:30:00.000Z');
    const T3_STUDENT3_SUBMIT_LATE = new Date('2026-09-14T09:45:00.000Z');
    const T4_PLAN_V2_GENERATED = new Date('2026-09-14T10:00:00.000Z');
    const T5_PLAN_V2_APPROVED = new Date('2026-09-14T10:15:00.000Z');

    // =========================================================================
    // 1. AI TEST FLOW (5 STUDENTS)
    // =========================================================================
    describe('AI Plan Flow: 5 Students Full Lifecycle', () => {

        // 5 Students initial state
        const students = [
            { userId: 'USR001', name: 'Student 1', stoppings: 'Stop A', travelStatus: 'Coming', travelResponseSubmittedAt: T1_SUBMIT_COMING_1_2 },
            { userId: 'USR002', name: 'Student 2', stoppings: 'Stop B', travelStatus: 'Coming', travelResponseSubmittedAt: T1_SUBMIT_COMING_1_2 },
            { userId: 'USR003', name: 'Student 3', stoppings: 'Stop C', travelStatus: 'Pending' },
            { userId: 'USR004', name: 'Student 4', stoppings: 'Stop D', travelStatus: 'Pending' },
            { userId: 'USR005', name: 'Student 5', stoppings: 'Stop E', travelStatus: 'Not Coming' }
        ];

        // Step 2 & 3: Admin generates & approves Plan Version 1 with Students 1 & 2
        const planV1 = {
            planId: 'plan_ai_v1',
            planVersion: 1,
            version: 1,
            approvalEventId: 'evt_plan_ai_v1',
            planType: 'AI',
            direction: 'INWARD',
            isApproved: true,
            adminApprovalStatus: 'Approved',
            approvedAt: T2_PLAN_V1_APPROVED,
            buses: [
                {
                    vehicleName: 'BUS-AI-01',
                    vehicleNumber: 'BUS-AI-01',
                    routeCode: 'R-01',
                    routeName: 'Route 1',
                    capacity: 50,
                    users: ['usr001', 'usr002'],
                    allocatedStudents: [
                        { userId: 'usr001', name: 'Student 1', stopName: 'Stop A', seatNumber: 1 },
                        { userId: 'usr002', name: 'Student 2', stopName: 'Stop B', seatNumber: 2 }
                    ],
                    stops: [
                        { name: 'Stop A', userIds: ['usr001'] },
                        { name: 'Stop B', userIds: ['usr002'] }
                    ]
                }
            ]
        };

        it('Steps 1-4: Students 1 and 2 are allocated in Plan Version 1', () => {
            const status1 = calculateStudentTransportStatusSync(students[0], [planV1]);
            assert.equal(status1.isAllocated, true);
            assert.equal(status1.allocationStatus, 'Assigned');
            assert.equal(status1.vehicle, 'BUS-AI-01');

            const status2 = calculateStudentTransportStatusSync(students[1], [planV1]);
            assert.equal(status2.isAllocated, true);
            assert.equal(status2.allocationStatus, 'Assigned');
            assert.equal(status2.vehicle, 'BUS-AI-01');
        });

        it('Steps 5-6: Student 3 submits Coming after approval -> Late Response Detected & Unallocated', () => {
            // Student 3 submits Coming at T3 (after T2 Plan V1 approval)
            const student3Late = {
                ...students[2],
                travelStatus: 'Coming',
                travelResponseSubmittedAt: T3_STUDENT3_SUBMIT_LATE,
                allocationStatus: 'Unallocated',
                isAllocated: false,
                isUnallocated: true,
                lateResponseDetected: true,
                isLateResponse: true,
                submittedApprovalEventId: 'evt_plan_ai_v1',
                submittedPlanVersion: 1
            };

            const activeLateUserIds = new Set(['usr003']);
            const status3 = calculateStudentTransportStatusSync(student3Late, [planV1], activeLateUserIds);

            assert.equal(status3.travelStatus, 'Coming');
            assert.equal(status3.allocationStatus, 'Unallocated');
            assert.equal(status3.isAllocated, false);
            assert.equal(status3.isUnallocated, true);
            assert.equal(status3.lateResponseDetected, true);
            assert.equal(status3.isLateResponse, true);
            assert.equal(status3.reason, 'Late response requires admin reallocation');
            assert.equal(status3.vehicle, null);
            assert.equal(status3.route, null);
        });

        it('Steps 7-9: Simulate Polling, Dashboard load, User Management refresh -> Student 3 remains unallocated', async () => {
            const student3Late = {
                userId: 'USR003',
                name: 'Student 3',
                stoppings: 'Stop C',
                travelStatus: 'Coming',
                travelResponseSubmittedAt: T3_STUDENT3_SUBMIT_LATE,
                allocationStatus: 'Unallocated',
                isAllocated: false,
                isUnallocated: true,
                lateResponseDetected: true,
                isLateResponse: true,
                submittedApprovalEventId: 'evt_plan_ai_v1',
                submittedPlanVersion: 1,
                // Stale fields that might have leaked from old allocation
                allocatedBus: {
                    vehicleName: 'OLD-BUS',
                    routeCode: 'OLD-ROUTE',
                    isAllocated: true
                },
                assignedVehicle: 'OLD-BUS',
                assignedRoute: 'OLD-ROUTE'
            };

            const activeLateUserIds = new Set(['usr003']);

            // 1. Background polling simulation
            const pollStatus = calculateStudentTransportStatusSync(student3Late, [planV1], activeLateUserIds);
            assert.equal(pollStatus.isAllocated, false);
            assert.equal(pollStatus.allocationStatus, 'Unallocated');
            assert.equal(pollStatus.lateResponseDetected, true);
            assert.equal(pollStatus.vehicle, null);

            // 2. Student Dashboard loading simulation
            const dashStatus = getActiveAllocationForStudent(student3Late, [planV1], { activeLateUserIds });
            assert.equal(dashStatus.isAllocated, false);
            assert.equal(dashStatus.allocationStatus, 'Unallocated');
            assert.equal(dashStatus.lateResponseDetected, true);
            assert.equal(dashStatus.vehicle, null);

            // 3. User Management refresh simulation
            const mgmtStatus = calculateStudentTransportStatusSync(student3Late, [planV1], activeLateUserIds);
            assert.equal(mgmtStatus.isAllocated, false);
            assert.equal(mgmtStatus.allocationStatus, 'Unallocated');

            // 4. Confirm Student 3 is NOT in Plan V1 bus passenger list
            const planBuses = planV1.buses;
            const hasStudent3InBus = planBuses.some(b => (b.users || []).includes('usr003'));
            assert.equal(hasStudent3InBus, false, 'Student 3 must never be inserted into old bus passenger list');
        });

        it('Steps 10-11: Generate Plan Version 2 with Student 3 -> Student 3 is STILL unallocated before approval', () => {
            // Plan Version 2 generated (draft, NOT approved)
            const planV2Draft = {
                planId: 'plan_ai_v2_draft',
                planVersion: 2,
                version: 2,
                planType: 'AI',
                direction: 'INWARD',
                isApproved: false, // NOT APPROVED YET
                adminApprovalStatus: 'Draft',
                createdAt: T4_PLAN_V2_GENERATED,
                buses: [
                    {
                        vehicleName: 'BUS-AI-01',
                        capacity: 50,
                        users: ['usr001', 'usr002', 'usr003'],
                        allocatedStudents: [
                            { userId: 'usr001', name: 'Student 1', seatNumber: 1 },
                            { userId: 'usr002', name: 'Student 2', seatNumber: 2 },
                            { userId: 'usr003', name: 'Student 3', seatNumber: 3 }
                        ]
                    }
                ]
            };

            const student3Late = {
                userId: 'USR003',
                name: 'Student 3',
                stoppings: 'Stop C',
                travelStatus: 'Coming',
                travelResponseSubmittedAt: T3_STUDENT3_SUBMIT_LATE,
                allocationStatus: 'Unallocated',
                isAllocated: false,
                isUnallocated: true,
                lateResponseDetected: true,
                isLateResponse: true
            };

            const activeLateUserIds = new Set(['usr003']);

            // Evaluate against the active plans (planV1 is still the only approved plan, planV2Draft is unapproved)
            const statusBeforeApproval = calculateStudentTransportStatusSync(student3Late, [planV1, planV2Draft], activeLateUserIds);
            assert.equal(statusBeforeApproval.isAllocated, false, 'Draft plan cannot allocate Student 3 before approval');
            assert.equal(statusBeforeApproval.allocationStatus, 'Unallocated');
            assert.equal(statusBeforeApproval.lateResponseDetected, true);
        });

        it('Steps 12-15: Approve Plan Version 2 -> Student 3 is allocated, old late-response event resolved, late count 0', () => {
            // Plan Version 2 APPROVED
            const planV2Approved = {
                planId: 'plan_ai_v2_approved',
                planVersion: 2,
                version: 2,
                approvalEventId: 'evt_plan_ai_v2',
                planType: 'AI',
                direction: 'INWARD',
                isApproved: true,
                adminApprovalStatus: 'Approved',
                approvedAt: T5_PLAN_V2_APPROVED,
                buses: [
                    {
                        vehicleName: 'BUS-AI-01',
                        vehicleNumber: 'BUS-AI-01',
                        routeCode: 'R-01',
                        routeName: 'Route 1',
                        capacity: 50,
                        users: ['usr001', 'usr002', 'usr003'],
                        allocatedStudents: [
                            { userId: 'usr001', name: 'Student 1', seatNumber: 1 },
                            { userId: 'usr002', name: 'Student 2', seatNumber: 2 },
                            { userId: 'usr003', name: 'Student 3', seatNumber: 3 }
                        ],
                        stops: [
                            { name: 'Stop A', userIds: ['usr001'] },
                            { name: 'Stop B', userIds: ['usr002'] },
                            { name: 'Stop C', userIds: ['usr003'] }
                        ]
                    }
                ]
            };

            // Now Student 3's late response for Plan V1 is resolved because Plan V2 was approved after T3 submission
            // and Student 3 is included in Plan V2!
            const student3Allocated = {
                userId: 'USR003',
                name: 'Student 3',
                stoppings: 'Stop C',
                travelStatus: 'Coming',
                travelResponseSubmittedAt: T3_STUDENT3_SUBMIT_LATE, // T3 is BEFORE T5 Plan V2 approval!
                allocationStatus: 'Assigned',
                isAllocated: true,
                isUnallocated: false,
                lateResponseDetected: false,
                isLateResponse: false
            };

            // Active late set is now empty (event resolved)
            const activeLateUserIdsAfterV2 = new Set();

            const statusAfterV2 = calculateStudentTransportStatusSync(student3Allocated, [planV2Approved], activeLateUserIdsAfterV2);
            assert.equal(statusAfterV2.isAllocated, true, 'Student 3 must be allocated after Plan V2 approval');
            assert.equal(statusAfterV2.allocationStatus, 'Assigned');
            assert.equal(statusAfterV2.lateResponseDetected, false);
            assert.equal(statusAfterV2.vehicle, 'BUS-AI-01');
            assert.equal(activeLateUserIdsAfterV2.size, 0, 'Active late responses must be 0');
        });
    });

    // =========================================================================
    // 2. MANUAL PLAN FLOW (ADMIN MANUAL PLAN PARITY)
    // =========================================================================
    describe('Admin Manual Plan Flow Parity: 5 Students Full Lifecycle', () => {

        const manualPlanV1 = {
            planId: 'plan_manual_v1',
            planVersion: 1,
            version: 1,
            approvalEventId: 'evt_plan_manual_v1',
            planType: 'MANUAL',
            direction: 'INWARD',
            isApproved: true,
            adminApprovalStatus: 'Approved',
            approvedAt: T2_PLAN_V1_APPROVED,
            buses: [
                {
                    vehicleName: 'MANUAL-BUS-01',
                    vehicleNumber: 'MANUAL-BUS-01',
                    routeCode: 'MR-01',
                    routeName: 'Manual Route 1',
                    capacity: 40,
                    users: ['usr001', 'usr002'],
                    allocatedStudents: [
                        { userId: 'usr001', name: 'Student 1', seatNumber: 1 },
                        { userId: 'usr002', name: 'Student 2', seatNumber: 2 }
                    ],
                    stops: [
                        { name: 'Stop A', userIds: ['usr001'] },
                        { name: 'Stop B', userIds: ['usr002'] }
                    ]
                }
            ]
        };

        it('Manual Steps 1-4: Students 1 and 2 allocated in Manual Plan Version 1', () => {
            const student1 = { userId: 'USR001', travelStatus: 'Coming', travelResponseSubmittedAt: T1_SUBMIT_COMING_1_2 };
            const student2 = { userId: 'USR002', travelStatus: 'Coming', travelResponseSubmittedAt: T1_SUBMIT_COMING_1_2 };

            const status1 = calculateStudentTransportStatusSync(student1, [manualPlanV1]);
            assert.equal(status1.isAllocated, true);
            assert.equal(status1.vehicle, 'MANUAL-BUS-01');

            const status2 = calculateStudentTransportStatusSync(student2, [manualPlanV1]);
            assert.equal(status2.isAllocated, true);
            assert.equal(status2.vehicle, 'MANUAL-BUS-01');
        });

        it('Manual Steps 5-9: Student 3 submits Coming late -> Unallocated, remains unallocated on polling/dash reload', () => {
            const student3Late = {
                userId: 'USR003',
                name: 'Student 3',
                travelStatus: 'Coming',
                travelResponseSubmittedAt: T3_STUDENT3_SUBMIT_LATE,
                allocationStatus: 'Unallocated',
                isAllocated: false,
                isUnallocated: true,
                lateResponseDetected: true,
                isLateResponse: true,
                submittedApprovalEventId: 'evt_plan_manual_v1'
            };

            const activeLateUserIds = new Set(['usr003']);

            const status3 = calculateStudentTransportStatusSync(student3Late, [manualPlanV1], activeLateUserIds);
            assert.equal(status3.travelStatus, 'Coming');
            assert.equal(status3.allocationStatus, 'Unallocated');
            assert.equal(status3.isAllocated, false);
            assert.equal(status3.isUnallocated, true);
            assert.equal(status3.lateResponseDetected, true);
            assert.equal(status3.reason, 'Late response requires admin reallocation');

            // Polling check
            const pollStatus = calculateStudentTransportStatusSync(student3Late, [manualPlanV1], activeLateUserIds);
            assert.equal(pollStatus.isAllocated, false);
            assert.equal(pollStatus.allocationStatus, 'Unallocated');
        });

        it('Manual Steps 10-15: Manual Plan V2 draft keeps Student 3 unallocated; approval allocates Student 3', () => {
            const manualPlanV2Draft = {
                planId: 'plan_manual_v2_draft',
                planVersion: 2,
                planType: 'MANUAL',
                direction: 'INWARD',
                isApproved: false,
                adminApprovalStatus: 'Draft',
                buses: [{ vehicleName: 'MANUAL-BUS-01', users: ['usr001', 'usr002', 'usr003'] }]
            };

            const student3Late = {
                userId: 'USR003',
                travelStatus: 'Coming',
                travelResponseSubmittedAt: T3_STUDENT3_SUBMIT_LATE,
                allocationStatus: 'Unallocated',
                isAllocated: false,
                lateResponseDetected: true
            };

            const activeLateUserIds = new Set(['usr003']);
            const statusDraft = calculateStudentTransportStatusSync(student3Late, [manualPlanV1, manualPlanV2Draft], activeLateUserIds);
            assert.equal(statusDraft.isAllocated, false, 'Manual draft plan cannot allocate Student 3 before approval');

            // Manual Plan V2 APPROVED
            const manualPlanV2Approved = {
                planId: 'plan_manual_v2_approved',
                planVersion: 2,
                version: 2,
                approvalEventId: 'evt_plan_manual_v2',
                planType: 'MANUAL',
                direction: 'INWARD',
                isApproved: true,
                adminApprovalStatus: 'Approved',
                approvedAt: T5_PLAN_V2_APPROVED,
                buses: [
                    {
                        vehicleName: 'MANUAL-BUS-01',
                        routeCode: 'MR-01',
                        capacity: 40,
                        users: ['usr001', 'usr002', 'usr003'],
                        allocatedStudents: [
                            { userId: 'usr001', seatNumber: 1 },
                            { userId: 'usr002', seatNumber: 2 },
                            { userId: 'usr003', seatNumber: 3 }
                        ],
                        stops: [{ name: 'Stop C', userIds: ['usr003'] }]
                    }
                ]
            };

            const student3Allocated = {
                userId: 'USR003',
                travelStatus: 'Coming',
                travelResponseSubmittedAt: T3_STUDENT3_SUBMIT_LATE,
                allocationStatus: 'Assigned',
                isAllocated: true,
                lateResponseDetected: false
            };

            const statusApproved = calculateStudentTransportStatusSync(student3Allocated, [manualPlanV2Approved], new Set());
            assert.equal(statusApproved.isAllocated, true);
            assert.equal(statusApproved.vehicle, 'MANUAL-BUS-01');
            assert.equal(statusApproved.allocationStatus, 'Assigned');
        });
    });

    // =========================================================================
    // 3. ADDITIONAL EDGE CASES & STALE FIELDS
    // =========================================================================
    describe('Edge Cases, Stale Allocation Fields, and State Transitions', () => {

        const approvedPlan = {
            planId: 'plan_edge_v1',
            planVersion: 1,
            version: 1,
            approvalEventId: 'evt_edge_v1',
            planType: 'AI',
            direction: 'INWARD',
            isApproved: true,
            adminApprovalStatus: 'Approved',
            approvedAt: T2_PLAN_V1_APPROVED,
            buses: [
                {
                    vehicleName: 'BUS-01',
                    routeCode: 'R-01',
                    users: ['usr001'],
                    allocatedStudents: [{ userId: 'usr001', seatNumber: 1 }],
                    stops: [{ name: 'Central', userIds: ['usr001'] }]
                }
            ]
        };

        it('Late student with stale allocatedBus must remain unallocated', () => {
            const studentWithStaleAllocatedBus = {
                userId: 'USR003',
                travelStatus: 'Coming',
                travelResponseSubmittedAt: T3_STUDENT3_SUBMIT_LATE,
                allocationStatus: 'Unallocated',
                isAllocated: false,
                isUnallocated: true,
                lateResponseDetected: true,
                isLateResponse: true,
                submittedApprovalEventId: 'evt_edge_v1',
                allocatedBus: {
                    vehicleName: 'STALE-BUS',
                    routeCode: 'STALE-ROUTE',
                    isAllocated: true,
                    approved: true
                }
            };

            const status = calculateStudentTransportStatusSync(studentWithStaleAllocatedBus, [approvedPlan], new Set(['usr003']));
            assert.equal(status.isAllocated, false);
            assert.equal(status.allocationStatus, 'Unallocated');
            assert.equal(status.vehicle, null);
        });

        it('Late student with stale assignedVehicle must remain unallocated', () => {
            const studentWithStaleVehicle = {
                userId: 'USR003',
                travelStatus: 'Coming',
                travelResponseSubmittedAt: T3_STUDENT3_SUBMIT_LATE,
                allocationStatus: 'Unallocated',
                isAllocated: false,
                isUnallocated: true,
                lateResponseDetected: true,
                isLateResponse: true,
                submittedApprovalEventId: 'evt_edge_v1',
                assignedVehicle: 'STALE-BUS-99'
            };

            const status = calculateStudentTransportStatusSync(studentWithStaleVehicle, [approvedPlan], new Set(['usr003']));
            assert.equal(status.isAllocated, false);
            assert.equal(status.allocationStatus, 'Unallocated');
            assert.equal(status.vehicle, null);
        });

        it('Late student with stale assignedRoute must remain unallocated', () => {
            const studentWithStaleRoute = {
                userId: 'USR003',
                travelStatus: 'Coming',
                travelResponseSubmittedAt: T3_STUDENT3_SUBMIT_LATE,
                allocationStatus: 'Unallocated',
                isAllocated: false,
                isUnallocated: true,
                lateResponseDetected: true,
                isLateResponse: true,
                submittedApprovalEventId: 'evt_edge_v1',
                assignedRoute: 'STALE-ROUTE-99'
            };

            const status = calculateStudentTransportStatusSync(studentWithStaleRoute, [approvedPlan], new Set(['usr003']));
            assert.equal(status.isAllocated, false);
            assert.equal(status.allocationStatus, 'Unallocated');
            assert.equal(status.route, null);
        });

        it('Student with travelStatus Pending returns unallocated and submission not locked', () => {
            const pendingStudent = {
                userId: 'USR004',
                travelStatus: 'Pending',
                allocationStatus: 'Unallocated',
                isAllocated: false,
                isUnallocated: true
            };

            const status = calculateStudentTransportStatusSync(pendingStudent, [approvedPlan]);
            assert.equal(status.travelStatus, 'Pending');
            assert.equal(status.allocationStatus, 'Unallocated');
            assert.equal(status.isAllocated, false);
            assert.equal(status.isUnallocated, true);
            assert.equal(status.submissionLocked, false);
        });

        it('Student with travelStatus Not Coming returns unallocated and submission not locked', () => {
            const notComingStudent = {
                userId: 'USR005',
                travelStatus: 'Not Coming',
                allocationStatus: 'Unallocated',
                isAllocated: false,
                isUnallocated: true
            };

            const status = calculateStudentTransportStatusSync(notComingStudent, [approvedPlan]);
            assert.equal(status.travelStatus, 'Not Coming');
            assert.equal(status.allocationStatus, 'Unallocated');
            assert.equal(status.isAllocated, false);
            assert.equal(status.isUnallocated, true);
            assert.equal(status.submissionLocked, false);
        });

        it('Duplicate late response submission does not change unallocated status', () => {
            const lateStudentSubmission1 = {
                userId: 'USR003',
                travelStatus: 'Coming',
                travelResponseSubmittedAt: T3_STUDENT3_SUBMIT_LATE,
                allocationStatus: 'Unallocated',
                isAllocated: false,
                lateResponseDetected: true
            };

            const status1 = calculateStudentTransportStatusSync(lateStudentSubmission1, [approvedPlan], new Set(['usr003']));
            assert.equal(status1.isAllocated, false);
            assert.equal(status1.allocationStatus, 'Unallocated');

            // Second submission attempt
            const lateStudentSubmission2 = {
                ...lateStudentSubmission1,
                travelResponseSubmittedAt: new Date(T3_STUDENT3_SUBMIT_LATE.getTime() + 10000)
            };

            const status2 = calculateStudentTransportStatusSync(lateStudentSubmission2, [approvedPlan], new Set(['usr003']));
            assert.equal(status2.isAllocated, false);
            assert.equal(status2.allocationStatus, 'Unallocated');
        });

        it('Refresh after 1 minute -> student remains unallocated', () => {
            const studentAfter1Min = {
                userId: 'USR003',
                travelStatus: 'Coming',
                travelResponseSubmittedAt: T3_STUDENT3_SUBMIT_LATE,
                allocationStatus: 'Unallocated',
                isAllocated: false,
                isUnallocated: true,
                lateResponseDetected: true
            };

            const status = calculateStudentTransportStatusSync(studentAfter1Min, [approvedPlan], new Set(['usr003']));
            assert.equal(status.isAllocated, false);
            assert.equal(status.allocationStatus, 'Unallocated');
        });

        it('Polling after 1 minute -> student remains unallocated', () => {
            const studentAfter1Min = {
                userId: 'USR003',
                travelStatus: 'Coming',
                travelResponseSubmittedAt: T3_STUDENT3_SUBMIT_LATE,
                allocationStatus: 'Unallocated',
                isAllocated: false,
                isUnallocated: true,
                lateResponseDetected: true
            };

            const status = getActiveAllocationForStudent(studentAfter1Min, [approvedPlan], { activeLateUserIds: new Set(['usr003']) });
            assert.equal(status.isAllocated, false);
            assert.equal(status.allocationStatus, 'Unallocated');
        });

        it('Plan approved but student NOT included -> student remains unallocated', () => {
            // Plan Version 2 approved, but only includes Students 1 and 2 (capacity limit reached for Student 3)
            const planV2WithoutStudent3 = {
                planId: 'plan_edge_v2',
                planVersion: 2,
                version: 2,
                approvalEventId: 'evt_edge_v2',
                planType: 'AI',
                direction: 'INWARD',
                isApproved: true,
                adminApprovalStatus: 'Approved',
                approvedAt: T5_PLAN_V2_APPROVED,
                buses: [
                    {
                        vehicleName: 'BUS-01',
                        routeCode: 'R-01',
                        users: ['usr001', 'usr002'], // USR003 NOT INCLUDED
                        allocatedStudents: [
                            { userId: 'usr001', seatNumber: 1 },
                            { userId: 'usr002', seatNumber: 2 }
                        ],
                        stops: [
                            { name: 'Stop A', userIds: ['usr001'] },
                            { name: 'Stop B', userIds: ['usr002'] }
                        ]
                    }
                ]
            };

            const student3NotIncluded = {
                userId: 'USR003',
                travelStatus: 'Coming',
                travelResponseSubmittedAt: T3_STUDENT3_SUBMIT_LATE,
                allocationStatus: 'Unallocated',
                isAllocated: false,
                isUnallocated: true
            };

            const status = calculateStudentTransportStatusSync(student3NotIncluded, [planV2WithoutStudent3], new Set());
            assert.equal(status.isAllocated, false, 'Student 3 must remain unallocated if not in new plan');
            assert.equal(status.allocationStatus, 'Unallocated');
            assert.equal(status.vehicle, null);
        });

        it('Reset One followed by Coming after approval -> detected as late response and remains unallocated', () => {
            // Student was reset to Pending
            const studentReset = {
                userId: 'USR001',
                travelStatus: 'Pending',
                allocationStatus: 'Unallocated',
                isAllocated: false,
                isUnallocated: true
            };

            const pendingStatus = calculateStudentTransportStatusSync(studentReset, [approvedPlan]);
            assert.equal(pendingStatus.travelStatus, 'Pending');
            assert.equal(pendingStatus.isAllocated, false);

            // Student then submits Coming AFTER approved plan time
            const studentComingPostApproval = {
                ...studentReset,
                travelStatus: 'Coming',
                travelResponseSubmittedAt: new Date(T2_PLAN_V1_APPROVED.getTime() + 15000), // Submitted post-approval
                allocationStatus: 'Unallocated',
                isAllocated: false,
                isUnallocated: true,
                lateResponseDetected: true
            };

            const lateStatus = calculateStudentTransportStatusSync(studentComingPostApproval, [approvedPlan], new Set(['usr001']));
            assert.equal(lateStatus.travelStatus, 'Coming');
            assert.equal(lateStatus.isAllocated, false);
            assert.equal(lateStatus.allocationStatus, 'Unallocated');
            assert.equal(lateStatus.lateResponseDetected, true);
        });

        it('Reset All followed by Coming after approval -> detected as late response and remains unallocated', () => {
            // All students reset to Pending
            const allStudentsReset = [
                { userId: 'USR001', travelStatus: 'Pending', allocationStatus: 'Unallocated', isAllocated: false },
                { userId: 'USR002', travelStatus: 'Pending', allocationStatus: 'Unallocated', isAllocated: false }
            ];

            allStudentsReset.forEach(s => {
                const res = calculateStudentTransportStatusSync(s, [approvedPlan]);
                assert.equal(res.travelStatus, 'Pending');
                assert.equal(res.isAllocated, false);
            });

            // Student 2 submits Coming after approved plan timestamp
            const student2ComingLate = {
                userId: 'USR002',
                travelStatus: 'Coming',
                travelResponseSubmittedAt: new Date(T2_PLAN_V1_APPROVED.getTime() + 60000),
                allocationStatus: 'Unallocated',
                isAllocated: false,
                isUnallocated: true,
                lateResponseDetected: true
            };

            const lateStatus = calculateStudentTransportStatusSync(student2ComingLate, [approvedPlan], new Set(['usr002']));
            assert.equal(lateStatus.travelStatus, 'Coming');
            assert.equal(lateStatus.isAllocated, false);
            assert.equal(lateStatus.allocationStatus, 'Unallocated');
            assert.equal(lateStatus.lateResponseDetected, true);
        });
    });
});
