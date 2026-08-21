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
        const conn = await mongoose.connect(mongoUri, {
            serverSelectionTimeoutMS: 5000,
            connectTimeoutMS: 5000
        });

        lastDbError = null;
        console.log("✅ MongoDB Connected:", conn.connection.host);
        console.log("📂 Database:", conn.connection.name);
        return conn;
    } catch (error) {
        lastDbError = error;
        console.error("❌ MongoDB Connection Failed:", error.message);
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