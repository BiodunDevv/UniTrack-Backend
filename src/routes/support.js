const express = require("express");
const { body, validationResult } = require("express-validator");
const Admin = require("../models/Admin");
const EmailService = require("../services/emailService");
const { supportLimiter } = require("../middleware/rateLimiter");

const router = express.Router();
const emailService = new EmailService();

// Support categories and their descriptions
const SUPPORT_CATEGORIES = {
  technical: "Technical Issues (Login problems, app crashes, etc.)",
  attendance: "Attendance Related (Session issues, missing records, etc.)",
  account: "Account Management (Profile updates, password issues, etc.)",
  general: "General Inquiry (Questions, suggestions, feedback)",
  urgent: "Urgent Issues (System down, critical problems)",
};

// FAQ data
const FAQ_DATA = [
  {
    category: "Authentication",
    questions: [
      {
        question: "I forgot my password, how can I reset it?",
        answer:
          "Use the 'Forgot Password' link on the login page to reset your password via email verification.",
      },
      {
        question: "Why am I getting 'Invalid credentials' error?",
        answer:
          "Please check your email and password. Ensure caps lock is off and try again. If the problem persists, contact support.",
      },
    ],
  },
  {
    category: "Attendance",
    questions: [
      {
        question: "Why can't I submit attendance?",
        answer:
          "Ensure you're within the allowed location radius and the session is active. Check your internet connection and try again.",
      },
      {
        question: "My attendance was not recorded, what should I do?",
        answer:
          "Contact your teacher immediately or submit a support request with your session details.",
      },
    ],
  },
  {
    category: "Technical",
    questions: [
      {
        question: "The app is not loading properly, what should I do?",
        answer:
          "Try refreshing the page, clearing your browser cache, or using a different browser. If the issue persists, contact support.",
      },
      {
        question: "I'm getting location permission errors",
        answer:
          "Please allow location access in your browser settings and ensure GPS is enabled on your device.",
      },
    ],
  },
];

