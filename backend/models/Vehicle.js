
import mongoose from "mongoose";

const vehicleSchema = new mongoose.Schema(
    {
        vehicleName: {
            type: String,
            required: true,
            unique: true,
            trim: true
        },

        capacity: {
            type: Number,
            required: true,
            min: 1
        }
    },
    {
        timestamps: true
    }
);

export default mongoose.model(
    "Vehicle",
    vehicleSchema
);

