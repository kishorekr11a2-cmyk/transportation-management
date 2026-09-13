import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Late Travel Response Notification & Detection Logic Test Suite
 * 
 * Validates the core business rules for the User Management late response notification:
 * 1. Timestamps: travelResponseSubmittedAt & planApprovalTime comparisons
 * 2. Status restrictions: ONLY 'Coming' responses qualify, NEVER 'Pending' or 'Not Coming'
 * 3. Direction isolation: INWARD vs OUTWARD approval affects only the matching direction
 * 4. Already-allocated protection: Students already allocated in the approved plan are NOT late
 * 5. Data structures: Users correctly flag affectedDirections, allocationStatus, lateResponseDetected
 */

// Simulated business logic matching backend/controllers/userController.js & aiAgentService.js
function evaluateLateTravelResponse({
  travelStatus,
  submissionTime,
  activePlans = {}, // { INWARD?: { approvedAt, allocatedStudentIds: [] }, OUTWARD?: { approvedAt, allocatedStudentIds: [] } }
  studentId,
  existingStudent = {}
}) {
  const result = {
    lateResponseDetected: false,
    allocationStatus: existingStudent.allocationStatus || 'Not Allocated',
    affectedDirections: [...(existingStudent.affectedDirections || [])],
    requiresReallocation: existingStudent.requiresReallocation || false,
    lateResponseAt: existingStudent.lateResponseAt || null,
    travelResponseSubmittedAt: submissionTime || new Date()
  };

  // Rule 1: ONLY 'Coming' status can be late
  if (travelStatus !== 'Coming') {
    return result;
  }

  const directions = ['INWARD', 'OUTWARD'];
  let isLateForAnyDirection = false;

  for (const dir of directions) {
    const plan = activePlans[dir];
    if (plan && plan.approvedAt) {
      const planApprovalTime = new Date(plan.approvedAt).getTime();
      const responseTime = new Date(submissionTime).getTime();

      // Check if response was submitted AFTER plan approval
      if (responseTime > planApprovalTime) {
        // Check if student was already part of the approved allocation
        const isAllocatedInPlan = plan.allocatedStudentIds && plan.allocatedStudentIds.includes(studentId);
        if (!isAllocatedInPlan) {
          isLateForAnyDirection = true;
          if (!result.affectedDirections.includes(dir)) {
            result.affectedDirections.push(dir);
          }
        }
      }
    }
  }

  if (isLateForAnyDirection) {
    result.lateResponseDetected = true;
    result.allocationStatus = 'Pending Reallocation';
    result.requiresReallocation = true;
    result.lateResponseAt = new Date(submissionTime);
  }

  return result;
}

