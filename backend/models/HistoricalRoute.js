import mongoose from "mongoose";

const historicalStopSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true
        },
        latitude: {
            type: Number,
            default: null
        },
        longitude: {
            type: Number,
            default: null
        },
        sequenceOrder: {
            type: Number,
            default: 1
        },
        passengerCount: {
            type: Number,
            default: 0
        },
        legDistanceKm: {
            type: Number,
            default: 0
        },
        legDurationMin: {
            type: Number,
            default: 0
        }
    },
    { _id: false }
);

const historicalRouteSchema = new mongoose.Schema(
    {
        routeId: {
            type: String,
            required: true,
            index: true,
            trim: true
        },
        busId: {
            type: String,
            required: true,
            index: true,
            trim: true
        },
        vehicleName: {
            type: String,
            default: "",
            trim: true
        },
        direction: {
            type: String,
            enum: ["OUTWARD", "INWARD"],
            default: "OUTWARD",
            index: true
        },
        stops: {
            type: [historicalStopSchema],
            default: []
        },
        stopNames: {
            type: [String],
            default: [],
            index: true
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
        numberOfStops: {
            type: Number,
            default: 0
        },
        roadDistanceKm: {
            type: Number,
            default: 0
        },
        travelTimeMin: {
            type: Number,
            default: 0
        },
        averageStopDistanceKm: {
            type: Number,
            default: 0
        },
        historicalRouteFrequency: {
            type: Number,
            default: 1
        },
        routeEfficiency: {
            type: Number,
            default: 1.0
        },
        unusedSeats: {
            type: Number,
            default: 0
        },
        vehicleType: {
            type: String,
            default: "Standard Bus",
            trim: true
        },
        scheduleAvailable: {
            type: Boolean,
            default: true
        },
        routeQuality: {
            type: Number,
            default: 0.85
        },
        sourceHub: {
            type: mongoose.Schema.Types.Mixed,
            default: null
        },
        destinationHub: {
            type: mongoose.Schema.Types.Mixed,
            default: null
        },
        planId: {
            type: String,
            default: null,
            index: true
        },
        scheduleDate: {
            type: String,
            default: null
        }
    },
    {
        timestamps: true
    }
);

historicalRouteSchema.index({ direction: 1, createdAt: -1 });
historicalRouteSchema.index({ busId: 1, direction: 1 });
historicalRouteSchema.index({ stopNames: 1 });

const HistoricalRoute =
    mongoose.models.HistoricalRoute ||
    mongoose.model("HistoricalRoute", historicalRouteSchema);

export default HistoricalRoute;
