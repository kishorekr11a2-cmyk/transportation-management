import mongoose from "mongoose";

const mlTrainingRecordSchema = new mongoose.Schema(
    {
        recordType: {
            type: String,
            enum: ["STOP_PAIR_COMPATIBILITY", "ROUTE_QUALITY", "VEHICLE_SUITABILITY", "DEMAND_PATTERN"],
            required: true,
            index: true
        },
        direction: {
            type: String,
            enum: ["OUTWARD", "INWARD"],
            default: "OUTWARD"
        },
        // Stop-level features
        stopA: {
            type: String,
            default: null,
            trim: true
        },
        stopB: {
            type: String,
            default: null,
            trim: true
        },
        geographicDistanceKm: {
            type: Number,
            default: null
        },
        roadDistanceKm: {
            type: Number,
            default: null
        },
        travelTimeMin: {
            type: Number,
            default: null
        },
        bearingDiffDeg: {
            type: Number,
            default: null
        },
        historicalCooccurrence: {
            type: Number,
            default: 0
        },
        sameRouteFrequency: {
            type: Number,
            default: 0
        },
        passengerDemandA: {
            type: Number,
            default: 0
        },
        passengerDemandB: {
            type: Number,
            default: 0
        },
        compatibilityScore: {
            type: Number,
            default: null
        },
        // Route-level features
        routeFeatures: {
            type: mongoose.Schema.Types.Mixed,
            default: null
        },
        routeQualityScore: {
            type: Number,
            default: null
        },
        source: {
            type: String,
            default: "historical_schedule"
        }
    },
    {
        timestamps: true
    }
);

mlTrainingRecordSchema.index({ recordType: 1, stopA: 1, stopB: 1 });

const MLTrainingRecord =
    mongoose.models.MLTrainingRecord ||
    mongoose.model("MLTrainingRecord", mlTrainingRecordSchema);

export default MLTrainingRecord;
