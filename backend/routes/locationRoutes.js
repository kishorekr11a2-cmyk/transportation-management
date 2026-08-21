import express from "express";
import { searchPlaces } from "../services/aiAgentService.js";

const router = express.Router();

/*
|--------------------------------------------------------------------------
| GLOBAL LOCATION SEARCH API (GET /api/location/search?q=...)
|--------------------------------------------------------------------------
*/
router.get("/search", async (req, res) => {
    try {
        const query = String(req.query.q || req.query.query || "").trim();

        if (query.length < 2) {
            return res.json({
                success: true,
                results: []
            });
        }

        const results = await searchPlaces(query);

        if (results.length === 0) {
            return res.json({
                success: true,
                results: [],
                message: `No locations found for "${query}".`
            });
        }

        res.json({
            success: true,
            results
        });
    } catch (error) {
        console.error("Location search endpoint error:", error);
        res.status(503).json({
            success: false,
            code: "LOCATION_SEARCH_UNAVAILABLE",
            message: "Location search service is temporarily unavailable."
        });
    }
});

export default router;
