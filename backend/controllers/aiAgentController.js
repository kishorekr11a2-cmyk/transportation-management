
import {
    getAgentOverview,
    analyzeTransport
} from "../services/aiAgentService.js";


/*
|--------------------------------------------------------------------------
| AI AGENT OVERVIEW
|--------------------------------------------------------------------------
*/

export const getAgentOverviewController =
    async (
        req,
        res
    ) => {
        try {
            const data =
                await getAgentOverview();


            res.json({
                success: true,
                data
            });

        } catch (error) {
            console.error(
                "AI Agent overview error:",
                error
            );


            res.status(500).json({
                success: false,

                message:
                    "Unable to load AI Agent overview.",

                error:
                    error.message
            });
        }
    };


/*
|--------------------------------------------------------------------------
| AI AGENT ANALYSIS
|--------------------------------------------------------------------------
*/

export const analyzeAgent =
    async (
        req,
        res
    ) => {
        try {
            const result =
                await analyzeTransport();


            res.status(
                result.success
                    ? 200
                    : 400
            ).json(result);

        } catch (error) {
            console.error(
                "AI Agent analysis error:",
                error
            );


            res.status(500).json({
                success: false,

                ready: false,

                recommendation:
                    null,

                message:
                    "Unable to analyze transportation data.",

                reason:
                    error.message
            });
        }
    };

