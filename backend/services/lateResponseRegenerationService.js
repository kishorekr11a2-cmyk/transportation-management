import mongoose from "mongoose";
import User from "../models/User.js";
import Vehicle from "../models/Vehicle.js";
import Route from "../models/Route.js";
import Schedule from "../models/Schedule.js";
import InwardStartingPlace from "../models/InwardStartingPlace.js";
import {
    calculateDistanceKm,
    getRoadRouteGeometry,
    isValidCoordinate,
    canonicalizeDirection,
    sanitizeTransportationPlan,
    persistPlanToUsers,
    findStartingPlaceForBus,
    isBusHubSuitableForStops,
    isStopNearOrAlongRoute
} from "./aiAgentService.js";
import {
    getInstitutionalHub,
    resolveStopCoordinates,
    normalizeStopName
} from "./manualPlanRecommendationService.js";
import { resolveLateResponsesForPreviousPlan } from "./lateResponseLifecycleService.js";
import { clearActiveApprovedPlansCache } from "./studentTransportStatusService.js";

const isDbConnected = () => mongoose.connection?.readyState === 1;

/**
 * Helper to get the active approved plan for a direction from ai_selected_plans or fallback
 */
export const getActiveApprovedPlanForDirection = async (direction) => {
    if (!isDbConnected() || !mongoose.connection.db) return null;

    const canonicalDirection = (String(direction).toUpperCase().trim() === "OUTWARD") ? "OUTWARD" : "INWARD";

    // 1. Check ai_selected_plans (primary authoritative source)
    const doc = await mongoose.connection.db.collection("ai_selected_plans").findOne(
        {
            active: true,
            status: "active",
            approved: true,
            $or: [
                { direction: canonicalDirection },
                { tripMode: canonicalDirection },
                { tripMode: canonicalDirection === "OUTWARD" ? "FROM_SOURCE" : "TO_DESTINATION" },
                { "plan.direction": canonicalDirection },
                { "plan.tripMode": canonicalDirection }
            ]
        },
        {
            projection: {
                plan: 1,
                direction: 1,
                tripMode: 1,
                planType: 1,
                startingPoint: 1,
                selectedAt: 1,
                approvedAt: 1,
                createdAt: 1
            }
        }
    );

    if (doc && doc.plan) {
        return {
            sourceCollection: "ai_selected_plans",
            plan: doc.plan,
            planType: doc.planType || "AI",
            direction: canonicalDirection,
            tripMode: doc.tripMode || (canonicalDirection === "OUTWARD" ? "FROM_SOURCE" : "TO_DESTINATION"),
            approvedAt: doc.approvedAt || doc.selectedAt || doc.createdAt || new Date(),
            startingPoint: doc.startingPoint || null
        };
    }

    // 2. Check AiPlan collection
    const aiPlanDoc = await mongoose.connection.db.collection("aiplans").findOne(
        {
            active: true,
            status: "active",
            isApproved: true,
            $or: [
                { direction: canonicalDirection },
                { tripMode: canonicalDirection },
                { tripMode: canonicalDirection === "OUTWARD" ? "FROM_SOURCE" : "TO_DESTINATION" }
            ]
        }
    );

    if (aiPlanDoc) {
        return {
            sourceCollection: "aiplans",
            plan: aiPlanDoc,
            planType: "AI",
            direction: canonicalDirection,
            tripMode: aiPlanDoc.tripMode || (canonicalDirection === "OUTWARD" ? "FROM_SOURCE" : "TO_DESTINATION"),
            approvedAt: aiPlanDoc.approvedAt || aiPlanDoc.createdAt || new Date(),
            startingPoint: aiPlanDoc.source || aiPlanDoc.startingPoint || null
        };
    }

    // 3. Check manual_plan_submissions
    const manualDoc = await mongoose.connection.db.collection("manual_plan_submissions").findOne(
        {
            $or: [
                { direction: canonicalDirection },
                { direction: canonicalDirection.toLowerCase() }
            ],
            isSubmitted: true
        }
    );

    if (manualDoc && manualDoc.plan) {
        return {
            sourceCollection: "manual_plan_submissions",
            plan: manualDoc.plan,
            planType: "MANUAL",
            direction: canonicalDirection,
            tripMode: canonicalDirection === "OUTWARD" ? "FROM_SOURCE" : "TO_DESTINATION",
            approvedAt: manualDoc.submittedAt || manualDoc.confirmedAt || manualDoc.createdAt || new Date(),
            startingPoint: null
        };
    }

    return null;
};

/**
 * Core Route Regeneration Engine for Late Responses
 * 
 * REVIEW-ONLY: Generates a new draft plan without activating it or allocating students.
 */
