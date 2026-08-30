
import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
    {
        userId: {
            type: String,
            required: true,
            unique: true,
            trim: true
        },

        name: {
            type: String,
            required: true,
            trim: true
        },

        password: {
            type: String
        },

        stoppings: {
            type: String,
            default: "",
            trim: true
        },

        city: {
            type: String,
            default: "",
            trim: true
        },

        district: {
            type: String,
            default: "",
            trim: true
        },

        state: {
            type: String,
            default: "",
            trim: true
        },

        country: {
            type: String,
            default: "",
            trim: true
        },

        travelStatus: {
            type: String,
            enum: [
                "Coming",
                "Not Coming",
                "Pending"
            ],
            default: "Pending"
        },

        role: {
            type: String,
            enum: [
                "admin",
                "student"
            ],
            default: "student"
        },

        assignedVehicle: {
            type: String,
            default: null,
            trim: true
        },

        assignedRoute: {
            type: String,
            default: null,
            trim: true
        },

        allocationStatus: {
            type: String,
            default: "Not Assigned",
            trim: true
        },

        allocatedBus: {
            type: mongoose.Schema.Types.Mixed,
            default: null
        }
    },
    {
        timestamps: true
    }
);

export default mongoose.model(
    "User",
    userSchema
);

