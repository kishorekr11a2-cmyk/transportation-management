
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

