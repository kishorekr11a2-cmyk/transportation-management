import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve("backend", ".env") });
dotenv.config();

import mongoose from "mongoose";
import { confirmAndAllocatePlan, saveSelectedPlan } from "../services/aiAgentService.js";

describe("Confirm & Allocate Plan Endpoint & Service Suite", () => {
    let mongoConnected = false;

    before(async () => {
        const mongoUri = process.env.MONGO_URI;
        if (mongoUri && mongoose.connection.readyState === 0) {
            try {
                await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 8000 });
                mongoConnected = mongoose.connection.readyState === 1;
            } catch (err) {
                console.warn("[TEST_SETUP] Mongo connection warning:", err.message);
            }
        } else if (mongoose.connection.readyState === 1) {
            mongoConnected = true;
        }
    });

    after(async () => {
        if (mongoose.connection.readyState !== 0) {
            await mongoose.disconnect();
        }
    });

    it("1. Verifies confirmAndAllocatePlan is exported and aliases saveSelectedPlan", () => {
        assert.equal(typeof confirmAndAllocatePlan, "function", "confirmAndAllocatePlan must be a function");
        assert.equal(confirmAndAllocatePlan, saveSelectedPlan, "confirmAndAllocatePlan should be an alias of saveSelectedPlan");
    });

    it("2. Verifies confirmAndAllocatePlan handles certification check if provided", async (t) => {
        if (!mongoConnected) {
            t.skip("MongoDB required for execution");
            return;
        }

        const uncertifiedPlan = {
            direction: "INWARD",
            certification: {
                isCertified: false,
                checks: { capacitiesNotExceeded: false },
                failureReasons: ["Capacity violation"]
            },
            buses: []
        };

        const res = await confirmAndAllocatePlan({
            planType: "AI",
            plan: uncertifiedPlan,
            direction: "INWARD"
        });

        assert.equal(res.success, false, "Should reject uncertified plan with critical safety violations");
    });
});
