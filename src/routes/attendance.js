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
      .isNumeric()
      .withMessage("Session code must be exactly 4 digits"),
    body("lat")
      .isFloat({ min: -90, max: 90 })
      .withMessage("Valid latitude required (-90 to 90)"),
    body("lng")
      .isFloat({ min: -180, max: 180 })
      .withMessage("Valid longitude required (-180 to 180)"),
    body("accuracy")
      .optional()
      .isFloat({ min: 0, max: 10000 })
      .withMessage("Accuracy must be between 0 and 10000 meters"),
    body("device_info")
      .optional()
      .isObject()
      .withMessage("Device info must be an object")
      .custom((value) => {
        // Validate device_info structure for frontend compatibility
        if (value && typeof value === "object") {
          const allowedFields = [
            "platform",
            "browser", 
            "screen_resolution",
            "timezone",
            "user_agent",
            "language",
            "device_fingerprint",
            "os",
            "device_type",
          ];
          const providedFields = Object.keys(value);
          const invalidFields = providedFields.filter(
            (field) => !allowedFields.includes(field)
          );
          if (invalidFields.length > 0) {
            throw new Error(
              `Invalid device_info fields: ${invalidFields.join(", ")}`
            );
          }
        }
        return true;
      }),
    body("level")
      .optional()
      .isInt({ min: 100, max: 600 })
      .custom((value) => {
        if (value && value % 100 !== 0) {
          throw new Error(
            "Level must be in increments of 100 (100, 200, 300, 400, 500, 600)"
          );
        }
        return true;
      })
      .withMessage("Level must be between 100 and 600 in increments of 100"),
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
        level,
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
          details: [
            "Please check the session code provided by your lecturer",
            "Session may have expired or not yet started",
            "Contact your lecturer if you believe this is an error",
          ],
        });
      }

      // Find student by matric number
      let student = await Student.findOne({
        matric_no: matric_no.toUpperCase(),
      });

      if (!student) {
        return res.status(404).json({
          error: "Student not found in the system",
          details: [
            "Your matriculation number is not registered in this system",
            "Please contact your lecturer to be added to the course",
            "Ensure you entered your matriculation number correctly",
          ],
        });
      }

      // Update student level if provided and different
      if (level && student.level !== level) {
        student.level = level;
        await student.save();
      }

      // ENHANCED VALIDATION: Check if student is enrolled in the specific course for this session
      const CourseStudent = require("../models/CourseStudent");
      const enrollment = await CourseStudent.findOne({
        course_id: session.course_id._id,
        student_id: student._id,
      });

      if (!enrollment) {
        return res.status(403).json({
          error: "You are not enrolled in this course",
          details: [
            `Course: ${session.course_id.title} (${session.course_id.course_code})`,
            `Lecturer: ${session.teacher_id.name}`,
            "Please contact your lecturer to be added to this course",
            "You can only submit attendance for courses you are enrolled in",
          ],
          course_info: {
            course_name: session.course_id.title,
            course_code: session.course_id.course_code,
            lecturer: session.teacher_id.name,
            session_code: session.session_code,
          },
        });
      }

      // ENHANCED VALIDATION: Verify student level matches course level (if both are specified)
      if (
        student.level &&
        session.course_id.level &&
        student.level !== session.course_id.level
      ) {
        return res.status(400).json({
          error: "Level mismatch: You are not eligible for this course level",
          details: [
            `Your current level: ${student.level}`,
            `Course level: ${session.course_id.level}`,
            "Please contact your lecturer if you believe this is incorrect",
          ],
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
          details: [
            "You have already marked your attendance for this session",
            `Previous submission status: ${existingAttendance.status}`,
            `Submitted at: ${existingAttendance.submitted_at.toLocaleString()}`,
          ],
          existing_record: {
            status: existingAttendance.status,
            submitted_at: existingAttendance.submitted_at,
            course: session.course_id.title,
            session_code: session.session_code,
          },
        });
      }

      // Generate device fingerprint - use frontend fingerprint if available, otherwise generate one
      let deviceFingerprint;
      if (device_info && device_info.device_fingerprint) {
        // Use the device fingerprint generated by the frontend
        deviceFingerprint = device_info.device_fingerprint;
      } else {
        // Generate device fingerprint server-side as fallback
        deviceFingerprint = generateDeviceFingerprint(userAgent, {
          ip,
          ...device_info,
        });
      }

      // ENHANCED VALIDATION: Check if this device has already been used for this session
      const deviceUsed = await Attendance.findOne({
        session_id: session._id,
        device_fingerprint: deviceFingerprint,
      }).populate("student_id", "name matric_no");

      if (deviceUsed) {
        return res.status(400).json({
          error: "Device already used for attendance in this session",
          details: [
            "This device has already been used to submit attendance for this session",
            `Previously used by: ${deviceUsed.student_id.name} (${deviceUsed.student_id.matric_no})`,
            `Submitted at: ${deviceUsed.submitted_at.toLocaleString()}`,
            "Each device can only be used once per session to prevent fraud",
          ],
          security_info: {
            device_fingerprint: deviceFingerprint.substring(0, 8) + "...",
            previous_user: deviceUsed.student_id.name,
            previous_matric: deviceUsed.student_id.matric_no,
            submission_time: deviceUsed.submitted_at,
          },
        });
      }

      // ENHANCED VALIDATION: Additional security check - verify session belongs to correct course
      if (!session.course_id || !session.teacher_id) {
        return res.status(500).json({
          error: "Session configuration error",
          details: [
            "This session is not properly configured",
            "Please contact your lecturer to resolve this issue",
          ],
        });
      }

      // ENHANCED VALIDATION: Check if session is still active (double-check)
      if (session.expiry_ts <= new Date()) {
        return res.status(400).json({
          error: "Session has expired",
          details: [
            `Session expired at: ${session.expiry_ts.toLocaleString()}`,
            "Please ask your lecturer to start a new session",
            "Attendance can only be submitted during active sessions",
          ],
        });
      }

      // ENHANCED GEOLOCATION VALIDATION - Check if student is within required radius
      const isInRange = isWithinRadius(
        session.lat,
        session.lng,
        lat,
        lng,
        session.radius_m
      );

      let status = "present";
      let reason = "submitted online";

      if (!isInRange) {
        // Calculate actual distance for better error reporting
        const { calculateDistance } = require("../utils/helpers");
        const actualDistance = Math.round(
          calculateDistance(session.lat, session.lng, lat, lng)
        );

        // Return detailed location error instead of storing as rejected
        return res.status(400).json({
          success: false,
          error: "Location validation failed",
          details: [
            `You are too far from the session location`,
            `Required radius: ${session.radius_m} meters`,
            `Your distance: ${actualDistance} meters`,
            "Please move closer to the session location and try again",
          ],
          location_info: {
            required_radius: session.radius_m,
            actual_distance: actualDistance,
            session_location: {
              lat: session.lat,
              lng: session.lng,
            },
            your_location: {
              lat: lat,
              lng: lng,
            },
          },
        });
      }

      // Generate receipt signature
      const receiptSignature = generateReceiptSignature(
        session._id,
        matric_no.toUpperCase(),
        Date.now(),
        session.nonce
      );

      // Calculate distance for analytics (even if within range)
      const { calculateDistance } = require("../utils/helpers");
      const distanceFromLocation = calculateDistance(session.lat, session.lng, lat, lng);

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
        distance_from_location: distanceFromLocation,
        status,
        reason,
        receipt_signature: receiptSignature,
      });

      await attendance.save();

      // Update device fingerprint record with complete device info
      await DeviceFingerprint.findOneAndUpdate(
        { device_fingerprint: deviceFingerprint },
        {
          device_fingerprint: deviceFingerprint,
          student_id: student._id,
          last_seen: new Date(),
          meta: { 
            userAgent, 
            ip, 
            platform: device_info.platform,
            browser: device_info.browser,
            screen_resolution: device_info.screen_resolution,
            timezone: device_info.timezone,
            language: device_info.language,
            ...device_info 
          },
        },
        {
          upsert: true,
          setDefaultsOnInsert: true,
        }
      );

      // Response with enhanced validation details
      if (status === "present") {
        res.status(201).json({
          success: true,
          message: "Attendance submitted successfully",
          record: {
            student_name: student.name,
            matric_no: student.matric_no,
            course: session.course_id.title,
            course_code: session.course_id.course_code,
            session_code: session.session_code,
            lecturer: session.teacher_id.name,
            status,
            submitted_at: attendance.submitted_at,
            receipt: receiptSignature,
          },
          validation_passed: {
            student_enrolled: true,
            session_active: true,
            device_unique: true,
            location_valid: true,
            level_match: true,
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
            course_code: session.course_id.course_code,
            session_code: session.session_code,
            lecturer: session.teacher_id.name,
            status,
            reason,
            submitted_at: attendance.submitted_at,
          },
          validation_results: {
            student_enrolled: true,
            session_active: true,
            device_unique: true,
            location_valid: false,
            level_match: true,
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
      const status = req.query.status; // present, absent, manual_present

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
        ["present", "absent", "manual_present"].includes(status)
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
