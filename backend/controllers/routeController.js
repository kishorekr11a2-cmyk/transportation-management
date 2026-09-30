import mongoose from "mongoose";
import Route from "../models/Route.js";
import Vehicle from "../models/Vehicle.js";
import Schedule from "../models/Schedule.js";
import {
    buildManualTransportationPlan,
    saveSelectedPlan,
    resetGeneratedAIRoute,
    clearActiveAIPlanCache,
    clearAIDataCache
} from "../services/aiAgentService.js";
import { generateManualPlanRecommendations } from "../services/manualPlanRecommendationService.js";
import { clearActiveApprovedPlansCache } from "../services/studentTransportStatusService.js";

const isValidStop = (stop) => {
    return (
        stop &&
        stop.name &&
        Number.isFinite(Number(stop.latitude)) &&
        Number.isFinite(Number(stop.longitude))
    );
};

const formatStopPayload = (stop) => {
    return {
        name: String(stop.name || "Stop").trim(),
        address: String(stop.address || stop.displayName || "").trim(),
        displayName: String(stop.displayName || stop.address || stop.name || "").trim(),
        latitude: Number(stop.latitude),
        longitude: Number(stop.longitude),
        placeId: String(stop.placeId || "").trim(),
        types: Array.isArray(stop.types) ? stop.types : []
    };
};

const validateVehicle = async (vehicleId) => {
    if (!vehicleId) {
        return null;
    }

    const vehicle = await Vehicle.findById(vehicleId);

    return vehicle || null;
};

// ======================================
// AUTHORITATIVE ROUTE ALLOCATION CACHE & HELPER
// ======================================

const authoritativeAllocationCache = new Map();
const ALLOCATION_CACHE_TTL_MS = 60 * 1000; // 60 seconds
const routesListCache = new Map();
const ROUTES_CACHE_TTL_MS = 60 * 1000; // 60 seconds

export const invalidateRouteAllocationCache = (direction = null) => {
    routesListCache.clear();
    if (direction) {
        const canonical = String(direction).toUpperCase().trim();
        authoritativeAllocationCache.delete(canonical);
    } else {
        authoritativeAllocationCache.clear();
    }
};

export const getAuthoritativeRouteAllocations = async (direction) => {
    const canonicalDirection = (String(direction || "").toUpperCase().trim() === "OUTWARD") ? "OUTWARD" : "INWARD";
    const effectiveTripMode = canonicalDirection === "OUTWARD" ? "FROM_SOURCE" : "TO_DESTINATION";

    // Fast-path: Check memory cache first (< 0.1ms)
    const cached = authoritativeAllocationCache.get(canonicalDirection);
    if (cached && (Date.now() - cached.timestamp < ALLOCATION_CACHE_TTL_MS)) {
        return cached.data;
    }

    let activeOrSubmittedBuses = [];
    let hasPlan = false;

    if (mongoose.connection?.db) {
        // 1. Check approved active plan in ai_selected_plans with fast projection (<2KB vs 15MB)
        const approvedDoc = await mongoose.connection.db.collection("ai_selected_plans").findOne({
            active: true,
            status: "active",
            approved: true,
            $or: [
                { direction: canonicalDirection },
                { tripMode: canonicalDirection },
                { tripMode: effectiveTripMode },
                { "plan.direction": canonicalDirection },
                { "plan.tripMode": canonicalDirection }
            ]
        }, {
            projection: {
                "plan.buses.routeId": 1,
                "plan.buses.routeName": 1,
                "plan.buses.vehicleId": 1,
                "plan.buses.vehicleName": 1,
                "plan.buses.capacity": 1,
                "plan.buses.assignedUsers": 1,
                "plan.buses.remainingSeats": 1,
                "plan.buses.users": 1
            }
        });

        if (approvedDoc?.plan?.buses && approvedDoc.plan.buses.length > 0) {
            activeOrSubmittedBuses = approvedDoc.plan.buses;
            hasPlan = true;
        } else {
            // 2. Check submitted manual plan in manual_plan_submissions (must not be reset)
            const subDoc = await mongoose.connection.db.collection("manual_plan_submissions").findOne({
                $or: [
                    { direction: canonicalDirection },
                    { direction: canonicalDirection.toLowerCase() }
                ],
                isSubmitted: true,
                status: { $ne: "reset" }
            }, {
                projection: {
                    "buses.routeId": 1,
                    "buses.routeName": 1,
                    "buses.vehicleId": 1,
                    "buses.vehicleName": 1,
                    "buses.capacity": 1,
                    "buses.assignedUsers": 1,
                    "buses.remainingSeats": 1,
                    "plan.buses": 1
                }
            });

            if (subDoc) {
                // Pre-saved buses fast path: use directly without running 28,000 fuzzy comparisons
                if (Array.isArray(subDoc.buses) && subDoc.buses.length > 0) {
                    activeOrSubmittedBuses = subDoc.buses;
                    hasPlan = true;
                } else if (Array.isArray(subDoc.plan?.buses) && subDoc.plan.buses.length > 0) {
                    activeOrSubmittedBuses = subDoc.plan.buses;
                    hasPlan = true;
                } else {
                    // Fallback: calculate once and persist to document so subsequent calls are 0ms
                    try {
                        const submittedPlan = await buildManualTransportationPlan({
                            direction: canonicalDirection,
                            forceAllocate: true
                        });
                        if (submittedPlan?.buses && submittedPlan.buses.length > 0) {
                            activeOrSubmittedBuses = submittedPlan.buses;
                            hasPlan = true;
                            await mongoose.connection.db.collection("manual_plan_submissions").updateOne(
                                { _id: subDoc._id },
                                { $set: { buses: submittedPlan.buses } }
                            ).catch(() => {});
                        }
                    } catch (err) {
                        console.warn("[getAuthoritativeRouteAllocations] Error building manual plan:", err.message);
                    }
                }
            }
        }
    }

    const allocationMap = new Map();
    activeOrSubmittedBuses.forEach((b) => {
        const allocData = {
            assignedUsers: Number(b.assignedUsers ?? b.users?.length ?? 0),
            capacity: Number(b.capacity || 0),
            remainingSeats: Number(b.remainingSeats ?? Math.max(0, (b.capacity || 0) - (b.assignedUsers || 0))),
            vehicleName: b.vehicleName || "",
            routeName: b.routeName || ""
        };

        if (b.routeId) allocationMap.set(String(b.routeId), allocData);
        if (b.routeName) allocationMap.set(String(b.routeName).toLowerCase().trim(), allocData);
        if (b.vehicleId) allocationMap.set(String(b.vehicleId), allocData);
        if (b.vehicleName) allocationMap.set(String(b.vehicleName).toLowerCase().trim(), allocData);
    });

    const result = {
        hasPlan,
        allocationMap,
        canonicalDirection
    };

    authoritativeAllocationCache.set(canonicalDirection, {
        timestamp: Date.now(),
        data: result
    });

    return result;
};

