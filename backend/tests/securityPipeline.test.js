import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";
import express from "express";

import { authMiddleware, generateToken } from "../middleware/authMiddleware.js";
import { authorize, requireAdmin, requireStudent } from "../middleware/authorizeMiddleware.js";
import { createRateLimiter, userOrIpKeyGenerator } from "../middleware/rateLimiter.js";
import validateRequest from "../middleware/validateMiddleware.js";

const JWT_SECRET = process.env.JWT_SECRET || "transportation_secret_key";

test("Security Pipeline End-to-End Suite", async (t) => {
    // Spin up an isolated test Express server
    const app = express();
    app.use(express.json());

    // Custom test rate limiter: max 2 requests per 60s window
    const strictRateLimiter = createRateLimiter({
        windowMs: 60 * 1000,
        limit: 2,
        skip: () => false, // Force rate limit checking in this test
        keyGenerator: (req) => req.user?.id || req.ip || "test-client"
    });

    const testActionSchema = {
        body: {
            vehicleNumber: { type: "string", required: true, minLength: 2 },
            action: { type: "string", required: true, enum: ["dispatch", "maintenance"] },
            reason: { type: "string", required: true, minLength: 5 }
        }
    };

    /*
     * The Full 5-Stage Security Pipeline:
     * 1. JWT Authentication (authMiddleware)
     * 2. Role-Based Authorization (requireAdmin)
     * 3. Rate Limiter (strictRateLimiter)
     * 4. Input Validation & Sanitization (validateRequest)
     * 5. Strong API Endpoint (controller logic)
     */
    app.post(
        "/api/secure/operations/test-pipeline",
        authMiddleware,
        requireAdmin,
        strictRateLimiter,
        validateRequest(testActionSchema),
        (req, res) => {
            res.status(200).json({
                success: true,
                code: "STRONG_ENDPOINT_SUCCESS",
                message: "Security pipeline completed successfully",
                data: {
                    caller: req.user,
                    payload: req.body
                },
                meta: {
                    pipeline: [
                        "jwt_authentication",
                        "role_authorization",
                        "rate_limiting",
                        "input_validation",
                        "strong_controller"
                    ],
                    timestamp: new Date().toISOString()
                }
            });
        }
    );

    // Multi-role endpoint (student or admin)
    app.get(
        "/api/secure/profile/test",
        authMiddleware,
        authorize("student", "admin"),
        (req, res) => {
            res.status(200).json({
                success: true,
                code: "PROFILE_SUCCESS",
                user: req.user
            });
        }
    );

    // Start ephemeral server
    const server = await new Promise((resolve) => {
        const s = app.listen(0, () => resolve(s));
    });
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    t.after(() => {
        server.close();
    });

    // Generate tokens for testing
    const adminToken = generateToken({ id: "adm_101", userId: "adminUser", role: "admin" });
    const studentToken = generateToken({ id: "std_202", userId: "studentUser", role: "student" });
    const guestToken = generateToken({ id: "gst_303", userId: "guestUser", role: "guest" });
    const expiredToken = jwt.sign(
        { id: "exp_999", role: "admin" },
        JWT_SECRET,
        { expiresIn: "-5s" }
    );

    await t.test("Layer 1: JWT Authentication — Rejects missing, malformed, and expired tokens", async () => {
        // 1. Missing Authorization header
        const resMissing = await fetch(`${baseUrl}/api/secure/operations/test-pipeline`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ vehicleNumber: "BUS-1", action: "dispatch", reason: "Standard route" })
        });
        const dataMissing = await resMissing.json();
        assert.equal(resMissing.status, 401);
        assert.equal(dataMissing.code, "UNAUTHORIZED");

        // 2. Malformed token (missing Bearer prefix)
        const resMalformed = await fetch(`${baseUrl}/api/secure/operations/test-pipeline`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: "TokenXYZ123"
            },
            body: JSON.stringify({ vehicleNumber: "BUS-1", action: "dispatch", reason: "Standard route" })
        });
        const dataMalformed = await resMalformed.json();
        assert.equal(resMalformed.status, 401);
        assert.equal(dataMalformed.code, "UNAUTHORIZED");

        // 3. Invalid signature
        const resInvalid = await fetch(`${baseUrl}/api/secure/operations/test-pipeline`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer invalid.token.signature"
            },
            body: JSON.stringify({ vehicleNumber: "BUS-1", action: "dispatch", reason: "Standard route" })
        });
        const dataInvalid = await resInvalid.json();
        assert.equal(resInvalid.status, 401);
        assert.equal(dataInvalid.code, "INVALID_TOKEN");

        // 4. Expired token
        const resExpired = await fetch(`${baseUrl}/api/secure/operations/test-pipeline`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${expiredToken}`
            },
            body: JSON.stringify({ vehicleNumber: "BUS-1", action: "dispatch", reason: "Standard route" })
        });
        const dataExpired = await resExpired.json();
        assert.equal(resExpired.status, 401);
        assert.equal(dataExpired.code, "TOKEN_EXPIRED");
    });

    await t.test("Layer 2: Role Authorization (RBAC) — Rejects unauthorized roles with 403 Forbidden", async () => {
        // Student token accessing admin-only endpoint
        const resForbidden = await fetch(`${baseUrl}/api/secure/operations/test-pipeline`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${studentToken}`
            },
            body: JSON.stringify({ vehicleNumber: "BUS-1", action: "dispatch", reason: "Standard route" })
        });
        const dataForbidden = await resForbidden.json();
        assert.equal(resForbidden.status, 403);
        assert.equal(dataForbidden.code, "FORBIDDEN");
        assert.match(dataForbidden.message, /Access forbidden.*admin/);

        // Student accessing allowed multi-role endpoint
        const resStudentAllowed = await fetch(`${baseUrl}/api/secure/profile/test`, {
            method: "GET",
            headers: { Authorization: `Bearer ${studentToken}` }
        });
        const dataStudentAllowed = await resStudentAllowed.json();
        assert.equal(resStudentAllowed.status, 200);
        assert.equal(dataStudentAllowed.user.role, "student");

        // Guest role rejected from student+admin endpoint
        const resGuest = await fetch(`${baseUrl}/api/secure/profile/test`, {
            method: "GET",
            headers: { Authorization: `Bearer ${guestToken}` }
        });
        assert.equal(resGuest.status, 403);
    });

    await t.test("Layer 3: Rate Limiter — Enforces 429 Too Many Requests after threshold", async () => {
        const payload = JSON.stringify({
            vehicleNumber: "BUS-99",
            action: "dispatch",
            reason: "Routine daily run"
        });

        // Request 1: Allowed
        const req1 = await fetch(`${baseUrl}/api/secure/operations/test-pipeline`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${adminToken}`
            },
            body: payload
        });
        assert.equal(req1.status, 200);

        // Request 2: Allowed
        const req2 = await fetch(`${baseUrl}/api/secure/operations/test-pipeline`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${adminToken}`
            },
            body: payload
        });
        assert.equal(req2.status, 200);

        // Request 3: Exceeds threshold (limit = 2) -> 429 Rate Limit Exceeded
        const req3 = await fetch(`${baseUrl}/api/secure/operations/test-pipeline`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${adminToken}`
            },
            body: payload
        });
        const data3 = await req3.json();
        assert.equal(req3.status, 429);
        assert.equal(data3.code, "RATE_LIMIT_EXCEEDED");
        assert.equal(typeof data3.retryAfterSeconds, "number");
    });

    await t.test("Layer 4 & 5: Input Validation & Strong API Endpoint Execution", async () => {
        // Create an admin with separate ID to avoid hitting previous rate limit
        const freshAdminToken = generateToken({ id: "adm_fresh", userId: "adminFresh", role: "admin" });

        // 1. Missing required field -> 400 Bad Request
        const resMissingField = await fetch(`${baseUrl}/api/secure/operations/test-pipeline`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${freshAdminToken}`
            },
            body: JSON.stringify({ vehicleNumber: "BUS-1" }) // missing action and reason
        });
        const dataMissingField = await resMissingField.json();
        assert.equal(resMissingField.status, 400);
        assert.equal(dataMissingField.code, "VALIDATION_FAILED");
        assert.equal(dataMissingField.errors.length, 2);

        // 2. Invalid Enum value -> 400 Bad Request
        const resInvalidEnum = await fetch(`${baseUrl}/api/secure/operations/test-pipeline`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${freshAdminToken}`
            },
            body: JSON.stringify({
                vehicleNumber: "BUS-1",
                action: "unauthorized_action",
                reason: "Valid description reason"
            })
        });
        const dataInvalidEnum = await resInvalidEnum.json();
        assert.equal(resInvalidEnum.status, 400);
        assert.match(dataInvalidEnum.errors[0].error, /must be one of/);

        // 3. Valid Payload -> 200 OK with sanitized envelope
        // Use another admin ID since limit is 2
        const execAdminToken = generateToken({ id: "adm_exec", userId: "adminExec", role: "admin" });
        const resSuccess = await fetch(`${baseUrl}/api/secure/operations/test-pipeline`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${execAdminToken}`
            },
            body: JSON.stringify({
                vehicleNumber: "  BUS-04  ",
                action: "dispatch",
                reason: "Regular morning student route"
            })
        });
        const dataSuccess = await resSuccess.json();
        assert.equal(resSuccess.status, 200);
        assert.equal(dataSuccess.code, "STRONG_ENDPOINT_SUCCESS");
        assert.equal(dataSuccess.data.payload.vehicleNumber, "BUS-04"); // Sanitized & trimmed
        assert.equal(dataSuccess.data.payload.action, "dispatch");
        assert.equal(dataSuccess.data.caller.userId, "adminExec");
        assert.equal(dataSuccess.data.caller.role, "admin");
        assert.deepEqual(dataSuccess.meta.pipeline, [
            "jwt_authentication",
            "role_authorization",
            "rate_limiting",
            "input_validation",
            "strong_controller"
        ]);
    });
});
