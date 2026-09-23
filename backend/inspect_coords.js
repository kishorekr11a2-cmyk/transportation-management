import dotenv from "dotenv";
dotenv.config();
import mongoose from "mongoose";

async function main() {
    await mongoose.connect(process.env.MONGO_URI);
    const stops = await mongoose.connection.db.collection("stops").find({
        $or: [
            { name: /melur/i },
            { name: /koodal/i }
        ]
    }).toArray();
    console.log("=== STOPS ===");
    stops.forEach(s => console.log(`${s.name} | lat: ${s.latitude}, lng: ${s.longitude}`));

    const mapLocs = await mongoose.connection.db.collection("maplocations").find({
        $or: [
            { name: /melur/i },
            { name: /koodal/i }
        ]
    }).toArray();
    console.log("\n=== MAP LOCATIONS ===");
    mapLocs.forEach(m => console.log(`${m.name} | lat: ${m.latitude}, lng: ${m.longitude}`));

    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
