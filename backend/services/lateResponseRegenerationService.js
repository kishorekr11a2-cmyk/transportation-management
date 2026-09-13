import mongoose from "mongoose";
import User from "../models/User.js";
import Vehicle from "../models/Vehicle.js";
import Route from "../models/Route.js";
import Schedule from "../models/Schedule.js";
import {
    calculateDistanceKm,
    getRoadRouteGeometry,
    isValidCoordinate,
    canonicalizeDirection,
    sanitizeTransportationPlan,
    persistPlanToUsers
} from "./aiAgentService.js";
import {
    getInstitutionalHub,
    resolveStopCoordinates,
    normalizeStopName
} from "./manualPlanRecommendationService.js";

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

    // 6. Fetch fleet inventory and vehicle availability
    const [allVehicles, allRoutesInDb] = await Promise.all([
        Vehicle.find().lean(),
        Route.find().populate("assignedVehicle").lean()
    ]);

    // Track vehicle usage in the existing active plan
    const usedVehicleIds = new Set();
    existingBuses.forEach((b) => {
        const vId = b.vehicleId || b.vehicle?._id || b.assignedVehicle?._id || b.assignedVehicle;
        if (vId) usedVehicleIds.add(String(vId));
    });

    const idleVehicles = allVehicles.filter((v) => !usedVehicleIds.has(String(v._id)));

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
        const existingUsers = Array.isArray(bus.users) ? [...bus.users] : [];
        const existingCapacity = Number(bus.capacity) || 70;
        const currentAssignedCount = existingUsers.length;
        const currentStops = (bus.stops || []).map((s, sIdx) => ({
            order: s.order || (sIdx + 1),
            name: s.name || `Stop ${sIdx + 1}`,
            address: s.address || "",
            latitude: Number(s.latitude),
            longitude: Number(s.longitude),
            userCount: Number(s.userCount || s.passengers || s.passengersBoarded || s.passengersDropped || 0),
            userIds: Array.isArray(s.userIds) ? [...s.userIds] : [],
            isNewStop: false,
            newLateStudentsCount: 0
        }));

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
            users: existingUsers,
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
        let minCorridorDist = Infinity;

        if (isValidCoordinate(stopLat, stopLon)) {
            proposedRoutes.forEach((route, rIdx) => {
                if (route.remainingSeats >= stopGroup.count) {
                    // Check distance from new stop to each stop on this route
                    for (const existingStop of route.stops) {
                        if (isValidCoordinate(existingStop.latitude, existingStop.longitude)) {
                            const d = calculateDistanceKm(stopLat, stopLon, existingStop.latitude, existingStop.longitude);
                            if (d < minCorridorDist) {
                                minCorridorDist = d;
                                bestRouteIdx = rIdx;
                            }
                        }
                    }
                }
            });
        }

        // Corridor threshold: Within 5.5 km of an existing route corridor
        if (bestRouteIdx !== -1 && minCorridorDist <= 5.5) {
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
                    targetStop.userIds.push(sId);
                    targetRoute.users.push(sId);
                    accommodatedStudents.push({
                        studentId: sId,
                        studentName: st.name,
                        stoppingArea: stopName,
                        assignedRouteCode: targetRoute.routeCode,
                        assignedVehicleName: targetRoute.vehicleName,
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
                    targetRoute.users.push(sId);
                    accommodatedStudents.push({
                        studentId: sId,
                        studentName: st.name,
                        stoppingArea: stopName,
                        assignedRouteCode: targetRoute.routeCode,
                        assignedVehicleName: targetRoute.vehicleName,
                        integrationType: "NEW_STOP_INSERTION"
                    });
                });
            }

            targetRoute.assignedUsers += stopGroup.count;
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
                const upgradeVehicleIdx = idleVehicles.findIndex((v) => Number(v.capacity) >= neededCapacity);
                if (upgradeVehicleIdx !== -1) {
                    const upgradeVehicle = idleVehicles.splice(upgradeVehicleIdx, 1)[0];
                    targetRoute.vehicleName = upgradeVehicle.vehicleName;
                    targetRoute.vehicleNumber = upgradeVehicle.vehicleName;
                    targetRoute.vehicleId = upgradeVehicle._id;
                    targetRoute.capacity = Number(upgradeVehicle.capacity);
                    targetRoute.vehicleUpgraded = true;

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
                        targetRoute.users.push(sId);
                        accommodatedStudents.push({
                            studentId: sId,
                            studentName: st.name,
                            stoppingArea: stopName,
                            assignedRouteCode: targetRoute.routeCode,
                            assignedVehicleName: targetRoute.vehicleName,
                            integrationType: "VEHICLE_UPGRADE_ACCOMMODATION"
                        });
                    });

                    targetRoute.assignedUsers += stopGroup.count;
                    targetRoute.remainingSeats = Math.max(0, targetRoute.capacity - targetRoute.assignedUsers);
                    targetRoute.newLateStudentsAccommodated += stopGroup.count;
                    assignedToRoute = true;
                }
            }
        }

        // OPTION C: Form a new route if idle fleet vehicle is available
        if (!assignedToRoute && idleVehicles.length > 0) {
            const newVeh = idleVehicles.shift();
            const newRouteNumber = proposedRoutes.length + 1;
            const newRouteCode = `R-${String(newRouteNumber).padStart(2, "0")}`;
            const newRouteName = `${newRouteCode}: ${newVeh.vehicleName}`;

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
                        newLateStudentsCount: stopGroup.count
                    }
                ],
                users: stopGroup.students.map((st) => String(st.userId || st._id)),
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

            stopGroup.students.forEach((st) => {
                const sId = String(st.userId || st._id);
                accommodatedStudents.push({
                    studentId: sId,
                    studentName: st.name,
                    stoppingArea: stopName,
                    assignedRouteCode: newRouteCode,
                    assignedVehicleName: newVeh.vehicleName,
                    integrationType: "NEW_ROUTE_FORMATION"
                });
            });

            proposedRoutes.push(newRouteObj);
            assignedToRoute = true;
        }

        // OPTION D: Unable to accommodate -> Mark as standby
        if (!assignedToRoute) {
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
        const waypoints = isOutward
            ? [collegeCoord, ...route.stops.filter((s) => isValidCoordinate(s.latitude, s.longitude))]
            : [...route.stops.filter((s) => isValidCoordinate(s.latitude, s.longitude)), collegeCoord];

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

    // 4. Insert approved regenerated plan into ai_selected_plans
    const sanitizedPlan = sanitizeTransportationPlan(draft);
    const approvedDoc = {
        planType: "AI_REGENERATED",
        direction: canonicalDirection,
        tripMode,
        plan: sanitizedPlan,
        startingPoint: draft.sourceHub || draft.startingPoint || null,
        active: true,
        status: "active",
        approved: true,
        selectedAt: new Date(),
        approvedAt: new Date(),
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
                    approvedAt: new Date(),
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

    // 5. Persist allocations to student records and update Student Dashboard
    await persistPlanToUsers(
        sanitizedPlan,
        canonicalDirection,
        draft.sourceHub || null,
        draft.destinationHub || null,
        "AI_REGENERATED"
    );

    // 6. Resolve LateResponseEvent records for this direction — mark as ALLOCATED
    // This completes the late-response lifecycle: DETECTED → NOTIFIED → ALLOCATED
    try {
        const lreResult = await mongoose.connection.db.collection("lateresponseevents").updateMany(
            {
                direction: canonicalDirection,
                status: { $nin: ["RESOLVED", "ALLOCATED"] }
            },
            {
                $set: {
                    status: "ALLOCATED",
                    resolvedAt: new Date(),
                    updatedAt: new Date()
                }
            }
        );
        console.log(`[LATE RESPONSE RESOLVED] Approved regenerated plan — resolved ${lreResult.modifiedCount} LateResponseEvent(s) for ${canonicalDirection}`);
    } catch (lreErr) {
        console.error("[LATE RESPONSE RESOLVED] LateResponseEvent update error on approval:", lreErr.message);
    }

    // 7. Clear late-response flags from User records for students now allocated in this direction
    try {
        await mongoose.connection.db.collection("users").updateMany(
            {
                role: "student",
                travelStatus: "Coming",
                affectedDirections: canonicalDirection
            },
            {
                $set: {
                    requiresReallocation: false,
                    lateResponseDetected: false,
                    lateResponseAt: null,
                    lateResponseResolvedAt: new Date()
                },
                $pull: {
                    affectedDirections: canonicalDirection
                }
            }
        );
    } catch (uErr) {
        console.error("[LATE RESPONSE RESOLVED] User flag clearing error on approval:", uErr.message);
    }

    // 8. Delete draft from late_response_drafts
    await mongoose.connection.db.collection("late_response_drafts").deleteMany({
        direction: canonicalDirection
    });

    return {
        success: true,
        message: `✓ ${canonicalDirection} Regenerated Transportation Plan approved! Student bus & seat allocations are published and live.`,
        plan: approvedDoc
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

    return {
        success: true,
        message: `Regenerated ${canonicalDirection} plan draft discarded. Active approved plan remains unchanged.`
    };
};
