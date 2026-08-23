
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
            default: Date.now
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
    { vehicle: 1 }
);

export default mongoose.model(
    "Schedule",
    scheduleSchema
);