// ======================================
// GET ALL ROUTES
// ======================================

export const getRoutes = async (req, res) => {
    const tStart = Date.now();
    try {
        const { direction, excludeGeometry, minimal } = req.query;
        const cacheKey = `${direction || "ALL"}_${excludeGeometry || "false"}_${minimal || "false"}`;

        const cached = routesListCache.get(cacheKey);
        if (cached && (Date.now() - cached.timestamp < ROUTES_CACHE_TTL_MS)) {
            return res.json(cached.data);
        }

        const filter = {};
        if (direction) {
            const canonical = String(direction).toUpperCase().trim();
            if (canonical === "INWARD" || canonical === "OUTWARD") {
                filter.$or = [
                    { direction: canonical },
                    { direction: canonical.toLowerCase() },
                    { direction: "BOTH" },
                    { direction: "both" }
                ];
            }
        }

        const query = Route.find(filter)
            .populate(
                "assignedVehicle",
                "vehicleName capacity"
            )
            .sort({
                createdAt: -1
            });

        if (excludeGeometry === "true" || minimal === "true") {
            query.select("-roadGeometry");
        }

        const [routes, inwardAlloc, outwardAlloc] = await Promise.all([
            query.lean(),
            getAuthoritativeRouteAllocations("INWARD"),
            getAuthoritativeRouteAllocations("OUTWARD")
        ]);

        // Enrich each route with authoritative allocation details.
        // BOTH routes appear in two UI sections but are one DB record with one vehicle;
        // we provide outwardAllocatedSeats and inwardAllocatedSeats independently so that
        // either direction view displays accurate allocations without duplicating records.
        const queryCanonical = direction ? String(direction).toUpperCase().trim() : null;

        routes.forEach((route) => {
            const dirUpper = String(route.direction || "").toUpperCase().trim();
            const isOutward = dirUpper === "OUTWARD";
            const isBoth   = dirUpper === "BOTH";
            const allocInfo = queryCanonical === "INWARD"
                ? inwardAlloc
                : queryCanonical === "OUTWARD"
                ? outwardAlloc
                : (isOutward || isBoth) ? outwardAlloc : inwardAlloc;
            const map = allocInfo.allocationMap;

            const routeId = String(route._id || "");
            const routeName = String(route.routeName || "").toLowerCase().trim();
            const vehicleId = String(route.assignedVehicle?._id || route.assignedVehicle || "");
            const vehicleName = String(route.assignedVehicle?.vehicleName || route.vehicleName || "").toLowerCase().trim();

            const match = map.get(routeId) ||
                map.get(routeName) ||
                (vehicleId ? map.get(vehicleId) : null) ||
                (vehicleName ? map.get(vehicleName) : null);

            const outwardMatch = outwardAlloc.allocationMap.get(routeId) ||
                outwardAlloc.allocationMap.get(routeName) ||
                (vehicleId ? outwardAlloc.allocationMap.get(vehicleId) : null) ||
                (vehicleName ? outwardAlloc.allocationMap.get(vehicleName) : null);

            const inwardMatch = inwardAlloc.allocationMap.get(routeId) ||
                inwardAlloc.allocationMap.get(routeName) ||
                (vehicleId ? inwardAlloc.allocationMap.get(vehicleId) : null) ||
                (vehicleName ? inwardAlloc.allocationMap.get(vehicleName) : null);

            const totalCapacity = Number(route.assignedVehicle?.capacity || route.capacity || 0);
            const allocatedSeats = match ? match.assignedUsers : 0;
            const remainingSeats = totalCapacity > 0 ? Math.max(0, totalCapacity - allocatedSeats) : 0;
            const isFull = totalCapacity > 0 && remainingSeats === 0;

            route.allocatedSeats = allocatedSeats;
            route.outwardAllocatedSeats = outwardMatch ? outwardMatch.assignedUsers : 0;
            route.inwardAllocatedSeats = inwardMatch ? inwardMatch.assignedUsers : 0;
            route.totalSeats = totalCapacity;
            route.remainingSeats = remainingSeats;
            route.isFull = isFull;
            route.hasPlan = allocInfo.hasPlan;
        });

        const responsePayload = {
            success: true,
            routes
        };

        routesListCache.set(cacheKey, {
            timestamp: Date.now(),
            data: responsePayload
        });

        console.log(`[PERFORMANCE] routes API query: ${Date.now() - tStart} ms`);

        res.json(responsePayload);
    } catch (error) {
        console.error(
            "Get routes error:",
            error
        );

        res.status(500).json({
            success: false,
            message: "Unable to load routes."
        });
    }
};

