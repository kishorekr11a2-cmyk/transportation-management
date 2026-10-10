import dotenv from "dotenv";
dotenv.config();
import connectDB from "../config/db.js";
import { generateAgentRecommendations } from "../services/aiAgentService.js";

async function main() {
    await connectDB();
    const result = await generateAgentRecommendations({
        direction: "OUTWARD",
        source: {
            name: "K. L. N. College of Engineering",
            address: "Pottapalayam, Sivagangai / Madurai - 630612",
            latitude: 9.8515,
            longitude: 78.1882
        },
        persistPreview: false
    });

    const buses = result.data?.plan?.buses || [];
    console.log("=== CHECKING ROUTE CONTINUITY METRICS ===");
    buses.forEach((b, i) => {
        const qv = b.qualityValidation || {};
        const isCont = Boolean(
            b.operationalContinuityVerified !== false &&
            (qv.directionalReversals || 0) === 0 &&
            (qv.backtrackingDistanceKm || 0) < 2.0 &&
            (qv.detourRatio || 1.0) <= 2.25
        );
        console.log(`Route ${i+1} [${b.routeCode}]: continuous=${isCont}, reversals=${qv.directionalReversals}, backKm=${qv.backtrackingDistanceKm}, detour=${qv.detourRatio}, opContVer=${b.operationalContinuityVerified}`);
        if (!isCont) {
            console.log(`   FAIL REASONS:`, {
                opCont: b.operationalContinuityVerified,
                reversals: qv.directionalReversals,
                backKm: qv.backtrackingDistanceKm,
                detour: qv.detourRatio
            });
        }
    });

    const evals = result.data?.plan?.fleetBalancing?.candidateFleetEvaluations || [];
    console.log("=== EVALS ===");
    evals.forEach(e => console.log(e));

    process.exit(0);
}
main();
