import InwardStartingPlace from "../models/InwardStartingPlace.js";
import Vehicle from "../models/Vehicle.js";
import Schedule from "../models/Schedule.js";

// Helper to check vehicle availability from Schedule
const isVehicleAvailableInSchedule = async (vehicleId) => {
    if (!vehicleId) return true;
    try {
        const schedule = await Schedule.findOne({ vehicle: vehicleId }).lean();
        if (!schedule) return true;

        const availability = String(schedule.availability || schedule.status || "").toLowerCase().trim();
        return (
            availability !== "not available" &&
            availability !== "unavailable" &&
            !availability.includes("unavailable") &&
            !availability.includes("not available") &&
            !availability.includes("maintenance") &&
            availability !== "disabled" &&
            availability !== "inactive" &&
            availability !== "off"
        );
    } catch {
        return true;
    }
};

// ======================================================
// GET ALL INWARD STARTING PLACES
// ======================================================
export const getInwardStartingPlaces = async (req, res) => {
    try {
        const filter = {};
        if (req.query.active === "true") {
            filter.active = true;
        }

        const startingPlaces = await InwardStartingPlace.find(filter)
            .sort({ busName: 1, createdAt: -1 })
            .lean();

        res.status(200).json({
            success: true,
            count: startingPlaces.length,
            startingPlaces
        });
    } catch (error) {
        console.error("Get Inward Starting Places Error:", error);
        res.status(500).json({
            success: false,
            message: "Failed to fetch inward starting places",
            error: error.message
        });
    }
};

// ======================================================
// ADD INWARD STARTING PLACE (BUS -> STARTING LOCATION)
// ======================================================
export const addInwardStartingPlace = async (req, res) => {
    try {
        const {
            vehicleId,
            busId,
            busName,
            capacity,
            locationName,
            name,
            address,
            latitude,
            longitude,
            active
        } = req.body;

        const effectiveVehicleId = String(vehicleId || busId || "").trim();
        const effectiveBusName = String(busName || "").trim();
        const effectiveLocationName = String(locationName || name || "").trim();
        const lat = Number(latitude);
        const lng = Number(longitude);
        const isActive = active !== undefined ? Boolean(active) : true;

        if (!effectiveBusName) {
            return res.status(400).json({
                success: false,
                message: "Bus is required to configure starting place"
            });
        }

        if (!effectiveLocationName || !Number.isFinite(lat) || !Number.isFinite(lng)) {
            return res.status(400).json({
                success: false,
                message: "Valid starting location name, latitude, and longitude are required"
            });
        }

        // Revalidate availability against existing Schedule logic
        if (effectiveVehicleId) {
            const isAvailable = await isVehicleAvailableInSchedule(effectiveVehicleId);
            if (!isAvailable) {
                return res.status(400).json({
                    success: false,
                    message: `Bus ${effectiveBusName} is no longer available for the current inward schedule. Please select another available bus.`
                });
            }
        }

        // Enforce ONE BUS = ONE ACTIVE INWARD STARTING PLACE
        if (isActive) {
            const orConditions = [{ busName: effectiveBusName }];
            if (effectiveVehicleId) {
                orConditions.push({ vehicleId: effectiveVehicleId });
                orConditions.push({ busId: effectiveVehicleId });
            }

            const existingActive = await InwardStartingPlace.findOne({
                active: true,
                $or: orConditions
            });

            if (existingActive) {
                return res.status(400).json({
                    success: false,
                    message: `Bus ${effectiveBusName} already has an active starting place (${existingActive.locationName || existingActive.name}). A bus can only have one active starting place. Please edit or deactivate the existing assignment.`
                });
            }
        }

        const startingPlace = await InwardStartingPlace.create({
            vehicleId: effectiveVehicleId || undefined,
            busId: effectiveVehicleId || undefined,
            busName: effectiveBusName,
            capacity: Number(capacity) || 0,
            locationName: effectiveLocationName,
            name: effectiveLocationName,
            address: (address || "").trim(),
            latitude: lat,
            longitude: lng,
            active: isActive
        });

        res.status(201).json({
            success: true,
            message: `Starting place for ${effectiveBusName} configured successfully`,
            startingPlace
        });
    } catch (error) {
        console.error("Add Inward Starting Place Error:", error);
        res.status(500).json({
            success: false,
            message: "Failed to add inward starting place",
            error: error.message
        });
    }
};

