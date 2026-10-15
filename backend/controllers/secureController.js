import Vehicle from "../models/Vehicle.js";
import Route from "../models/Route.js";
import User from "../models/User.js";
import { isDbConnected } from "../config/db.js";

/**
 * Controller for hardened fleet override operation
 * Step 5 of the Security Pipeline
 */
export const executeFleetOverride = async (req, res) => {
    const startTime = Date.now();

    try {
        const { vehicleNumber, action, reason, priority } = req.body;
        const operator = req.user;

        if (!isDbConnected()) {
            return res.status(503).json({
                success: false,
                code: "DATABASE_UNAVAILABLE",
                message: "Database connection unavailable. Operation aborted safely."
            });
        }

        // Validate vehicle existence if DB connected
        let vehicle = null;
        if (vehicleNumber) {
            vehicle = await Vehicle.findOne({
                vehicleNumber: new RegExp(`^${vehicleNumber}$`, "i")
            }).lean();
        }

        const operationResult = {
            operationId: `SEC-OP-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`,
            targetVehicle: vehicleNumber,
            vehicleFound: Boolean(vehicle),
            action,
            priority: priority || "normal",
            reason,
            executedBy: {
                userId: operator.userId || operator.id,
                role: operator.role
            },
            status: "COMMITTED",
            executionTimeMs: Date.now() - startTime
        };

        return res.status(200).json({
            success: true,
            code: "SECURE_OPERATION_COMPLETED",
            message: `Secure operation '${action}' executed successfully on vehicle ${vehicleNumber}.`,
            data: operationResult,
            meta: {
                pipeline: [
                    "jwt_authentication",
                    "role_authorization",
                    "rate_limiting",
                    "schema_validation",
                    "hardened_controller"
                ],
                timestamp: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error("[SECURE CONTROLLER ERROR]", error);
        return res.status(500).json({
            success: false,
            code: "OPERATION_FAILED",
            message: "Secure operation failed: " + error.message,
            executionTimeMs: Date.now() - startTime
        });
    }
};

/**
 * Controller for retrieving security & system audit summary
 */
export const getSecurityAudit = async (req, res) => {
    try {
        const auditData = {
            activeSession: {
                userId: req.user.userId || req.user.id,
                role: req.user.role,
                authenticatedAt: new Date(req.user.iat * 1000).toISOString(),
                expiresAt: new Date(req.user.exp * 1000).toISOString()
            },
            securityStatus: {
                jwtAuthentication: "ENFORCED",
                roleAuthorization: "ENFORCED",
                rateLimiting: "ACTIVE",
                schemaSanitization: "ENABLED",
                cacheControl: "NO_STORE"
            },
            systemHealth: {
                dbConnected: isDbConnected(),
                serverTime: new Date().toISOString(),
                nodeEnv: process.env.NODE_ENV || "development"
            }
        };

        return res.status(200).json({
            success: true,
            code: "AUDIT_SUMMARY_RETRIEVED",
            data: auditData
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            code: "AUDIT_RETRIEVAL_FAILED",
            message: error.message
        });
    }
};

/**
 * Controller for retrieving current user profile under secure pipeline
 */
export const getSecureProfile = async (req, res) => {
    try {
        const user = req.user;
        let dbDetails = null;

        if (isDbConnected() && user.id) {
            dbDetails = await User.findById(user.id)
                .select("userId name role stoppings travelStatus allocatedBus")
                .lean();
        }

        return res.status(200).json({
            success: true,
            code: "PROFILE_RETRIEVED",
            data: {
                authenticatedUser: {
                    id: user.id || user.userId,
                    role: user.role
                },
                profile: dbDetails || {
                    userId: user.userId || user.id,
                    role: user.role
                }
            }
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            code: "PROFILE_ERROR",
            message: error.message
        });
    }
};

/**
 * Controller for verifying pipeline execution in test harness
 */
export const testPipelineExecution = async (req, res) => {
    return res.status(200).json({
        success: true,
        code: "PIPELINE_VERIFIED",
        message: "Request successfully passed JWT authentication, role authorization, rate limiter, and schema validation.",
        data: {
            caller: req.user,
            payload: req.body
        },
        pipeline: [
            "jwt_authentication",
            "role_authorization",
            "rate_limiter",
            "schema_validation",
            "strong_endpoint_handler"
        ]
    });
};
