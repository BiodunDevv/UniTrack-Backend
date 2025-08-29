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

      // Get all students enrolled in this course
      const CourseStudent = require("../models/CourseStudent");
      const allStudents = await CourseStudent.find({
        course_id: session.course_id._id,
      })
        .populate("student_id", "name email matric_no level")
        .sort({ "student_id.name": 1 })
        .lean();

      // Get attendance records for this session
      const attendanceRecords = await Attendance.find({ session_id: sessionId })
        .populate("student_id", "name email matric_no level")
        .sort({ submitted_at: -1 })
        .lean();

      // Create a map of student attendance status
      const attendanceMap = {};
      attendanceRecords.forEach((record) => {
        attendanceMap[record.student_id._id.toString()] = record;
      });

      // Build comprehensive student list with attendance status
      const studentsWithAttendance = allStudents.map((enrollment) => {
        const student = enrollment.student_id;
        const studentId = student._id.toString();
        const attendanceRecord = attendanceMap[studentId];

        return {
          _id: student._id,
          name: student.name,
          email: student.email,
          matric_no: student.matric_no,
          level: student.level,
          attendance_status: attendanceRecord
            ? attendanceRecord.status
            : "absent",
          submitted_at: attendanceRecord ? attendanceRecord.submitted_at : null,
          location: attendanceRecord ? attendanceRecord.location : null,
          distance_from_session_m: attendanceRecord
            ? attendanceRecord.distance_from_session_m
            : null,
          device_info: attendanceRecord ? attendanceRecord.device_info : null,
          reason: attendanceRecord ? attendanceRecord.reason : null,
          has_submitted: !!attendanceRecord,
        };
      });

      // Separate students by attendance status
      const presentStudents = studentsWithAttendance.filter(
        (s) =>
          s.attendance_status === "present" ||
          s.attendance_status === "manual_present"
      );
      const absentStudents = studentsWithAttendance.filter(
        (s) => s.attendance_status === "absent"
      );

      // Calculate statistics based on all enrolled students
      const totalEnrolled = allStudents.length;
      const totalSubmissions = attendanceRecords.length;
      const presentCount = presentStudents.length;
      const absentCount = absentStudents.length;

      res.json({
        session: {
          ...session.toObject(),
          is_expired: session.isExpired(),
        },
        students: {
          all: studentsWithAttendance,
          present: presentStudents,
          absent: absentStudents,
        },
        // Keep the original attendance array for backward compatibility
        attendance: attendanceRecords,
        statistics: {
          total_enrolled: totalEnrolled,
          total_submissions: totalSubmissions,
          present_count: presentCount,
          absent_count: absentCount,
          attendance_rate:
            totalEnrolled > 0
              ? Math.round((presentCount / totalEnrolled) * 100)
              : 0,
          submission_rate:
            totalEnrolled > 0
              ? Math.round((totalSubmissions / totalEnrolled) * 100)
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

      // Always ensure we have at least 10 recent submissions
      let finalSubmissions = recentSubmissions;

      if (recentSubmissions.length < 10) {
        // Get the latest 10 submissions regardless of time window
        finalSubmissions = await Attendance.find({ session_id: sessionId })
          .populate("student_id", "matric_no name")
          .sort({ submitted_at: -1 })
          .limit(10);
      }

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
        recent_submissions: finalSubmissions,
        live_stats: {
          total_submissions: totalSubmissions,
          present_count: presentCount,
          rejected_count: rejectedCount,
          last_submission: latestSubmission?.submitted_at || null,
          last_updated: new Date(),
          time_window_minutes: parseInt(minutes),
          submissions_in_window: recentSubmissions.length,
          showing_count: finalSubmissions.length,
        },
        meta: {
          within_time_window: recentSubmissions.length,
          showing_latest: finalSubmissions.length,
          expanded_to_show_minimum:
            recentSubmissions.length < 10 &&
            finalSubmissions.length > recentSubmissions.length,
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

// Get all lecturer sessions (both active and inactive)
router.get("/lecturer/all", auth, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      course_id,
      search,
      full = false,
    } = req.query;

    // If full=true, don't use pagination
    const usePagination = full !== "true";
    const skip = usePagination ? (parseInt(page) - 1) * parseInt(limit) : 0;
    const limitNum = usePagination ? parseInt(limit) : 0; // 0 means no limit

    // Build query
    let query = {};

    // Get all courses taught by this teacher
    const teacherCourses = await Course.find({
      teacher_id: req.teacher._id,
    }).select("_id");
    const courseIds = teacherCourses.map((course) => course._id);

    query.course_id = { $in: courseIds };

    // Filter by status if provided
    if (status) {
      if (status === "active") {
        query.is_active = true;
        query.expiry_ts = { $gt: new Date() };
      } else if (status === "expired") {
        query.$or = [{ is_active: false }, { expiry_ts: { $lte: new Date() } }];
      } else if (status === "inactive") {
        query.is_active = false;
      }
    }

    // Filter by specific course if provided
    if (course_id) {
      query.course_id = course_id;
    }

    // Search by session code or course info if provided
    if (search) {
      const searchRegex = new RegExp(search, "i");
      query.$or = [
        { session_code: searchRegex },
        { "course_info.title": searchRegex },
        { "course_info.course_code": searchRegex },
      ];
    }

    let sessionsQuery = Session.find(query)
      .populate("course_id", "title course_code level semester academic_year")
      .sort({ created_at: -1 });

    if (usePagination) {
      sessionsQuery = sessionsQuery.skip(skip).limit(limitNum);
    }

    const sessions = await sessionsQuery.lean();

    // Get attendance count for each session
    const sessionsWithStats = await Promise.all(
      sessions.map(async (session) => {
        const attendanceCount = await Attendance.countDocuments({
          session_id: session._id,
        });
        const uniqueStudents = await Attendance.distinct("student_id", {
          session_id: session._id,
        });

        return {
          ...session,
          stats: {
            total_attendance: attendanceCount,
            unique_students: uniqueStudents.length,
            is_currently_active:
              session.is_active && new Date() < session.expiry_ts,
            duration_minutes: Math.round(
              (session.expiry_ts - session.created_at) / 60000
            ),
            time_remaining:
              session.is_active && new Date() < session.expiry_ts
                ? Math.max(
                    0,
                    Math.round((session.expiry_ts - new Date()) / 60000)
                  )
                : 0,
          },
        };
      })
    );

    const total = await Session.countDocuments(query);

    const response = {
      success: true,
      data: {
        sessions: sessionsWithStats,
        summary: {
          total_sessions: total,
          active_sessions: sessionsWithStats.filter(
            (s) => s.stats.is_currently_active
          ).length,
          expired_sessions: sessionsWithStats.filter(
            (s) => !s.stats.is_currently_active
          ).length,
        },
      },
    };

    // Only include pagination if not requesting full data
    if (usePagination) {
      response.data.pagination = {
        current_page: parseInt(page),
        total_pages: Math.ceil(total / parseInt(limit)),
        total_items: total,
        items_per_page: parseInt(limit),
      };
    }

    res.json(response);
  } catch (error) {
    console.error("Get lecturer sessions error:", error);
    res.status(500).json({
      error: "Failed to fetch sessions",
      message: "An internal server error occurred",
    });
  }
});

// Get detailed view of a specific session
router.get("/lecturer/:sessionId/details", auth, async (req, res) => {
  try {
    const { sessionId } = req.params;

    // Find session and verify it belongs to this teacher's courses
    const session = await Session.findById(sessionId)
      .populate(
        "course_id",
        "title course_code level semester academic_year teacher_id"
      )
      .lean();

    if (!session) {
      return res.status(404).json({
        error: "Session not found",
        message: "The requested session does not exist",
      });
    }

    // Verify this session belongs to the requesting teacher
    if (
      session.course_id.teacher_id.toString() !== req.teacher._id.toString()
    ) {
      return res.status(403).json({
        error: "Access denied",
        message: "You can only view sessions from your own courses",
      });
    }

    // Get all students enrolled in this course
    const CourseStudent = require("../models/CourseStudent");
    const allStudents = await CourseStudent.find({
      course_id: session.course_id._id,
    })
      .populate("student_id", "name email matric_no level")
      .sort({ "student_id.name": 1 })
      .lean();

    // Get attendance records for this session
    const attendanceRecords = await Attendance.find({ session_id: sessionId })
      .populate("student_id", "name email matric_no level")
      .sort({ submitted_at: -1 })
      .lean();

    // Create a map of student attendance status
    const attendanceMap = {};
    attendanceRecords.forEach((record) => {
      attendanceMap[record.student_id._id.toString()] = record;
    });

    // Build comprehensive student list with attendance status
    const studentsWithAttendance = allStudents.map((enrollment) => {
      const student = enrollment.student_id;
      const studentId = student._id.toString();
      const attendanceRecord = attendanceMap[studentId];

      return {
        _id: student._id,
        name: student.name,
        email: student.email,
        matric_no: student.matric_no,
        level: student.level,
        attendance_status: attendanceRecord
          ? attendanceRecord.status
          : "absent",
        submitted_at: attendanceRecord ? attendanceRecord.submitted_at : null,
        location: attendanceRecord ? attendanceRecord.location : null,
        distance_from_session_m: attendanceRecord
          ? attendanceRecord.distance_from_session_m
          : null,
        device_info: attendanceRecord ? attendanceRecord.device_info : null,
        reason: attendanceRecord ? attendanceRecord.reason : null,
        has_submitted: !!attendanceRecord,
      };
    });

    // Separate students by attendance status
    const presentStudents = studentsWithAttendance.filter(
      (s) =>
        s.attendance_status === "present" ||
        s.attendance_status === "manual_present"
    );
    const absentStudents = studentsWithAttendance.filter(
      (s) => s.attendance_status === "absent"
    );

    // Calculate session statistics
    const stats = {
      total_students_enrolled: allStudents.length,
      total_attendance_submissions: attendanceRecords.length,
      present_count: presentStudents.length,
      absent_count: absentStudents.length,
      attendance_rate:
        allStudents.length > 0
          ? Math.round((presentStudents.length / allStudents.length) * 100)
          : 0,
      is_currently_active: session.is_active && new Date() < session.expiry_ts,
      duration_minutes: Math.round(
        (session.expiry_ts - session.start_ts) / 60000
      ),
      time_remaining:
        session.is_active && new Date() < session.expiry_ts
          ? Math.max(0, Math.round((session.expiry_ts - new Date()) / 60000))
          : 0,
    };

    // Group attendance by time intervals (15-minute intervals)
    const timeIntervals = {};
    attendanceRecords.forEach((record) => {
      const interval =
        Math.floor(
          (record.submitted_at - session.start_ts) / (15 * 60 * 1000)
        ) * 15;
      if (!timeIntervals[interval]) {
        timeIntervals[interval] = 0;
      }
      timeIntervals[interval]++;
    });

    res.json({
      success: true,
      data: {
        session: {
          ...session,
          stats,
          attendance_distribution: timeIntervals,
        },
        students: {
          all: studentsWithAttendance,
          present: presentStudents,
          absent: absentStudents,
        },
        summary: {
          total_enrolled: allStudents.length,
          present: presentStudents.length,
          absent: absentStudents.length,
          attendance_rate: stats.attendance_rate + "%",
        },
      },
    });
  } catch (error) {
    console.error("Get session details error:", error);
    res.status(500).json({
      error: "Failed to fetch session details",
      message: "An internal server error occurred",
    });
  }
});

// Get lecturer session analytics
router.get("/lecturer/analytics", auth, async (req, res) => {
  try {
    const { days = 30, course_id } = req.query;
    const startDate = new Date(
      Date.now() - parseInt(days) * 24 * 60 * 60 * 1000
    );

    // Get teacher's courses
    let courseQuery = { teacher_id: req.teacher._id };
    if (course_id) {
      courseQuery._id = course_id;
    }

    const teacherCourses = await Course.find(courseQuery).select(
      "_id title course_code"
    );
    const courseIds = teacherCourses.map((course) => course._id);

    // Get sessions in date range
    const sessions = await Session.find({
      course_id: { $in: courseIds },
      created_at: { $gte: startDate },
    }).lean();

    // Calculate analytics
    const analytics = {
      total_sessions: sessions.length,
      active_sessions: sessions.filter(
        (s) => s.is_active && new Date() < s.expiry_ts
      ).length,
      completed_sessions: sessions.filter(
        (s) => !s.is_active || new Date() >= s.expiry_ts
      ).length,

      // Sessions by course
      sessions_by_course: {},

      // Sessions by day
      sessions_by_day: {},

      // Average session duration
      average_duration: 0,

      // Peak hours
      sessions_by_hour: {},
    };

    let totalDuration = 0;

    // Process each session
    for (const session of sessions) {
      const courseTitle =
        teacherCourses.find(
          (c) => c._id.toString() === session.course_id.toString()
        )?.title || "Unknown";
      const dayKey = session.created_at.toISOString().split("T")[0];
      const hour = session.created_at.getHours();
      const duration = Math.round(
        (session.expiry_ts - session.created_at) / 60000
      );

      // By course
      if (!analytics.sessions_by_course[courseTitle]) {
        analytics.sessions_by_course[courseTitle] = 0;
      }
      analytics.sessions_by_course[courseTitle]++;

      // By day
      if (!analytics.sessions_by_day[dayKey]) {
        analytics.sessions_by_day[dayKey] = 0;
      }
      analytics.sessions_by_day[dayKey]++;

      // By hour
      if (!analytics.sessions_by_hour[hour]) {
        analytics.sessions_by_hour[hour] = 0;
      }
      analytics.sessions_by_hour[hour]++;

      totalDuration += duration;
    }

    analytics.average_duration =
      sessions.length > 0 ? Math.round(totalDuration / sessions.length) : 0;

    // Get attendance analytics
    const attendanceStats = await Attendance.aggregate([
      {
        $lookup: {
          from: "sessions",
          localField: "session_id",
          foreignField: "_id",
          as: "session",
        },
      },
      {
        $unwind: "$session",
      },
      {
        $match: {
          "session.course_id": { $in: courseIds },
          submitted_at: { $gte: startDate },
        },
      },
      {
        $group: {
          _id: null,
          total_attendance: { $sum: 1 },
          unique_students: { $addToSet: "$student_id" },
          average_distance: { $avg: "$distance_from_session_m" },
        },
      },
    ]);

    const attendanceData = attendanceStats[0] || {
      total_attendance: 0,
      unique_students: [],
      average_distance: 0,
    };

    analytics.attendance_summary = {
      total_submissions: attendanceData.total_attendance,
      unique_students: attendanceData.unique_students.length,
      average_distance_meters: Math.round(attendanceData.average_distance || 0),
      average_attendance_per_session:
        sessions.length > 0
          ? Math.round(attendanceData.total_attendance / sessions.length)
          : 0,
    };

    res.json({
      success: true,
      data: {
        period: `Last ${days} days`,
        analytics,
        courses: teacherCourses,
      },
    });
  } catch (error) {
    console.error("Get lecturer analytics error:", error);
    res.status(500).json({
      error: "Failed to fetch analytics",
      message: "An internal server error occurred",
    });
  }
});

module.exports = router;
