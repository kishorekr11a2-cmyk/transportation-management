import mongoose from "mongoose";

const routePerformanceSchema = new mongoose.Schema(
    {
        routeId: {
            type: String,
            required: true,
            index: true,
            trim: true
        },
        planId: {
            type: String,
            default: null,
            index: true,
            trim: true
        },
        planVersion: {
            type: Number,
            default: 1
        },
        direction: {
            type: String,
            enum: ["OUTWARD", "INWARD"],
            default: "OUTWARD",
            index: true
        },
        vehicleId: {
            type: String,
            default: null,
            index: true
        },
        vehicleName: {
            type: String,
            default: ""
        },
        plannedDistanceKm: {
            type: Number,
            default: 0
        },
        actualDistanceKm: {
            type: Number,
            default: 0
        },
        plannedDurationMin: {
            type: Number,
            default: 0
        },
        actualDurationMin: {
            type: Number,
            default: 0
        },
        passengerCount: {
            type: Number,
            default: 0
        },
        vehicleCapacity: {
            type: Number,
            default: 70
        },
        utilization: {
            type: Number,
            default: 0
        },
        unusedSeats: {
            type: Number,
            default: 0
        },
        lateResponsesHandled: {
            type: Number,
            default: 0
        },
        routeChangesCount: {
            type: Number,
            default: 0
        },
        recordedAt: {
            type: Date,
            default: Date.now,
            index: true
        }
    },
    {
        timestamps: true
    }
);

routePerformanceSchema.index({ direction: 1, recordedAt: -1 });

const RoutePerformance =
    mongoose.models.RoutePerformance ||
    mongoose.model("RoutePerformance", routePerformanceSchema);

export default RoutePerformance;
