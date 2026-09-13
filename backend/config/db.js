import mongoose from "mongoose";

let lastDbError = null;

export const isDbConnected = () => {
    return mongoose.connection.readyState === 1;
};

export const getDbStatus = () => {
    const states = ["disconnected", "connected", "connecting", "disconnecting"];
    const state = states[mongoose.connection.readyState] || "unknown";
    return {
        connected: isDbConnected(),
        state,
        host: isDbConnected() ? mongoose.connection.host : null,
        name: isDbConnected() ? mongoose.connection.name : null,
        error: lastDbError ? lastDbError.message : null
    };
};

const connectDB = async () => {
    const mongoUri = process.env.MONGO_URI;
    if (!mongoUri) {
        lastDbError = new Error("MONGO_URI environment variable is not defined");
        console.error("❌ MongoDB Error:", lastDbError.message);
        return null;
    }

    try {
        console.log("[DB] Connecting to MongoDB...");
        const conn = await mongoose.connect(mongoUri, {
            serverSelectionTimeoutMS: 15000,  // 15s — more forgiving on slow networks
            connectTimeoutMS: 15000,
            socketTimeoutMS: 45000,
            heartbeatFrequencyMS: 10000,
            retryWrites: true,
            w: "majority"
        });

        lastDbError = null;
        console.log("[DB] MongoDB connected");
        console.log("✅ MongoDB Connected:", conn.connection.host);
        console.log("📂 Database:", conn.connection.name);
        return conn;
    } catch (error) {
        lastDbError = error;
        console.error("❌ MongoDB Connection Failed:", error.message);
        console.error("💡 Fix: Whitelist your IP in MongoDB Atlas → Network Access → Add 0.0.0.0/0");
        // Do not crash server process on startup; allow health endpoints to report status
        return null;
    }
};


mongoose.connection.on("disconnected", () => {
    console.warn("⚠️ MongoDB disconnected");
});

mongoose.connection.on("error", (err) => {
    lastDbError = err;
    console.error("❌ MongoDB error event:", err.message);
});

export default connectDB;