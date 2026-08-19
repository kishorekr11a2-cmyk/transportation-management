import mongoose from "mongoose";

const stopSchema = new mongoose.Schema(
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

export default mongoose.model(
    "Stop",
    stopSchema
);