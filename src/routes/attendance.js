const express = require("express");
const { body, param } = require("express-validator");
const Attendance = require("../models/Attendance");
const Session = require("../models/Session");
const Student = require("../models/Student");
const Course = require("../models/Course");
const DeviceFingerprint = require("../models/DeviceFingerprint");
const { auth } = require("../middleware/auth");
const validate = require("../middleware/validation");
const { attendanceLimiter } = require("../middleware/rateLimiter");
const auditLogger = require("../middleware/auditLogger");
const ReportGenerator = require("../utils/reportGenerator");
const EmailService = require("../services/emailService");
const {
  generateDeviceFingerprint,
  generateReceiptSignature,
  isWithinRadius,
  isValidMatricNo,
} = require("../utils/helpers");

const emailService = new EmailService();

const router = express.Router();

// Submit attendance (public endpoint for students)
router.post(
  "/submit",
  attendanceLimiter,
  [
    body("matric_no").custom((value) => {
      if (!isValidMatricNo(value)) {
        throw new Error("Invalid matriculation number format");
      }
      return true;
    }),
    body("session_code")
      .isLength({ min: 4, max: 4 })
      .withMessage("Session code must be 4 digits"),
    body("lat")
      .isFloat({ min: -90, max: 90 })
      .withMessage("Valid latitude required"),
    body("lng")
      .isFloat({ min: -180, max: 180 })
      .withMessage("Valid longitude required"),
    body("accuracy")
      .optional()
      .isFloat({ min: 0 })
      .withMessage("Accuracy must be a positive number"),
    body("device_info")
      .optional()
      .isObject()
      .withMessage("Device info must be an object"),
  ],
  validate,
  async (req, res) => {
    try {
      const {
        matric_no,
        session_code,
        lat,
        lng,
        accuracy = 0,
        device_info = {},
      } = req.body;
      const userAgent = req.get("User-Agent") || "";
      const ip = req.ip;

      // Find active session with the provided code
      const session = await Session.findOne({
        session_code,
        is_active: true,
        expiry_ts: { $gt: new Date() },
      }).populate("course_id teacher_id");

      if (!session) {
        return res.status(404).json({
          error: "Invalid session code or session has expired",
        });
      }

      // Find student by matric number
      let student = await Student.findOne({
        matric_no: matric_no.toUpperCase(),
      });

      if (!student) {
        return res.status(404).json({
          error:
            "Student not found. Please contact your teacher to be added to the course.",
        });
      }

      // Check if student is enrolled in the course
      const CourseStudent = require("../models/CourseStudent");
      const enrollment = await CourseStudent.findOne({
        course_id: session.course_id._id,
        student_id: student._id,
      });

      if (!enrollment) {
        return res.status(403).json({
          error: "You are not enrolled in this course",
        });
      }

      // Check if student has already submitted attendance for this session
      const existingAttendance = await Attendance.findOne({
        session_id: session._id,
        matric_no_submitted: matric_no.toUpperCase(),
      });

      if (existingAttendance) {
        return res.status(400).json({
          error: "Attendance already submitted for this session",
          existing_record: {
            status: existingAttendance.status,
            submitted_at: existingAttendance.submitted_at,
          },
        });
      }

      // Generate device fingerprint
      const deviceFingerprint = generateDeviceFingerprint(userAgent, {
        ip,
        ...device_info,
      });

      // Check if this device has already been used for this session
      const deviceUsed = await Attendance.findOne({
        session_id: session._id,
        device_fingerprint: deviceFingerprint,
      });

      if (deviceUsed) {
        return res.status(400).json({
          error:
            "This device has already been used for attendance in this session",
        });
      }

      // Check geolocation - is student within the required radius?
      const isInRange = isWithinRadius(
        session.lat,
        session.lng,
        lat,
        lng,
        session.radius_m
      );

      let status = "present";
      let reason = "";

      if (!isInRange) {
        status = "rejected";
        reason = "Location out of range";
      }

      // Generate receipt signature
      const receiptSignature = generateReceiptSignature(
        session._id,
        matric_no.toUpperCase(),
        Date.now(),
        session.nonce
      );

      // Create attendance record
      const attendance = new Attendance({
        session_id: session._id,
        course_id: session.course_id._id,
        student_id: student._id,
        matric_no_submitted: matric_no.toUpperCase(),
        device_fingerprint: deviceFingerprint,
        lat,
        lng,
        accuracy,
        status,
        reason,
        receipt_signature: receiptSignature,
      });

      await attendance.save();

      // Update device fingerprint record
      await DeviceFingerprint.findOneAndUpdate(
        { device_fingerprint: deviceFingerprint },
        {
          device_fingerprint: deviceFingerprint,
          student_id: student._id,
          last_seen: new Date(),
          meta: { userAgent, ip, ...device_info },
        },
        {
          upsert: true,
          setDefaultsOnInsert: true,
        }
      );

      // Response based on status
      if (status === "present") {
        res.status(201).json({
          success: true,
          message: "Attendance submitted successfully",
          record: {
            student_name: student.name,
            matric_no: student.matric_no,
            course: session.course_id.title,
            session_code: session.session_code,
            status,
            submitted_at: attendance.submitted_at,
            receipt: receiptSignature,
          },
        });
      } else {
        res.status(400).json({
          success: false,
          message: "Attendance submission failed",
          error: reason,
          record: {
            student_name: student.name,
            matric_no: student.matric_no,
            course: session.course_id.title,
            session_code: session.session_code,
            status,
            reason,
            submitted_at: attendance.submitted_at,
          },
        });
      }
    } catch (error) {
      console.error("Attendance submission error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Get attendance records for a session (teacher only)
router.get(
  "/session/:sessionId",
  auth,
  [param("sessionId").isMongoId().withMessage("Valid session ID required")],
  validate,
  async (req, res) => {
    try {
      const { sessionId } = req.params;
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 50;
      const skip = (page - 1) * limit;
      const status = req.query.status; // present, absent, rejected, manual_present

      // Verify session belongs to teacher
      const session = await Session.findOne({
        _id: sessionId,
        teacher_id: req.teacher._id,
      }).populate("course_id");

      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }

      // Build query
      let query = { session_id: sessionId };
      if (
        status &&
        ["present", "absent", "rejected", "manual_present"].includes(status)
      ) {
        query.status = status;
      }

      const attendanceRecords = await Attendance.find(query)
        .populate("student_id", "matric_no name email")
        .populate("course_id", "course_code title")
        .sort({ submitted_at: -1 })
        .skip(skip)
        .limit(limit);

      const total = await Attendance.countDocuments(query);

      res.json({
        session,
        attendance: attendanceRecords,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(total / limit),
          totalRecords: total,
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1,
        },
      });
    } catch (error) {
      console.error("Get session attendance error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Download CSV attendance report
router.get(
  "/course/:courseId/report.csv",
  auth,
  [param("courseId").isMongoId().withMessage("Valid course ID required")],
  validate,
  auditLogger("attendance_report_downloaded"),
  async (req, res) => {
    try {
      const { courseId } = req.params;
      const { startDate, endDate, email } = req.query;

      // Verify course belongs to teacher
      const course = await Course.findOne({
        _id: courseId,
        teacher_id: req.teacher._id,
      });

      if (!course) {
        return res.status(404).json({ error: "Course not found" });
      }

      // Build date filter
      let dateFilter = {};
      if (startDate) {
        dateFilter.$gte = new Date(startDate);
      }
      if (endDate) {
        dateFilter.$lte = new Date(endDate);
      }

      // Get attendance data
      let query = { course_id: courseId };
      if (Object.keys(dateFilter).length > 0) {
        query.submitted_at = dateFilter;
      }

      const attendanceData = await Attendance.find(query)
        .populate("student_id", "matric_no name")
        .populate("course_id", "course_code title")
        .populate("session_id", "session_code start_ts")
        .sort({ submitted_at: -1 });

      // Generate CSV
      const csvBuffer = await ReportGenerator.generateAttendanceCSV(
        attendanceData
      );

      // If email is requested, send via email
      if (email && email.toLowerCase() === "true") {
        try {
          await emailService.sendAttendanceReport(
            req.teacher.email,
            req.teacher.name,
            course.title,
            csvBuffer,
            "csv"
          );

          res.json({
            message: "Attendance report has been sent to your email",
          });
          return;
        } catch (emailError) {
          console.error("Failed to send report email:", emailError);
          // Fall through to direct download
        }
      }

      // Direct download
      const filename = `attendance-${course.course_code}-${Date.now()}.csv`;

      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`
      );
      res.send(csvBuffer);
    } catch (error) {
      console.error("Generate CSV report error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Download PDF attendance report
router.get(
  "/course/:courseId/report.pdf",
  auth,
  [param("courseId").isMongoId().withMessage("Valid course ID required")],
  validate,
  auditLogger("attendance_report_downloaded"),
  async (req, res) => {
    try {
      const { courseId } = req.params;
      const { startDate, endDate, email } = req.query;

      // Verify course belongs to teacher
      const course = await Course.findOne({
        _id: courseId,
        teacher_id: req.teacher._id,
      }).populate("teacher_id", "name");

      if (!course) {
        return res.status(404).json({ error: "Course not found" });
      }

      // Build date filter
      let dateFilter = {};
      if (startDate) {
        dateFilter.$gte = new Date(startDate);
      }
      if (endDate) {
        dateFilter.$lte = new Date(endDate);
      }

      // Get attendance data
      let query = { course_id: courseId };
      if (Object.keys(dateFilter).length > 0) {
        query.submitted_at = dateFilter;
      }

      const attendanceData = await Attendance.find(query)
        .populate("student_id", "matric_no name")
        .populate("course_id", "course_code title")
        .populate("session_id", "session_code start_ts")
        .sort({ submitted_at: -1 });

      // Generate PDF
      const courseInfo = {
        course_code: course.course_code,
        title: course.title,
        teacher_name: course.teacher_id.name,
      };

      const pdfBuffer = await ReportGenerator.generateAttendancePDF(
        attendanceData,
        courseInfo
      );

      // If email is requested, send via email
      if (email && email.toLowerCase() === "true") {
        try {
          await emailService.sendAttendanceReport(
            req.teacher.email,
            req.teacher.name,
            course.title,
            pdfBuffer,
            "pdf"
          );

          res.json({
            message: "Attendance report has been sent to your email",
          });
          return;
        } catch (emailError) {
          console.error("Failed to send report email:", emailError);
          // Fall through to direct download
        }
      }

      // Direct download
      const filename = `attendance-${course.course_code}-${Date.now()}.pdf`;

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`
      );
      res.send(pdfBuffer);
    } catch (error) {
      console.error("Generate PDF report error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Get attendance statistics for a course
router.get(
  "/course/:courseId/stats",
  auth,
  [param("courseId").isMongoId().withMessage("Valid course ID required")],
  validate,
  async (req, res) => {
    try {
      const { courseId } = req.params;

      // Verify course belongs to teacher
      const course = await Course.findOne({
        _id: courseId,
        teacher_id: req.teacher._id,
      });

      if (!course) {
        return res.status(404).json({ error: "Course not found" });
      }

      // Get basic counts
      const totalSessions = await Session.countDocuments({
        course_id: courseId,
      });
      const activeSessions = await Session.countDocuments({
        course_id: courseId,
        expiry_ts: { $gt: new Date() },
        is_active: true,
      });

      const CourseStudent = require("../models/CourseStudent");
      const totalStudents = await CourseStudent.countDocuments({
        course_id: courseId,
      });

      // Get attendance statistics
      const attendanceStats = await Attendance.aggregate([
        { $match: { course_id: courseId } },
        {
          $group: {
            _id: "$status",
            count: { $sum: 1 },
          },
        },
      ]);

      const statusCounts = {};
      attendanceStats.forEach((stat) => {
        statusCounts[stat._id] = stat.count;
      });

      // Get recent activity
      const recentAttendance = await Attendance.find({ course_id: courseId })
        .populate("student_id", "matric_no name")
        .populate("session_id", "session_code start_ts")
        .sort({ submitted_at: -1 })
        .limit(10);

      res.json({
        course,
        statistics: {
          total_sessions: totalSessions,
          active_sessions: activeSessions,
          total_students: totalStudents,
          attendance_counts: {
            present:
              (statusCounts.present || 0) + (statusCounts.manual_present || 0),
            absent: statusCounts.absent || 0,
            rejected: statusCounts.rejected || 0,
            total_submissions: Object.values(statusCounts).reduce(
              (sum, count) => sum + count,
              0
            ),
          },
        },
        recent_activity: recentAttendance,
      });
    } catch (error) {
      console.error("Get course stats error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

module.exports = router;
