import xlsx from "xlsx";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const SAMPLE_STOPS_DISTRIBUTION = [
    { stoppings: "Anna Nagar", count: 30, city: "Madurai", state: "Tamil Nadu", country: "India" },
    { stoppings: "Arappalayam", count: 27, city: "Madurai", state: "Tamil Nadu", country: "India" },
    { stoppings: "Simmakkal", count: 24, city: "Madurai", state: "Tamil Nadu", country: "India" },
    { stoppings: "Tallakulam", count: 22, city: "Madurai", state: "Tamil Nadu", country: "India" },
    { stoppings: "Goripalayam", count: 21, city: "Madurai", state: "Tamil Nadu", country: "India" },
    { stoppings: "KK Nagar", count: 20, city: "Madurai", state: "Tamil Nadu", country: "India" },
    { stoppings: "K.K. Nagar West", count: 18, city: "Madurai", state: "Tamil Nadu", country: "India" },
    { stoppings: "Vandiyur", count: 17, city: "Madurai", state: "Tamil Nadu", country: "India" },
    { stoppings: "Teppakulam", count: 15, city: "Madurai", state: "Tamil Nadu", country: "India" },
    { stoppings: "Mattuthavani", count: 15, city: "Madurai", state: "Tamil Nadu", country: "India" },
    { stoppings: "Othakadai", count: 14, city: "Madurai", state: "Tamil Nadu", country: "India" },
    { stoppings: "Thiruppalai", count: 13, city: "Madurai", state: "Tamil Nadu", country: "India" },
    { stoppings: "Iyer Bungalow", count: 12, city: "Madurai", state: "Tamil Nadu", country: "India" },
    { stoppings: "K.Pudur", count: 12, city: "Madurai", state: "Tamil Nadu", country: "India" },
    { stoppings: "Pudur", count: 11, city: "Madurai", state: "Tamil Nadu", country: "India" },
    { stoppings: "Koodal Nagar", count: 11, city: "Madurai", state: "Tamil Nadu", country: "India" },
    { stoppings: "Vilangudi", count: 10, city: "Madurai", state: "Tamil Nadu", country: "India" },
    { stoppings: "Kochadai", count: 10, city: "Madurai", state: "Tamil Nadu", country: "India" },
    { stoppings: "Kochadai Junction", count: 9, city: "Madurai", state: "Tamil Nadu", country: "India" },
    { stoppings: "Palanganatham", count: 9, city: "Madurai", state: "Tamil Nadu", country: "India" },
    { stoppings: "Jaihindpuram", count: 8, city: "Madurai", state: "Tamil Nadu", country: "India" },
    { stoppings: "Alagappan Nagar", count: 7, city: "Madurai", state: "Tamil Nadu", country: "India" },
    { stoppings: "Villapuram", count: 7, city: "Madurai", state: "Tamil Nadu", country: "India" },
    { stoppings: "Avaniyapuram", count: 7, city: "Madurai", state: "Tamil Nadu", country: "India" },
    { stoppings: "Anuppanadi", count: 6, city: "Madurai", state: "Tamil Nadu", country: "India" },
    { stoppings: "Periyar", count: 6, city: "Madurai", state: "Tamil Nadu", country: "India" },
    { stoppings: "Thirunagar", count: 5, city: "Madurai", state: "Tamil Nadu", country: "India" },
    { stoppings: "Sellur", count: 5, city: "Madurai", state: "Tamil Nadu", country: "India" },
    { stoppings: "Narimedu", count: 5, city: "Madurai", state: "Tamil Nadu", country: "India" },
    { stoppings: "Bibikulam", count: 4, city: "Madurai", state: "Tamil Nadu", country: "India" },
    { stoppings: "Samayanallur", count: 4, city: "Madurai", state: "Tamil Nadu", country: "India" },
    { stoppings: "Thiruparankundram", count: 4, city: "Madurai", state: "Tamil Nadu", country: "India" },
    { stoppings: "Pasumalai", count: 3, city: "Madurai", state: "Tamil Nadu", country: "India" },
    { stoppings: "Sundararajapuram", count: 3, city: "Madurai", state: "Tamil Nadu", country: "India" },
    { stoppings: "Munichalai", count: 3, city: "Madurai", state: "Tamil Nadu", country: "India" },
    { stoppings: "South Gate", count: 3, city: "Madurai", state: "Tamil Nadu", country: "India" }
];

const FIRST_NAMES = [
    "Arun", "Priya", "Karthik", "Deepa", "Suresh", "Divya", "Vignesh", "Anitha",
    "Manoj", "Sneha", "Rahul", "Pooja", "Aravind", "Kavya", "Sanjay", "Meena",
    "Ganesh", "Swetha", "Naveen", "Revathi", "Pradeep", "Gayathri", "Dinesh", "Sandhya",
    "Ramesh", "Keerthi", "Balaji", "Pavithra", "Hari", "Nithya", "Ajith", "Lavanya",
    "Saravanan", "Archana", "Vijay", "Preethi", "Rajesh", "Sowmya", "Gokul", "Shalini",
    "Kishore", "Subha", "Ashwin", "Janani", "Venkatesh", "Raji", "Sridhar", "Bhavani"
];

const LAST_NAMES = [
    "Kumar", "Devi", "Raj", "Rathi", "Sundaram", "Krishnan", "Murugan", "Nathan",
    "Sharma", "Verma", "Pandian", "Sethupathi", "Nadar", "Iyer", "Chettiar", "Pillai",
    "Mani", "Sekar", "Vasan", "Prasad", "Gopal", "Chander", "Moorthy", "Reddy"
];

export const generate400TestUsers = () => {
    const users = [];
    let userIndex = 1;

    SAMPLE_STOPS_DISTRIBUTION.forEach((item) => {
        for (let i = 0; i < item.count; i++) {
            const firstName = FIRST_NAMES[(userIndex - 1) % FIRST_NAMES.length];
            const lastName = LAST_NAMES[Math.floor((userIndex - 1) / FIRST_NAMES.length) % LAST_NAMES.length];
            const name = `${firstName} ${lastName}`;
            const userId = `USR${String(userIndex).padStart(3, "0")}`;

            users.push({
                userId,
                name,
                stoppings: item.stoppings,
                city: item.city,
                state: item.state,
                country: item.country
            });

            userIndex++;
        }
    });

    return users;
};

export const createTestUsersWorkbook = () => {
    const users = generate400TestUsers();
    const worksheet = xlsx.utils.json_to_sheet(users, {
        header: ["userId", "name", "stoppings", "city", "state", "country"]
    });
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, "Users");
    return workbook;
};

// If run directly via CLI
if (process.argv[1] && process.argv[1].endsWith("generateTestUsersExcel.js")) {
    const workbook = createTestUsersWorkbook();
    const outPath = path.join(__dirname, "test_users_400.xlsx");
    xlsx.writeFile(workbook, outPath);
    console.log(`✅ Successfully generated test Excel with 400 users at: ${outPath}`);
    console.log(`Total users generated: ${generate400TestUsers().length}`);
}
