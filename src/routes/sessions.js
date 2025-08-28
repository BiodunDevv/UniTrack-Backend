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
  "/:sessionId",
  auth,
  [param("sessionId").isMongoId().withMessage("Valid session ID required")],
  validate,
  async (req, res) => {
    try {
      const { sessionId } = req.params;

      // Build query based on user type
      let query = { _id: sessionId };

      // If teacher, only show their sessions. If admin, show all sessions
      if (req.teacher) {
        query.teacher_id = req.teacher._id;
      }

      const session = await Session.findOne(query)
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
  "/:sessionId/end",
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
  "/:sessionId/live",
  auth,
  [param("sessionId").isMongoId().withMessage("Valid session ID required")],
  validate,
  async (req, res) => {
    try {
      const { sessionId } = req.params;
      const { minutes = 10 } = req.query; // Allow custom time window, default 10 minutes

      // Build query based on user type
      let query = { _id: sessionId };

      // If teacher, only show their sessions. If admin, show all sessions
      if (req.teacher) {
        query.teacher_id = req.teacher._id;
      }

      const session = await Session.findOne(query);

      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }

      // Convert minutes to milliseconds
      const timeWindow = parseInt(minutes) * 60 * 1000;

      // Get recent attendance submissions (customizable time window)
      const recentSubmissions = await Attendance.find({
        session_id: sessionId,
        submitted_at: { $gte: new Date(Date.now() - timeWindow) },
      })
        .populate("student_id", "matric_no name")
        .sort({ submitted_at: -1 });

      // Get all submissions for this session (for fallback if no recent ones)
      const allSubmissions =
        recentSubmissions.length === 0
          ? await Attendance.find({ session_id: sessionId })
              .populate("student_id", "matric_no name")
              .sort({ submitted_at: -1 })
              .limit(10) // Show last 10 submissions
          : [];

      // Get total counts
      const totalSubmissions = await Attendance.countDocuments({
        session_id: sessionId,
      });
      const presentCount = await Attendance.countDocuments({
        session_id: sessionId,
        status: { $in: ["present", "manual_present"] },
      });
      const rejectedCount = await Attendance.countDocuments({
        session_id: sessionId,
        status: "rejected",
      });

      // Get latest submission time
      const latestSubmission = await Attendance.findOne({
        session_id: sessionId,
      }).sort({ submitted_at: -1 });

      res.json({
        session_info: {
          session_code: session.session_code,
          is_active: !session.isExpired(),
          expires_at: session.expiry_ts,
          started_at: session.start_ts,
        },
        recent_submissions:
          recentSubmissions.length > 0 ? recentSubmissions : allSubmissions,
        live_stats: {
          total_submissions: totalSubmissions,
          present_count: presentCount,
          rejected_count: rejectedCount,
          last_submission: latestSubmission?.submitted_at || null,
          last_updated: new Date(),
          time_window_minutes: parseInt(minutes),
        },
        meta: {
          showing_recent: recentSubmissions.length > 0,
          showing_all_recent:
            recentSubmissions.length === 0 && allSubmissions.length > 0,
        },
      });
    } catch (error) {
      console.error("Get live attendance error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Generate session attendance report in CSV format
router.get(
  "/:sessionId/report.csv",
  auth,
  [param("sessionId").isMongoId().withMessage("Valid session ID required")],
  validate,
  auditLogger("session_report_csv_generated"),
  async (req, res) => {
    try {
      const { sessionId } = req.params;
      const { email } = req.query;

      // Verify session belongs to teacher
      const session = await Session.findOne({
        _id: sessionId,
        teacher_id: req.teacher._id,
      }).populate("course_id", "title course_code");

      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }

      // Get attendance data for this session
      const attendanceData = await Attendance.find({ session_id: sessionId })
        .populate("student_id", "name email matric_no phone")
        .sort({ submitted_at: -1 });

      const sessionInfo = {
        session_code: session.session_code,
        start_ts: session.start_ts,
        course_code: session.course_id?.course_code,
        course_title: session.course_id?.title,
      };

      const ReportGenerator = require("../utils/reportGenerator");
      const csvBuffer = await ReportGenerator.generateSessionAttendanceCSV(
        attendanceData,
        sessionInfo
      );

      if (email === "true") {
        // Send via email
        await emailService.sendAttendanceReport(
          req.teacher.email,
          req.teacher.name,
          `${sessionInfo.course_title || "Course"} - Session ${
            sessionInfo.session_code
          }`,
          csvBuffer,
          "csv"
        );

        res.json({
          message: "Session attendance report sent to your email successfully",
          session_code: sessionInfo.session_code,
          total_records: attendanceData.length,
        });
      } else {
        // Direct download
        const filename = `session_${
          sessionInfo.session_code
        }_attendance_${Date.now()}.csv`;

        res.setHeader("Content-Type", "text/csv");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${filename}"`
        );
        res.send(csvBuffer);
      }
    } catch (error) {
      console.error("Session CSV report error:", error);
      res.status(500).json({ error: "Failed to generate session report" });
    }
  }
);

// Generate session attendance report in PDF format
router.get(
  "/:sessionId/report.pdf",
  auth,
  [param("sessionId").isMongoId().withMessage("Valid session ID required")],
  validate,
  auditLogger("session_report_pdf_generated"),
  async (req, res) => {
    try {
      const { sessionId } = req.params;
      const { email } = req.query;

      // Verify session belongs to teacher
      const session = await Session.findOne({
        _id: sessionId,
        teacher_id: req.teacher._id,
      }).populate("course_id", "title course_code");

      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }

      // Get attendance data for this session
      const attendanceData = await Attendance.find({ session_id: sessionId })
        .populate("student_id", "name email matric_no phone")
        .sort({ submitted_at: -1 });

      const sessionInfo = {
        session_code: session.session_code,
        start_ts: session.start_ts,
        course_code: session.course_id?.course_code,
        course_title: session.course_id?.title,
      };

      const teacherInfo = {
        name: req.teacher.name,
        email: req.teacher.email,
      };

      const ReportGenerator = require("../utils/reportGenerator");
      const pdfBuffer = await ReportGenerator.generateSessionAttendancePDF(
        attendanceData,
        sessionInfo,
        teacherInfo
      );

      if (email === "true") {
        // Send via email
        await emailService.sendAttendanceReport(
          req.teacher.email,
          req.teacher.name,
          `${sessionInfo.course_title || "Course"} - Session ${
            sessionInfo.session_code
          }`,
          pdfBuffer,
          "pdf"
        );

        res.json({
          message: "Session attendance report sent to your email successfully",
          session_code: sessionInfo.session_code,
          total_records: attendanceData.length,
        });
      } else {
        // Direct download
        const filename = `session_${
          sessionInfo.session_code
        }_attendance_${Date.now()}.pdf`;

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${filename}"`
        );
        res.send(pdfBuffer);
      }
    } catch (error) {
      console.error("Session PDF report error:", error);
      res.status(500).json({ error: "Failed to generate session report" });
    }
  }
);

