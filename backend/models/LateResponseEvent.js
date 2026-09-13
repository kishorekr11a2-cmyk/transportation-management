import mongoose from "mongoose";

const lateResponseEventSchema = new mongoose.Schema(
    {
        eventKey: {
            type: String,
            required: true,
            unique: true,
            index: true,
            trim: true
        },

        userId: {
            type: String,
            required: true,
            index: true,
            trim: true
        },

        // Reference to the approved plan this late response is against
        planId: {
            type: String,
            default: null,
            index: true,
            trim: true
        },

        direction: {
            type: String,
            required: true,
            enum: ["INWARD", "OUTWARD"],
            trim: true
        },

        // Student travel status BEFORE this response was submitted
        previousTravelStatus: {
            type: String,
            default: null,
            trim: true
        },

        // Student travel status AFTER this response was submitted (always "Coming" for late responses)
        currentTravelStatus: {
            type: String,
            default: "Coming",
            trim: true
        },

        responseTimestamp: {
            type: Date,
            default: Date.now
        },

        responseSubmittedAt: {
            type: Date,
            default: Date.now
        },

        planApprovedAt: {
            type: Date,
            default: null
        },

        planType: {
            type: String,
            default: "AI"
        },

        isLateResponse: {
            type: Boolean,
            default: true,
            index: true
        },

        status: {
            type: String,
            enum: [
                "Pending",
                "DETECTED",
                "NOTIFIED",
                "PENDING_REALLOCATION",
                "REGENERATION_DRAFT",
                "AWAITING_APPROVAL",
                "ALLOCATED",
                "Processed",
                "Resolved",
                "RESOLVED"
            ],
            default: "Pending",
            index: true
        },

        notifiedAt: {
            type: Date,
            default: null
        },

        resolvedAt: {
            type: Date,
            default: null
        },

        allocatedBus: {
            type: String,
            default: null
        },

        allocatedRoute: {
            type: String,
            default: null
        },

        allocatedSeat: {
            type: String,
            default: null
        },

        unallocatedReason: {
            type: String,
            default: null
        },

        metadata: {
            type: mongoose.Schema.Types.Mixed,
            default: null
        }
    },
    {
        timestamps: true
    }
);

lateResponseEventSchema.index({ direction: 1 });
lateResponseEventSchema.index({ userId: 1, direction: 1 });
lateResponseEventSchema.index({ userId: 1, planId: 1, direction: 1 });
lateResponseEventSchema.index({ planId: 1, status: 1 });
lateResponseEventSchema.index({ notifiedAt: 1 });

export default mongoose.model("LateResponseEvent", lateResponseEventSchema);
