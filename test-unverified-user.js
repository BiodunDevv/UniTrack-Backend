const mongoose = require("mongoose");
require("dotenv").config();
const Teacher = require("./src/models/Teacher");

async function createUnverifiedUser() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("Connected to database");

    // Create an unverified teacher
    const unverifiedTeacher = new Teacher({
      name: "Unverified Teacher",
      email: "unverified@example.com",
      password_hash: "balikiss12",
      role: "teacher",
      email_verified: false,
    });

    await unverifiedTeacher.save();
    console.log("Created unverified teacher:", unverifiedTeacher.email);
    console.log("Verified status:", unverifiedTeacher.email_verified);

    await mongoose.disconnect();
  } catch (error) {
    console.error("Error:", error);
  }
}

createUnverifiedUser();
