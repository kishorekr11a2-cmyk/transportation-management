import Route from "../models/Route.js";
import Vehicle from "../models/Vehicle.js";
import Schedule from "../models/Schedule.js";

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
    try {
        const routes = await Route.find()
            .populate(
                "assignedVehicle",
                "vehicleName capacity"
            )
            .sort({
                createdAt: -1
            });

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
            source,
            stops,
            destination,
            assignedVehicle
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

        const route = await Route.create({
            routeName: trimmedName,
            source: formatStopPayload(source),
            stops: stops.map(formatStopPayload),
            destination: formatStopPayload(destination),
            assignedVehicle: vehicle ? vehicle._id : null
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
            assignedVehicle
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

        const route = await Route.findByIdAndUpdate(
            req.params.id,
            {
                routeName: trimmedName,
                source: formatStopPayload(source),
                stops: stops.map(formatStopPayload),
                destination: formatStopPayload(destination),
                assignedVehicle: vehicle ? vehicle._id : null
            },
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