export const regenerateLateResponsePlan = async ({ direction = "OUTWARD" } = {}) => {
    if (!isDbConnected()) {
        throw new Error("Database is currently unavailable.");
    }

    const canonicalDirection = (String(direction).toUpperCase().trim() === "OUTWARD") ? "OUTWARD" : "INWARD";
    const isOutward = canonicalDirection === "OUTWARD";
    const tripMode = isOutward ? "FROM_SOURCE" : "TO_DESTINATION";

    // 1. Fetch active approved plan
    const activePlanRecord = await getActiveApprovedPlanForDirection(canonicalDirection);
    if (!activePlanRecord || !activePlanRecord.plan) {
        return {
            success: false,
            code: "NO_ACTIVE_APPROVED_PLAN",
            message: `No active approved transportation plan found for ${canonicalDirection}. Please approve an initial transportation plan first before regenerating routes for late responses.`
        };
    }

    const activePlan = activePlanRecord.plan;
    const planApprovalTime = new Date(activePlanRecord.approvedAt);

    // 2. Fetch Institutional Hub
    const institutionalHub = await getInstitutionalHub();
    const collegeCoord = {
        name: institutionalHub.name || "K.L.N. College of Engineering",
        latitude: Number(institutionalHub.latitude) || 9.8242,
        longitude: Number(institutionalHub.longitude) || 78.1794
    };

    // 3. Extract existing approved allocation user IDs
    const existingAllocatedUserIds = new Set();
    const existingBuses = Array.isArray(activePlan.buses)
        ? activePlan.buses
        : (Array.isArray(activePlan.routes) ? activePlan.routes : []);

    for (const bus of existingBuses) {
        const users = bus.users || bus.allocatedStudents || bus.passengers || [];
        for (const u of users) {
            const uId = typeof u === "string" ? u : (u.userId || u._id || u.id);
            if (uId) existingAllocatedUserIds.add(String(uId).toLowerCase().trim());
        }
    }

    // 4. Query all confirmed Coming students
    const confirmedComingStudents = await User.find({
        role: "student",
        travelStatus: "Coming"
    })
        .select({
            userId: 1,
            name: 1,
            stoppings: 1,
            city: 1,
            district: 1,
            state: 1,
            country: 1,
            latitude: 1,
            longitude: 1,
            travelStatus: 1,
            allocationStatus: 1,
            lateResponseDetected: 1,
            lateResponseAt: 1,
            travelResponseSubmittedAt: 1,
            lastTravelResponseAt: 1,
            requiresReallocation: 1,
            affectedDirections: 1,
            allocatedBus: 1,
            createdAt: 1,
            updatedAt: 1
        })
        .lean();

    // 5. Partition students: Existing Allocated vs. Late Coming Responders
    const lateStudents = [];
    const existingAllocatedStudents = [];

    for (const student of confirmedComingStudents) {
        const sId = String(student.userId || "").toLowerCase().trim();
        const sMongoId = String(student._id || "").toLowerCase().trim();

        const isAllocatedInPlan = existingAllocatedUserIds.has(sId) ||
            existingAllocatedUserIds.has(sMongoId) ||
            Boolean(
                student.allocatedBus?.[canonicalDirection.toLowerCase()]?.isAllocated &&
                (student.allocatedBus[canonicalDirection.toLowerCase()].approved === true ||
                 student.allocatedBus[canonicalDirection.toLowerCase()].adminApprovalStatus === "Approved")
            );

        const responseTime = new Date(
            student.travelResponseSubmittedAt ||
            student.lastTravelResponseAt ||
            student.lateResponseAt ||
            student.updatedAt ||
            student.createdAt
        );

        const isSubmittedAfterApproval = responseTime.getTime() > planApprovalTime.getTime();
        const isExplicitlyFlaggedLate = Boolean(student.lateResponseDetected) ||
            student.allocationStatus === "Pending Reallocation" ||
            Boolean(student.requiresReallocation);

        if (!isAllocatedInPlan && (isSubmittedAfterApproval || isExplicitlyFlaggedLate)) {
            lateStudents.push(student);
        } else {
            existingAllocatedStudents.push(student);
        }
    }

    if (lateStudents.length === 0) {
        return {
            success: true,
            status: "NO_LATE_RESPONSES",
            direction: canonicalDirection,
            message: `No qualifying late Coming students detected for ${canonicalDirection}. All confirmed Coming students are already allocated.`,
            lateStudentsCount: 0
        };
    }

    // 6. Fetch fleet inventory, vehicle availability, and inward starting places
    const [allVehicles, allRoutesInDb, allSchedules] = await Promise.all([
        Vehicle.find().lean(),
        Route.find().populate("assignedVehicle").lean(),
        Schedule.find().lean()
    ]);

    let activeInwardStartingPlaces = [];
    if (!isOutward) {
        try {
            activeInwardStartingPlaces = await InwardStartingPlace.find({ active: true }).lean();
        } catch (err) {
            console.error("Error loading inward starting places in late response regeneration:", err);
            activeInwardStartingPlaces = [];
        }
    }

    // Filter out vehicles marked unavailable in Schedule
    const unavailableVehicleIds = new Set();
    allSchedules.forEach((s) => {
        const vId = String(s.vehicle?._id || s.vehicle || "");
        const status = String(s.availability || s.status || "").toLowerCase().trim();
        if (
            status === "not available" ||
            status === "unavailable" ||
            status.includes("not available") ||
            status.includes("unavailable") ||
            status.includes("maintenance") ||
            status === "disabled" ||
            status === "inactive" ||
            status === "off"
        ) {
            if (vId) unavailableVehicleIds.add(vId);
        }
    });

    // Track vehicle usage in the existing active plan
    const usedVehicleIds = new Set();
    existingBuses.forEach((b) => {
        const vId = b.vehicleId || b.vehicle?._id || b.assignedVehicle?._id || b.assignedVehicle;
        if (vId) usedVehicleIds.add(String(vId));
    });

    const idleVehicles = allVehicles.filter((v) => {
        const vid = String(v._id);
        return !usedVehicleIds.has(vid) && !unavailableVehicleIds.has(vid);
    });

    // 7. Group late students by residential stopping area
    const lateStopsMap = new Map();
    for (const student of lateStudents) {
        const stopName = (student.stoppings || "Unspecified Stop").trim();
        if (!lateStopsMap.has(stopName)) {
            const coords = resolveStopCoordinates(stopName, student);
            lateStopsMap.set(stopName, {
                stopName,
                students: [],
                count: 0,
                latitude: coords.latitude,
                longitude: coords.longitude
            });
        }
        const entry = lateStopsMap.get(stopName);
        entry.students.push(student);
        entry.count++;
        if (!isValidCoordinate(entry.latitude, entry.longitude) && isValidCoordinate(student.latitude, student.longitude)) {
            entry.latitude = Number(student.latitude);
            entry.longitude = Number(student.longitude);
        }
    }

    // 8. Clone existing routes to prepare proposed continuous routes
    const proposedRoutes = existingBuses.map((bus, idx) => {
        const rawExistingUsers = bus.users || bus.allocatedStudents || bus.passengers || [];
        const existingUsers = rawExistingUsers
            .map((u) => (typeof u === "string" ? u : String(u.userId || u._id || u.id || "")))
            .filter(Boolean);
        const existingAllocatedStudents = (Array.isArray(bus.allocatedStudents) ? bus.allocatedStudents : []).map((st, sIdx) => ({
            userId: typeof st === "string" ? st : String(st.userId || st._id || st.id || ""),
            name: typeof st === "object" ? (st.name || "") : "",
            seatNumber: (typeof st === "object" && st.seatNumber) ? Number(st.seatNumber) : (sIdx + 1)
        }));
        if (existingAllocatedStudents.length === 0 && existingUsers.length > 0) {
            existingUsers.forEach((uId, uIdx) => {
                existingAllocatedStudents.push({ userId: uId, seatNumber: uIdx + 1 });
            });
        }

        // Recalculate changed demand: filter to only students currently confirmed as Coming
        const confirmedComingSet = new Set(
            confirmedComingStudents.map((s) => String(s.userId || s._id).toLowerCase().trim())
        );

        const currentStops = (bus.stops || []).map((s, sIdx) => {
            const validUserIds = (Array.isArray(s.userIds) ? s.userIds : []).filter((uid) =>
                confirmedComingSet.has(String(uid).toLowerCase().trim())
            );
            const userCount = validUserIds.length > 0
                ? validUserIds.length
                : (s.userIds && s.userIds.length > 0 ? 0 : Number(s.userCount || 0));
            return {
                order: s.order || (sIdx + 1),
                name: s.name || `Stop ${sIdx + 1}`,
                address: s.address || "",
                latitude: Number(s.latitude),
                longitude: Number(s.longitude),
                userCount,
                userIds: validUserIds,
                isNewStop: false,
                newLateStudentsCount: 0
            };
        });

        const activeUsers = existingUsers.filter((uId) => confirmedComingSet.has(String(uId).toLowerCase().trim()));
        const activeAllocatedStudents = existingAllocatedStudents.filter((st) =>
            confirmedComingSet.has(String(st.userId).toLowerCase().trim())
        );
        const existingCapacity = Number(bus.capacity) || 70;
        const currentAssignedCount = activeUsers.length > 0 ? activeUsers.length : currentStops.reduce((sum, s) => sum + s.userCount, 0);

        const configuredStartPlace = !isOutward ? findStartingPlaceForBus(bus, activeInwardStartingPlaces) : null;
        const resolvedStartLoc = bus.startLocation || bus.inwardStartLocation || configuredStartPlace || null;

        return {
            routeNumber: bus.routeNumber || (idx + 1),
            routeCode: bus.routeCode || `R-${String(idx + 1).padStart(2, "0")}`,
            routeName: bus.routeName || `${bus.routeCode || 'R-01'}: ${bus.vehicleName || 'Bus'}`,
            vehicleName: bus.vehicleName || "Assigned Bus",
            vehicleNumber: bus.vehicleNumber || bus.vehicleName || "Assigned Bus",
            vehicleId: bus.vehicleId || bus.assignedVehicle?._id || bus.assignedVehicle || null,
            capacity: existingCapacity,
            assignedUsers: currentAssignedCount,
            remainingSeats: Math.max(0, existingCapacity - currentAssignedCount),
            stops: currentStops,
            users: activeUsers,
            allocatedStudents: activeAllocatedStudents,
            startLocation: resolvedStartLoc,
            inwardStartLocation: resolvedStartLoc,
            sourceHub: resolvedStartLoc,
            newStopsAdded: [],
            newLateStudentsAccommodated: 0,
            roadDistanceKm: Number(bus.routeDistanceKm || bus.roadDistanceKm || 0),
            routeDurationMin: Number(bus.routeDurationMin || bus.estimatedTimeMin || 0),
            isRoadVerified: Boolean(bus.isRoadVerified),
            roadRouteStatus: bus.roadRouteStatus || "Current Plan",
            roadGeometry: bus.roadGeometry || [],
            currentRouteSummary: {
                routeCode: bus.routeCode || `R-${String(idx + 1).padStart(2, "0")}`,
                vehicleName: bus.vehicleName || "Assigned Bus",
                capacity: existingCapacity,
                assignedUsers: currentAssignedCount,
                stopsCount: currentStops.length,
                roadDistanceKm: Number(bus.routeDistanceKm || bus.roadDistanceKm || 0)
            }
        };
    });

    const accommodatedStudents = [];
    const standbyStudents = [];

    // 9. Smart Late Student Integration
    // Process each late stop group
    for (const [stopName, stopGroup] of lateStopsMap.entries()) {
        const stopLat = stopGroup.latitude;
        const stopLon = stopGroup.longitude;
        let assignedToRoute = false;

        // OPTION A: Accommodate in an existing route that passes near the stop and has capacity
        let bestRouteIdx = -1;
        let minDetourOrDist = Infinity;

        if (isValidCoordinate(stopLat, stopLon)) {
            const candStop = { name: stopName, latitude: stopLat, longitude: stopLon };
            proposedRoutes.forEach((route, rIdx) => {
                if (route.remainingSeats >= stopGroup.count) {
                    const existingStopIndex = (route.stops || []).findIndex(
                        (s) => normalizeStopName(s.name) === normalizeStopName(stopName)
                    );

                    if (existingStopIndex !== -1) {
                        // Stop already exists on this route: detour is 0, highest priority
                        if (0 < minDetourOrDist) {
                            minDetourOrDist = 0;
                            bestRouteIdx = rIdx;
                        }
                    } else if (!isOutward) {
                        // Strict Inward condition: stop must be near/along the alternative bus's current route
                        // AND adding it does not create an unreasonable route deviation (detour <= 5.0km).
                        const check = isStopNearOrAlongRoute({
                            stop: candStop,
                            route,
                            sourceHub: route.startLocation || route.inwardStartLocation || route.sourceHub,
                            destinationHub: collegeCoord,
                            maxDetourKm: 5.0,
                            maxProximityKm: 5.5
                        });

                        if (check.suitable && check.detourKm < minDetourOrDist) {
                            minDetourOrDist = check.detourKm;
                            bestRouteIdx = rIdx;
                        }
                    } else {
                        // Outward: standard corridor threshold (within 5.5km)
                        for (const existingStop of (route.stops || [])) {
                            if (isValidCoordinate(existingStop.latitude, existingStop.longitude)) {
                                const d = calculateDistanceKm(stopLat, stopLon, existingStop.latitude, existingStop.longitude);
                                if (d <= 5.5 && d < minDetourOrDist) {
                                    minDetourOrDist = d;
                                    bestRouteIdx = rIdx;
                                }
                            }
                        }
                    }
                }
            });
        }

        // If a suitable route was found within constraints
        if (bestRouteIdx !== -1) {
            const targetRoute = proposedRoutes[bestRouteIdx];
            
            // Check if stop already exists in this route
            const existingStopIndex = targetRoute.stops.findIndex(
                (s) => normalizeStopName(s.name) === normalizeStopName(stopName)
            );

            if (existingStopIndex !== -1) {
                // Add late students to the existing stop
                const targetStop = targetRoute.stops[existingStopIndex];
                targetStop.userCount += stopGroup.count;
                targetStop.newLateStudentsCount += stopGroup.count;
                stopGroup.students.forEach((st) => {
                    const sId = String(st.userId || st._id);
                    targetRoute.assignedUsers++;
                    const assignedSeatNumber = targetRoute.assignedUsers;
                    targetStop.userIds.push(sId);
                    targetRoute.users.push(sId);
                    if (!Array.isArray(targetRoute.allocatedStudents)) targetRoute.allocatedStudents = [];
                    targetRoute.allocatedStudents.push({
                        userId: sId,
                        name: st.name || "",
                        seatNumber: assignedSeatNumber
                    });
                    accommodatedStudents.push({
                        studentId: sId,
                        studentName: st.name,
                        stoppingArea: stopName,
                        assignedRouteCode: targetRoute.routeCode,
                        assignedVehicleName: targetRoute.vehicleName,
                        seatNumber: assignedSeatNumber,
                        integrationType: "EXISTING_STOP_ACCOMMODATION"
                    });
                });
            } else {
                // Insert new stop into continuous road sequence
                const newStopObj = {
                    order: targetRoute.stops.length + 1,
                    name: stopName,
                    address: stopGroup.students[0]?.city || stopName,
                    latitude: stopLat,
                    longitude: stopLon,
                    userCount: stopGroup.count,
                    userIds: stopGroup.students.map((st) => String(st.userId || st._id)),
                    isNewStop: true,
                    newLateStudentsCount: stopGroup.count
                };

                // Find optimal insertion index based on distance to college hub
                const distToCollege = calculateDistanceKm(stopLat, stopLon, collegeCoord.latitude, collegeCoord.longitude);
                let insertIndex = targetRoute.stops.length;

                for (let i = 0; i < targetRoute.stops.length; i++) {
                    const curStop = targetRoute.stops[i];
                    const curDist = calculateDistanceKm(curStop.latitude, curStop.longitude, collegeCoord.latitude, collegeCoord.longitude);
                    if (isOutward) {
                        // OUTWARD: Stops ordered from near College to far residential
                        if (distToCollege < curDist) {
                            insertIndex = i;
                            break;
                        }
                    } else {
                        // INWARD: Stops ordered from far residential to near College
                        if (distToCollege > curDist) {
                            insertIndex = i;
                            break;
                        }
                    }
                }

                targetRoute.stops.splice(insertIndex, 0, newStopObj);
                // Re-sequence stop orders
                targetRoute.stops.forEach((s, idx) => { s.order = idx + 1; });
                targetRoute.newStopsAdded.push(stopName);

                stopGroup.students.forEach((st) => {
                    const sId = String(st.userId || st._id);
                    targetRoute.assignedUsers++;
                    const assignedSeatNumber = targetRoute.assignedUsers;
                    targetRoute.users.push(sId);
                    if (!Array.isArray(targetRoute.allocatedStudents)) targetRoute.allocatedStudents = [];
                    targetRoute.allocatedStudents.push({
                        userId: sId,
                        name: st.name || "",
                        seatNumber: assignedSeatNumber
                    });
                    accommodatedStudents.push({
                        studentId: sId,
                        studentName: st.name,
                        stoppingArea: stopName,
                        assignedRouteCode: targetRoute.routeCode,
                        assignedVehicleName: targetRoute.vehicleName,
                        seatNumber: assignedSeatNumber,
                        integrationType: "NEW_STOP_INSERTION"
                    });
                });
            }

            targetRoute.remainingSeats = Math.max(0, targetRoute.capacity - targetRoute.assignedUsers);
            targetRoute.newLateStudentsAccommodated += stopGroup.count;
            assignedToRoute = true;
        }

        // OPTION B: Vehicle Capacity Upgrade for a saturated corridor
        if (!assignedToRoute && idleVehicles.length > 0) {
            // Find a corridor that matches this stop but ran out of capacity
            let candidateRIdx = -1;
            let nearestDist = Infinity;

            if (isValidCoordinate(stopLat, stopLon)) {
                proposedRoutes.forEach((route, rIdx) => {
                    for (const existingStop of route.stops) {
                        if (isValidCoordinate(existingStop.latitude, existingStop.longitude)) {
                            const d = calculateDistanceKm(stopLat, stopLon, existingStop.latitude, existingStop.longitude);
                            if (d < nearestDist && d <= 6.0) {
                                nearestDist = d;
                                candidateRIdx = rIdx;
                            }
                        }
                    }
                });
            }

            if (candidateRIdx !== -1) {
                const targetRoute = proposedRoutes[candidateRIdx];
                const neededCapacity = targetRoute.assignedUsers + stopGroup.count;
                
                // Look for an idle vehicle with sufficient capacity
                // STRICT INWARD BUS CHANGE RULE:
                // Alternative bus is available AND has sufficient capacity AND its configured starting hub is near/suitable.
                let upgradeVehicleIdx = -1;
                if (!isOutward && activeInwardStartingPlaces.length > 0) {
                    upgradeVehicleIdx = idleVehicles.findIndex((v) => {
                        const hasCap = Number(v.capacity) >= neededCapacity;
                        if (!hasCap) return false;
                        const suitability = isBusHubSuitableForStops(v, targetRoute.stops, activeInwardStartingPlaces);
                        return suitability.suitable;
                    });
                } else {
                    upgradeVehicleIdx = idleVehicles.findIndex((v) => Number(v.capacity) >= neededCapacity);
                }

                if (upgradeVehicleIdx !== -1) {
                    const upgradeVehicle = idleVehicles.splice(upgradeVehicleIdx, 1)[0];
                    targetRoute.vehicleName = upgradeVehicle.vehicleName;
                    targetRoute.vehicleNumber = upgradeVehicle.vehicleName;
                    targetRoute.vehicleId = upgradeVehicle._id;
                    targetRoute.capacity = Number(upgradeVehicle.capacity);
                    targetRoute.vehicleUpgraded = true;

                    if (!isOutward && activeInwardStartingPlaces.length > 0) {
                        const sp = findStartingPlaceForBus(upgradeVehicle, activeInwardStartingPlaces);
                        if (sp) {
                            const formattedPlace = {
                                vehicleId: sp.vehicleId || sp.busId || upgradeVehicle._id,
                                busName: sp.busName || upgradeVehicle.vehicleName,
                                name: sp.locationName || sp.name,
                                locationName: sp.locationName || sp.name,
                                address: sp.address || "",
                                latitude: Number(sp.latitude),
                                longitude: Number(sp.longitude)
                            };
                            targetRoute.startLocation = formattedPlace;
                            targetRoute.inwardStartLocation = formattedPlace;
                            targetRoute.sourceHub = formattedPlace;
                        }
                    }

                    // Now insert the stop
                    const newStopObj = {
                        order: targetRoute.stops.length + 1,
                        name: stopName,
                        address: stopGroup.students[0]?.city || stopName,
                        latitude: stopLat,
                        longitude: stopLon,
                        userCount: stopGroup.count,
                        userIds: stopGroup.students.map((st) => String(st.userId || st._id)),
                        isNewStop: true,
                        newLateStudentsCount: stopGroup.count
                    };

                    targetRoute.stops.push(newStopObj);
                    targetRoute.stops.forEach((s, idx) => { s.order = idx + 1; });
                    targetRoute.newStopsAdded.push(stopName);

                    stopGroup.students.forEach((st) => {
                        const sId = String(st.userId || st._id);
                        targetRoute.assignedUsers++;
                        const assignedSeatNumber = targetRoute.assignedUsers;
                        targetRoute.users.push(sId);
                        if (!Array.isArray(targetRoute.allocatedStudents)) targetRoute.allocatedStudents = [];
                        targetRoute.allocatedStudents.push({
                            userId: sId,
                            name: st.name || "",
                            seatNumber: assignedSeatNumber
                        });
                        accommodatedStudents.push({
                            studentId: sId,
                            studentName: st.name,
                            stoppingArea: stopName,
                            assignedRouteCode: targetRoute.routeCode,
                            assignedVehicleName: targetRoute.vehicleName,
                            seatNumber: assignedSeatNumber,
                            integrationType: "VEHICLE_UPGRADE_ACCOMMODATION"
                        });
                    });

                    targetRoute.remainingSeats = Math.max(0, targetRoute.capacity - targetRoute.assignedUsers);
                    targetRoute.newLateStudentsAccommodated += stopGroup.count;
                    assignedToRoute = true;
                }
            }
        }

        // OPTION C: Form a new route if idle fleet vehicle is available
        // STRICT INWARD BUS CHANGE RULE:
        // Alternative bus is available AND has capacity AND its starting hub is near/suitable.
        let newVehIdx = -1;
        if (!assignedToRoute && idleVehicles.length > 0) {
            if (!isOutward && activeInwardStartingPlaces.length > 0) {
                newVehIdx = idleVehicles.findIndex((v) => {
                    const hasCap = (Number(v.capacity) || 50) >= stopGroup.count;
                    if (!hasCap) return false;
                    const suitability = isBusHubSuitableForStops(v, [stopGroup], activeInwardStartingPlaces);
                    return suitability.suitable;
                });
            } else {
                newVehIdx = 0;
            }
        }

        if (newVehIdx !== -1) {
            const newVeh = idleVehicles.splice(newVehIdx, 1)[0];
            const newRouteNumber = proposedRoutes.length + 1;
            const newRouteCode = `R-${String(newRouteNumber).padStart(2, "0")}`;
            const newRouteName = `${newRouteCode}: ${newVeh.vehicleName}`;

            const newAllocatedStudents = stopGroup.students.map((st, sIdx) => ({
                userId: String(st.userId || st._id),
                name: st.name || "",
                seatNumber: sIdx + 1
            }));

            let configuredStartLocation = null;
            if (!isOutward && activeInwardStartingPlaces.length > 0) {
                const sp = findStartingPlaceForBus(newVeh, activeInwardStartingPlaces);
                if (sp) {
                    configuredStartLocation = {
                        vehicleId: sp.vehicleId || sp.busId || newVeh._id,
                        busName: sp.busName || newVeh.vehicleName,
                        name: sp.locationName || sp.name,
                        locationName: sp.locationName || sp.name,
                        address: sp.address || "",
                        latitude: Number(sp.latitude),
                        longitude: Number(sp.longitude)
                    };
                }
            }

            const newRouteObj = {
                routeNumber: newRouteNumber,
                routeCode: newRouteCode,
                routeName: newRouteName,
                vehicleName: newVeh.vehicleName,
                vehicleNumber: newVeh.vehicleName,
                vehicleId: newVeh._id,
                capacity: Number(newVeh.capacity) || 50,
                assignedUsers: stopGroup.count,
                remainingSeats: Math.max(0, (Number(newVeh.capacity) || 50) - stopGroup.count),
                stops: [
                    {
                        order: 1,
                        name: stopName,
                        address: stopGroup.students[0]?.city || stopName,
                        latitude: stopLat,
                        longitude: stopLon,
                        userCount: stopGroup.count,
                        userIds: stopGroup.students.map((st) => String(st.userId || st._id)),
                        isNewStop: true,
                        newLateStudentsCount: stopGroup.count,
                        previousStopName: configuredStartLocation?.name || null
                    }
                ],
                users: stopGroup.students.map((st) => String(st.userId || st._id)),
                allocatedStudents: newAllocatedStudents,
                startLocation: configuredStartLocation,
                inwardStartLocation: configuredStartLocation,
                sourceHub: configuredStartLocation,
                newStopsAdded: [stopName],
                newLateStudentsAccommodated: stopGroup.count,
                isNewRoute: true,
                roadDistanceKm: 0,
                routeDurationMin: 0,
                isRoadVerified: false,
                roadRouteStatus: "New Route Generated",
                roadGeometry: [],
                currentRouteSummary: null
            };

            stopGroup.students.forEach((st, sIdx) => {
                const sId = String(st.userId || st._id);
                accommodatedStudents.push({
                    studentId: sId,
                    studentName: st.name,
                    stoppingArea: stopName,
                    assignedRouteCode: newRouteCode,
                    assignedVehicleName: newVeh.vehicleName,
                    seatNumber: sIdx + 1,
                    integrationType: "NEW_ROUTE_FORMATION"
                });
            });

            proposedRoutes.push(newRouteObj);
            assignedToRoute = true;
        }

        // OPTION D: Unable to accommodate via any alternative bus or new route.
        // INWARD STANDING PASSENGER FALLBACK:
        // For INWARD direction: do NOT leave the student unallocated.
        // Keep them on the nearest existing route as standing passengers.
        // They ARE allocated — they will travel standing/over-capacity.
        // OUTWARD: mark as standby (cannot board over capacity for outward).
        if (!assignedToRoute) {
            if (!isOutward && proposedRoutes.length > 0) {
                // Find the nearest existing route (by closest stop to this student stop)
                let nearestRouteIdx = 0;
                let minDist = Infinity;
                proposedRoutes.forEach((route, rIdx) => {
                    for (const existingSt of (route.stops || [])) {
                        if (isValidCoordinate(existingSt.latitude, existingSt.longitude)) {
                            const d = calculateDistanceKm(stopLat, stopLon, existingSt.latitude, existingSt.longitude);
                            if (d < minDist) {
                                minDist = d;
                                nearestRouteIdx = rIdx;
                            }
                        }
                    }
                });

                const standingRoute = proposedRoutes[nearestRouteIdx];
                const standingExistingIdx = standingRoute.stops.findIndex(
                    (s) => normalizeStopName(s.name) === normalizeStopName(stopName)
                );

                if (standingExistingIdx !== -1) {
                    // Add to existing stop as standing passengers
                    standingRoute.stops[standingExistingIdx].userCount += stopGroup.count;
                    standingRoute.stops[standingExistingIdx].userIds.push(
                        ...stopGroup.students.map((st) => String(st.userId || st._id))
                    );
                    standingRoute.stops[standingExistingIdx].standingCount =
                        (standingRoute.stops[standingExistingIdx].standingCount || 0) + stopGroup.count;
                } else {
                    // Insert a new stop entry marked as standing
                    const distToCollege = calculateDistanceKm(stopLat, stopLon, collegeCoord.latitude, collegeCoord.longitude);
                    let insertIndex = standingRoute.stops.length;
                    for (let i = 0; i < standingRoute.stops.length; i++) {
                        const curDist = calculateDistanceKm(
                            standingRoute.stops[i].latitude, standingRoute.stops[i].longitude,
                            collegeCoord.latitude, collegeCoord.longitude
                        );
                        if (distToCollege > curDist) { insertIndex = i; break; }
                    }
                    standingRoute.stops.splice(insertIndex, 0, {
                        order: insertIndex + 1,
                        name: stopName,
                        latitude: stopLat,
                        longitude: stopLon,
                        userCount: stopGroup.count,
                        userIds: stopGroup.students.map((st) => String(st.userId || st._id)),
                        standingCount: stopGroup.count,
                        isStandingStop: true,
                        newLateStudentsCount: stopGroup.count
                    });
                    standingRoute.stops.forEach((s, idx) => { s.order = idx + 1; });
                }

                // Accumulate standing stats on the route
                standingRoute.standingPassengers = (standingRoute.standingPassengers || 0) + stopGroup.count;
                standingRoute.assignedUsers += stopGroup.count;
                standingRoute.isOverCapacity = standingRoute.assignedUsers > standingRoute.capacity;
                standingRoute.seatedPassengers = Math.min(standingRoute.assignedUsers, standingRoute.capacity);
                standingRoute.overCapacityCount = Math.max(0, standingRoute.assignedUsers - standingRoute.capacity);
                standingRoute.remainingSeats = 0;
                standingRoute.newLateStudentsAccommodated += stopGroup.count;

                stopGroup.students.forEach((st) => {
                    const sId = String(st.userId || st._id);
                    standingRoute.users.push(sId);
                    if (!Array.isArray(standingRoute.allocatedStudents)) standingRoute.allocatedStudents = [];
                    standingRoute.allocatedStudents.push({
                        userId: sId,
                        name: st.name || "",
                        standingPassenger: true
                    });
                    accommodatedStudents.push({
                        studentId: sId,
                        studentName: st.name,
                        stoppingArea: stopName,
                        assignedRouteCode: standingRoute.routeCode,
                        assignedVehicleName: standingRoute.vehicleName,
                        integrationType: "STANDING_PASSENGER_FALLBACK",
                        isStandingPassenger: true
                    });
                });

                console.log(`[STANDING FALLBACK LATE] ${standingRoute.vehicleName}: +${stopGroup.count} standing at "${stopName}" (${standingRoute.assignedUsers}/${standingRoute.capacity} total — ${standingRoute.overCapacityCount} over capacity)`);

            } else {
                // OUTWARD: standard standby (cannot exceed capacity for outward)
                stopGroup.students.forEach((st) => {
                    standbyStudents.push({
                        studentId: String(st.userId || st._id),
                        studentName: st.name,
                        stoppingArea: stopName,
                        reason: "FLEET_CAPACITY_LIMIT"
                    });
                });
            }
        }
    }

    // 10. Continuous Road Sequencing & OSRM Road Validation for all proposed routes
    for (const route of proposedRoutes) {
        // Continuous ordering check:
        // OUTWARD: College Hub -> stops ordered from near to far residential
        // INWARD: stops ordered from far residential to near -> College Hub
        if (isOutward) {
            route.stops.sort((a, b) => {
                const distA = calculateDistanceKm(a.latitude, a.longitude, collegeCoord.latitude, collegeCoord.longitude);
                const distB = calculateDistanceKm(b.latitude, b.longitude, collegeCoord.latitude, collegeCoord.longitude);
                return distA - distB;
            });
        } else {
            route.stops.sort((a, b) => {
                const distA = calculateDistanceKm(a.latitude, a.longitude, collegeCoord.latitude, collegeCoord.longitude);
                const distB = calculateDistanceKm(b.latitude, b.longitude, collegeCoord.latitude, collegeCoord.longitude);
                return distB - distA;
            });
        }
        route.stops.forEach((s, idx) => { s.order = idx + 1; });

        // Build waypoint array for OSRM validation
        const routeStartLoc = route.startLocation || route.inwardStartLocation;
        const validStops = route.stops.filter((s) => isValidCoordinate(s.latitude, s.longitude));
        const waypoints = isOutward
            ? [collegeCoord, ...validStops]
            : (routeStartLoc && isValidCoordinate(routeStartLoc.latitude, routeStartLoc.longitude)
                ? [routeStartLoc, ...validStops, collegeCoord]
                : [...validStops, collegeCoord]);

        if (!isOutward && routeStartLoc && route.stops.length > 0) {
            route.stops[0].previousStopName = routeStartLoc.locationName || routeStartLoc.name;
        }

        if (waypoints.length >= 2) {
            try {
                const osrmResult = await getRoadRouteGeometry(waypoints);
                if (osrmResult && osrmResult.isRoadVerified) {
                    route.roadDistanceKm = Number(osrmResult.distanceKm);
                    route.routeDurationMin = Math.round(Number(osrmResult.durationSeconds || 0) / 60);
                    route.isRoadVerified = true;
                    route.roadRouteStatus = "OSRM Verified";
                    route.roadGeometry = osrmResult.geometry || [];
                } else {
                    // Fallback calculation using straight line * 1.35 road factor
                    let straightKm = 0;
                    for (let i = 0; i < waypoints.length - 1; i++) {
                        straightKm += calculateDistanceKm(waypoints[i].latitude, waypoints[i].longitude, waypoints[i + 1].latitude, waypoints[i + 1].longitude);
                    }
                    route.roadDistanceKm = Number((straightKm * 1.35).toFixed(2));
                    route.routeDurationMin = Math.round((route.roadDistanceKm / 35) * 60);
                    route.isRoadVerified = false;
                    route.roadRouteStatus = "Calibrated Fallback (Network Unavailable)";
                }
            } catch (err) {
                console.warn(`OSRM validation failed for ${route.routeCode}:`, err.message);
                route.isRoadVerified = false;
                route.roadRouteStatus = "Validation Offline";
            }
        }
    }

    // 11. Compile Plan Summaries & Metrics
    const currentDemand = existingAllocatedStudents.length;
    const newLateDemand = lateStudents.length;
    const proposedDemand = currentDemand + accommodatedStudents.length;

    const currentCapacity = existingBuses.reduce((sum, b) => sum + (Number(b.capacity) || 70), 0);
    const proposedCapacity = proposedRoutes.reduce((sum, r) => sum + (Number(r.capacity) || 70), 0);

    const currentTotalKm = existingBuses.reduce((sum, b) => sum + Number(b.routeDistanceKm || b.roadDistanceKm || 0), 0);
    const proposedTotalKm = proposedRoutes.reduce((sum, r) => sum + Number(r.roadDistanceKm || 0), 0);

    const currentTotalMin = existingBuses.reduce((sum, b) => sum + Number(b.routeDurationMin || b.estimatedTimeMin || 0), 0);
    const proposedTotalMin = proposedRoutes.reduce((sum, r) => sum + Number(r.routeDurationMin || 0), 0);

    const proposedPlanSummary = {
        direction: canonicalDirection,
        tripMode,
        totalRoutes: proposedRoutes.length,
        currentDemand,
        newLateDemand,
        proposedDemand,
        currentCapacity,
        proposedCapacity,
        remainingSeats: Math.max(0, proposedCapacity - proposedDemand),
        accommodatedCount: accommodatedStudents.length,
        standbyCount: standbyStudents.length,
        additionalDistanceKm: Number(Math.max(0, proposedTotalKm - currentTotalKm).toFixed(2)),
        additionalDurationMin: Math.max(0, proposedTotalMin - currentTotalMin),
        osrmRoadVerified: proposedRoutes.every((r) => r.isRoadVerified),
        isFullyAccommodated: standbyStudents.length === 0
    };

    const currentPlanSummary = {
        direction: canonicalDirection,
        totalRoutes: existingBuses.length,
        demand: currentDemand,
        capacity: currentCapacity,
        totalKm: Number(currentTotalKm.toFixed(2)),
        totalMin: currentTotalMin,
        planType: activePlanRecord.planType,
        approvedAt: activePlanRecord.approvedAt
    };

    // Ensure allocatedUserIds array is on each route and draftDoc
    const allAllocatedUserIds = new Set();
    proposedRoutes.forEach((r) => {
        (r.users || []).forEach((u) => allAllocatedUserIds.add(String(u)));
        (r.allocatedStudents || []).forEach((s) => allAllocatedUserIds.add(String(s.userId || s)));
        r.allocatedUserIds = Array.from(new Set([
            ...(r.users || []).map(String),
            ...(r.allocatedStudents || []).map((s) => String(s.userId || s))
        ]));
    });

    // 12. Persist to late_response_drafts (Review-Only Draft Storage)
    const draftDoc = {
        direction: canonicalDirection,
        tripMode,
        isDraft: true,
        status: "draft",
        approved: false,
        generatedAt: new Date(),
        planType: "LATE_RESPONSE_REGENERATION",
        sourceHub: isOutward ? collegeCoord : null,
        destinationHub: !isOutward ? collegeCoord : null,
        currentPlanSummary,
        proposedPlanSummary,
        routes: proposedRoutes,
        buses: proposedRoutes, // compatibility with persistPlanToUsers
        accommodatedStudents,
        standbyStudents,
        allocatedUserIds: Array.from(allAllocatedUserIds),
        lateStudentsCount: lateStudents.length
    };

    if (mongoose.connection.db) {
        await mongoose.connection.db.collection("late_response_drafts").deleteMany({
            direction: canonicalDirection
        });
        const insertRes = await mongoose.connection.db.collection("late_response_drafts").insertOne(draftDoc);
        draftDoc._id = insertRes.insertedId;
    }

    return {
        success: true,
        isDraft: true,
        status: "DRAFT_PENDING_APPROVAL",
        direction: canonicalDirection,
        message: `Regenerated transportation plan draft created for ${canonicalDirection}. Review proposed changes before approving.`,
        draft: draftDoc
    };
};

