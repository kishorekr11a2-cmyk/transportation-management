import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import adminMiddleware from "../middleware/adminMiddleware.js";

import {
    getAIData,
    getAIMetrics,
    searchPlaces,
    resolveLocation,
    generateAgentRecommendations,
    saveSelectedPlan,
    getSelectedPlan,
    getActiveAIPlan,
    resetGeneratedAIRoute,
    resetAIPlanAndStudents
} from "../services/aiAgentService.js";

import {
    regenerateLateResponsePlan,
    getLateResponseDraft,
    approveLateResponseDraft,
    discardLateResponseDraft
} from "../services/lateResponseRegenerationService.js";

const router =
    express.Router();

/*
|--------------------------------------------------------------------------
| AI METRICS (Fast Counts & Capacities)
|--------------------------------------------------------------------------
*/

router.get("/metrics", async (req, res) => {
    try {
        const metrics = await getAIMetrics();
        res.json(metrics);
    } catch (error) {
        console.error("AI metrics error:", error);
        res.status(500).json({
            success: false,
            message: "Unable to load AI transportation metrics."
        });
    }
});

/*
|--------------------------------------------------------------------------
| AI DATA
|--------------------------------------------------------------------------
*/

router.get(
    "/data",
    async (
        req,
        res
    ) => {
        try {
            const metricsOnly = req.query.metricsOnly === "true";
            const data =
                await getAIData({ metricsOnly });

            res.json({
                success: true,
                ...data
            });

        } catch (error) {
            console.error(
                "AI data error:",
                error
            );

            res.status(
                500
            ).json({
                success: false,

                message:
                    "Unable to load AI transportation data."
            });
        }
    }
);

/*
|--------------------------------------------------------------------------
| PLACE SEARCH
|--------------------------------------------------------------------------
*/

router.get(
    "/search-places",
    async (
        req,
        res
    ) => {
        try {
            const query =
                String(
                    req.query.query ||
                    ""
                ).trim();

            if (
                query.length <
                2
            ) {
                return res.json({
                    success: true,

                    results: []
                });
            }

            const results =
                await searchPlaces(
                    query
                );

            res.json({
                success: true,

                results
            });

        } catch (error) {
            console.error(
                "AI place search error:",
                error
            );

            res.status(
                500
            ).json({
                success: false,

                message:
                    "Unable to search locations.",

                results: []
            });
        }
    }
);

/*
|--------------------------------------------------------------------------
| RESOLVE LOCATION
|--------------------------------------------------------------------------
*/

router.get(
    "/resolve-location",
    async (
        req,
        res
    ) => {
        try {
            const query =
                String(
                    req.query.query ||
                    ""
                ).trim();

            if (
                !query
            ) {
                return res.status(
                    400
                ).json({
                    success: false,

                    message:
                        "Location query is required."
                });
            }

            const result =
                await resolveLocation(
                    query
                );

            res.json(
                result
            );

        } catch (error) {
            console.error(
                "AI resolve location error:",
                error
            );

            res.status(
                500
            ).json({
                success: false,

                message:
                    "Unable to resolve location."
            });
        }
    }
);

/*
|--------------------------------------------------------------------------
| GENERATE AI PLAN
|--------------------------------------------------------------------------
*/

router.post(
    "/recommendations",
    async (
        req,
        res
    ) => {
        try {
            // Accept both old format (startingPoint) and new format (source, destination, tripMode)
            const payload = req.body || {};

            const hasSource = payload?.source?.latitude && payload?.source?.longitude;
            const hasDestination = payload?.destination?.latitude && payload?.destination?.longitude;
            const hasStartingPoint = payload?.startingPoint?.latitude && payload?.startingPoint?.longitude;

            if (!hasSource && !hasDestination && !hasStartingPoint) {
                return res.status(400).json({
                    success: false,
                    message: "A Source or Destination location is required."
                });
            }

            const result = await generateAgentRecommendations(payload);

            res.json(result);

        } catch (error) {
            console.error(
                "AI recommendation error:",
                error
            );

            res.status(
                500
            ).json({
                success: false,

                message:
                    error?.message ||
                    "Unable to generate AI route plan."
            });
        }
    }
);

/*
|--------------------------------------------------------------------------
| SAVE FINAL ADMIN SELECTION
|--------------------------------------------------------------------------
*/

router.post(
    "/select-plan",
    async (
        req,
        res
    ) => {
        try {
            const {
                planType,
                plan,
                startingPoint,
                direction,
                tripMode
            } = req.body;

            if (
                !planType ||
                !plan
            ) {
                return res.status(
                    400
                ).json({
                    success: false,

                    message:
                        "Plan type and plan are required."
                });
            }

            const result =
                await saveSelectedPlan({
                    planType,
                    plan,
                    startingPoint,
                    direction: direction || plan?.direction || tripMode || plan?.tripMode,
                    tripMode: tripMode || plan?.tripMode
                });

            res.json(
                result
            );

        } catch (error) {
            console.error(
                "Save selected plan error:",
                error
            );

            res.status(
                500
            ).json({
                success: false,

                message:
                    error?.message ||
                    "Unable to save selected plan."
            });
        }
    }
);

