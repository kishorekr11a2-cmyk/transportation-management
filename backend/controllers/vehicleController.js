import Vehicle from "../models/Vehicle.js";

// ======================================
// Get All Vehicles
// ======================================

export const getVehicles = async (req, res) => {

    try {

        if (req.user.role !== "admin") {
            return res.status(403).json({
                success: false,
                message: "Only admin can access this."
            });
        }

        const vehicles = await Vehicle.find().sort({
            createdAt: -1
        });

        res.status(200).json({
            success: true,
            count: vehicles.length,
            vehicles
        });

    } catch (error) {

        res.status(500).json({
            success: false,
            message: error.message
        });

    }

};


// ======================================
// Add Vehicle
// ======================================

export const addVehicle = async (req, res) => {

    try {

        if (req.user.role !== "admin") {
            return res.status(403).json({
                success: false,
                message: "Only admin can access this."
            });
        }

        const {
            vehicleName,
            capacity
        } = req.body;

        if (!vehicleName || !capacity) {
            return res.status(400).json({
                success: false,
                message: "Vehicle Name and Seat Capacity are required."
            });
        }

        const existingVehicle = await Vehicle.findOne({
            vehicleName
        });

        if (existingVehicle) {
            return res.status(400).json({
                success: false,
                message: "Vehicle already exists."
            });
        }

        const vehicle = await Vehicle.create({
            vehicleName,
            capacity
        });

        res.status(201).json({
            success: true,
            message: "Vehicle Added Successfully",
            vehicle
        });

    } catch (error) {

        res.status(500).json({
            success: false,
            message: error.message
        });

    }

};


// ======================================
// Update Vehicle
// ======================================

export const updateVehicle = async (req, res) => {

    try {

        if (req.user.role !== "admin") {
            return res.status(403).json({
                success: false,
                message: "Only admin can access this."
            });
        }

        const vehicle = await Vehicle.findByIdAndUpdate(

            req.params.id,

            req.body,

            {
                new: true,
                runValidators: true
            }

        );

        if (!vehicle) {
            return res.status(404).json({
                success: false,
                message: "Vehicle not found."
            });
        }

        res.status(200).json({
            success: true,
            message: "Vehicle Updated Successfully",
            vehicle
        });

    } catch (error) {

        res.status(500).json({
            success: false,
            message: error.message
        });

    }

};


// ======================================
// Delete Vehicle
// ======================================

export const deleteVehicle = async (req, res) => {

    try {

        if (req.user.role !== "admin") {
            return res.status(403).json({
                success: false,
                message: "Only admin can access this."
            });
        }

        const vehicle = await Vehicle.findByIdAndDelete(
            req.params.id
        );

        if (!vehicle) {
            return res.status(404).json({
                success: false,
                message: "Vehicle not found."
            });
        }

        res.status(200).json({
            success: true,
            message: "Vehicle Deleted Successfully"
        });

    } catch (error) {

        res.status(500).json({
            success: false,
            message: error.message
        });

    }

};