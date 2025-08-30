const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const { body } = require("express-validator");
const Teacher = require("../models/Teacher");
const Admin = require("../models/Admin");
const EmailOtp = require("../models/EmailOtp");
const EmailService = require("../services/emailService");
const {
  generateOTP,
} = require("../utils/helpers");
const validate = require("../middleware/validation");
const { strictLimiter, otpLimiter } = require("../middleware/rateLimiter");
const auditLogger = require("../middleware/auditLogger");
const { auth } = require("../middleware/auth");

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
        Date.now() + 60 * 60 * 1000 // 1 hour expiry
      );

      // Create temporary teacher record with OTP
      const tempTeacher = new Teacher({
        name,
        email,
        password_hash: password, // Will be hashed by pre-save middleware
        role,
        email_verified: false,
        otp,
        otp_expires_at: otpExpiry,
        otp_purpose: "registration",
      });

      await tempTeacher.save();

      // Send OTP email
      await emailService.sendOTP(email, otp, "account registration");

      // Store registration data temporarily (in production, use Redis or similar)
      const registrationToken = jwt.sign(
        { userId: tempTeacher._id, email, step: "otp_verification" },
        process.env.JWT_SECRET,
        { expiresIn: "1h" }
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

      // Find the teacher with the OTP
      const teacher = await Teacher.findOne({
        _id: decoded.userId,
        email: decoded.email,
        otp,
        otp_purpose: "registration",
        otp_expires_at: { $gt: new Date() },
      });

      if (!teacher) {
        return res.status(400).json({ error: "Invalid or expired OTP" });
      }

      // Mark email as verified and clear OTP
      teacher.email_verified = true;
      teacher.otp = null;
      teacher.otp_expires_at = null;
      teacher.otp_purpose = null;

      // Send welcome email
      try {
        await emailService.sendWelcomeEmail(
          teacher.email,
          teacher.name,
          null, // No password to send since they set it during registration
          `${process.env.FRONTEND_URL || "http://localhost:3000"}/auth/sigin`
        );
      } catch (emailError) {
        console.error("Failed to send welcome email:", emailError);
        // Don't fail the registration if email fails
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

// Login (supports both teachers and admins)
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
  auditLogger("user_login"),
  async (req, res) => {
    try {
      const { email, password } = req.body;

      // Try to find in Teachers first
      let user = await Teacher.findOne({ email });
      let userType = "teacher";

      // If not found in Teachers, try Admins
      if (!user) {
        user = await Admin.findOne({ email });
        if (user) {
          userType = "admin";
        }
      }

      if (!user) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      // Check password
      const isPasswordValid = await user.comparePassword(password);
      if (!isPasswordValid) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      // Check email verification for teachers (admins are auto-verified)
      console.log(
        "User type:",
        userType,
        "Email verified:",
        user.email_verified
      );
      if (userType === "teacher" && !user.email_verified) {
        console.log("User is unverified, sending new OTP");
        // Generate new OTP for unverified users
        const otp = generateOTP();
        const otpExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour expiry

        console.log("Generated OTP:", otp);
        // Save OTP to user record
        user.otp = otp;
        user.otp_expires_at = otpExpiry;
        user.otp_purpose = "email_verification";
        await user.save();

        console.log("Sending OTP email...");
        // Send OTP email
        await emailService.sendOTP(user.email, otp, "email verification");

        // Generate verification token
        const verificationToken = jwt.sign(
          { id: user._id, email: user.email, step: "email_verification" },
          process.env.JWT_SECRET,
          { expiresIn: "1h" }
        );

        console.log("Returning verification response");
        return res.status(403).json({
          error: "Email not verified",
          message:
            "Please verify your email to continue. A new verification code has been sent.",
          verificationToken,
          needsVerification: true,
        });
      }

      // Generate JWT token
      const token = jwt.sign(
        { id: user._id, email: user.email, role: user.role, userType },
        process.env.JWT_SECRET,
        { expiresIn: "24h" }
      );

      // Update last login
      user.last_login = new Date();
      await user.save();

      res.json({
        message: "Login successful",
        token,
        user: user.toJSON(),
        userType,
      });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Logout
router.post("/logout", auth, auditLogger("user_logout"), async (req, res) => {
  try {
    // In a JWT-based auth system, logout is primarily handled client-side
    // by removing the token. Here we can perform server-side cleanup

    // Update last login time as a logout marker
    const user = req.user;
    if (user) {
      // You could add a last_logout field to track logout times
      // user.last_logout = new Date();
      // await user.save();
    }

    // In a production system, you might want to:
    // 1. Add the token to a blacklist/Redis cache
    // 2. Log the logout event
    // 3. Clear any server-side sessions

    res.json({
      message: "Logout successful",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Logout error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Request new verification code
router.post(
  "/request_verification_code",
  otpLimiter,
  [
    body("email")
      .isEmail()
      .normalizeEmail()
      .withMessage("Valid email required"),
    body("verificationToken")
      .optional()
      .notEmpty()
      .withMessage("Verification token required if provided"),
  ],
  validate,
  async (req, res) => {
    try {
      const { email, verificationToken } = req.body;

      // If verification token is provided, verify it
      if (verificationToken) {
        try {
          const decoded = jwt.verify(verificationToken, process.env.JWT_SECRET);
          if (
            decoded.step !== "email_verification" ||
            decoded.email !== email
          ) {
            return res
              .status(400)
              .json({ error: "Invalid verification token" });
          }
        } catch (error) {
          return res
            .status(400)
            .json({ error: "Invalid or expired verification token" });
        }
      }

      // Check if user exists and is unverified
      const user = await Teacher.findOne({ email });
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      if (user.email_verified) {
        return res.status(400).json({ error: "Email is already verified" });
      }

      // Generate new OTP
      const otp = generateOTP();
      const otpExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour expiry

      // Save OTP to user record
      user.otp = otp;
      user.otp_expires_at = otpExpiry;
      user.otp_purpose = "email_verification";
      await user.save();

      // Send OTP email
      await emailService.sendOTP(email, otp, "email verification");

      // Generate new verification token
      const newVerificationToken = jwt.sign(
        { id: user._id, email: user.email, step: "email_verification" },
        process.env.JWT_SECRET,
        { expiresIn: "1h" }
      );

      res.json({
        message: "New verification code sent to your email",
        verificationToken: newVerificationToken,
      });
    } catch (error) {
      console.error("Request verification code error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Verify email with OTP
router.post(
  "/verify_email",
  strictLimiter,
  [
    body("verificationToken")
      .notEmpty()
      .withMessage("Verification token required"),
    body("otp").isLength({ min: 6, max: 6 }).withMessage("Valid OTP required"),
  ],
  validate,
  async (req, res) => {
    try {
      const { verificationToken, otp } = req.body;

      // Verify token
      const decoded = jwt.verify(verificationToken, process.env.JWT_SECRET);
      if (decoded.step !== "email_verification") {
        return res.status(400).json({ error: "Invalid verification token" });
      }

      // Find user and verify OTP
      const user = await Teacher.findOne({
        _id: decoded.id,
        email: decoded.email,
        otp,
        otp_purpose: "email_verification",
        otp_expires_at: { $gt: new Date() },
      });

      if (!user) {
        return res.status(400).json({ error: "Invalid or expired OTP" });
      }

      // Mark email as verified and clear OTP
      user.email_verified = true;
      user.otp = null;
      user.otp_expires_at = null;
      user.otp_purpose = null;
      await user.save();

      // Send welcome email
      try {
        await emailService.sendWelcomeEmail(
          user.email,
          user.name,
          null, // No password to send
          `${process.env.FRONTEND_URL || "http://localhost:3000"}/login`
        );
      } catch (emailError) {
        console.error("Failed to send welcome email:", emailError);
        // Don't fail the verification if email fails
      }

      // Generate login token
      const token = jwt.sign(
        {
          id: user._id,
          email: user.email,
          role: user.role,
          userType: "teacher",
        },
        process.env.JWT_SECRET,
        { expiresIn: "24h" }
      );

      // Update last login
      user.last_login = new Date();
      await user.save();

      res.json({
        message: "Email verified successfully! Welcome to UniTrack!",
        token,
        user: user.toJSON(),
        userType: "teacher",
      });
    } catch (error) {
      console.error("Email verification error:", error);
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
      const otpExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour expiry

      // Save OTP to teacher record
      teacher.otp = otp;
      teacher.otp_expires_at = otpExpiry;
      teacher.otp_purpose = purpose;
      await teacher.save();

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

      // Find teacher and verify OTP
      const teacher = await Teacher.findOne({
        email,
        otp,
        otp_purpose: purpose,
        otp_expires_at: { $gt: new Date() },
      });

      if (!teacher) {
        return res.status(400).json({ error: "Invalid or expired OTP" });
      }

      // Clear OTP from teacher record
      teacher.otp = null;
      teacher.otp_expires_at = null;
      teacher.otp_purpose = null;

      if (purpose === "password_reset") {
        if (!newPassword) {
          return res
            .status(400)
            .json({ error: "New password required for password reset" });
        }

        // Update teacher password
        teacher.password_hash = newPassword; // Will be hashed by pre-save middleware
        await teacher.save();

        res.json({ message: "Password reset successful" });
      } else {
        // Save the updated teacher record (OTP cleared)
        await teacher.save();
        res.json({ message: "OTP verified successfully" });
      }
    } catch (error) {
      console.error("OTP verification error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

/**
 * Profile Management Routes
 * 
 * These routes allow both teachers and admins to manage their profile settings.
 * Features:
 * - Update name
 * - Change password with current password verification
 * - Strong password validation
 * - Different response data based on user role
 * - Comprehensive validation and error handling
 */

// Profile settings update - for both teachers and admins
router.put(
  "/profile",
  auth,
  [
    body("name")
      .optional()
      .trim()
      .isLength({ min: 2, max: 100 })
      .withMessage("Name must be 2-100 characters"),
    body("email")
      .optional()
      .isEmail()
      .normalizeEmail()
      .withMessage("Valid email required"),
    body("currentPassword")
      .optional()
      .isLength({ min: 1 })
      .withMessage("Current password is required when changing password"),
    body("newPassword")
      .optional()
      .isLength({ min: 8 })
      .withMessage("New password must be at least 8 characters")
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
      .withMessage("New password must contain at least one uppercase letter, one lowercase letter, and one number"),
    body("confirmPassword")
      .optional()
      .custom((value, { req }) => {
        if (req.body.newPassword && value !== req.body.newPassword) {
          throw new Error("Password confirmation does not match new password");
        }
        return true;
      })
  ],
  validate,
  auditLogger("profile_update"),
  async (req, res) => {
    try {
      const { name, email, currentPassword, newPassword } = req.body;
      const userId = req.user.id;
      const userRole = req.user.role;

      // Determine which model to use based on user role
      const UserModel = userRole === "admin" ? Admin : Teacher;
      
      // Find the user
      const user = await UserModel.findById(userId);
      if (!user) {
        return res.status(404).json({
          error: "User not found",
          details: ["Your account may have been deleted or deactivated"]
        });
      }

      // Check if email change is requested
      if (email && email !== user.email) {
        // Check if new email is already in use
        const existingUserWithEmail = await UserModel.findOne({ email, _id: { $ne: userId } });
        if (existingUserWithEmail) {
          return res.status(400).json({
            error: "Email already in use",
            details: ["The email address you entered is already registered to another account"]
          });
        }

        // Generate OTP for email verification
        const otp = generateOTP();
        const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

        // Store pending email change in user record
        user.pending_email = email;
        user.otp = otp;
        user.otp_expires_at = otpExpiresAt;
        user.otp_purpose = "email_change";

        // Send OTP email
        await emailService.sendOTP(email, otp, "email_change", {
          currentEmail: user.email,
          newEmail: email,
          name: user.name
        });

        await user.save();

        return res.json({
          success: true,
          message: "Email change OTP sent",
          details: [
            "An OTP has been sent to your new email address",
            "Please verify the OTP using the /api/auth/verify-email-change endpoint",
            "The OTP will expire in 10 minutes"
          ],
          data: {
            pending_email: email,
            current_email: user.email,
            otp_expires_at: otpExpiresAt
          }
        });
      }

      // Check if user wants to update password
      if (newPassword) {
        if (!currentPassword) {
          return res.status(400).json({
            error: "Current password required",
            details: ["You must provide your current password to set a new one"]
          });
        }

        // Verify current password
        const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password_hash);
        if (!isCurrentPasswordValid) {
          return res.status(400).json({
            error: "Invalid current password",
            details: ["The current password you entered is incorrect"]
          });
        }

        // Update password
        user.password_hash = newPassword; // Will be hashed by pre-save middleware
      }

      // Update name if provided
      if (name && name !== user.name) {
        user.name = name;
      }

      // Check if any changes were made
      if (!name && !newPassword) {
        return res.status(400).json({
          error: "No changes provided",
          details: ["Please provide either a new name or password to update"]
        });
      }

      // Save the updated user
      await user.save();

      // Prepare response data (excluding sensitive information)
      const responseData = {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role || userRole,
        updated_at: new Date()
      };

      // Add role-specific data
      if (userRole === "admin") {
        responseData.is_super_admin = user.is_super_admin;
        responseData.status = user.status;
        responseData.permissions = user.permissions;
      } else {
        responseData.email_verified = user.email_verified;
      }

      res.json({
        success: true,
        message: "Profile updated successfully",
        data: responseData,
        changes: {
          name_updated: !!name,
          password_updated: !!newPassword
        }
      });

    } catch (error) {
      console.error("Profile update error:", error);
      
      // Handle validation errors
      if (error.name === "ValidationError") {
        const validationErrors = Object.values(error.errors).map(err => err.message);
        return res.status(400).json({
          error: "Validation failed",
          details: validationErrors
        });
      }

      res.status(500).json({
        error: "Internal server error",
        details: ["Failed to update profile. Please try again later."]
      });
    }
  }
);

// Get current user profile - for both teachers and admins
router.get(
  "/profile",
  auth,
  async (req, res) => {
    try {
      const userId = req.user.id;
      const userRole = req.user.role;

      // Determine which model to use based on user role
      const UserModel = userRole === "admin" ? Admin : Teacher;
      
      // Find the user (excluding password)
      const user = await UserModel.findById(userId).select("-password_hash -otp -otp_expires_at");
      
      if (!user) {
        return res.status(404).json({
          error: "User not found",
          details: ["Your account may have been deleted or deactivated"]
        });
      }

      // Prepare response data
      const responseData = {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role || userRole,
        created_at: user.created_at,
        last_login: user.last_login
      };

      // Add role-specific data
      if (userRole === "admin") {
        responseData.is_super_admin = user.is_super_admin;
        responseData.status = user.status;
        responseData.permissions = user.permissions;
        responseData.email_verified = user.email_verified;
      } else {
        responseData.email_verified = user.email_verified;
      }

      res.json({
        success: true,
        data: responseData
      });

    } catch (error) {
      console.error("Get profile error:", error);
      res.status(500).json({
        error: "Internal server error",
        details: ["Failed to retrieve profile. Please try again later."]
      });
    }
  }
);

// Verify email change OTP
router.post(
  "/verify-email-change",
  auth,
  [
    body("otp")
      .isLength({ min: 6, max: 6 })
      .isNumeric()
      .withMessage("OTP must be exactly 6 digits")
  ],
  validate,
  auditLogger("email_change_verification"),
  async (req, res) => {
    try {
      const { otp } = req.body;
      const userId = req.user.id;
      const userRole = req.user.role;

      // Determine which model to use based on user role
      const UserModel = userRole === "admin" ? Admin : Teacher;

      // Find user with valid OTP for email change
      const user = await UserModel.findOne({
        _id: userId,
        otp,
        otp_purpose: "email_change",
        otp_expires_at: { $gt: new Date() },
        pending_email: { $exists: true, $ne: null }
      });

      if (!user) {
        return res.status(400).json({
          error: "Invalid or expired OTP",
          details: [
            "The OTP you entered is invalid or has expired",
            "Please request a new email change if needed"
          ]
        });
      }

      // Update email and clear OTP fields
      const oldEmail = user.email;
      const newEmail = user.pending_email;
      
      user.email = newEmail;
      user.pending_email = null;
      user.otp = null;
      user.otp_expires_at = null;
      user.otp_purpose = null;
      user.email_verified = true; // Mark new email as verified

      await user.save();

      // Send confirmation email to both old and new email
      try {
        await emailService.sendEmailChangeConfirmation(oldEmail, newEmail, user.name);
        await emailService.sendEmailChangeConfirmation(newEmail, newEmail, user.name, true);
      } catch (emailError) {
        console.error("Error sending email change confirmation:", emailError);
        // Don't fail the request if email sending fails
      }

      // Prepare response data
      const responseData = {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role || userRole,
        email_verified: user.email_verified,
        updated_at: new Date()
      };

      // Add role-specific data
      if (userRole === "admin") {
        responseData.is_super_admin = user.is_super_admin;
        responseData.status = user.status;
        responseData.permissions = user.permissions;
      }

      res.json({
        success: true,
        message: "Email changed successfully",
        details: [
          "Your email address has been updated",
          "Confirmation emails have been sent to both old and new email addresses"
        ],
        data: responseData,
        email_change: {
          old_email: oldEmail,
          new_email: newEmail,
          changed_at: new Date()
        }
      });

    } catch (error) {
      console.error("Email change verification error:", error);
      res.status(500).json({
        error: "Internal server error",
        details: ["Failed to verify email change. Please try again later."]
      });
    }
  }
);

// Cancel pending email change
router.delete(
  "/cancel-email-change",
  auth,
  auditLogger("email_change_cancelled"),
  async (req, res) => {
    try {
      const userId = req.user.id;
      const userRole = req.user.role;

      // Determine which model to use based on user role
      const UserModel = userRole === "admin" ? Admin : Teacher;

      const user = await UserModel.findById(userId);
      if (!user) {
        return res.status(404).json({
          error: "User not found",
          details: ["Your account may have been deleted or deactivated"]
        });
      }

      if (!user.pending_email) {
        return res.status(400).json({
          error: "No pending email change",
          details: ["There is no pending email change to cancel"]
        });
      }

      // Clear pending email change
      const pendingEmail = user.pending_email;
      user.pending_email = null;
      user.otp = null;
      user.otp_expires_at = null;
      user.otp_purpose = null;

      await user.save();

      res.json({
        success: true,
        message: "Email change cancelled",
        details: [
          "The pending email change has been cancelled",
          "Your current email address remains unchanged"
        ],
        data: {
          current_email: user.email,
          cancelled_email: pendingEmail,
          cancelled_at: new Date()
        }
      });

    } catch (error) {
      console.error("Cancel email change error:", error);
      res.status(500).json({
        error: "Internal server error",
        details: ["Failed to cancel email change. Please try again later."]
      });
    }
  }
);

module.exports = router;
