import dotenv from "dotenv";
dotenv.config();
import mongoose from "mongoose";
import connectDB from "./config/db.js";

async function main() {
    await connectDB();
    const doc = await mongoose.connection.db.collection('ai_selected_plans').findOne({
        status: 'active',
        active: true,
        approved: true,
        $or: [
            { direction: 'OUTWARD' },
            { tripMode: 'OUTWARD' },
            { tripMode: 'FROM_SOURCE' },
            { 'plan.direction': 'OUTWARD' },
            { 'plan.tripMode': 'OUTWARD' },
            { 'plan.tripMode': 'FROM_SOURCE' }
        ]
    }, {
        sort: { active: -1, approved: -1, createdAt: -1 }
    });
    console.log('findOne returned:', {
        id: doc?._id,
        planType: doc?.planType,
        selectedAt: doc?.selectedAt,
        approvedAt: doc?.approvedAt,
        createdAt: doc?.createdAt,
        buses: doc?.plan?.buses?.map(b => `${b.routeName} (${b.vehicleName})`)
    });

    const docSortedBySelectedAt = await mongoose.connection.db.collection('ai_selected_plans').findOne({
        status: 'active',
        active: true,
        approved: true,
        $or: [
            { direction: 'OUTWARD' },
            { tripMode: 'OUTWARD' },
            { tripMode: 'FROM_SOURCE' },
            { 'plan.direction': 'OUTWARD' },
            { 'plan.tripMode': 'OUTWARD' },
            { 'plan.tripMode': 'FROM_SOURCE' }
        ]
    }, {
        sort: { planVersion: -1, approvedAt: -1, selectedAt: -1, createdAt: -1 }
    });
    console.log('docSortedBySelectedAt returned:', {
        id: docSortedBySelectedAt?._id,
        planType: docSortedBySelectedAt?.planType,
        selectedAt: docSortedBySelectedAt?.selectedAt,
        approvedAt: docSortedBySelectedAt?.approvedAt,
        createdAt: docSortedBySelectedAt?.createdAt,
        buses: docSortedBySelectedAt?.plan?.buses?.map(b => `${b.routeName} (${b.vehicleName})`)
    });

    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