// ======================================================
// UPDATE INWARD STARTING PLACE
// ======================================================
export const updateInwardStartingPlace = async (req, res) => {
    try {
        const { id } = req.params;
        const {
            vehicleId,
            busId,
            busName,
            capacity,
            locationName,
            name,
            address,
            latitude,
            longitude,
            active
        } = req.body;

        const existing = await InwardStartingPlace.findById(id);
        if (!existing) {
            return res.status(404).json({
                success: false,
                message: "Inward starting place not found"
            });
        }

        const effectiveVehicleId = String(vehicleId || busId || existing.vehicleId || existing.busId || "").trim();
        const effectiveBusName = String(busName || existing.busName || "").trim();
        const effectiveLocationName = String(locationName || name || existing.locationName || existing.name || "").trim();
        const lat = latitude !== undefined ? Number(latitude) : existing.latitude;
        const lng = longitude !== undefined ? Number(longitude) : existing.longitude;
        const isActive = active !== undefined ? Boolean(active) : existing.active;

        if (!effectiveLocationName || !Number.isFinite(lat) || !Number.isFinite(lng)) {
            return res.status(400).json({
                success: false,
                message: "Valid starting location name, latitude, and longitude are required"
            });
        }

        // Revalidate availability if activating or changing bus
        if (effectiveVehicleId && isActive) {
            const isAvailable = await isVehicleAvailableInSchedule(effectiveVehicleId);
            if (!isAvailable) {
                return res.status(400).json({
                    success: false,
                    message: `Bus ${effectiveBusName} is no longer available for the current inward schedule. Please select another available bus.`
                });
            }
        }

        // Enforce ONE BUS = ONE ACTIVE INWARD STARTING PLACE (excluding current record)
        if (isActive) {
            const orConditions = [{ busName: effectiveBusName }];
            if (effectiveVehicleId) {
                orConditions.push({ vehicleId: effectiveVehicleId });
                orConditions.push({ busId: effectiveVehicleId });
            }

            const duplicateActive = await InwardStartingPlace.findOne({
                _id: { $ne: id },
                active: true,
                $or: orConditions
            });

            if (duplicateActive) {
                return res.status(400).json({
                    success: false,
                    message: `Bus ${effectiveBusName} already has an active starting place (${duplicateActive.locationName || duplicateActive.name}). A bus can only have one active starting place.`
                });
            }
        }

        existing.vehicleId = effectiveVehicleId || undefined;
        existing.busId = effectiveVehicleId || undefined;
        existing.busName = effectiveBusName;
        if (capacity !== undefined) existing.capacity = Number(capacity) || 0;
        existing.locationName = effectiveLocationName;
        existing.name = effectiveLocationName;
        if (address !== undefined) existing.address = (address || "").trim();
        existing.latitude = lat;
        existing.longitude = lng;
        existing.active = isActive;

        await existing.save();

        res.status(200).json({
            success: true,
            message: `Starting place for ${effectiveBusName} updated successfully`,
            startingPlace: existing
        });
    } catch (error) {
        console.error("Update Inward Starting Place Error:", error);
        res.status(500).json({
            success: false,
            message: "Failed to update inward starting place",
            error: error.message
        });
    }
};

// ======================================================
// DELETE INWARD STARTING PLACE
// ======================================================
export const deleteInwardStartingPlace = async (req, res) => {
    try {
        const { id } = req.params;
        const startingPlace = await InwardStartingPlace.findByIdAndDelete(id);

        if (!startingPlace) {
            return res.status(404).json({
                success: false,
                message: "Inward starting place not found"
            });
        }

        res.status(200).json({
            success: true,
            message: "Inward starting place removed successfully",
            deletedId: id
        });
    } catch (error) {
        console.error("Delete Inward Starting Place Error:", error);
        res.status(500).json({
            success: false,
            message: "Failed to delete inward starting place",
            error: error.message
        });
    }
};

// ======================================================
// TOGGLE ACTIVE STATUS
// ======================================================
export const toggleInwardStartingPlaceStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const startingPlace = await InwardStartingPlace.findById(id);

        if (!startingPlace) {
            return res.status(404).json({
                success: false,
                message: "Inward starting place not found"
            });
        }

        const nextActive = !startingPlace.active;

        if (nextActive) {
            // Check availability in Schedule
            if (startingPlace.vehicleId) {
                const isAvailable = await isVehicleAvailableInSchedule(startingPlace.vehicleId);
                if (!isAvailable) {
                    return res.status(400).json({
                        success: false,
                        message: `Bus ${startingPlace.busName} is no longer available for the current inward schedule. Please select another available bus.`
                    });
                }
            }

            // Check duplicate active assignment
            const orConditions = [{ busName: startingPlace.busName }];
            if (startingPlace.vehicleId) {
                orConditions.push({ vehicleId: startingPlace.vehicleId });
                orConditions.push({ busId: startingPlace.vehicleId });
            }

            const duplicate = await InwardStartingPlace.findOne({
                _id: { $ne: id },
                active: true,
                $or: orConditions
            });

            if (duplicate) {
                return res.status(400).json({
                    success: false,
                    message: `Bus ${startingPlace.busName} already has an active starting place (${duplicate.locationName || duplicate.name}). Deactivate it first before activating this one.`
                });
            }
        }

        startingPlace.active = nextActive;
        await startingPlace.save();

        res.status(200).json({
            success: true,
            message: `Starting place for ${startingPlace.busName} is now ${nextActive ? "Active" : "Inactive"}`,
            startingPlace
        });
    } catch (error) {
        console.error("Toggle Inward Starting Place Status Error:", error);
        res.status(500).json({
            success: false,
            message: "Failed to toggle inward starting place status",
            error: error.message
        });
    }
};
