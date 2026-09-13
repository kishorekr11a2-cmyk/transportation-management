
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

        lateResponseDetected: {
            type: Boolean,
            default: false
        },

        lateResponseAt: {
            type: Date,
            default: null
        },

        previousTravelStatus: {
            type: String,
            default: null,
            trim: true
        },

        requiresReallocation: {
            type: Boolean,
            default: false
        },

        affectedDirections: {
            type: [String],
            default: []
        },

        acknowledgedAt: {
            type: Date,
            default: null
        },

        acknowledgedBy: {
            type: String,
            default: null,
            trim: true
        },

        travelResponseSubmittedAt: {
            type: Date,
            default: null
        },

        lastTravelResponseAt: {
            type: Date,
            default: null
        },

        allocatedBus: {
            type: mongoose.Schema.Types.Mixed,
            default: null
        },

        lateResponseNotifiedEventKeys: {
            type: [String],
            default: []
        },

        lateResponseNotifiedAt: {
            type: Date,
            default: null
        },

        lateResponseResolvedAt: {
            type: Date,
            default: null
        },

        isLateResponse: {
            type: Boolean,
            default: false
        },

        responseDeadline: {
            type: Date,
            default: null
        },

        approvedPlanType: {
            type: String,
            default: null,
            trim: true
        },

        manualRouteId: {
            type: String,
            default: null,
            trim: true
        },

        manualBusId: {
            type: String,
            default: null,
            trim: true
        },

        routeId: {
            type: String,
            default: null,
            trim: true
        },

        busId: {
            type: String,
            default: null,
            trim: true
        },

        approvalStatus: {
            type: String,
            default: null,
            trim: true
        },

        manualAllocation: {
            type: mongoose.Schema.Types.Mixed,
            default: null
        },

        aiAllocation: {
            type: mongoose.Schema.Types.Mixed,
            default: null
        }
    },
    {
        timestamps: true
    }
);

// Performance Indexes for high-frequency query patterns
userSchema.index({ role: 1, userId: 1 });
userSchema.index({ role: 1, travelStatus: 1 });
userSchema.index({ role: 1, allocationStatus: 1 });
userSchema.index({ role: 1, lateResponseDetected: 1 });
userSchema.index({ role: 1, isLateResponse: 1 });
userSchema.index({ role: 1, travelResponseSubmittedAt: 1 });
userSchema.index({ role: 1, responseDeadline: 1 });
userSchema.index({ role: 1, requiresReallocation: 1 });
userSchema.index({ role: 1, createdAt: -1 });
userSchema.index({ role: 1, "allocatedBus.direction": 1 });
userSchema.index({ role: 1, "allocatedBus.isAllocated": 1 });

export default mongoose.model(
    "User",
    userSchema
);