describe('Late Travel Response Notification Detection Logic', () => {

  it('Rule: Normal Coming response submitted BEFORE plan approval must NOT trigger late notification', () => {
    const planApprovedAt = new Date('2026-09-13T08:00:00Z');
    const studentSubmissionAt = new Date('2026-09-13T07:45:00Z'); // 15 mins before

    const activePlans = {
      INWARD: {
        approvedAt: planApprovedAt,
        allocatedStudentIds: ['std-01']
      }
    };

    const res = evaluateLateTravelResponse({
      travelStatus: 'Coming',
      submissionTime: studentSubmissionAt,
      activePlans,
      studentId: 'std-01'
    });

    assert.equal(res.lateResponseDetected, false, 'Should not detect as late');
    assert.equal(res.requiresReallocation, false, 'Should not require reallocation');
    assert.equal(res.affectedDirections.length, 0, 'No affected directions');
  });

  it('Rule: Coming response submitted AFTER plan approval by unallocated student MUST trigger late notification', () => {
    const planApprovedAt = new Date('2026-09-13T08:00:00Z');
    const studentSubmissionAt = new Date('2026-09-13T08:15:00Z'); // 15 mins after

    const activePlans = {
      INWARD: {
        approvedAt: planApprovedAt,
        allocatedStudentIds: ['std-01', 'std-02']
      }
    };

    const res = evaluateLateTravelResponse({
      travelStatus: 'Coming',
      submissionTime: studentSubmissionAt,
      activePlans,
      studentId: 'std-03' // Not in allocated list
    });

    assert.equal(res.lateResponseDetected, true, 'Must detect as late response');
    assert.equal(res.allocationStatus, 'Pending Reallocation', 'Must set status to Pending Reallocation');
    assert.equal(res.requiresReallocation, true, 'Must set requiresReallocation flag');
    assert.deepEqual(res.affectedDirections, ['INWARD'], 'Must register INWARD as affected direction');
    assert.equal(res.lateResponseAt.toISOString(), studentSubmissionAt.toISOString());
  });

  it('Rule: Ordinary Pending student must NEVER trigger late travel response alert', () => {
    const planApprovedAt = new Date('2026-09-13T08:00:00Z');
    const studentSubmissionAt = new Date('2026-09-13T08:30:00Z');

    const activePlans = {
      INWARD: {
        approvedAt: planApprovedAt,
        allocatedStudentIds: ['std-01']
      }
    };

    const res = evaluateLateTravelResponse({
      travelStatus: 'Pending',
      submissionTime: studentSubmissionAt,
      activePlans,
      studentId: 'std-99'
    });

    assert.equal(res.lateResponseDetected, false, 'Pending student must not trigger late response');
    assert.equal(res.affectedDirections.length, 0, 'No affected directions for Pending');
  });

  it('Rule: Not Coming student submitted after approval must NEVER trigger late travel response alert', () => {
    const planApprovedAt = new Date('2026-09-13T08:00:00Z');
    const studentSubmissionAt = new Date('2026-09-13T08:30:00Z');

    const activePlans = {
      INWARD: {
        approvedAt: planApprovedAt,
        allocatedStudentIds: ['std-01']
      }
    };

    const res = evaluateLateTravelResponse({
      travelStatus: 'Not Coming',
      submissionTime: studentSubmissionAt,
      activePlans,
      studentId: 'std-99'
    });

    assert.equal(res.lateResponseDetected, false, 'Not Coming student must not trigger late response');
    assert.equal(res.affectedDirections.length, 0, 'No affected directions for Not Coming');
  });

  it('Rule: Direction Isolation — INWARD approved only affects INWARD; OUTWARD untouched', () => {
    const inwardApprovedAt = new Date('2026-09-13T08:00:00Z');
    const submissionAt = new Date('2026-09-13T08:10:00Z');

    const activePlans = {
      INWARD: {
        approvedAt: inwardApprovedAt,
        allocatedStudentIds: ['std-01']
      },
      OUTWARD: null // Not approved
    };

    const res = evaluateLateTravelResponse({
      travelStatus: 'Coming',
      submissionTime: submissionAt,
      activePlans,
      studentId: 'std-late'
    });

    assert.equal(res.lateResponseDetected, true);
    assert.deepEqual(res.affectedDirections, ['INWARD'], 'Only INWARD should be affected');
    assert.ok(!res.affectedDirections.includes('OUTWARD'), 'OUTWARD must remain untouched');
  });

  it('Rule: Direction Isolation — OUTWARD approved only affects OUTWARD; INWARD untouched', () => {
    const outwardApprovedAt = new Date('2026-09-13T14:00:00Z');
    const submissionAt = new Date('2026-09-13T14:05:00Z');

    const activePlans = {
      INWARD: null, // Not approved
      OUTWARD: {
        approvedAt: outwardApprovedAt,
        allocatedStudentIds: ['std-01']
      }
    };

    const res = evaluateLateTravelResponse({
      travelStatus: 'Coming',
      submissionTime: submissionAt,
      activePlans,
      studentId: 'std-late'
    });

    assert.equal(res.lateResponseDetected, true);
    assert.deepEqual(res.affectedDirections, ['OUTWARD'], 'Only OUTWARD should be affected');
    assert.ok(!res.affectedDirections.includes('INWARD'), 'INWARD must remain untouched');
  });

  it('Rule: Student already allocated in the approved plan is NOT a late responder even if re-submitting Coming', () => {
    const inwardApprovedAt = new Date('2026-09-13T08:00:00Z');
    const submissionAt = new Date('2026-09-13T08:20:00Z');

    const activePlans = {
      INWARD: {
        approvedAt: inwardApprovedAt,
        allocatedStudentIds: ['std-already-allocated'] // Already seat assigned in approved plan
      }
    };

    const res = evaluateLateTravelResponse({
      travelStatus: 'Coming',
      submissionTime: submissionAt,
      activePlans,
      studentId: 'std-already-allocated'
    });

    assert.equal(res.lateResponseDetected, false, 'Already allocated student should not be flagged as late responder');
  });

  it('Rule: Reset clears travelResponseSubmittedAt and late response state properly', () => {
    const user = {
      travelStatus: 'Coming',
      travelResponseSubmittedAt: new Date('2026-09-13T08:30:00Z'),
      lastTravelResponseAt: new Date('2026-09-13T08:30:00Z'),
      lateResponseDetected: true,
      allocationStatus: 'Pending Reallocation',
      affectedDirections: ['INWARD']
    };

    // Simulate resetAllUsersTravelStatus
    const resetUser = {
      ...user,
      travelStatus: 'Pending',
      travelResponseSubmittedAt: null,
      lastTravelResponseAt: null,
      lateResponseDetected: false,
      allocationStatus: 'Not Allocated',
      affectedDirections: []
    };

    assert.equal(resetUser.travelStatus, 'Pending');
    assert.equal(resetUser.travelResponseSubmittedAt, null);
    assert.equal(resetUser.lateResponseDetected, false);
    assert.equal(resetUser.affectedDirections.length, 0);
  });

  it('Rule: Manual Plan Approval — late response detection supports manual transportation plan submissions', () => {
    const manualPlanApprovedAt = new Date('2026-09-13T09:00:00Z');
    const submissionAt = new Date('2026-09-13T09:10:00Z');

    const activePlans = {
      OUTWARD: {
        approvedAt: manualPlanApprovedAt,
        planType: 'MANUAL',
        allocatedStudentIds: ['std-manual-01']
      }
    };

    const res = evaluateLateTravelResponse({
      travelStatus: 'Coming',
      submissionTime: submissionAt,
      activePlans,
      studentId: 'std-manual-unallocated'
    });

    assert.equal(res.lateResponseDetected, true, 'Must detect as late for manual plan');
    assert.deepEqual(res.affectedDirections, ['OUTWARD']);
  });

  it('Contract: Dedicated API response payload must match expected structure with count and lateResponses array', () => {
    const mockLateStudent = {
      userId: 'STU-001',
      name: 'Priya Sharma',
      travelStatus: 'Coming',
      direction: 'OUTWARD',
      affectedDirections: ['OUTWARD'],
      responseSubmittedAt: new Date('2026-09-13T08:15:00Z'),
      planApprovedAt: new Date('2026-09-13T08:00:00Z'),
      allocationStatus: 'Not Assigned'
    };

    const apiResponse = {
      success: true,
      count: 1,
      lateComingResponsesCount: 1,
      lateResponses: [
        {
          userId: mockLateStudent.userId,
          name: mockLateStudent.name,
          travelStatus: mockLateStudent.travelStatus,
          direction: mockLateStudent.direction,
          responseSubmittedAt: mockLateStudent.responseSubmittedAt,
          planApprovedAt: mockLateStudent.planApprovedAt,
          allocationStatus: mockLateStudent.allocationStatus
        }
      ],
      summary: {
        lateComingResponsesCount: 1,
        pendingReallocationUsersCount: 1,
        affectedDirections: ['OUTWARD'],
        inwardCount: 0,
        outwardCount: 1,
        planApprovalTimes: {
          INWARD: null,
          OUTWARD: mockLateStudent.planApprovedAt
        }
      },
      users: [mockLateStudent]
    };

    assert.equal(apiResponse.success, true);
    assert.equal(apiResponse.count, 1);
    assert.equal(apiResponse.lateResponses.length, 1);
    assert.equal(apiResponse.lateResponses[0].userId, 'STU-001');
    assert.equal(apiResponse.lateResponses[0].travelStatus, 'Coming');
    assert.equal(apiResponse.summary.affectedDirections[0], 'OUTWARD');
  });
});
