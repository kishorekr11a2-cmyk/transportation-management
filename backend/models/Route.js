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

        displayName: {
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
        },

        types: {
            type: [String],
            default: []
        }
    },
    {
        _id: false
    }
);

const routeSchema = new mongoose.Schema(
    {
        routeName: {
            type: String,
            required: true,
            trim: true
        },

        source: {
            type: stopSchema,
            required: true
        },

        stops: {
            type: [stopSchema],
            default: []
        },

        destination: {
            type: stopSchema,
            required: true
        },

        assignedVehicle: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Vehicle",
            default: null
        }
    },
    {
        timestamps: true
    }
);

export default mongoose.model("Route", routeSchema);