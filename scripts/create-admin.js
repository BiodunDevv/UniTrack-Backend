const mongoose = require("mongoose");
const Teacher = require("../src/models/Teacher");
const { generateRandomPassword } = require("../src/utils/helpers");
require("dotenv").config();

const createAdmin = async () => {
  try {
    // Connect to database
    await mongoose.connect(
      process.env.MONGODB_URI || "mongodb://localhost:27017/unitrack_attendance"
    );
    console.log("✅ Connected to database");

    // Get admin details from command line or use defaults
    const name = process.argv[2] || "System Administrator";
    const email = process.argv[3] || "admin@unitrack.edu";
    const password = process.argv[4] || generateRandomPassword();

    // Check if admin already exists
    const existingAdmin = await Teacher.findOne({ email });
    if (existingAdmin) {
      console.log("❌ Admin with this email already exists");
      process.exit(1);
    }

    // Create admin user
    const admin = new Teacher({
      name,
      email,
      password_hash: password, // Will be hashed by pre-save middleware
      role: "admin",
    });

    await admin.save();

    console.log("🎉 Admin user created successfully!");
    console.log("");
    console.log("Admin Details:");
    console.log(`Name: ${name}`);
    console.log(`Email: ${email}`);
    console.log(`Password: ${password}`);
    console.log("");
    console.log(
      "⚠️  Please save these credentials securely and change the password after first login."
    );
  } catch (error) {
    console.error("❌ Error creating admin:", error);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
};

// Usage instructions
if (process.argv.length < 2) {
  console.log("Usage: node scripts/create-admin.js [name] [email] [password]");
  console.log(
    'Example: node scripts/create-admin.js "John Doe" "john@unitrack.edu" "mypassword"'
  );
  console.log("If no arguments provided, default values will be used.");
  process.exit(1);
}

createAdmin();