/*
|--------------------------------------------------------------------------
| GET LAST SELECTED PLAN
|--------------------------------------------------------------------------
*/

router.get(
    "/selected-plan",
    async (
        req,
        res
    ) => {
        try {
            const result =
                await getSelectedPlan(req.query);

            res.json(
                result
            );

        } catch (error) {
            console.error(
                "Get selected plan error:",
                error
            );

            res.status(
                500
            ).json({
                success: false,

                selection:
                    null,

                message:
                    "Unable to load selected plan."
            });
        }
    }
);

/*
|--------------------------------------------------------------------------
| GET ACTIVE SAVED AI PLAN
|--------------------------------------------------------------------------
*/

router.get(
    "/active-plan",
    async (
        req,
        res
    ) => {
        try {
            const result =
                await getActiveAIPlan(req.query);

            res.json(
                result
            );

        } catch (error) {
            console.error(
                "Get active AI plan error:",
                error
            );

            res.status(
                500
            ).json({
                success: false,

                plan:
                    null,

                message:
                    "Unable to load active AI plan."
            });
        }
    }
);

/*
|--------------------------------------------------------------------------
| RESET AI GENERATED PLAN (Does NOT modify student travel status)
|--------------------------------------------------------------------------
*/

router.post(
    "/reset",
    authMiddleware,
    adminMiddleware,
    async (
        req,
        res
    ) => {
        try {
            const direction = req.body?.direction || req.query?.direction || null;
            const result =
                await resetGeneratedAIRoute({ direction });

            res.json(
                result
            );

        } catch (error) {
            console.error(
                "Reset AI plan error:",
                error
            );

            res.status(
                500
            ).json({
                success: false,

                message:
                    error?.message ||
                    "Unable to reset AI transportation plan."
            });
        }
    }
);

/*
|--------------------------------------------------------------------------
| REGENERATE LATE RESPONSE PLAN (Review-Only Draft)
|--------------------------------------------------------------------------
*/

router.post(
    "/regenerate-late-response-plan",
    authMiddleware,
    adminMiddleware,
    async (req, res) => {
        try {
            const direction = req.body?.direction || req.query?.direction || "OUTWARD";
            const result = await regenerateLateResponsePlan({ direction });
            res.json(result);
        } catch (error) {
            console.error("Regenerate late response plan error:", error);
            res.status(500).json({
                success: false,
                message: error?.message || "Failed to regenerate route for late responses."
            });
        }
    }
);

/*
|--------------------------------------------------------------------------
| GET LATE RESPONSE DRAFT (Review State)
|--------------------------------------------------------------------------
*/

router.get(
    "/late-response-draft",
    authMiddleware,
    adminMiddleware,
    async (req, res) => {
        try {
            const direction = req.query?.direction || "OUTWARD";
            const result = await getLateResponseDraft({ direction });
            res.json(result);
        } catch (error) {
            console.error("Get late response draft error:", error);
            res.status(500).json({
                success: false,
                message: error?.message || "Failed to fetch late response draft."
            });
        }
    }
);

/*
|--------------------------------------------------------------------------
| APPROVE LATE RESPONSE PLAN (Commits Draft to Active Plan & Allocates)
|--------------------------------------------------------------------------
*/

router.post(
    "/approve-late-response-plan",
    authMiddleware,
    adminMiddleware,
    async (req, res) => {
        try {
            const { direction, draftId } = req.body || {};
            const result = await approveLateResponseDraft({
                direction: direction || "OUTWARD",
                draftId
            });
            res.json(result);
        } catch (error) {
            console.error("Approve late response plan error:", error);
            res.status(500).json({
                success: false,
                message: error?.message || "Failed to approve regenerated transportation plan."
            });
        }
    }
);

/*
|--------------------------------------------------------------------------
| DISCARD LATE RESPONSE DRAFT
|--------------------------------------------------------------------------
*/

router.post(
    "/discard-late-response-draft",
    authMiddleware,
    adminMiddleware,
    async (req, res) => {
        try {
            const { direction } = req.body || {};
            const result = await discardLateResponseDraft({
                direction: direction || "OUTWARD"
            });
            res.json(result);
        } catch (error) {
            console.error("Discard late response draft error:", error);
            res.status(500).json({
                success: false,
                message: error?.message || "Failed to discard draft plan."
            });
        }
    }
);

export default router;