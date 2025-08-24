const mongoose = require("mongoose");
require("dotenv").config();

// Import models
const Teacher = require("../src/models/Teacher");
const Course = require("../src/models/Course");
const Student = require("../src/models/Student");
const CourseStudent = require("../src/models/CourseStudent");
const Session = require("../src/models/Session");
const Attendance = require("../src/models/Attendance");
const DeviceFingerprint = require("../src/models/DeviceFingerprint");
const AuditLog = require("../src/models/AuditLog");
const EmailOtp = require("../src/models/EmailOtp");

const cleanupDatabase = async () => {
  try {
    console.log("🧹 Starting database cleanup...");

    // Connect to database
    await mongoose.connect(
      process.env.MONGODB_URI || "mongodb://localhost:27017/unitrack"
    );
    console.log("✅ Connected to database");

    // Cleanup expired sessions
    const expiredSessions = await Session.updateMany(
      {
        expiry_ts: { $lt: new Date() },
        is_active: true,
      },
      { is_active: false }
    );
    console.log(
      `✅ Deactivated ${expiredSessions.modifiedCount} expired sessions`
    );

    // Cleanup expired OTPs
    const expiredOtps = await EmailOtp.deleteMany({
      expires_at: { $lt: new Date() },
    });
    console.log(`✅ Removed ${expiredOtps.deletedCount} expired OTPs`);

    // Cleanup old device fingerprints (older than 6 months)
    const sixMonthsAgo = new Date(Date.now() - 6 * 30 * 24 * 60 * 60 * 1000);
    const oldFingerprints = await DeviceFingerprint.deleteMany({
      last_seen: { $lt: sixMonthsAgo },
    });
    console.log(
      `✅ Removed ${oldFingerprints.deletedCount} old device fingerprints`
    );

    // Cleanup old audit logs (older than 1 year)
    const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    const oldLogs = await AuditLog.deleteMany({
      created_at: { $lt: oneYearAgo },
    });
    console.log(`✅ Removed ${oldLogs.deletedCount} old audit logs`);

    // Generate statistics
    const stats = await generateStatistics();
    console.log("\n📊 Database Statistics:");
    Object.entries(stats).forEach(([key, value]) => {
      console.log(`   ${key}: ${value}`);
    });

    console.log("\n🎉 Database cleanup completed successfully!");
  } catch (error) {
    console.error("❌ Error during cleanup:", error);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
};

const generateStatistics = async () => {
  const [
    teacherCount,
    courseCount,
    studentCount,
    sessionCount,
    attendanceCount,
    activeSessionCount,
    recentAttendanceCount,
  ] = await Promise.all([
    Teacher.countDocuments(),
    Course.countDocuments(),
    Student.countDocuments(),
    Session.countDocuments(),
    Attendance.countDocuments(),
    Session.countDocuments({
      expiry_ts: { $gt: new Date() },
      is_active: true,
    }),
    Attendance.countDocuments({
      submitted_at: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    }),
  ]);

  return {
    "Total Teachers": teacherCount,
    "Total Courses": courseCount,
    "Total Students": studentCount,
    "Total Sessions": sessionCount,
    "Total Attendance Records": attendanceCount,
    "Active Sessions": activeSessionCount,
    "Attendance (Last 24h)": recentAttendanceCount,
  };
};

// Check if this script is being run directly
if (require.main === module) {
  cleanupDatabase();
}

module.exports = { cleanupDatabase, generateStatistics };
