// Direct test sending via the running backend API to avoid multi-socket conflicts
const phoneNumber = process.argv[2] || "8903368790";
const message = process.argv[3] || "Direct backend test";

console.log(`Testing WhatsApp send to ${phoneNumber} via backend API...`);

try {
  const response = await fetch("http://localhost:5000/api/whatsapp/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phoneNumber, message })
  });

  const data = await response.json();
  console.log("Response:", JSON.stringify(data, null, 2));

  if (!response.ok || !data.success) {
    process.exit(1);
  }
} catch (err) {
  console.error("❌ Test request failed:", err.message);
  process.exit(1);
}