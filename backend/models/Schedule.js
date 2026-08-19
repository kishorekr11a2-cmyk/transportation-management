
import mongoose from "mongoose";

const scheduleSchema = new mongoose.Schema(
    {
        vehicle: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Vehicle",
            required: true
        },

        date: {
            type: Date,
            required: true
        },

        availability: {
            type: String,
            enum: [
                "Available",
                "Not Available"
            ],
            default: "Available"
        }
    },
    {
        timestamps: true
    }
);

scheduleSchema.index(
    { date: 1, vehicle: 1 },
    { unique: true }
);

export default mongoose.model(
    "Schedule",
    scheduleSchema
);
