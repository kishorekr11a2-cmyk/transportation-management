import mongoose from "mongoose";
import Route from "../models/Route.js";
import Vehicle from "../models/Vehicle.js";
import Schedule from "../models/Schedule.js";
import {
    buildManualTransportationPlan,
    saveSelectedPlan,
    resetGeneratedAIRoute
} from "../services/aiAgentService.js";
import { generateManualPlanRecommendations } from "../services/manualPlanRecommendationService.js";

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
// GET ALL ROUTES
// ======================================

export const getRoutes = async (req, res) => {
    const tStart = Date.now();
    try {
        const { direction, excludeGeometry, minimal } = req.query;
        const filter = {};
        if (direction) {
            const canonical = String(direction).toUpperCase().trim();
            if (canonical === "INWARD" || canonical === "OUTWARD") {
                filter.direction = canonical;
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

        const routes = await query.lean();

        console.log(`[PERFORMANCE] routes API query: ${Date.now() - tStart} ms`);

        res.json({
            success: true,
            routes
        });
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

            // CRITICAL: Reject if vehicle is already allocated to another active route
            const existingAssignedRoute = await Route.findOne({ assignedVehicle: vehicle._id });
            if (existingAssignedRoute) {
                return res.status(400).json({
                    success: false,
                    message: `Vehicle "${vehicle.vehicleName}" is already allocated to route "${existingAssignedRoute.routeName}". Please select another available vehicle.`
                });
            }
        }

        const canonicalDirection = (String(direction || "").toUpperCase().trim() === "OUTWARD") ? "OUTWARD" : "INWARD";

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

            // CRITICAL: Reject if vehicle is already allocated to ANOTHER route
            const existingAssignedRoute = await Route.findOne({
                assignedVehicle: vehicle._id,
                _id: { $ne: req.params.id }
            });
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
            updateFields.direction = (String(req.body.direction).toUpperCase().trim() === "OUTWARD") ? "OUTWARD" : "INWARD";
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
        const direction = req.query.direction || "INWARD";
        const canonicalDirection = (String(direction).toUpperCase().trim() === "OUTWARD") ? "OUTWARD" : "INWARD";
        const plan = await buildManualTransportationPlan({ direction: canonicalDirection });

        res.json({
            success: true,
            direction: canonicalDirection,
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

        // 1. Fetch routes configured with assigned vehicles in this direction
        const assignedRoutes = await Route.find({
            $or: [
                { direction: canonicalDirection },
                { direction: canonicalDirection.toLowerCase() },
                { direction: new RegExp(`^${canonicalDirection}$`, "i") }
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

                // Check if bus is assigned to another route in the database outside this direction
                const otherRoute = await Route.findOne({
                    assignedVehicle: vehicle._id || vehicle,
                    _id: { $ne: route._id }
                }).lean();
                if (otherRoute) {
                    return res.status(400).json({
                        success: false,
                        message: `Selected bus is already assigned to another route`
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
            allocationMode: "MANUAL"
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
        const direction = req.body.direction || req.query.direction || null;
        const canonicalDirection = direction ? ((String(direction).toUpperCase().trim() === "OUTWARD") ? "OUTWARD" : "INWARD") : null;
        const result = await resetGeneratedAIRoute({ direction: canonicalDirection, planType: "MANUAL" });

        if (mongoose.connection?.db && canonicalDirection) {
            await mongoose.connection.db.collection("manual_plan_submissions").deleteOne({
                $or: [
                    { direction: canonicalDirection },
                    { direction: canonicalDirection.toLowerCase() }
                ]
            });
            await Route.updateMany(
                {
                    $or: [
                        { direction: canonicalDirection },
                        { direction: canonicalDirection.toLowerCase() }
                    ]
                },
                { $set: { isSubmitted: false } }
            );
        }

        res.json({
            success: true,
            message: `Manual ${canonicalDirection || "all"} transportation plan reset successfully. Student travel responses remain preserved.`,
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
// CONFIRM MANUAL TRANSPORTATION PLAN (OK ACTION)
// ======================================

export const confirmManualPlan = async (req, res) => {
    try {
        const direction = req.body.direction || req.query.direction || "INWARD";
        const canonicalDirection = (String(direction).toUpperCase().trim() === "OUTWARD") ? "OUTWARD" : "INWARD";

        // Find all routes in this direction with assigned vehicles
        const assignedRoutes = await Route.find({
            $or: [
                { direction: canonicalDirection },
                { direction: canonicalDirection.toLowerCase() },
                { direction: new RegExp(`^${canonicalDirection}$`, "i") }
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

        // Record the confirmed/submitted plan state in MongoDB
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
                        submittedAt: new Date(),
                        totalAssignedRoutes: validAssignedRoutes.length,
                        routeIds: validAssignedRoutes.map((r) => r._id)
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
        }

        const plan = await buildManualTransportationPlan({ direction: canonicalDirection });

        res.json({
            success: true,
            message: `Admin manual ${canonicalDirection} plan with ${assignedRoutes.length} assigned routes confirmed and submitted to AI Route Management!`,
            direction: canonicalDirection,
            totalAssignedRoutes: assignedRoutes.length,
            plan
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