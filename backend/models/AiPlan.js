import mongoose from "mongoose";

const aiPlanSchema = new mongoose.Schema(
    {
        active: {
            type: Boolean,
            default: true,
            index: true
        },

        status: {
            type: String,
            enum: ["active", "reset", "superseded"],
            default: "active",
            index: true
        },

        planType: {
            type: String,
            default: "AI"
        },

        tripMode: {
            type: String,
            default: "INWARD"
        },

        direction: {
            type: String,
            enum: ["OUTWARD", "INWARD"],
            default: "INWARD",
            index: true
        },

        source: {
            type: mongoose.Schema.Types.Mixed,
            default: null
        },

        destination: {
            type: mongoose.Schema.Types.Mixed,
            default: null
        },

        startingPoint: {
            type: mongoose.Schema.Types.Mixed,
            default: null
        },

        hubProvenance: {
            type: String,
            default: ""
        },

        summary: {
            type: mongoose.Schema.Types.Mixed,
            default: {}
        },

        stoppingGroups: {
            type: Array,
            default: []
        },

        aiPlan: {
            type: mongoose.Schema.Types.Mixed,
            default: null
        },

        manualPlan: {
            type: mongoose.Schema.Types.Mixed,
            default: null
        },

        recommendations: {
            type: Array,
            default: []
        },

        generatedAt: {
            type: Date,
            default: Date.now
        },

        isApproved: {
            type: Boolean,
            default: false,
            index: true
        },

        approvedAt: {
            type: Date,
            default: null
        },

        resetAt: {
            type: Date,
            default: null
        },

        // ── Late-Response Review State ──────────────────────────────
        // Set to true when a student submits a Coming response AFTER
        // this plan was approved, requiring admin to review/regenerate.
        requiresReview: {
            type: Boolean,
            default: false,
            index: true
        },

        hasLateResponses: {
            type: Boolean,
            default: false,
            index: true
        },

        pendingReallocation: {
            type: Boolean,
            default: false
        },

        lastLateResponseAt: {
            type: Date,
            default: null
        },

        affectedDirections: {
            type: [String],
            default: []
        }
    },
    {
        timestamps: true
    }
);

aiPlanSchema.index({ active: 1, status: 1, direction: 1, createdAt: -1 });
aiPlanSchema.index({ active: 1, status: 1, isApproved: 1, direction: 1 });
aiPlanSchema.index({ active: 1, isApproved: 1, requiresReview: 1 });
aiPlanSchema.index({ active: 1, isApproved: 1, hasLateResponses: 1 });

export default mongoose.model("AiPlan", aiPlanSchema);