// Schedule session report via email
router.post(
  "/:sessionId/schedule-report",
  auth,
  [
    param("sessionId").isMongoId().withMessage("Valid session ID required"),
    body("email_date")
      .isISO8601()
      .withMessage("Valid date required (YYYY-MM-DD format)"),
    body("format")
      .isIn(["csv", "pdf", "both"])
      .withMessage("Format must be csv, pdf, or both"),
    body("email_time")
      .optional()
      .matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/)
      .withMessage("Valid time required (HH:MM format)"),
  ],
  validate,
  auditLogger("session_report_scheduled"),
  async (req, res) => {
    try {
      const { sessionId } = req.params;
      const { email_date, format, email_time = "09:00" } = req.body;

      // Verify session belongs to teacher
      const session = await Session.findOne({
        _id: sessionId,
        teacher_id: req.teacher._id,
      }).populate("course_id", "title course_code");

      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }

      // Parse the scheduled date and time
      const scheduledDateTime = new Date(`${email_date}T${email_time}:00`);
      const now = new Date();

      if (scheduledDateTime <= now) {
        return res.status(400).json({
          error: "Scheduled date and time must be in the future",
        });
      }

      // Create a simple scheduling mechanism (in production, use a job queue like Bull or Agenda)
      const scheduleId = `${sessionId}_${Date.now()}`;

      // Store schedule info (in production, store in database)
      const scheduleInfo = {
        id: scheduleId,
        sessionId,
        teacherId: req.teacher._id,
        teacherEmail: req.teacher.email,
        teacherName: req.teacher.name,
        format,
        scheduledDateTime,
        sessionCode: session.session_code,
        courseName: session.course_id?.title,
      };

      // Set timeout for the scheduled email (Note: in production, use persistent job queue)
      const delay = scheduledDateTime.getTime() - now.getTime();
      setTimeout(async () => {
        try {
          // Generate and send report
          const attendanceData = await Attendance.find({
            session_id: sessionId,
          })
            .populate("student_id", "name email matric_no phone")
            .sort({ submitted_at: -1 });

          const sessionInfo = {
            session_code: session.session_code,
            start_ts: session.start_ts,
            course_code: session.course_id?.course_code,
            course_title: session.course_id?.title,
          };

          const ReportGenerator = require("../utils/reportGenerator");

          if (format === "csv" || format === "both") {
            const csvBuffer =
              await ReportGenerator.generateSessionAttendanceCSV(
                attendanceData,
                sessionInfo
              );
            await emailService.sendAttendanceReport(
              scheduleInfo.teacherEmail,
              scheduleInfo.teacherName,
              `${scheduleInfo.courseName || "Course"} - Scheduled Session ${
                sessionInfo.session_code
              } (CSV)`,
              csvBuffer,
              "csv"
            );
          }

          if (format === "pdf" || format === "both") {
            const pdfBuffer =
              await ReportGenerator.generateSessionAttendancePDF(
                attendanceData,
                sessionInfo,
                {
                  name: scheduleInfo.teacherName,
                  email: scheduleInfo.teacherEmail,
                }
              );
            await emailService.sendAttendanceReport(
              scheduleInfo.teacherEmail,
              scheduleInfo.teacherName,
              `${scheduleInfo.courseName || "Course"} - Scheduled Session ${
                sessionInfo.session_code
              } (PDF)`,
              pdfBuffer,
              "pdf"
            );
          }

          console.log(
            `✅ Scheduled report sent for session ${sessionInfo.session_code}`
          );
        } catch (error) {
          console.error("Scheduled report error:", error);
        }
      }, delay);

      res.json({
        message: "Session report scheduled successfully",
        schedule_id: scheduleId,
        session_code: session.session_code,
        scheduled_for: scheduledDateTime.toLocaleString(),
        format: format,
        note: "You will receive the report via email at the scheduled time",
      });
    } catch (error) {
      console.error("Schedule session report error:", error);
      res.status(500).json({ error: "Failed to schedule session report" });
    }
  }
);

module.exports = router;
