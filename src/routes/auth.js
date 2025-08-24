const express = require("express");
const jwt = require("jsonwebtoken");
const { body } = require("express-validator");
const Teacher = require("../models/Teacher");
const EmailOtp = require("../models/EmailOtp");
const EmailService = require("../services/emailService");
const {
  generateOTP,
  generateRandomPassword,
  isValidEmail,
} = require("../utils/helpers");
const validate = require("../middleware/validation");
const { strictLimiter, otpLimiter } = require("../middleware/rateLimiter");
const auditLogger = require("../middleware/auditLogger");

const emailService = new EmailService();

const router = express.Router();

// Register teacher
router.post(
  "/register_teacher",
  strictLimiter,
  [
    body("name")
      .trim()
      .isLength({ min: 2, max: 100 })
      .withMessage("Name must be 2-100 characters"),
    body("email")
      .isEmail()
      .normalizeEmail()
      .withMessage("Valid email required"),
    body("password")
      .isLength({ min: 8 })
      .withMessage("Password must be at least 8 characters"),
    body("role")
      .optional()
      .isIn(["teacher", "admin"])
      .withMessage("Invalid role"),
  ],
  validate,
  auditLogger("teacher_registration"),
  async (req, res) => {
    try {
      const { name, email, password, role = "teacher" } = req.body;

      // Check if teacher already exists
      const existingTeacher = await Teacher.findOne({ email });
      if (existingTeacher) {
        return res
          .status(400)
          .json({ error: "Teacher with this email already exists" });
      }

      // Generate OTP for email verification
      const otp = generateOTP();
      const otpExpiry = new Date(
        Date.now() +
          (parseInt(process.env.OTP_EXPIRY_MINUTES) || 10) * 60 * 1000
      );

      // Save OTP
      await EmailOtp.create({
        email,
        otp,
        purpose: "registration",
        expires_at: otpExpiry,
      });

      // Send OTP email
      await emailService.sendOTP(email, otp, "account registration");

      // Store registration data temporarily (in production, use Redis or similar)
      const registrationToken = jwt.sign(
        { name, email, password, role, step: "otp_verification" },
        process.env.JWT_SECRET,
        { expiresIn: "15m" }
      );

      res.status(200).json({
        message:
          "OTP sent to your email. Please verify to complete registration.",
        registrationToken,
      });
    } catch (error) {
      console.error("Registration error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Verify OTP and complete registration
router.post(
  "/verify_registration",
  strictLimiter,
  [
    body("registrationToken")
      .notEmpty()
      .withMessage("Registration token required"),
    body("otp").isLength({ min: 6, max: 6 }).withMessage("Valid OTP required"),
  ],
  validate,
  async (req, res) => {
    try {
      const { registrationToken, otp } = req.body;

      // Verify registration token
      const decoded = jwt.verify(registrationToken, process.env.JWT_SECRET);
      if (decoded.step !== "otp_verification") {
        return res.status(400).json({ error: "Invalid registration token" });
      }

      // Verify OTP
      const otpRecord = await EmailOtp.findOne({
        email: decoded.email,
        otp,
        purpose: "registration",
        used: false,
        expires_at: { $gt: new Date() },
      });

      if (!otpRecord) {
        return res.status(400).json({ error: "Invalid or expired OTP" });
      }

      // Mark OTP as used
      otpRecord.used = true;
      await otpRecord.save();

      // Create teacher account
      const teacher = new Teacher({
        name: decoded.name,
        email: decoded.email,
        password_hash: decoded.password, // Will be hashed by pre-save middleware
        role: decoded.role,
      });

      await teacher.save();

      // Generate JWT token
      const token = jwt.sign(
        { id: teacher._id, email: teacher.email, role: teacher.role },
        process.env.JWT_SECRET,
        { expiresIn: "24h" }
      );

      // Update last login
      teacher.last_login = new Date();
      await teacher.save();

      res.status(201).json({
        message: "Registration completed successfully",
        token,
        teacher: teacher.toJSON(),
      });
    } catch (error) {
      console.error("OTP verification error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Teacher login
router.post(
  "/login",
  strictLimiter,
  [
    body("email")
      .isEmail()
      .normalizeEmail()
      .withMessage("Valid email required"),
    body("password").notEmpty().withMessage("Password required"),
  ],
  validate,
  auditLogger("teacher_login"),
  async (req, res) => {
    try {
      const { email, password } = req.body;

      // Find teacher
      const teacher = await Teacher.findOne({ email });
      if (!teacher) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      // Check password
      const isPasswordValid = await teacher.comparePassword(password);
      if (!isPasswordValid) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      // Generate JWT token
      const token = jwt.sign(
        { id: teacher._id, email: teacher.email, role: teacher.role },
        process.env.JWT_SECRET,
        { expiresIn: "24h" }
      );

      // Update last login
      teacher.last_login = new Date();
      await teacher.save();

      res.json({
        message: "Login successful",
        token,
        teacher: teacher.toJSON(),
      });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Request OTP (for password reset)
router.post(
  "/request_otp",
  otpLimiter,
  [
    body("email")
      .isEmail()
      .normalizeEmail()
      .withMessage("Valid email required"),
    body("purpose")
      .isIn(["password_reset", "login"])
      .withMessage("Invalid purpose"),
  ],
  validate,
  async (req, res) => {
    try {
      const { email, purpose } = req.body;

      // Check if teacher exists
      const teacher = await Teacher.findOne({ email });
      if (!teacher) {
        // Don't reveal if email exists or not
        return res.json({
          message: "If the email exists, an OTP has been sent.",
        });
      }

      // Generate OTP
      const otp = generateOTP();
      const otpExpiry = new Date(
        Date.now() +
          (parseInt(process.env.OTP_EXPIRY_MINUTES) || 10) * 60 * 1000
      );

      // Save OTP
      await EmailOtp.create({
        email,
        otp,
        purpose,
        expires_at: otpExpiry,
      });

      // Send OTP email
      if (purpose === "password_reset") {
        await emailService.sendPasswordResetOTP(email, otp);
      } else {
        await emailService.sendOTP(email, otp, purpose);
      }

      res.json({ message: "If the email exists, an OTP has been sent." });
    } catch (error) {
      console.error("OTP request error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Verify OTP
router.post(
  "/verify_otp",
  strictLimiter,
  [
    body("email")
      .isEmail()
      .normalizeEmail()
      .withMessage("Valid email required"),
    body("otp").isLength({ min: 6, max: 6 }).withMessage("Valid OTP required"),
    body("purpose")
      .isIn(["password_reset", "login"])
      .withMessage("Invalid purpose"),
    body("newPassword")
      .optional()
      .isLength({ min: 8 })
      .withMessage("Password must be at least 8 characters"),
  ],
  validate,
  async (req, res) => {
    try {
      const { email, otp, purpose, newPassword } = req.body;

      // Verify OTP
      const otpRecord = await EmailOtp.findOne({
        email,
        otp,
        purpose,
        used: false,
        expires_at: { $gt: new Date() },
      });

      if (!otpRecord) {
        return res.status(400).json({ error: "Invalid or expired OTP" });
      }

      // Mark OTP as used
      otpRecord.used = true;
      await otpRecord.save();

      if (purpose === "password_reset") {
        if (!newPassword) {
          return res
            .status(400)
            .json({ error: "New password required for password reset" });
        }

        // Update teacher password
        const teacher = await Teacher.findOne({ email });
        if (!teacher) {
          return res.status(404).json({ error: "Teacher not found" });
        }

        teacher.password_hash = newPassword; // Will be hashed by pre-save middleware
        await teacher.save();

        res.json({ message: "Password reset successful" });
      } else {
        res.json({ message: "OTP verified successfully" });
      }
    } catch (error) {
      console.error("OTP verification error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

module.exports = router;
