import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import { authorize, requireAdmin } from "../middleware/authorizeMiddleware.js";
import { sensitiveActionLimiter, apiRateLimiter, createRateLimiter, userOrIpKeyGenerator } from "../middleware/rateLimiter.js";
import validateRequest from "../middleware/validateMiddleware.js";
import {
    executeFleetOverride,
    getSecurityAudit,
    getSecureProfile,
    testPipelineExecution
} from "../controllers/secureController.js";

const router = express.Router();

/**
 * Validation Schemas for Strong API Endpoints
 */
const fleetOverrideSchema = {
    body: {
        vehicleNumber: { type: "string", required: true, minLength: 2, maxLength: 30 },
        action: {
            type: "string",
            required: true,
            enum: ["reassign_route", "standby_activate", "maintenance_hold", "emergency_stop"]
        },
        reason: { type: "string", required: true, minLength: 5, maxLength: 300 },
        priority: { type: "string", required: false, enum: ["low", "normal", "high", "urgent"] }
    }
};

const testPipelineSchema = {
    body: {
        testId: { type: "string", required: true, minLength: 1 },
        action: { type: "string", required: true, enum: ["verify", "execute"] },
        details: { type: "string", required: false, maxLength: 500 }
    }
};

/**
 * Rate limiter specifically for test pipeline verification
 * (allows strict rate limit testing with a small threshold)
 */
export const testPipelineRateLimiter = createRateLimiter({
    windowMs: 60 * 1000, // 1 minute
    limit: 5,
    keyGenerator: userOrIpKeyGenerator,
    message: "Rate limit reached for test pipeline. Please wait 1 minute."
});

/*
 |--------------------------------------------------------------------------
 | 1. STRONG API ENDPOINT: Admin Fleet Override
 |--------------------------------------------------------------------------
 | PIPELINE SEQUENCE:
 |   1. authMiddleware         -> Verifies JWT signature and extracts user claims
 |   2. requireAdmin           -> Enforces 'admin' role authorization
 |   3. sensitiveActionLimiter -> Throttles sensitive operations per admin
 |   4. validateRequest        -> Validates types, required fields, and sanitizes input
 |   5. executeFleetOverride   -> Atomic business logic execution & structured envelope
 */
router.post(
    "/operations/fleet-override",
    authMiddleware,
    requireAdmin,
    sensitiveActionLimiter,
    validateRequest(fleetOverrideSchema),
    executeFleetOverride
);

/*
 |--------------------------------------------------------------------------
 | 2. STRONG API ENDPOINT: Security Audit Status
 |--------------------------------------------------------------------------
 | PIPELINE SEQUENCE:
 |   1. authMiddleware  -> Verifies JWT authentication
 |   2. requireAdmin    -> Authorizes 'admin' role
 |   3. apiRateLimiter  -> Throttles request volume
 |   4. getSecurityAudit-> Reads audit & security status
 */
router.get(
    "/audit/status",
    authMiddleware,
    requireAdmin,
    apiRateLimiter,
    getSecurityAudit
);

/*
 |--------------------------------------------------------------------------
 | 3. STRONG API ENDPOINT: Authenticated User Profile (Student & Admin)
 |--------------------------------------------------------------------------
 | PIPELINE SEQUENCE:
 |   1. authMiddleware                 -> Verifies JWT authentication
 |   2. authorize("student", "admin")  -> Authorizes role
 |   3. apiRateLimiter                 -> Enforces rate limiting
 |   4. getSecureProfile               -> Retrieves verified user data
 */
router.get(
    "/profile/me",
    authMiddleware,
    authorize("student", "admin"),
    apiRateLimiter,
    getSecureProfile
);

/*
 |--------------------------------------------------------------------------
 | 4. STRONG API ENDPOINT: Test Pipeline Verification Endpoint
 |--------------------------------------------------------------------------
 | PIPELINE SEQUENCE:
 |   1. authMiddleware               -> Step 1: JWT Authentication
 |   2. requireAdmin                 -> Step 2: Role Authorization
 |   3. testPipelineRateLimiter      -> Step 3: Rate Limiter
 |   4. validateRequest              -> Step 4: Schema Validation & Sanitization
 |   5. testPipelineExecution        -> Step 5: Strong Endpoint Controller
 */
router.post(
    "/test-pipeline",
    authMiddleware,
    requireAdmin,
    testPipelineRateLimiter,
    validateRequest(testPipelineSchema),
    testPipelineExecution
);

export default router;
