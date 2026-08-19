import mongoose from "mongoose";

const mapLocationSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true
        },

        address: {
            type: String,
            default: "",
            trim: true
        },

        latitude: {
            type: Number,
            required: true
        },

        longitude: {
            type: Number,
            required: true
        },

        placeId: {
            type: String,
            default: "",
            trim: true
        }
    },
    {
        timestamps: true
    }
);

mapLocationSchema.index(
    { name: 1 },
    { unique: true }
);

export default mongoose.model(
    "MapLocation",
    mapLocationSchema
);
