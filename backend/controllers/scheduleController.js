import Schedule from "../models/Schedule.js";
import Vehicle from "../models/Vehicle.js";

const adminOnly = (req, res) => {
    if (req.user.role !== "admin") {
        res.status(403).json({
            success: false,
            message: "Only admin can access this."
        });

        return false;
    }

    return true;
};

export const getSchedules = async (req, res) => {
    try {
        if (!adminOnly(req, res)) return;

        const [vehicles, schedules] = await Promise.all([
            Vehicle.find().sort({ vehicleName: 1 }),
            Schedule.find().populate("vehicle").sort({ createdAt: -1 })
        ]);

        // Map schedules by vehicle ID
        const scheduleMap = new Map();
        schedules.forEach((s) => {
            const vId = String(s.vehicle?._id || s.vehicle || "");
            if (vId && !scheduleMap.has(vId)) {
                scheduleMap.set(vId, s);
            }
        });

        res.status(200).json({
            success: true,
            count: schedules.length,
            vehicles,
            schedules
        });
    } catch (error) {
        console.error(
            "Get Schedules Error:",
            error
        );

        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

export const addSchedule = async (req, res) => {
    try {
        if (!adminOnly(req, res)) return;

        const {
            vehicle,
            date,
            availability
        } = req.body;

        if (!vehicle) {
            return res.status(400).json({
                success: false,
                message:
                    "Vehicle is required."
            });
        }

        if (
            availability &&
            ![
                "Available",
                "Not Available"
            ].includes(availability)
        ) {
            return res.status(400).json({
                success: false,
                message:
                    "Invalid availability value."
            });
        }

        const existingVehicle =
            await Vehicle.findById(vehicle);

        if (!existingVehicle) {
            return res.status(404).json({
                success: false,
                message:
                    "Selected vehicle not found."
            });
        }

        const normalizedDate = date
            ? new Date(date)
            : new Date();

        normalizedDate.setHours(0, 0, 0, 0);

        const schedule =
            await Schedule.findOneAndUpdate(
                {
                    vehicle
                },
                {
                    $set: {
                        availability:
                            availability ||
                            "Available",
                        date: normalizedDate
                    },
                    $setOnInsert: {
                        vehicle
                    }
                },
                {
                    new: true,
                    upsert: true,
                    runValidators: true
                }
            ).populate("vehicle");

        res.status(200).json({
            success: true,
            message:
                `Bus "${existingVehicle.vehicleName}" marked as ${schedule.availability}.`,
            schedule
        });
    } catch (error) {
        console.error(
            "Add Schedule Error:",
            error
        );

        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

export const updateSchedule = async (
    req,
    res
) => {
    try {
        if (!adminOnly(req, res)) return;

        const {
            vehicle,
            date,
            availability
        } = req.body;

        if (!availability) {
            return res.status(400).json({
                success: false,
                message:
                    "Availability is required."
            });
        }

        if (
            ![
                "Available",
                "Not Available"
            ].includes(availability)
        ) {
            return res.status(400).json({
                success: false,
                message:
                    "Invalid availability value."
            });
        }

        const schedule =
            await Schedule.findById(
                req.params.id
            );

        if (!schedule) {
            return res.status(404).json({
                success: false,
                message:
                    "Schedule not found."
            });
        }

        if (vehicle) {
            const existingVehicle =
                await Vehicle.findById(vehicle);

            if (!existingVehicle) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Selected vehicle not found."
                });
            }

            schedule.vehicle = vehicle;
        }

        if (date) {
            const normalizedDate =
                new Date(date);

            normalizedDate.setHours(
                0,
                0,
                0,
                0
            );

            schedule.date =
                normalizedDate;
        }

        schedule.availability =
            availability;

        await schedule.save();

        await schedule.populate(
            "vehicle"
        );

        res.status(200).json({
            success: true,
            message:
                "Bus availability updated successfully.",
            schedule
        });
    } catch (error) {
        console.error(
            "Update Schedule Error:",
            error
        );

        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

export const deleteSchedule = async (
    req,
    res
) => {
    try {
        if (!adminOnly(req, res)) return;

        const schedule =
            await Schedule.findByIdAndDelete(
                req.params.id
            );

        if (!schedule) {
            return res.status(404).json({
                success: false,
                message:
                    "Schedule not found."
            });
        }

        res.status(200).json({
            success: true,
            message:
                "Bus availability deleted successfully."
        });
    } catch (error) {
        console.error(
            "Delete Schedule Error:",
            error
        );

        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};