import mongoose from "mongoose";

const roadMatrixCacheSchema = new mongoose.Schema(
    {
        cacheKey: {
            type: String,
            required: true,
            unique: true,
            index: true,
            trim: true
        },
        distances: {
            type: [[Number]],
            required: true
        },
        durations: {
            type: [[Number]],
            required: true
        },
        source: {
            type: String,
            enum: ["osrm", "calibrated_fallback", "cached_osrm"],
            default: "osrm"
        },
        locationCount: {
            type: Number,
            required: true
        },
        expiresAt: {
            type: Date,
            default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days TTL
            index: { expires: 0 }
        }
    },
    {
        timestamps: true
    }
);

const RoadMatrixCache =
    mongoose.models.RoadMatrixCache ||
    mongoose.model("RoadMatrixCache", roadMatrixCacheSchema);

export default RoadMatrixCache;
