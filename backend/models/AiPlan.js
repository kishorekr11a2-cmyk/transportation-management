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

        resetAt: {
            type: Date,
            default: null
        }
    },
    {
        timestamps: true
    }
);

export default mongoose.model("AiPlan", aiPlanSchema);
