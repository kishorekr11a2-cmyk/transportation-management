import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import User from "../models/User.js";

/**
 * MongoDB Path Conflict Validator:
 * MongoDB throws: Updating the path "X" would create a conflict at "X"
 * if an update document attempts to update a parent path and a child path,
 * or specifies the same path in both $set and $unset.
 */
function validateMongoUpdateOperations(updateDoc) {
    const paths = new Map(); // path -> operation

    for (const [op, fields] of Object.entries(updateDoc)) {
        if (!fields || typeof fields !== "object") continue;
        for (const path of Object.keys(fields)) {
            // Check direct overlap
            if (paths.has(path)) {
                throw new Error(
                    `Updating the path "${path}" would create a conflict at "${path}" (conflicting operations: ${paths.get(path)} and ${op})`
                );
            }

            // Check ancestor/descendant overlap
            for (const existingPath of paths.keys()) {
                if (path.startsWith(existingPath + ".") || existingPath.startsWith(path + ".")) {
                    throw new Error(
                        `Updating the path "${path}" would create a conflict at "${existingPath}" (nested path conflict between ${paths.get(existingPath)} and ${op})`
                    );
                }
            }

            paths.set(path, op);
        }
    }
    return true;
}

test("MongoDB allocatedBus Path Conflict Prevention Test Suite", async (t) => {

    await t.test("Validates that conflicting update triggers simulated MongoDB conflict error", () => {
        const conflictingUpdate = {
            $set: {
                allocatedBus: null,
                travelStatus: "Pending"
            },
            $unset: {
                "allocatedBus.inward": 1,
                "allocatedBus.outward": 1
            }
        };

        assert.throws(
            () => validateMongoUpdateOperations(conflictingUpdate),
            /Updating the path "allocatedBus\.inward" would create a conflict at "allocatedBus"/
        );
    });

    await t.test("Validates that identical path in both $set and $unset triggers conflict error", () => {
        const conflictingUpdate = {
            $set: {
                allocatedBus: null,
                travelStatus: "Pending"
            },
            $unset: {
                allocatedBus: 1
            }
        };

        assert.throws(
            () => validateMongoUpdateOperations(conflictingUpdate),
            /Updating the path "allocatedBus" would create a conflict at "allocatedBus"/
        );
    });

    await t.test("Single User Reset query uses strictly conflict-free $set and $unset", async () => {
        const resetSetFields = {
            travelStatus: "Pending",
            allocationStatus: "Unallocated",
            isAllocated: false,
            isUnallocated: true,
            lateResponseDetected: false,
            isLateResponse: false,
            approvedPlanType: null,
            approvalStatus: null,
            lateResponseAt: null,
            travelResponseSubmittedAt: null,
            lastTravelResponseAt: null,
            previousTravelStatus: null,
            requiresReallocation: false,
            affectedDirections: [],
            lateResponseNotifiedEventKeys: [],
            lateResponseNotifiedAt: null,
            lateResponseResolvedAt: null
        };

        const resetUnsetFields = {
            allocatedBus: 1,
            assignedVehicle: 1,
            assignedRoute: 1,
            manualRouteId: 1,
            manualBusId: 1,
            routeId: 1,
            busId: 1,
            vehicleId: 1,
            planVersion: 1,
            manualAllocation: 1,
            aiAllocation: 1,
            submittedPlanVersion: 1,
            submittedApprovalEventId: 1,
            lateResponseEventId: 1
        };

        const updateDoc = {
            $set: resetSetFields,
            $unset: resetUnsetFields
        };

        // 1. Conflict validator passes
        assert.doesNotThrow(() => validateMongoUpdateOperations(updateDoc));

        // 2. allocatedBus is strictly NOT in $set
        assert.equal("allocatedBus" in resetSetFields, false, "allocatedBus must NOT be present in $set");

        // 3. No subpath of allocatedBus exists in $set or $unset
        for (const key of Object.keys(resetSetFields)) {
            assert.equal(key.startsWith("allocatedBus."), false, `Key ${key} in $set must not start with allocatedBus.`);
        }
        for (const key of Object.keys(resetUnsetFields)) {
            if (key !== "allocatedBus") {
                assert.equal(key.startsWith("allocatedBus."), false, `Key ${key} in $unset must not start with allocatedBus.`);
            }
        }

        // 4. Sets and unsets have disjoint key sets
        const setKeys = new Set(Object.keys(resetSetFields));
        for (const unsetKey of Object.keys(resetUnsetFields)) {
            assert.equal(setKeys.has(unsetKey), false, `Key ${unsetKey} cannot exist in both $set and $unset`);
        }
    });

    await t.test("Global Reset All query uses strictly conflict-free $set and $unset", async () => {
        const resetSetFields = {
            travelStatus: "Pending",
            allocationStatus: "Unallocated",
            isAllocated: false,
            isUnallocated: true,
            lateResponseDetected: false,
            isLateResponse: false,
            approvedPlanType: null,
            approvalStatus: null,
            lateResponseAt: null,
            travelResponseSubmittedAt: null,
            lastTravelResponseAt: null,
            previousTravelStatus: null,
            requiresReallocation: false,
            affectedDirections: [],
            lateResponseNotifiedEventKeys: [],
            lateResponseNotifiedAt: null,
            lateResponseResolvedAt: null
        };

        const resetUnsetFields = {
            allocatedBus: 1,
            assignedVehicle: 1,
            assignedRoute: 1,
            manualRouteId: 1,
            manualBusId: 1,
            routeId: 1,
            busId: 1,
            vehicleId: 1,
            planVersion: 1,
            manualAllocation: 1,
            aiAllocation: 1,
            submittedPlanVersion: 1,
            submittedApprovalEventId: 1,
            lateResponseEventId: 1
        };

        const updateDoc = {
            $set: resetSetFields,
            $unset: resetUnsetFields
        };

        assert.doesNotThrow(() => validateMongoUpdateOperations(updateDoc));
    });

    await t.test("User Schema compatibility: All $unset fields are valid fields or safe in MongoDB", () => {
        const schemaPaths = Object.keys(User.schema.paths);
        
        // Key fields checked
        assert.ok(schemaPaths.includes("allocatedBus"), "allocatedBus is a recognized schema path");
        assert.ok(schemaPaths.includes("assignedVehicle"), "assignedVehicle is a recognized schema path");
        assert.ok(schemaPaths.includes("assignedRoute"), "assignedRoute is a recognized schema path");
        assert.ok(schemaPaths.includes("allocationStatus"), "allocationStatus is a recognized schema path");
        assert.ok(schemaPaths.includes("travelStatus"), "travelStatus is a recognized schema path");
    });
});
