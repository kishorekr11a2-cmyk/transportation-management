import mongoose from "mongoose";

const inwardStartingPlaceSchema = new mongoose.Schema(
    {
        vehicleId: {
            type: String,
            trim: true,
            index: true
        },

        busId: {
            type: String,
            trim: true,
            index: true
        },

        busName: {
            type: String,
            required: [true, "Bus name is required"],
            trim: true,
            index: true
        },

        capacity: {
            type: Number,
            default: 0
        },

        locationName: {
            type: String,
            required: [true, "Starting location name is required"],
            trim: true
        },

        // Legacy compatibility alias
        name: {
            type: String,
            trim: true
        },

        address: {
            type: String,
            default: "",
            trim: true
        },

        latitude: {
            type: Number,
            required: [true, "Latitude is required"],
            min: -90,
            max: 90
        },

        longitude: {
            type: Number,
            required: [true, "Longitude is required"],
            min: -180,
            max: 180
        },

        active: {
            type: Boolean,
            default: true,
            index: true
        }
    },
    {
        timestamps: true
    }
);

// Pre-save hook to ensure name and locationName remain in sync
inwardStartingPlaceSchema.pre("save", function (next) {
    if (this.locationName && !this.name) {
        this.name = this.locationName;
    } else if (this.name && !this.locationName) {
        this.locationName = this.name;
    }
    if (this.vehicleId && !this.busId) {
        this.busId = this.vehicleId;
    } else if (this.busId && !this.vehicleId) {
        this.vehicleId = this.busId;
    }
    next();
});

inwardStartingPlaceSchema.index({ active: 1, busName: 1 });
inwardStartingPlaceSchema.index({ active: 1, vehicleId: 1 });
inwardStartingPlaceSchema.index({ createdAt: -1 });

const InwardStartingPlace =
    mongoose.models.InwardStartingPlace ||
    mongoose.model("InwardStartingPlace", inwardStartingPlaceSchema);

export default InwardStartingPlace;
