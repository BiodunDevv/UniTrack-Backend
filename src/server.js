require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const mongoose = require("mongoose");

// Import database connection
const connectDB = require("./config/database");

// Import middleware
const { generalLimiter } = require("./middleware/rateLimiter");

// Import routes
const authRoutes = require("./routes/auth");
const courseRoutes = require("./routes/courses");
const studentRoutes = require("./routes/students");
const sessionRoutes = require("./routes/sessions");
const attendanceRoutes = require("./routes/attendance");
const adminRoutes = require("./routes/admin");
const studentSharingRoutes = require("./routes/studentSharing");
const supportRoutes = require("./routes/support");
const faqRoutes = require("./routes/faq");

// Import models to ensure they're registered
require("./models/Teacher");
require("./models/Course");
require("./models/Student");
require("./models/CourseStudent");
require("./models/Session");
require("./models/Attendance");
require("./models/DeviceFingerprint");
require("./models/AuditLog");
require("./models/EmailOtp");
require("./models/StudentShareRequest");
require("./models/FAQ");

const app = express();

// Connect to database
connectDB();

// Security middleware
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

// CORS configuration - Allow all origins
app.use(
  cors({
    origin: true, // Allow all origins
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "Accept",
      "Origin",
      "Access-Control-Request-Method",
      "Access-Control-Request-Headers",
      "User-Agent",
      "Referer",
      "Accept-Encoding",
      "Accept-Language",
      "Connection",
      "Host",
    ],
    exposedHeaders: ["*"],
    preflightContinue: false,
    optionsSuccessStatus: 200,
  })
);

// Additional CORS middleware for handling all preflight requests
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Credentials", "true");
  res.header(
    "Access-Control-Allow-Methods",
    "GET,HEAD,OPTIONS,POST,PUT,PATCH,DELETE"
  );
  res.header("Access-Control-Allow-Headers", "*");
  res.header("Access-Control-Expose-Headers", "*");

  // Handle preflight requests
  if (req.method === "OPTIONS") {
    res.sendStatus(200);
  } else {
    next();
  }
});

// Rate limiting
app.use(generalLimiter);

// Body parsing middleware
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Trust proxy (important for rate limiting and IP detection)
app.set("trust proxy", 1);

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    timestamp: new Date(),
    environment: process.env.NODE_ENV || "development",
    version: "1.0.0",
  });
});

// API routes
app.use("/api/auth", authRoutes);
app.use("/api/courses", courseRoutes);
app.use("/api/courses", studentRoutes); // Student routes are nested under courses
app.use("/api/courses", sessionRoutes); // Session routes are nested under courses
app.use("/api/attendance", attendanceRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/student-sharing", studentSharingRoutes);
app.use("/api/support", supportRoutes);
app.use("/api/faq", faqRoutes);

// Session routes that aren't nested under courses
app.use("/api/sessions", sessionRoutes);

// 404 handler
app.use("*", (req, res) => {
  res.status(404).json({
    error: "Endpoint not found",
    message: `The requested endpoint ${req.method} ${req.originalUrl} was not found on this server.`,
    timestamp: new Date(),
  });
});

// Global error handler
app.use((error, req, res, next) => {
  console.error("Global error handler:", error);

  // Handle specific error types
  if (error.name === "ValidationError") {
    return res.status(400).json({
      error: "Validation Error",
      details: Object.values(error.errors).map((err) => err.message),
    });
  }

  if (error.name === "CastError") {
    return res.status(400).json({
      error: "Invalid ID format",
      message: "The provided ID is not valid",
    });
  }

  if (error.code === 11000) {
    return res.status(409).json({
      error: "Duplicate Entry",
      message: "A record with this information already exists",
    });
  }

  if (error.name === "JsonWebTokenError") {
    return res.status(401).json({
      error: "Invalid Token",
      message: "Please provide a valid authentication token",
    });
  }

  if (error.name === "TokenExpiredError") {
    return res.status(401).json({
      error: "Token Expired",
      message: "Authentication token has expired",
    });
  }

  // Default error response
  res.status(error.status || 500).json({
    error: "Internal Server Error",
    message:
      process.env.NODE_ENV === "development"
        ? error.message
        : "Something went wrong",
    timestamp: new Date(),
  });
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("SIGTERM received. Shutting down gracefully...");

  try {
    await mongoose.connection.close();
    console.log("Database connection closed.");
    process.exit(0);
  } catch (error) {
    console.error("Error during shutdown:", error);
    process.exit(1);
  }
});

process.on("SIGINT", async () => {
  console.log("SIGINT received. Shutting down gracefully...");

  try {
    await mongoose.connection.close();
    console.log("Database connection closed.");
    process.exit(0);
  } catch (error) {
    console.error("Error during shutdown:", error);
    process.exit(1);
  }
});

// Handle unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  // Don't exit in production, just log the error
  if (process.env.NODE_ENV !== "production") {
    process.exit(1);
  }
});

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  process.exit(1);
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`
🚀 UniTrack Attendance System Backend Server Started
📍 Environment: ${process.env.NODE_ENV || "development"}
🌐 Port: ${PORT}
📊 API Documentation: http://localhost:${PORT}/api
🏥 Health Check: http://localhost:${PORT}/health
${
  process.env.NODE_ENV === "development"
    ? "🔧 Development Mode Active"
    : "🔒 Production Mode Active"
}
  `);
});

module.exports = app;
