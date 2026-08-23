import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import adminMiddleware from "../middleware/adminMiddleware.js";

import {
    getAIData,
    searchPlaces,
    resolveLocation,
    generateAgentRecommendations,
    saveSelectedPlan,
    getSelectedPlan,
    getActiveAIPlan,
    resetGeneratedAIRoute,
    resetAIPlanAndStudents
} from "../services/aiAgentService.js";

const router =
    express.Router();

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
            const data =
                await getAIData();

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
                startingPoint
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
                    startingPoint
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
                await getSelectedPlan();

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
                await getActiveAIPlan();

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
            const result =
                await resetGeneratedAIRoute();

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

export default router;