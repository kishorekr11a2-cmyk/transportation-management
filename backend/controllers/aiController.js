import {
    transportationAI
} from "../services/transportationAI.js";


// ======================================
// Route AI Recommendations
// ======================================

export const getRouteAIRecommendations =
    async (req, res) => {

        try {

            if (
                req.user.role !== "admin"
            ) {

                return res.status(403).json({

                    success: false,

                    message:
                        "Only admin can use the AI agent."

                });

            }


            const result =
                await transportationAI(
                    "route-recommendations"
                );


            return res.status(200).json({

                success: true,

                ...result

            });


        } catch (error) {

            console.error(
                "Route AI Error:",
                error
            );


            return res.status(500).json({

                success: false,

                message:
                    error.message ||
                    "Failed to generate AI recommendations."

            });

        }

    };