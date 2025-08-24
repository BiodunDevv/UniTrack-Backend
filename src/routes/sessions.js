const express = require("express");
const { body, param } = require("express-validator");
const Session = require("../models/Session");
const Course = require("../models/Course");
const Attendance = require("../models/Attendance");
const { auth } = require("../middleware/auth");
const validate = require("../middleware/validation");
const auditLogger = require("../middleware/auditLogger");
const EmailService = require("../services/emailService");
const { generateSessionCode, generateNonce } = require("../utils/helpers");

const emailService = new EmailService();
const router = express.Router();

// Start new attendance session
router.post(
  "/:courseId/sessions",
  auth,
  [
    param("courseId").isMongoId().withMessage("Valid course ID required"),
    body("lat")
      .isFloat({ min: -90, max: 90 })
      .withMessage("Valid latitude required"),
    body("lng")
      .isFloat({ min: -180, max: 180 })
      .withMessage("Valid longitude required"),
    body("radius_m")
      .optional()
      .isInt({ min: 10, max: 10000 })
      .withMessage("Radius must be between 10-10000 meters"),
    body("duration_minutes")
      .optional()
      .isInt({ min: 5, max: 480 })
      .withMessage("Duration must be between 5-480 minutes"),
  ],
  validate,
  auditLogger("session_started"),
  async (req, res) => {
    try {
      const { courseId } = req.params;
      const { lat, lng, radius_m = 100, duration_minutes = 60 } = req.body;

      // Verify course belongs to teacher
      const course = await Course.findOne({
        _id: courseId,
        teacher_id: req.teacher._id,
      });

      if (!course) {
        return res.status(404).json({ error: "Course not found" });
      }

      // Check if there's already an active session for this course
      const activeSession = await Session.findOne({
        course_id: courseId,
        is_active: true,
        expiry_ts: { $gt: new Date() },
      });

      if (activeSession) {
        return res.status(400).json({
          error: "There is already an active session for this course",
          activeSession: {
            session_code: activeSession.session_code,
            expires_at: activeSession.expiry_ts,
          },
        });
      }

      // Generate session details
      const sessionCode = generateSessionCode();
      const nonce = generateNonce();
      const startTime = new Date();
      const expiryTime = new Date(
        startTime.getTime() + duration_minutes * 60 * 1000
      );

      // Create session
      const session = new Session({
        course_id: courseId,
        teacher_id: req.teacher._id,
        session_code: sessionCode,
        start_ts: startTime,
        expiry_ts: expiryTime,
        lat,
        lng,
        radius_m,
        nonce,
      });

      await session.save();
      await session.populate(["course_id", "teacher_id"]);

      // Send email notification to teacher
      try {
        await emailService.sendSessionNotification(
          req.teacher.email,
          req.teacher.name,
          course.title,
          sessionCode
        );
      } catch (emailError) {
        console.error("Failed to send session notification email:", emailError);
        // Don't fail the request if email fails
      }

      res.status(201).json({
        message: "Attendance session started successfully",
        session: {
          id: session._id,
          session_code: sessionCode,
          course: course,
          start_time: startTime,
          expiry_time: expiryTime,
          location: { lat, lng },
          radius_meters: radius_m,
          duration_minutes,
        },
      });
    } catch (error) {
      console.error("Start session error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Get sessions for a course
router.get(
  "/:courseId/sessions",
  auth,
  [param("courseId").isMongoId().withMessage("Valid course ID required")],
  validate,
  async (req, res) => {
    try {
      const { courseId } = req.params;
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;
      const skip = (page - 1) * limit;
      const status = req.query.status; // active, expired, all

      // Verify course belongs to teacher
      const course = await Course.findOne({
        _id: courseId,
        teacher_id: req.teacher._id,
      });

      if (!course) {
        return res.status(404).json({ error: "Course not found" });
      }

      // Build query based on status filter
      let query = { course_id: courseId };

      if (status === "active") {
        query.expiry_ts = { $gt: new Date() };
        query.is_active = true;
      } else if (status === "expired") {
        query.expiry_ts = { $lte: new Date() };
      }

      const sessions = await Session.find(query)
        .populate("course_id", "course_code title")
        .populate("teacher_id", "name email")
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(limit);

      const total = await Session.countDocuments(query);

      // Add attendance counts to each session
      const sessionsWithStats = await Promise.all(
        sessions.map(async (session) => {
          const attendanceCount = await Attendance.countDocuments({
            session_id: session._id,
          });
          const presentCount = await Attendance.countDocuments({
            session_id: session._id,
            status: { $in: ["present", "manual_present"] },
          });

          return {
            ...session.toObject(),
            attendance_stats: {
              total_submissions: attendanceCount,
              present_count: presentCount,
              is_expired: session.isExpired(),
            },
          };
        })
      );

      res.json({
        course,
        sessions: sessionsWithStats,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(total / limit),
          totalSessions: total,
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1,
        },
      });
    } catch (error) {
      console.error("Get sessions error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Get specific session details
router.get(
  "/sessions/:sessionId",
  auth,
  [param("sessionId").isMongoId().withMessage("Valid session ID required")],
  validate,
  async (req, res) => {
    try {
      const { sessionId } = req.params;

      const session = await Session.findOne({
        _id: sessionId,
        teacher_id: req.teacher._id,
      })
        .populate("course_id", "course_code title")
        .populate("teacher_id", "name email");

      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }

      // Get attendance records for this session
      const attendanceRecords = await Attendance.find({ session_id: sessionId })
        .populate("student_id", "matric_no name email")
        .sort({ submitted_at: -1 });

      // Calculate statistics
      const totalSubmissions = attendanceRecords.length;
      const presentCount = attendanceRecords.filter(
        (record) =>
          record.status === "present" || record.status === "manual_present"
      ).length;
      const absentCount = attendanceRecords.filter(
        (record) => record.status === "absent"
      ).length;
      const rejectedCount = attendanceRecords.filter(
        (record) => record.status === "rejected"
      ).length;

      res.json({
        session: {
          ...session.toObject(),
          is_expired: session.isExpired(),
        },
        attendance: attendanceRecords,
        statistics: {
          total_submissions: totalSubmissions,
          present_count: presentCount,
          absent_count: absentCount,
          rejected_count: rejectedCount,
          attendance_rate:
            totalSubmissions > 0
              ? Math.round((presentCount / totalSubmissions) * 100)
              : 0,
        },
      });
    } catch (error) {
      console.error("Get session details error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// End session early
router.patch(
  "/sessions/:sessionId/end",
  auth,
  [param("sessionId").isMongoId().withMessage("Valid session ID required")],
  validate,
  auditLogger("session_ended"),
  async (req, res) => {
    try {
      const { sessionId } = req.params;

      const session = await Session.findOne({
        _id: sessionId,
        teacher_id: req.teacher._id,
      });

      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }

      if (session.isExpired()) {
        return res.status(400).json({ error: "Session has already expired" });
      }

      // End session by setting expiry to now
      session.expiry_ts = new Date();
      session.is_active = false;
      await session.save();

      res.json({
        message: "Session ended successfully",
        session,
      });
    } catch (error) {
      console.error("End session error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Get real-time attendance for a session (for live monitoring)
router.get(
  "/sessions/:sessionId/live",
  auth,
  [param("sessionId").isMongoId().withMessage("Valid session ID required")],
  validate,
  async (req, res) => {
    try {
      const { sessionId } = req.params;

      const session = await Session.findOne({
        _id: sessionId,
        teacher_id: req.teacher._id,
      });

      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }

      // Get recent attendance submissions (last 30 seconds)
      const recentSubmissions = await Attendance.find({
        session_id: sessionId,
        submitted_at: { $gte: new Date(Date.now() - 30000) },
      })
        .populate("student_id", "matric_no name")
        .sort({ submitted_at: -1 });

      // Get total counts
      const totalSubmissions = await Attendance.countDocuments({
        session_id: sessionId,
      });
      const presentCount = await Attendance.countDocuments({
        session_id: sessionId,
        status: { $in: ["present", "manual_present"] },
      });

      res.json({
        session_info: {
          session_code: session.session_code,
          is_active: !session.isExpired(),
          expires_at: session.expiry_ts,
        },
        recent_submissions: recentSubmissions,
        live_stats: {
          total_submissions: totalSubmissions,
          present_count: presentCount,
          last_updated: new Date(),
        },
      });
    } catch (error) {
      console.error("Get live attendance error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

module.exports = router;
