const mongoose = require("mongoose");
require("dotenv").config();

// Import models
const FAQ = require("../src/models/FAQ");
const Admin = require("../src/models/Admin");

// FAQ data from the user request
const faqData = [
  {
    question: "How accurate is the geolocation verification?",
    answer:
      "UniTrack achieves 99.8% accuracy in location verification using advanced GPS tracking with configurable radius settings. The system accounts for GPS signal variations and provides reliable attendance tracking even in challenging environments. Teachers can adjust the radius from 10 to 100 meters based on classroom size and building layout requirements.",
    category: "technical",
    display_order: 1,
    tags: ["geolocation", "GPS", "accuracy", "verification", "location"],
  },
  {
    question: "What security measures are in place to prevent fraud?",
    answer:
      "UniTrack implements multiple security layers including device fingerprinting, JWT-based authentication, rate limiting, and cryptographic receipts for each attendance submission. Device fingerprinting prevents students from submitting attendance multiple times from the same device, while location verification ensures physical presence. All actions are logged in a comprehensive audit trail for security monitoring and compliance purposes.",
    category: "security",
    display_order: 2,
    tags: [
      "security",
      "fraud prevention",
      "device fingerprinting",
      "authentication",
      "audit trail",
    ],
  },
  {
    question: "Can the system handle large numbers of concurrent users?",
    answer:
      "Yes! UniTrack is built with scalability in mind, using MongoDB for efficient data storage and Express.js for high-performance API handling. The system has been tested with thousands of concurrent users and includes optimized database queries, proper indexing, and efficient caching mechanisms. Rate limiting ensures system stability during peak usage periods while maintaining responsive performance for all users.",
    category: "technical",
    display_order: 3,
    tags: [
      "scalability",
      "performance",
      "concurrent users",
      "MongoDB",
      "optimization",
    ],
  },
  {
    question: "What attendance submission methods are supported?",
    answer:
      "UniTrack supports multiple attendance submission methods for maximum flexibility: QR code scanning for quick attendance, 4-digit session codes for manual entry, Manual marking by teachers when needed, and Bulk attendance operations for large classes. All methods include the same security verification and location checking.",
    category: "attendance",
    display_order: 4,
    tags: [
      "attendance",
      "submission methods",
      "QR code",
      "session codes",
      "bulk operations",
    ],
  },
  {
    question: "How are attendance reports generated and delivered?",
    answer:
      "UniTrack automatically generates comprehensive attendance reports in both CSV and PDF formats. Reports can be downloaded instantly or delivered via email to teachers and administrators. The system includes detailed analytics showing attendance patterns, trends, and statistics to help improve student engagement and identify attendance issues early.",
    category: "reports",
    display_order: 5,
    tags: ["reports", "analytics", "CSV", "PDF", "email delivery", "trends"],
  },
  {
    question: "Is technical support and documentation available?",
    answer:
      "Yes! UniTrack comes with comprehensive documentation covering installation, configuration, API reference, and best practices for deployment. For additional support, you can reach out via email or check our GitHub repository for community support and issue tracking.",
    category: "support",
    display_order: 6,
    tags: [
      "documentation",
      "technical support",
      "API reference",
      "GitHub",
      "community",
    ],
  },
];

async function populateFAQ() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("Connected to MongoDB");

    // Find or create an admin user
    let admin = await Admin.findOne({ email_verified: true });

    if (!admin) {
      // Create a default admin if none exists
      admin = new Admin({
        name: "System Administrator",
        email: "admin@unitrack.com",
        password_hash: "defaultpassword123", // This will be hashed automatically
        is_super_admin: true,
        status: "active",
        email_verified: true,
      });
      await admin.save();
      console.log("Created default admin user");
    }

    // Check if FAQs already exist
    const existingFAQCount = await FAQ.countDocuments();
    if (existingFAQCount > 0) {
      console.log(`Found ${existingFAQCount} existing FAQs. Updating...`);

      // Clear existing FAQs
      await FAQ.deleteMany({});
      console.log("Cleared existing FAQs");
    }

    // Add created_by field to each FAQ
    const faqsWithCreator = faqData.map((faq) => ({
      ...faq,
      created_by: admin._id,
    }));

    // Insert new FAQs
    const createdFAQs = await FAQ.insertMany(faqsWithCreator);
    console.log(`Successfully created ${createdFAQs.length} FAQs`);

    // Display created FAQs
    console.log("\nCreated FAQs:");
    createdFAQs.forEach((faq, index) => {
      console.log(
        `${index + 1}. [${faq.category.toUpperCase()}] ${faq.question}`
      );
    });

    console.log("\nFAQ population completed successfully!");
  } catch (error) {
    console.error("Error populating FAQ:", error);
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected from MongoDB");
  }
}

// Run the script
if (require.main === module) {
  populateFAQ();
}

module.exports = { populateFAQ, faqData };