// Contact form submission with comprehensive validation
router.post(
  "/contact",
  [
    supportLimiter,
    body("name")
      .trim()
      .notEmpty()
      .withMessage("Name is required")
      .isLength({ min: 2, max: 100 })
      .withMessage("Name must be 2-100 characters"),
    body("email")
      .isEmail()
      .normalizeEmail()
      .withMessage("Valid email is required"),
    body("user_type")
      .isIn(["student", "teacher", "admin", "other"])
      .withMessage("User type must be student, teacher, admin, or other"),
    body("subject")
      .trim()
      .notEmpty()
      .withMessage("Subject is required")
      .isLength({ min: 5, max: 200 })
      .withMessage("Subject must be 5-200 characters"),
    body("category")
      .isIn(Object.keys(SUPPORT_CATEGORIES))
      .withMessage("Invalid category selected"),
    body("priority")
      .isIn(["low", "medium", "high", "urgent"])
      .withMessage("Priority must be low, medium, high, or urgent"),
    body("message")
      .trim()
      .notEmpty()
      .withMessage("Message is required")
      .isLength({ min: 20, max: 2000 })
      .withMessage("Message must be 20-2000 characters"),
    body("phone")
      .optional()
      .trim()
      .isLength({ min: 10, max: 15 })
      .withMessage("Phone number must be 10-15 characters"),
    body("matric_no").optional().trim(),
    body("course_info")
      .optional()
      .custom((value) => {
        if (value && typeof value !== "object") {
          throw new Error("Course info must be an object");
        }
        return true;
      }),
    body("error_details")
      .optional()
      .custom((value) => {
        if (value && typeof value !== "object") {
          throw new Error("Error details must be an object");
        }
        return true;
      }),
    body("browser_info")
      .optional()
      .custom((value) => {
        if (value && typeof value !== "object") {
          throw new Error("Browser info must be an object");
        }
        return true;
      }),
  ],
  async (req, res) => {
    try {
      // Check for validation errors
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          error: "Validation failed",
          details: errors.array(),
        });
      }

      const {
        name,
        email,
        user_type,
        subject,
        category,
        priority,
        message,
        phone,
        matric_no,
        course_info,
        error_details,
        browser_info,
      } = req.body;

      // Generate unique ticket ID
      const ticketId = `TK${Date.now()}${Math.random()
        .toString(36)
        .substr(2, 4)
        .toUpperCase()}`;

      // Prepare support data
      const supportData = {
        name,
        email,
        user_type,
        subject,
        category,
        priority,
        message,
        phone,
        matric_no,
        course_info,
        error_details,
        browser_info,
        ticketId,
        submittedAt: new Date(),
        ip_address: req.ip,
        user_agent: req.get("User-Agent"),
      };

      // Get all active and verified admins
      const admins = await Admin.find({
        status: "active",
        email_verified: true,
      }).select("email name");

      if (admins.length === 0) {
        return res.status(500).json({
          error: "No administrators available",
          message:
            "Please try again later or contact system administrator directly",
        });
      }

      // Send notification to all admins
      const adminEmailPromises = admins.map((admin) =>
        emailService.sendSupportRequestToAdmin(admin.email, supportData)
      );

      // Send confirmation to user
      const userEmailPromise = emailService.sendSupportConfirmation(
        email,
        supportData
      );

      // Execute all email sends in parallel
      try {
        await Promise.all([...adminEmailPromises, userEmailPromise]);
      } catch (emailError) {
        console.error("Email sending failed:", emailError);
        // Continue anyway as the request was received
      }

      res.status(200).json({
        success: true,
        message: "Support request submitted successfully",
        ticketId,
        data: {
          ticket_id: ticketId,
          subject,
          category,
          priority,
          submitted_at: supportData.submittedAt,
          admins_notified: admins.length,
          expected_response:
            priority === "urgent"
              ? "within 4-6 hours"
              : priority === "high"
              ? "within 24 hours"
              : priority === "medium"
              ? "within 1-2 business days"
              : "within 2-3 business days",
        },
      });
    } catch (error) {
      console.error("Support request error:", error);
      res.status(500).json({
        error: "Failed to submit support request",
        message: "An internal server error occurred",
      });
    }
  }
);

// Get support information
router.get("/info", (req, res) => {
  res.json({
    success: true,
    data: {
      categories: SUPPORT_CATEGORIES,
      priorities: {
        low: "Non-urgent issues that can wait",
        medium: "Issues affecting normal operation",
        high: "Important issues requiring prompt attention",
        urgent: "Critical issues requiring immediate attention",
      },
      guidelines: [
        "Provide as much detail as possible about your issue",
        "Include relevant course or session information",
        "For technical issues, include browser and device information",
        "Use appropriate priority levels - reserve 'urgent' for critical system issues",
        "Check the FAQ section before submitting a request",
      ],
      contact_tips: [
        "Be specific in your subject line",
        "Include error messages exactly as they appear",
        "Mention the steps you took before the issue occurred",
        "Include your user type (student/teacher) and relevant course information",
      ],
    },
  });
});

// Get FAQ
router.get("/faq", (req, res) => {
  res.json({
    success: true,
    data: {
      categories: FAQ_DATA,
      general_tips: [
        "Clear your browser cache if you're experiencing loading issues",
        "Ensure you have a stable internet connection",
        "Allow location access for attendance submission",
        "Use the latest version of your browser",
        "Contact support if your issue isn't covered in the FAQ",
      ],
    },
  });
});

// Health check for support system
router.get("/health", (req, res) => {
  res.json({
    success: true,
    message: "Support system is operational",
    timestamp: new Date(),
    available_endpoints: [
      "POST /contact - Submit support request",
      "GET /info - Get support information and guidelines",
      "GET /faq - Get frequently asked questions",
      "GET /health - Check support system status",
    ],
  });
});

module.exports = router;