// ======================================
// ADD ROUTE
// ======================================

export const addRoute = async (req, res) => {
    try {
        const {
            routeName,
            direction,
            source,
            stops,
            destination,
            assignedVehicle,
            roadGeometry
        } = req.body;

        if (!routeName?.trim()) {
            return res.status(400).json({
                success: false,
                message: "Route name or number is required."
            });
        }

        const trimmedName = routeName.trim();

        // Check for duplicate route name (case-insensitive)
        const duplicateNameRoute = await Route.findOne({
            routeName: { $regex: new RegExp(`^${trimmedName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") }
        });
        if (duplicateNameRoute) {
            return res.status(400).json({
                success: false,
                message: `A route with name "${trimmedName}" already exists. Please choose a distinct route name.`
            });
        }

        if (!isValidStop(source) || !isValidStop(destination)) {
            return res.status(400).json({
                success: false,
                message: "Please add at least two valid stops (start and destination with coordinates)."
            });
        }

        if (!Array.isArray(stops)) {
            return res.status(400).json({
                success: false,
                message: "Stops must be an array."
            });
        }

        if (stops.some((stop) => !isValidStop(stop))) {
            return res.status(400).json({
                success: false,
                message: "One or more route stops have invalid coordinates."
            });
        }

        let vehicle = null;

        // Parse direction: accept INWARD, OUTWARD, or BOTH
        const rawDirection = String(direction || "").toUpperCase().trim();
        const canonicalDirection = (rawDirection === "OUTWARD" || rawDirection === "BOTH") ? rawDirection : "INWARD";

        if (assignedVehicle) {
            vehicle = await validateVehicle(assignedVehicle);

            if (!vehicle) {
                return res.status(400).json({
                    success: false,
                    message: "Selected vehicle was not found."
                });
            }

            // Verify vehicle is scheduled and available in Schedule Management
            const schedule = await Schedule.findOne({ vehicle: vehicle._id });
            if (!schedule || schedule.availability !== "Available") {
                return res.status(400).json({
                    success: false,
                    message: `Vehicle "${vehicle.vehicleName}" is not currently scheduled as Available in Schedule Management.`
                });
            }

            // Direction-specific vehicle conflict check:
            // For BOTH routes: the vehicle must not be assigned to ANY existing route
            //   (INWARD, OUTWARD, or BOTH) since it covers both directions.
            // For INWARD/OUTWARD: the vehicle must not be assigned to another route in
            //   the SAME direction OR to an existing BOTH route (which also occupies both).
            const vehicleConflictQuery = canonicalDirection === "BOTH"
                ? { assignedVehicle: vehicle._id }          // BOTH occupies all directions
                : {
                    assignedVehicle: vehicle._id,
                    direction: { $in: [canonicalDirection, "BOTH"] } // BOTH conflicts with either
                };

            const existingAssignedRoute = await Route.findOne(vehicleConflictQuery);
            if (existingAssignedRoute) {
                return res.status(400).json({
                    success: false,
                    message: `Vehicle "${vehicle.vehicleName}" is already allocated to route "${existingAssignedRoute.routeName}". Please select another available vehicle.`
                });
            }
        }

        const route = await Route.create({
            routeName: trimmedName,
            direction: canonicalDirection,
            source: formatStopPayload(source),
            stops: stops.map(formatStopPayload),
            destination: formatStopPayload(destination),
            assignedVehicle: vehicle ? vehicle._id : null,
            roadGeometry: Array.isArray(roadGeometry) ? roadGeometry : []
        });

        const populatedRoute = await Route.findById(route._id).populate(
            "assignedVehicle",
            "vehicleName capacity"
        );

        clearActiveApprovedPlansCache();
        invalidateRouteAllocationCache(canonicalDirection);

        res.status(201).json({
            success: true,
            message: "Route created successfully.",
            route: populatedRoute
        });
    } catch (error) {
        console.error("Add route error:", error);

        res.status(500).json({
            success: false,
            message: "Unable to create route."
        });
    }
};

// ======================================
// GET ROUTE BY ID
// ======================================

export const getRouteById = async (req, res) => {
    try {
        const route = await Route.findById(req.params.id).populate(
            "assignedVehicle",
            "vehicleName capacity"
        );

        if (!route) {
            return res.status(404).json({
                success: false,
                message: "Route not found."
            });
        }

        res.json({
            success: true,
            route
        });
    } catch (error) {
        console.error("Get route error:", error);

        res.status(500).json({
            success: false,
            message: "Unable to load route."
        });
    }
};

// ======================================
// UPDATE ROUTE
// ======================================

export const updateRoute = async (req, res) => {
    try {
        const {
            routeName,
            source,
            stops,
            destination,
            assignedVehicle,
            roadGeometry
        } = req.body;

        if (!routeName?.trim()) {
            return res.status(400).json({
                success: false,
                message: "Route name or number is required."
            });
        }

        const existingRoute = await Route.findById(req.params.id);
        if (!existingRoute) {
            return res.status(404).json({
                success: false,
                message: "Route not found."
            });
        }

        const trimmedName = routeName.trim();

        // Check for duplicate route name on another route
        const duplicateNameRoute = await Route.findOne({
            routeName: { $regex: new RegExp(`^${trimmedName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") },
            _id: { $ne: req.params.id }
        });
        if (duplicateNameRoute) {
            return res.status(400).json({
                success: false,
                message: `A route with name "${trimmedName}" already exists. Please choose a distinct route name.`
            });
        }

        if (!isValidStop(source) || !isValidStop(destination)) {
            return res.status(400).json({
                success: false,
                message: "Valid source and destination locations with coordinates are required."
            });
        }

        if (!Array.isArray(stops)) {
            return res.status(400).json({
                success: false,
                message: "Stops must be an array."
            });
        }

        if (stops.some((stop) => !isValidStop(stop))) {
            return res.status(400).json({
                success: false,
                message: "One or more route stops have invalid coordinates."
            });
        }

        let vehicle = null;

        // Parse direction: accept INWARD, OUTWARD, or BOTH
        const rawTargetDir = req.body.direction
            ? String(req.body.direction).toUpperCase().trim()
            : String(existingRoute.direction || "INWARD").toUpperCase().trim();
        const targetDirection = (rawTargetDir === "OUTWARD" || rawTargetDir === "BOTH") ? rawTargetDir : "INWARD";

        if (assignedVehicle) {
            vehicle = await validateVehicle(assignedVehicle);

            if (!vehicle) {
                return res.status(400).json({
                    success: false,
                    message: "Selected vehicle was not found."
                });
            }

            // Verify vehicle is scheduled and available in Schedule Management
            const schedule = await Schedule.findOne({ vehicle: vehicle._id });
            if (!schedule || schedule.availability !== "Available") {
                return res.status(400).json({
                    success: false,
                    message: `Vehicle "${vehicle.vehicleName}" is not currently scheduled as Available in Schedule Management.`
                });
            }

            // Direction-specific vehicle conflict check (same logic as addRoute):
            const vehicleConflictQuery = targetDirection === "BOTH"
                ? { assignedVehicle: vehicle._id, _id: { $ne: req.params.id } }
                : {
                    assignedVehicle: vehicle._id,
                    direction: { $in: [targetDirection, "BOTH"] },
                    _id: { $ne: req.params.id }
                };

            const existingAssignedRoute = await Route.findOne(vehicleConflictQuery);
            if (existingAssignedRoute) {
                return res.status(400).json({
                    success: false,
                    message: `Vehicle "${vehicle.vehicleName}" is already allocated to route "${existingAssignedRoute.routeName}". Please select another available vehicle.`
                });
            }
        }

        const updateFields = {
            routeName: trimmedName,
            source: formatStopPayload(source),
            stops: stops.map(formatStopPayload),
            destination: formatStopPayload(destination),
            assignedVehicle: vehicle ? vehicle._id : null
        };
        if (req.body.direction) {
            updateFields.direction = targetDirection;
        }
        if (Array.isArray(roadGeometry)) {
            updateFields.roadGeometry = roadGeometry;
        }

        const route = await Route.findByIdAndUpdate(
            req.params.id,
            updateFields,
            {
                new: true,
                runValidators: true
            }
        ).populate(
            "assignedVehicle",
            "vehicleName capacity"
        );

        if (!route) {
            return res.status(404).json({
                success: false,
                message: "Route not found."
            });
        }

        clearActiveApprovedPlansCache();
        invalidateRouteAllocationCache();

        res.json({
            success: true,
            message: "Route updated successfully.",
            route
        });
    } catch (error) {
        console.error("Update route error:", error);

        res.status(500).json({
            success: false,
            message: "Unable to update route."
        });
    }
};

// ======================================
// DELETE ROUTE
// ======================================

export const deleteRoute = async (req, res) => {
    try {
        const route =
            await Route.findByIdAndDelete(
                req.params.id
            );

        if (!route) {
            return res.status(404).json({
                success: false,
                message: "Route not found."
            });
        }

        clearActiveApprovedPlansCache();
        invalidateRouteAllocationCache();

        res.json({
            success: true,
            message: "Route deleted successfully."
        });
    } catch (error) {
        console.error(
            "Delete route error:",
            error
        );

        res.status(500).json({
            success: false,
            message: "Unable to delete route."
        });
    }
};

// ======================================
// GET MANUAL TRANSPORTATION PLAN (LIVE ALLOCATION)
// ======================================

export const getManualPlan = async (req, res) => {
    try {
        let direction = req.query.direction;
        let latestSubmittedDirection = null;

        if (mongoose.connection?.db) {
            const sub = await mongoose.connection.db.collection("manual_plan_submissions")
                .find({ isSubmitted: true })
                .sort({ submittedAt: -1 })
                .limit(1)
                .toArray();
            if (sub && sub.length > 0 && sub[0].direction) {
                latestSubmittedDirection = sub[0].direction;
            }
        }

        const canonicalDirection = direction
            ? ((String(direction).toUpperCase().trim() === "OUTWARD") ? "OUTWARD" : "INWARD")
            : (latestSubmittedDirection || "INWARD");

        const plan = await buildManualTransportationPlan({ direction: canonicalDirection });

        res.json({
            success: true,
            direction: canonicalDirection,
            latestSubmittedDirection,
            plan
        });
    } catch (error) {
        console.error("Get manual plan error:", error);
        res.status(500).json({
            success: false,
            message: error.message || "Unable to load manual plan."
        });
    }
};

// ======================================
// APPROVE MANUAL TRANSPORTATION PLAN
// ======================================

export const approveManualPlan = async (req, res) => {
    try {
        const direction = req.body.direction || req.query.direction || "INWARD";
        const canonicalDirection = (String(direction).toUpperCase().trim() === "OUTWARD") ? "OUTWARD" : "INWARD";
        const startingPoint = req.body.startingPoint || null;

        // 1. Fetch routes configured with assigned vehicles in this direction.
        //    Include BOTH routes — they serve this direction as well.
        const assignedRoutes = await Route.find({
            $or: [
                { direction: canonicalDirection },
                { direction: canonicalDirection.toLowerCase() },
                { direction: new RegExp(`^${canonicalDirection}$`, "i") },
                { direction: "BOTH" }
            ],
            assignedVehicle: { $ne: null }
        })
            .populate("assignedVehicle", "vehicleName capacity vehicleNumber")
            .lean();

        if (!assignedRoutes || assignedRoutes.length === 0) {
            return res.status(400).json({
                success: false,
                message: `No manual routes found for ${canonicalDirection} direction. Please create and configure at least one route before approving.`
            });
        }

        // 2. Strict Bus Assignment & Capacity Validation Checks (Requirement D)
        const seenVehicleIds = new Set();
        for (const route of assignedRoutes) {
            const vehicle = route.assignedVehicle;
            const vehicleId = String(vehicle?._id || vehicle || "");
            const vehicleName = vehicle?.vehicleName || route.vehicleName || "Assigned Bus";

            // Check if bus is double-assigned to multiple routes in this direction
            if (vehicleId) {
                if (seenVehicleIds.has(vehicleId)) {
                    return res.status(400).json({
                        success: false,
                        message: `Selected bus is already assigned to another route`
                    });
                }
                seenVehicleIds.add(vehicleId);

                // Check if bus is assigned to another route in the SAME direction
                const otherRoute = await Route.findOne({
                    assignedVehicle: vehicle._id || vehicle,
                    direction: canonicalDirection,
                    _id: { $ne: route._id }
                }).lean();
                if (otherRoute) {
                    return res.status(400).json({
                        success: false,
                        message: `Selected bus is already assigned to another route in ${canonicalDirection} direction`
                    });
                }
            }

            // Check bus capacity
            const capacity = Number(vehicle?.capacity || route.capacity || 0);
            if (capacity <= 0) {
                return res.status(400).json({
                    success: false,
                    message: `Selected bus does not have enough available seats`
                });
            }

            // Check Schedule availability
            if (vehicle?._id) {
                const schedule = await Schedule.findOne({ vehicle: vehicle._id }).lean();
                if (schedule && schedule.availability !== "Available") {
                    return res.status(400).json({
                        success: false,
                        message: `Vehicle "${vehicleName}" assigned to Route "${route.routeName}" is not currently marked as Available in Schedule Management.`
                    });
                }
            }
        }

        const plan = await buildManualTransportationPlan({
            direction: canonicalDirection,
            allocationMode: "MANUAL",
            forceAllocate: true
        });

        if (!plan.buses || plan.buses.length === 0) {
            return res.status(400).json({
                success: false,
                message: `No manual routes found for ${canonicalDirection} direction. Please create and configure at least one route before approving.`
            });
        }

        const result = await saveSelectedPlan({
            planType: "ADMIN",
            direction: canonicalDirection,
            tripMode: canonicalDirection === "OUTWARD" ? "FROM_SOURCE" : "TO_DESTINATION",
            plan,
            startingPoint,
            allocationMode: "MANUAL"
        });

        if (!result.success) {
            return res.status(400).json({
                success: false,
                code: result.code || "PLAN_APPROVAL_FAILED",
                message: result.message || `Unable to approve manual ${canonicalDirection} transportation plan.`
            });
        }

        clearActiveApprovedPlansCache();
        clearActiveAIPlanCache(canonicalDirection);
        clearAIDataCache();
        invalidateRouteAllocationCache(canonicalDirection);

        res.json({
            success: true,
            message: `Admin manual ${canonicalDirection} transportation plan approved and bus allocations published to all confirmed students successfully.`,
            direction: canonicalDirection,
            plan: result.plan || plan,
            result
        });
    } catch (error) {
        console.error("Approve manual plan error:", error);
        res.status(500).json({
            success: false,
            message: error.message || "Unable to approve manual plan."
        });
    }
};

// ======================================
// RESET MANUAL TRANSPORTATION PLAN
// ======================================

export const resetManualPlan = async (req, res) => {
    try {
        const direction = req.body?.direction || req.query?.direction || null;
        const canonicalDirection = direction ? ((String(direction).toUpperCase().trim() === "OUTWARD") ? "OUTWARD" : "INWARD") : null;
        
        const result = await resetGeneratedAIRoute({ direction: canonicalDirection, planType: "MANUAL" });

        if (mongoose.connection?.db) {
            const dirQuery = canonicalDirection ? {
                $or: [
                    { direction: canonicalDirection },
                    { direction: canonicalDirection.toLowerCase() },
                    { direction: new RegExp(`^${canonicalDirection}$`, "i") }
                ]
            } : {};

            const selPlanDirQuery = canonicalDirection ? {
                $or: [
                    { direction: canonicalDirection },
                    { tripMode: canonicalDirection },
                    { tripMode: canonicalDirection === "OUTWARD" ? "FROM_SOURCE" : "TO_DESTINATION" },
                    { "plan.direction": canonicalDirection },
                    { "plan.tripMode": canonicalDirection }
                ]
            } : {};

            await Promise.allSettled([
                mongoose.connection.db.collection("manual_plan_submissions").deleteMany(dirQuery),
                Route.updateMany(dirQuery, { $set: { isSubmitted: false } }),
                mongoose.connection.db.collection("late_response_drafts").deleteMany(dirQuery),
                mongoose.connection.db.collection("ai_selected_plans").updateMany(
                    {
                        planType: { $in: ["ADMIN", "MANUAL"] },
                        ...selPlanDirQuery
                    },
                    {
                        $set: {
                            active: false,
                            status: "reset",
                            approved: false,
                            resetAt: new Date(),
                            requiresReview: false,
                            hasLateResponses: false,
                            pendingReallocation: false,
                            affectedDirections: []
                        }
                    }
                )
            ]);
        }

        clearActiveApprovedPlansCache();
        clearActiveAIPlanCache(canonicalDirection);
        clearAIDataCache();
        invalidateRouteAllocationCache(canonicalDirection);

        res.json({
            success: true,
            message: "Admin Manual Route Plan reset successfully.",
            direction: canonicalDirection,
            result
        });
    } catch (error) {
        console.error("Reset manual plan error:", error);
        res.status(500).json({
            success: false,
            message: error.message || "Unable to reset manual plan."
        });
    }
};

// ======================================
// RESET MANUAL PLAN ALLOCATIONS ONLY
// Removes only user-to-vehicle allocations created by manual plan
// Preserves manual routes, vehicles, student travel status, and AI plan
// ======================================
export const resetManualAllocations = async (req, res) => {
    try {
        const direction = req.body?.direction || req.query?.direction || null;
        const canonicalDirection = direction ? ((String(direction).toUpperCase().trim() === "OUTWARD") ? "OUTWARD" : "INWARD") : null;

        // Reset manual user allocations and ai_selected_plans (MANUAL/ADMIN) without deleting Route models or submissions
        const result = await resetGeneratedAIRoute({ direction: canonicalDirection, planType: "MANUAL" });

        if (mongoose.connection?.db) {
            const selPlanDirQuery = canonicalDirection ? {
                $or: [
                    { direction: canonicalDirection },
                    { tripMode: canonicalDirection },
                    { tripMode: canonicalDirection === "OUTWARD" ? "FROM_SOURCE" : "TO_DESTINATION" },
                    { "plan.direction": canonicalDirection },
                    { "plan.tripMode": canonicalDirection }
                ]
            } : {};

            await mongoose.connection.db.collection("ai_selected_plans").updateMany(
                {
                    planType: { $in: ["ADMIN", "MANUAL"] },
                    ...selPlanDirQuery
                },
                {
                    $set: {
                        active: false,
                        status: "reset",
                        approved: false,
                        resetAt: new Date(),
                        requiresReview: false,
                        hasLateResponses: false,
                        pendingReallocation: false,
                        affectedDirections: []
                    }
                }
            );
        }

        clearActiveApprovedPlansCache();
        clearActiveAIPlanCache(canonicalDirection);
        clearAIDataCache();
        invalidateRouteAllocationCache(canonicalDirection);

        res.json({
            success: true,
            message: "Manual plan allocations reset successfully",
            direction: canonicalDirection,
            result
        });
    } catch (error) {
        console.error("Reset manual allocations error:", error);
        res.status(500).json({
            success: false,
            message: error.message || "Unable to reset manual plan allocations."
        });
    }
};

// ======================================
// CONFIRM MANUAL TRANSPORTATION PLAN (OK ACTION)
// ======================================

export const confirmManualPlan = async (req, res) => {
    try {
        const direction = req.body.direction || req.query.direction || "INWARD";
        const canonicalDirection = (String(direction).toUpperCase().trim() === "OUTWARD") ? "OUTWARD" : "INWARD";

        // Find all routes in this direction with assigned vehicles.
        // Include BOTH routes — they serve this direction as well.
        const assignedRoutes = await Route.find({
            $or: [
                { direction: canonicalDirection },
                { direction: canonicalDirection.toLowerCase() },
                { direction: new RegExp(`^${canonicalDirection}$`, "i") },
                { direction: "BOTH" }
            ],
            assignedVehicle: { $ne: null }
        })
            .populate("assignedVehicle", "vehicleName capacity vehicleNumber")
            .lean();

        // Filter to ensure vehicle is actually present and valid
        const validAssignedRoutes = (assignedRoutes || []).filter(
            (r) => Boolean(r.assignedVehicle && (r.assignedVehicle.vehicleName || r.assignedVehicle._id || r.vehicleName))
        );

        if (!validAssignedRoutes || validAssignedRoutes.length === 0) {
            return res.status(400).json({
                success: false,
                message: `No routes with assigned buses found for ${canonicalDirection}. Please assign a bus to at least one ${canonicalDirection} route before clicking OK.`
            });
        }

        const plan = await buildManualTransportationPlan({
            direction: canonicalDirection,
            allocationMode: "MANUAL",
            forceAllocate: true
        });

        // Record the confirmed/submitted plan state and pre-calculated buses in MongoDB
        let saveResult = null;
        if (mongoose.connection?.db) {
            await mongoose.connection.db.collection("manual_plan_submissions").updateOne(
                {
                    $or: [
                        { direction: canonicalDirection },
                        { direction: canonicalDirection.toLowerCase() }
                    ]
                },
                {
                    $set: {
                        direction: canonicalDirection,
                        isSubmitted: true,
                        status: "active",
                        submittedAt: new Date(),
                        totalAssignedRoutes: validAssignedRoutes.length,
                        routeIds: validAssignedRoutes.map((r) => r._id),
                        buses: plan.buses || [],
                        plan
                    },
                    $unset: {
                        resetAt: ""
                    }
                },
                { upsert: true }
            );

            await Route.updateMany(
                {
                    $or: [
                        { direction: canonicalDirection },
                        { direction: canonicalDirection.toLowerCase() },
                        { direction: new RegExp(`^${canonicalDirection}$`, "i") }
                    ],
                    assignedVehicle: { $ne: null }
                },
                { $set: { isSubmitted: true, confirmedAt: new Date() } }
            );

            const existingApproved = await mongoose.connection.db.collection("ai_selected_plans").findOne({
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
            });

            if (existingApproved || req.body?.approve === true || req.body?.allocate === true) {
                // If a transportation plan was already approved in this direction or explicit allocation is requested,
                // confirming the regenerated plan updates the authoritative active plan and persists allocations to User documents.
                saveResult = await saveSelectedPlan({
                    planType: "ADMIN",
                    direction: canonicalDirection,
                    tripMode: canonicalDirection === "OUTWARD" ? "FROM_SOURCE" : "TO_DESTINATION",
                    plan,
                    allocationMode: "MANUAL"
                });
            }
        }

        clearActiveApprovedPlansCache();
        clearActiveAIPlanCache(canonicalDirection);
        clearAIDataCache();
        invalidateRouteAllocationCache(canonicalDirection);

        res.json({
            success: true,
            message: `Admin manual ${canonicalDirection} plan with ${assignedRoutes.length} assigned routes confirmed and submitted to AI Route Management!`,
            direction: canonicalDirection,
            totalAssignedRoutes: assignedRoutes.length,
            plan: saveResult?.plan || plan,
            saveResult
        });
    } catch (error) {
        console.error("Confirm manual plan error:", error);
        res.status(500).json({
            success: false,
            message: error.message || "Unable to confirm manual plan."
        });
    }
};

// ======================================
// REGENERATE MANUAL TRANSPORTATION PLAN (Review Preview)
// ======================================

export const regenerateManualPlan = async (req, res) => {
    try {
        const direction = req.body.direction || req.query.direction || "INWARD";
        const canonicalDirection = (String(direction).toUpperCase().trim() === "OUTWARD") ? "OUTWARD" : "INWARD";

        const assignedRoutes = await Route.find({
            $or: [
                { direction: canonicalDirection },
                { direction: canonicalDirection.toLowerCase() },
                { direction: new RegExp(`^${canonicalDirection}$`, "i") },
                { direction: "BOTH" }
            ],
            assignedVehicle: { $ne: null }
        })
            .populate("assignedVehicle", "vehicleName capacity vehicleNumber")
            .lean();

        const validAssignedRoutes = (assignedRoutes || []).filter(
            (r) => Boolean(r.assignedVehicle && (r.assignedVehicle.vehicleName || r.assignedVehicle._id || r.vehicleName))
        );

        if (!validAssignedRoutes || validAssignedRoutes.length === 0) {
            return res.status(400).json({
                success: false,
                message: `No routes with assigned buses found for ${canonicalDirection}. Please assign a bus to at least one ${canonicalDirection} route before regenerating.`
            });
        }

        // Recalculate plan with current eligible demand including late responses
        const plan = await buildManualTransportationPlan({
            direction: canonicalDirection,
            allocationMode: "MANUAL",
            forceAllocate: true
        });

        // Update manual_plan_submissions with the newly regenerated draft plan
        if (mongoose.connection?.db) {
            await mongoose.connection.db.collection("manual_plan_submissions").updateOne(
                {
                    $or: [
                        { direction: canonicalDirection },
                        { direction: canonicalDirection.toLowerCase() }
                    ]
                },
                {
                    $set: {
                        direction: canonicalDirection,
                        isSubmitted: true,
                        status: "active",
                        regeneratedAt: new Date(),
                        submittedAt: new Date(),
                        totalAssignedRoutes: validAssignedRoutes.length,
                        routeIds: validAssignedRoutes.map((r) => r._id),
                        buses: plan.buses || [],
                        plan
                    },
                    $unset: {
                        resetAt: ""
                    }
                },
                { upsert: true }
            );
        }

        clearActiveAIPlanCache(canonicalDirection);
        clearAIDataCache();
        invalidateRouteAllocationCache(canonicalDirection);

        res.json({
            success: true,
            isDraft: true,
            message: `Admin manual ${canonicalDirection} plan regenerated with latest demand! Review proposed allocations before confirming.`,
            direction: canonicalDirection,
            totalAssignedRoutes: validAssignedRoutes.length,
            plan
        });
    } catch (error) {
        console.error("Regenerate manual plan error:", error);
        res.status(500).json({
            success: false,
            message: error.message || "Unable to regenerate manual plan."
        });
    }
};

// ======================================
// GET MANUAL PLAN AI RECOMMENDATIONS (REVIEW ONLY)
// ======================================

export const getManualPlanRecommendations = async (req, res) => {
    try {
        const direction = req.query.direction || req.body?.direction || "INWARD";
        const canonicalDirection = (String(direction).toUpperCase().trim() === "OUTWARD") ? "OUTWARD" : "INWARD";

        const result = await generateManualPlanRecommendations({ direction: canonicalDirection });

        res.json({
            success: true,
            direction: canonicalDirection,
            summary: result.summary,
            recommendations: result.recommendations,
            analyzedAt: result.analyzedAt
        });
    } catch (error) {
        console.error("Get manual plan recommendations error:", error);
        res.status(500).json({
            success: false,
            message: error.message || "Unable to generate AI recommendations for manual plan."
        });
    }
};