/**
 * Retrieves the pending late response draft for a direction
 */
export const getLateResponseDraft = async ({ direction = "OUTWARD" } = {}) => {
    if (!isDbConnected() || !mongoose.connection.db) {
        return { success: false, draft: null };
    }

    const canonicalDirection = (String(direction).toUpperCase().trim() === "OUTWARD") ? "OUTWARD" : "INWARD";
    const draft = await mongoose.connection.db.collection("late_response_drafts").findOne({
        direction: canonicalDirection,
        isDraft: true,
        status: "draft"
    });

    return {
        success: Boolean(draft),
        draft: draft || null
    };
};

/**
 * Explicit Admin Approval of the Regenerated Late Response Plan
 * 
 * Commits the draft to ai_selected_plans, updates student allocations, and clears late flags.
 */
export const approveLateResponseDraft = async ({ direction = "OUTWARD", draftId = null } = {}) => {
    if (!isDbConnected()) {
        throw new Error("Database is currently unavailable.");
    }

    const canonicalDirection = (String(direction).toUpperCase().trim() === "OUTWARD") ? "OUTWARD" : "INWARD";
    const isOutward = canonicalDirection === "OUTWARD";
    const tripMode = isOutward ? "FROM_SOURCE" : "TO_DESTINATION";

    // 1. Fetch the draft
    const query = { direction: canonicalDirection, isDraft: true, status: "draft" };
    if (draftId) {
        try { query._id = new mongoose.Types.ObjectId(draftId); } catch {}
    }

    const draft = await mongoose.connection.db.collection("late_response_drafts").findOne(query);
    if (!draft) {
        return {
            success: false,
            code: "DRAFT_NOT_FOUND",
            message: `No active regenerated draft plan found for ${canonicalDirection}. Please regenerate the plan first.`
        };
    }

    // 2. Validate vehicles and route continuity
    const buses = draft.buses || draft.routes || [];
    if (!Array.isArray(buses) || buses.length === 0) {
        return {
            success: false,
            code: "INVALID_DRAFT_ROUTES",
            message: "The regenerated plan contains no valid routes. Approval aborted."
        };
    }

    // Determine incrementing planVersion and unique approvalEventId
    const prevPlan = await mongoose.connection.db.collection("ai_selected_plans").findOne(
        {
            $or: [
                { direction: canonicalDirection },
                { tripMode: canonicalDirection },
                { tripMode: canonicalDirection === "OUTWARD" ? "FROM_SOURCE" : "TO_DESTINATION" },
                { "plan.direction": canonicalDirection },
                { "plan.tripMode": canonicalDirection }
            ]
        },
        { sort: { planVersion: -1, approvedAt: -1, createdAt: -1 } }
    );

    const planVersion = (Number(prevPlan?.planVersion) || 0) + 1;
    const approvalEventId = new mongoose.Types.ObjectId().toString();
    const approvalTime = new Date();

    // 3. Mark previous active plan for this direction as superseded in ai_selected_plans
    await mongoose.connection.db.collection("ai_selected_plans").updateMany(
        {
            active: true,
            $or: [
                { direction: canonicalDirection },
                { tripMode: canonicalDirection },
                { tripMode: canonicalDirection === "OUTWARD" ? "FROM_SOURCE" : "TO_DESTINATION" },
                { "plan.direction": canonicalDirection },
                { "plan.tripMode": canonicalDirection }
            ]
        },
        { $set: { active: false, status: "superseded" } }
    );

    // Determine effectivePlanType from prevPlan or draft summary
    const isManualOriginal = prevPlan?.planType === "MANUAL" || prevPlan?.planType === "ADMIN" || draft?.currentPlanSummary?.planType === "MANUAL" || draft?.currentPlanSummary?.planType === "ADMIN";
    const effectivePlanType = isManualOriginal ? (prevPlan?.planType || draft?.currentPlanSummary?.planType || "ADMIN") : "AI";

    // 4. Insert approved regenerated plan into ai_selected_plans
    const sanitizedPlan = sanitizeTransportationPlan(draft);
    const approvedDoc = {
        planVersion,
        approvalEventId,
        planType: isManualOriginal ? effectivePlanType : "AI_REGENERATED",
        direction: canonicalDirection,
        tripMode,
        allocationMode: isManualOriginal ? "MANUAL" : "AI",
        plan: sanitizedPlan,
        startingPoint: draft.sourceHub || draft.startingPoint || null,
        active: true,
        status: "active",
        approved: true,
        selectedAt: approvalTime,
        approvedAt: approvalTime,
        requiresReview: false,
        hasLateResponses: false,
        pendingReallocation: false,
        affectedDirections: [],
        regeneratedForLateResponses: true
    };

    await mongoose.connection.db.collection("ai_selected_plans").insertOne(approvedDoc);

    // Also update AiPlan collection to clear review flags and mark approved
    try {
        await mongoose.connection.db.collection("aiplans").updateMany(
            {
                active: true,
                $or: [
                    { direction: canonicalDirection },
                    { tripMode: canonicalDirection },
                    { tripMode: canonicalDirection === "OUTWARD" ? "FROM_SOURCE" : "TO_DESTINATION" }
                ]
            },
            {
                $set: {
                    isApproved: true,
                    approvedAt: approvalTime,
                    planVersion,
                    approvalEventId,
                    requiresReview: false,
                    hasLateResponses: false,
                    pendingReallocation: false
                },
                $pull: {
                    affectedDirections: canonicalDirection
                }
            }
        );
    } catch (aiErr) {
        console.warn("AiPlan update warning on draft approval:", aiErr.message);
    }

    // 5. Extract all allocated userIds from the draft buses BEFORE resolving late responses.
    //    This is the source of truth: only students whose userId appears in a bus.users[] array
    //    OR stop.userIds[] array in the draft are considered actually allocated.
    const rawAllocatedIds = new Set();
    const allocatedIdVariants = new Set();
    const allocatedStudentInfoMap = new Map();

    const draftBuses = draft.buses || draft.routes || [];
    for (const bus of draftBuses) {
        const busVehicle = bus.vehicleName || bus.vehicleNumber || "Assigned Bus";
        const busRoute = bus.routeCode || bus.routeName || "Assigned Route";

        // Index allocatedStudents with seat numbers
        if (Array.isArray(bus.allocatedStudents)) {
            bus.allocatedStudents.forEach((st, sIdx) => {
                const sId = typeof st === "string" ? st : (st.userId || st._id || st.id || "");
                const seatNo = (typeof st === "object" && st.seatNumber) ? Number(st.seatNumber) : (sIdx + 1);
                if (sId) {
                    rawAllocatedIds.add(String(sId));
                    allocatedIdVariants.add(String(sId));
                    allocatedIdVariants.add(String(sId).toLowerCase().trim());
                    allocatedIdVariants.add(String(sId).toUpperCase().trim());
                    allocatedStudentInfoMap.set(String(sId).toLowerCase().trim(), {
                        vehicleName: busVehicle,
                        routeCode: busRoute,
                        seatNumber: seatNo
                    });
                }
            });
        }

        // Index users
        const busUsers = bus.users || bus.passengers || [];
        busUsers.forEach((u, uIdx) => {
            const uid = typeof u === "string" ? u : (u.userId || u._id || u.id || "");
            if (uid) {
                rawAllocatedIds.add(String(uid));
                allocatedIdVariants.add(String(uid));
                allocatedIdVariants.add(String(uid).toLowerCase().trim());
                allocatedIdVariants.add(String(uid).toUpperCase().trim());
                if (!allocatedStudentInfoMap.has(String(uid).toLowerCase().trim())) {
                    allocatedStudentInfoMap.set(String(uid).toLowerCase().trim(), {
                        vehicleName: busVehicle,
                        routeCode: busRoute,
                        seatNumber: uIdx + 1
                    });
                }
            }
        });

        // Index stops
        const stops = bus.stops || [];
        for (const st of stops) {
            for (const uid of (st.userIds || [])) {
                if (uid) {
                    rawAllocatedIds.add(String(uid));
                    allocatedIdVariants.add(String(uid));
                    allocatedIdVariants.add(String(uid).toLowerCase().trim());
                    allocatedIdVariants.add(String(uid).toUpperCase().trim());
                }
            }
        }
    }

    // Also collect standby user IDs so we can leave their late-response records intact
    const standbyUserIds = new Set(
        (draft.standbyStudents || []).map((s) => String(s.studentId || "").toLowerCase().trim()).filter(Boolean)
    );

    console.log(`[LATE RESPONSE APPROVAL] Direction: ${canonicalDirection} | Allocated: ${allocatedStudentInfoMap.size} | Standby: ${standbyUserIds.size}`);

    // 6. Persist allocations to student records FIRST — this is what actually writes
    //    bus/route/seat info to User documents. Must run BEFORE resolving late responses.
    await persistPlanToUsers(
        sanitizedPlan,
        canonicalDirection,
        draft.sourceHub || null,
        draft.destinationHub || null,
        effectivePlanType,
        isManualOriginal ? "MANUAL" : "AI",
        planVersion
    );

    // If original plan was manual, also keep manual_plan_submissions in sync
    if (isManualOriginal && mongoose.connection.db) {
        try {
            await mongoose.connection.db.collection("manual_plan_submissions").updateMany(
                {
                    $or: [
                        { direction: canonicalDirection },
                        { direction: canonicalDirection.toLowerCase() }
                    ]
                },
                {
                    $set: {
                        isSubmitted: true,
                        plan: sanitizedPlan,
                        updatedAt: approvalTime
                    }
                }
            );
        } catch (mSubErr) {
            console.warn("manual_plan_submissions sync warning:", mSubErr.message);
        }
    }

    // 7. Verify actual student allocations in the database and resolve late responses
    const now = new Date();
    const idVariantsList = Array.from(allocatedIdVariants);
    const objIdList = idVariantsList
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));

    let allocatedStudentsCount = 0;

    if (idVariantsList.length > 0) {
        const matchedUsers = await User.find({
            role: "student",
            $or: [
                { userId: { $in: idVariantsList } },
                { _id: { $in: objIdList } }
            ]
        }).lean();

        for (const u of matchedUsers) {
            const uIdLower = String(u.userId || "").toLowerCase().trim();
            const alloc = u.allocatedBus;
            const dirKey = canonicalDirection.toLowerCase();
            const isCurrentDirAllocated = Boolean(
                (alloc && alloc.isAllocated && (alloc.approved === true || alloc.adminApprovalStatus === "Approved")) ||
                (alloc && alloc[dirKey] && alloc[dirKey].isAllocated && (alloc[dirKey].approved === true || alloc[dirKey].adminApprovalStatus === "Approved")) ||
                allocatedStudentInfoMap.has(uIdLower)
            );

            if (isCurrentDirAllocated) {
                allocatedStudentsCount++;

                const currentAffected = (Array.isArray(u.affectedDirections) ? u.affectedDirections : [])
                    .map((d) => String(d).toUpperCase().trim());
                const nextAffected = currentAffected.filter((d) => d !== canonicalDirection);
                const isFullyAllocated = nextAffected.length === 0;

                const studentInfo = allocatedStudentInfoMap.get(uIdLower) || {};
                const assignedVehicle = alloc?.[dirKey]?.vehicleName || alloc?.vehicleName || u.assignedVehicle || studentInfo.vehicleName || "Assigned Bus";
                const assignedRoute = alloc?.[dirKey]?.routeCode || alloc?.routeCode || u.assignedRoute || studentInfo.routeCode || "Assigned Route";
                const assignedSeat = alloc?.[dirKey]?.seatNumber || alloc?.seatNumber || studentInfo.seatNumber ? Number(alloc?.[dirKey]?.seatNumber || alloc?.seatNumber || studentInfo.seatNumber) : 1;

                const userUpdate = {
                    requiresReallocation: !isFullyAllocated,
                    affectedDirections: nextAffected,
                    lateResponseDetected: !isFullyAllocated,
                    lateResponse: !isFullyAllocated,
                    isLateResponse: !isFullyAllocated,
                    lateResponseResolvedAt: now,
                    isAllocated: true,
                    isUnallocated: false,
                    allocationStatus: "Assigned",
                    assignedVehicle,
                    assignedRoute,
                    planVersion: Number(planVersion) || 1,
                    activePlanVersion: Number(planVersion) || 1
                };
                if (isManualOriginal) {
                    userUpdate.manualRouteId = assignedRoute;
                    userUpdate.manualBusId = assignedVehicle;
                    userUpdate.approvedPlanType = effectivePlanType;
                }
                if (!alloc || !alloc.isAllocated) {
                    userUpdate.allocatedBus = {
                        isAllocated: true,
                        approved: true,
                        allocationStatus: "Assigned",
                        adminApprovalStatus: "Approved",
                        vehicleName: assignedVehicle,
                        vehicleNumber: assignedVehicle,
                        routeCode: assignedRoute,
                        seatNumber: assignedSeat,
                        direction: canonicalDirection
                    };
                }
                if (isFullyAllocated) {
                    userUpdate.lateResponseAt = null;
                }

                await User.updateOne({ _id: u._id }, { $set: userUpdate });

                // Resolve LateResponseEvent for this student and direction

                const uIds = [u.userId, String(u._id), u.userId.toLowerCase(), u.userId.toUpperCase()];
                try {
                    await LateResponseEvent.updateMany(
                        {
                            userId: { $in: uIds },
                            $or: [
                                { direction: canonicalDirection },
                                { direction: null },
                                { direction: "" }
                            ],
                            status: { $nin: ["RESOLVED", "ALLOCATED"] }
                        },
                        {
                            $set: {
                                status: "RESOLVED",
                                resolvedAt: now,
                                resolutionReason: `Allocated via regenerated ${canonicalDirection} plan v${planVersion}`,
                                allocatedBus: assignedVehicle,
                                allocatedRoute: assignedRoute,
                                allocatedSeat: assignedSeat,
                                direction: canonicalDirection,
                                updatedAt: now
                            }
                        }
                    );
                } catch (lreErr) {
                    console.error("[LATE RESPONSE RESOLVED] LateResponseEvent update error:", lreErr.message);
                }
            }
        }
        console.log(`[LATE RESPONSE RESOLVED] Verified allocation & resolved late response for ${allocatedStudentsCount} student(s) (${canonicalDirection})`);
    }

    // 8. For standby students — keep their LateResponseEvent ACTIVE and log the reason
    for (const standby of (draft.standbyStudents || [])) {
        const sId = String(standby.studentId || "").trim();
        if (sId) {
            const sIds = [sId, sId.toLowerCase(), sId.toUpperCase()];
            try {
                await LateResponseEvent.updateMany(
                    {
                        userId: { $in: sIds },
                        status: { $nin: ["RESOLVED", "ALLOCATED"] }
                    },
                    {
                        $set: {
                            status: "ACTIVE",
                            unallocatedReason: standby.reason || "FLEET_CAPACITY_LIMIT",
                            metadata: { standby: true, reason: standby.reason || "FLEET_CAPACITY_LIMIT" },
                            updatedAt: now
                        }
                    }
                );
            } catch (sbErr) {
                console.warn("[LATE RESPONSE STANDBY] Update error:", sbErr.message);
            }
            console.log(`[LATE RESPONSE STANDBY] ${sId} remains on standby (Reason: ${standby.reason || "FLEET_CAPACITY_LIMIT"})`);
        }
    }

    // 9. Run the shared lifecycle resolver for any remaining active events by allocated users.
    try {
        await resolveLateResponsesForPreviousPlan({
            allocatedUserIds: allocatedIdVariants,
            direction: canonicalDirection,
            newPlanVersion: planVersion,
            newApprovalEventId: approvalEventId
        });
    } catch (rErr) {
        console.warn("resolveLateResponsesForPreviousPlan warning on draft approval:", rErr.message);
    }

    // 10. Delete draft from late_response_drafts
    await mongoose.connection.db.collection("late_response_drafts").deleteMany({
        direction: canonicalDirection
    });

    // Invalidate plan cache so status checks immediately reflect the approved plan
    clearActiveApprovedPlansCache();

    return {
        success: true,
        message: `✓ ${canonicalDirection} Regenerated Transportation Plan approved! ${allocatedStudentsCount} student(s) allocated. ${standbyUserIds.size > 0 ? `${standbyUserIds.size} on standby.` : ""}`,
        plan: approvedDoc,
        allocatedCount: allocatedStudentsCount,
        standbyCount: standbyUserIds.size
    };
};

/**
 * Discards/clears a regenerated draft without touching active approved plans
 */
export const discardLateResponseDraft = async ({ direction = "OUTWARD" } = {}) => {
    if (!isDbConnected() || !mongoose.connection.db) {
        return { success: false, message: "Database unavailable." };
    }

    const canonicalDirection = (String(direction).toUpperCase().trim() === "OUTWARD") ? "OUTWARD" : "INWARD";
    await mongoose.connection.db.collection("late_response_drafts").deleteMany({
        direction: canonicalDirection
    });

    clearActiveApprovedPlansCache();

    return {
        success: true,
        message: `Regenerated ${canonicalDirection} plan draft discarded. Active approved plan remains unchanged.`
    };
};
