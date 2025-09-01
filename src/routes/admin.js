const express = require("express");
const { body, param, query } = require("express-validator");
const Teacher = require("../models/Teacher");
const Course = require("../models/Course");
const CourseStudent = require("../models/CourseStudent");
const Student = require("../models/Student");
const Session = require("../models/Session");
const Attendance = require("../models/Attendance");
const AuditLog = require("../models/AuditLog");
const { adminAuth } = require("../middleware/auth");
const validate = require("../middleware/validation");
const auditLogger = require("../middleware/auditLogger");
const EmailService = require("../services/emailService");
const ReportGenerator = require("../utils/reportGenerator");
const { generateRandomPassword } = require("../utils/helpers");

const emailService = new EmailService();
const router = express.Router();

// Helper function to generate comprehensive course attendance data
async function generateCourseAttendanceData(courseId) {
  try {
    // Get course information
    const course = await Course.findById(courseId);
    if (!course) {
      throw new Error("Course not found");
    }

    // Get all sessions for this course
    const sessions = await Session.find({ course_id: courseId }).sort({
      start_ts: 1,
    });

    // Get all students enrolled in this course
    const enrolledStudents = await CourseStudent.find({
      course_id: courseId,
    }).populate("student_id", "matric_no name email level");

    // Get all attendance records for this course
    const attendanceRecords = await Attendance.find({ course_id: courseId })
      .populate("student_id", "matric_no name email level")
      .populate("session_id", "session_code start_ts expiry_ts");

    // Calculate statistics for each student
    const studentStats = {};
    const sessionStats = {};

    // Initialize student stats
    enrolledStudents.forEach((enrollment) => {
      const student = enrollment.student_id;
      studentStats[student._id] = {
        id: student._id,
        name: student.name,
        email: student.email,
        matric_no: student.matric_no,
        level: student.level,
        sessions_attended: 0,
        sessions_missed: 0,
        total_sessions: sessions.length,
        attendance_rate: 0,
        risk_level: "low",
      };
    });

    // Initialize session stats
    sessions.forEach((session) => {
      sessionStats[session._id] = {
        session_code: session.session_code,
        start_ts: session.start_ts,
        present_count: 0,
        absent_count: 0,
        total_enrolled: enrolledStudents.length,
        attendance_rate: 0,
      };
    });

    // Process attendance records
    attendanceRecords.forEach((record) => {
      const studentId = record.student_id._id;
      const sessionId = record.session_id._id;

      if (studentStats[studentId] && sessionStats[sessionId]) {
        if (record.status === "present" || record.status === "manual_present") {
          studentStats[studentId].sessions_attended++;
          sessionStats[sessionId].present_count++;
        } else {
          studentStats[studentId].sessions_missed++;
          sessionStats[sessionId].absent_count++;
        }
      }
    });

    // Calculate missing sessions for students who didn't submit attendance
    Object.values(studentStats).forEach((student) => {
      const totalSubmissions =
        student.sessions_attended + student.sessions_missed;
      student.sessions_missed = sessions.length - student.sessions_attended;
      student.attendance_rate =
        sessions.length > 0
          ? (student.sessions_attended / sessions.length) * 100
          : 0;

      // Determine risk level
      if (student.attendance_rate < 50) {
        student.risk_level = "critical";
      } else if (student.attendance_rate < 65) {
        student.risk_level = "high";
      } else if (student.attendance_rate < 75) {
        student.risk_level = "medium";
      } else {
        student.risk_level = "low";
      }

      student.sessions_needed_for_75_percent = Math.max(
        0,
        Math.ceil(sessions.length * 0.75) - student.sessions_attended
      );
    });

    // Calculate session attendance rates
    Object.values(sessionStats).forEach((session) => {
      session.attendance_rate =
        session.total_enrolled > 0
          ? (session.present_count / session.total_enrolled) * 100
          : 0;
    });

    // Calculate overall statistics
    const totalStudents = enrolledStudents.length;
    const totalSessions = sessions.length;
    const studentsBelow75 = Object.values(studentStats).filter(
      (s) => s.attendance_rate < 75
    );
    const studentsMeeting75 = totalStudents - studentsBelow75.length;
    const studentsWithPerfectAttendance = Object.values(studentStats).filter(
      (s) => s.attendance_rate === 100
    ).length;

    // Risk analysis
    const criticalRisk = studentsBelow75.filter(
      (s) => s.risk_level === "critical"
    ).length;
    const highRisk = studentsBelow75.filter(
      (s) => s.risk_level === "high"
    ).length;
    const mediumRisk = studentsBelow75.filter(
      (s) => s.risk_level === "medium"
    ).length;

    // Calculate overall attendance rate
    const totalPossibleAttendance = totalStudents * totalSessions;
    const totalActualAttendance = Object.values(studentStats).reduce(
      (sum, student) => sum + student.sessions_attended,
      0
    );
    const overallAttendanceRate =
      totalPossibleAttendance > 0
        ? (totalActualAttendance / totalPossibleAttendance) * 100
        : 0;

    // Find best and worst sessions
    const sessionList = Object.values(sessionStats);
    const bestSession =
      sessionList.length > 0
        ? sessionList.reduce((max, session) =>
            session.attendance_rate > max.attendance_rate ? session : max
          )
        : { session_code: "N/A", attendance_rate: 0 };

    const worstSession =
      sessionList.length > 0
        ? sessionList.reduce((min, session) =>
            session.attendance_rate < min.attendance_rate ? session : min
          )
        : { session_code: "N/A", attendance_rate: 0 };

    const averageSessionAttendance =
      sessionList.length > 0
        ? sessionList.reduce(
            (sum, session) => sum + session.attendance_rate,
            0
          ) / sessionList.length
        : 0;

    // Prepare return data
    return {
      course: {
        course_code: course.course_code,
        title: course.title,
        level: course.level,
      },
      generated_at: new Date().toISOString(),
      summary: {
        overall_attendance_rate: overallAttendanceRate,
        total_sessions: totalSessions,
        total_students: totalStudents,
        students_meeting_75_percent: studentsMeeting75,
      },
      risk_analysis: {
        total_at_risk: studentsBelow75.length,
        critical_risk: criticalRisk,
        high_risk: highRisk,
        medium_risk: mediumRisk,
      },
      students_below_75_percent: studentsBelow75.sort(
        (a, b) => a.attendance_rate - b.attendance_rate
      ),
      all_students: Object.values(studentStats).sort((a, b) =>
        a.matric_no.localeCompare(b.matric_no)
      ),
      session_overview: sessionList.sort(
        (a, b) => new Date(a.start_ts) - new Date(b.start_ts)
      ),
      insights: {
        best_attended_session: {
          session_code: bestSession.session_code,
          attendance_rate: bestSession.attendance_rate,
        },
        worst_attended_session: {
          session_code: worstSession.session_code,
          attendance_rate: worstSession.attendance_rate,
        },
        average_session_attendance: averageSessionAttendance,
        students_with_perfect_attendance: studentsWithPerfectAttendance,
      },
    };
  } catch (error) {
    console.error("Error generating course attendance data:", error);
    throw error;
  }
}

// Get system statistics (admin only)
router.get("/stats", adminAuth, async (req, res) => {
  try {
    const [
      totalTeachers,
      totalStudents,
      totalCourses,
      totalSessions,
      totalAttendance,
      activeSessions,
      recentActivity,
    ] = await Promise.all([
      Teacher.countDocuments(),
      Student.countDocuments(),
      Course.countDocuments(),
      Session.countDocuments(),
      Attendance.countDocuments(),
      Session.countDocuments({
        expiry_ts: { $gt: new Date() },
        is_active: true,
      }),
      AuditLog.find()
        .populate("actor_id", "name email role")
        .sort({ created_at: -1 })
        .limit(20),
    ]);

    // Get teacher registration trends (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recentTeachers = await Teacher.countDocuments({
      created_at: { $gte: thirtyDaysAgo },
    });

    // Get attendance trends
    const recentAttendance = await Attendance.countDocuments({
      submitted_at: { $gte: thirtyDaysAgo },
    });

    res.json({
      system_stats: {
        total_teachers: totalTeachers,
        total_students: totalStudents,
        total_courses: totalCourses,
        total_sessions: totalSessions,
        total_attendance_records: totalAttendance,
        active_sessions: activeSessions,
      },
      trends: {
        new_teachers_30d: recentTeachers,
        attendance_submissions_30d: recentAttendance,
      },
      recent_activity: recentActivity,
    });
  } catch (error) {
    console.error("Get admin stats error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get all teachers (admin only)
router.get("/teachers", adminAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const search = req.query.search;

    let query = {};
    if (search) {
      query = {
        $or: [
          { name: { $regex: search, $options: "i" } },
          { email: { $regex: search, $options: "i" } },
        ],
      };
    }

    const teachers = await Teacher.find(query)
      .select("-password_hash")
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Teacher.countDocuments(query);

    // Get course counts for each teacher
    const teachersWithStats = await Promise.all(
      teachers.map(async (teacher) => {
        const courseCount = await Course.countDocuments({
          teacher_id: teacher._id,
        });
        const sessionCount = await Session.countDocuments({
          teacher_id: teacher._id,
        });

        // Get all courses for this teacher
        const teacherCourses = await Course.find({
          teacher_id: teacher._id,
        }).select("_id");

        // Count unique students across all courses for this teacher
        const uniqueStudentCount = await CourseStudent.distinct("student_id", {
          course_id: { $in: teacherCourses.map((course) => course._id) },
        });

        return {
          ...teacher.toObject(),
          stats: {
            total_courses: courseCount,
            total_sessions: sessionCount,
            total_students: uniqueStudentCount.length,
          },
        };
      })
    );

    res.json({
      teachers: teachersWithStats,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalTeachers: total,
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1,
      },
    });
  } catch (error) {
    console.error("Get teachers error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Create teacher account (admin only)
router.post(
  "/teachers",
  adminAuth,
  [
    body("name")
      .trim()
      .isLength({ min: 2, max: 100 })
      .withMessage("Name must be 2-100 characters"),
    body("email")
      .isEmail()
      .normalizeEmail()
      .withMessage("Valid email required"),
    body("role")
      .optional()
      .isIn(["teacher", "admin"])
      .withMessage("Invalid role"),
    body("sendWelcomeEmail")
      .optional()
      .isBoolean()
      .withMessage("Send welcome email must be boolean"),
  ],
  validate,
  auditLogger("admin_created_teacher"),
  async (req, res) => {
    try {
      const {
        name,
        email,
        role = "teacher",
        sendWelcomeEmail = true,
      } = req.body;

      // Check if teacher already exists
      const existingTeacher = await Teacher.findOne({ email });
      if (existingTeacher) {
        return res
          .status(400)
          .json({ error: "Teacher with this email already exists" });
      }

      // Generate temporary password
      const temporaryPassword = generateRandomPassword();

      // Create teacher
      const teacher = new Teacher({
        name,
        email,
        password_hash: temporaryPassword,
        role,
      });

      await teacher.save();

      // Send welcome email with credentials
      if (sendWelcomeEmail) {
        try {
          await emailService.sendWelcomeEmail(email, name, temporaryPassword);
        } catch (emailError) {
          console.error("Failed to send welcome email:", emailError);
          // Don't fail the request if email fails
        }
      }

      res.status(201).json({
        message: "Teacher created successfully",
        teacher: teacher.toJSON(),
        temporary_password: temporaryPassword, // Include in response for admin
      });
    } catch (error) {
      console.error("Create teacher error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Update teacher (admin only)
router.patch(
  "/teachers/:teacherId",
  adminAuth,
  [
    param("teacherId").isMongoId().withMessage("Valid teacher ID required"),
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
    body("role")
      .optional()
      .isIn(["teacher", "admin"])
      .withMessage("Invalid role"),
    body("active").optional().isBoolean().withMessage("Active must be boolean"),
  ],
  validate,
  auditLogger("admin_updated_teacher"),
  async (req, res) => {
    try {
      const { teacherId } = req.params;
      const { name, email, role, active } = req.body;

      const teacher = await Teacher.findById(teacherId);
      if (!teacher) {
        return res.status(404).json({ error: "Teacher not found" });
      }

      // Prevent admin from demoting themselves
      if (teacherId === req.teacher._id.toString() && role === "teacher") {
        return res
          .status(400)
          .json({ error: "Cannot demote yourself from admin role" });
      }

      // Check email uniqueness if email is being changed
      if (email && email !== teacher.email) {
        const existingTeacher = await Teacher.findOne({
          email,
          _id: { $ne: teacherId },
        });
        if (existingTeacher) {
          return res.status(400).json({ error: "Email already in use" });
        }
      }

      // Update fields
      if (name) teacher.name = name;
      if (email) teacher.email = email;
      if (role) teacher.role = role;
      if (typeof active === "boolean") teacher.active = active;

      await teacher.save();

      res.json({
        message: "Teacher updated successfully",
        teacher: teacher.toJSON(),
      });
    } catch (error) {
      console.error("Update teacher error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Delete teacher (admin only)
router.delete(
  "/teachers/:teacherId",
  adminAuth,
  [param("teacherId").isMongoId().withMessage("Valid teacher ID required")],
  validate,
  auditLogger("admin_deleted_teacher"),
  async (req, res) => {
    try {
      const { teacherId } = req.params;

      // Prevent admin from deleting themselves
      if (teacherId === req.teacher._id.toString()) {
        return res
          .status(400)
          .json({ error: "Cannot delete your own account" });
      }

      const teacher = await Teacher.findById(teacherId);
      if (!teacher) {
        return res.status(404).json({ error: "Teacher not found" });
      }

      // Check if teacher has active sessions
      const activeSessions = await Session.countDocuments({
        teacher_id: teacherId,
        expiry_ts: { $gt: new Date() },
        is_active: true,
      });

      if (activeSessions > 0) {
        return res.status(400).json({
          error:
            "Cannot delete teacher with active sessions. Please end all sessions first.",
          active_sessions_count: activeSessions,
        });
      }

      // In production, you might want to archive instead of delete
      // For now, we'll delete but this removes all associated data
      await Teacher.findByIdAndDelete(teacherId);

      res.json({ message: "Teacher deleted successfully" });
    } catch (error) {
      console.error("Delete teacher error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Get system audit logs (admin only)
router.get("/audit-logs", adminAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;
    const action = req.query.action;
    const teacherId = req.query.teacher_id;

    let query = {};
    if (action) {
      query.action = { $regex: action, $options: "i" };
    }
    if (teacherId) {
      query.actor_id = teacherId;
    }

    const logs = await AuditLog.find(query)
      .populate("actor_id", "name email role")
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(limit);

    const total = await AuditLog.countDocuments(query);

    res.json({
      audit_logs: logs,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalLogs: total,
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1,
      },
    });
  } catch (error) {
    console.error("Get audit logs error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get system health check (admin only)
router.get("/health", adminAuth, async (req, res) => {
  try {
    const mongoose = require("mongoose");

    // Check database connection
    const dbStatus =
      mongoose.connection.readyState === 1 ? "connected" : "disconnected";

    // Check recent activity
    const recentActivity = await AuditLog.countDocuments({
      created_at: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    });

    // Check for any system errors (you can customize this)
    const errorCount = await AuditLog.countDocuments({
      action: { $regex: "error", $options: "i" },
      created_at: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    });

    res.json({
      status: "healthy",
      timestamp: new Date(),
      database: {
        status: dbStatus,
        host:
          process.env.MONGODB_URI?.replace(/\/\/.*@/, "//***@") || "localhost",
      },
      activity: {
        recent_actions_24h: recentActivity,
        errors_24h: errorCount,
      },
      system: {
        node_version: process.version,
        uptime_seconds: process.uptime(),
        memory_usage: process.memoryUsage(),
        environment: process.env.NODE_ENV || "development",
      },
    });
  } catch (error) {
    console.error("Health check error:", error);
    res.status(500).json({
      status: "unhealthy",
      error: "Health check failed",
      timestamp: new Date(),
    });
  }
});

// Bulk operations for teachers (admin only)
router.post(
  "/teachers/bulk-action",
  adminAuth,
  [
    body("action")
      .isIn(["activate", "deactivate", "delete"])
      .withMessage("Invalid bulk action"),
    body("teacher_ids").isArray().withMessage("Teacher IDs must be an array"),
    body("teacher_ids.*").isMongoId().withMessage("Invalid teacher ID format"),
  ],
  validate,
  auditLogger("admin_bulk_teacher_action"),
  async (req, res) => {
    try {
      const { action, teacher_ids } = req.body;

      // Prevent bulk action on current admin
      if (teacher_ids.includes(req.teacher._id.toString())) {
        return res
          .status(400)
          .json({ error: "Cannot perform bulk action on your own account" });
      }

      let result = {};

      switch (action) {
        case "activate":
          result = await Teacher.updateMany(
            { _id: { $in: teacher_ids } },
            { active: true }
          );
          break;

        case "deactivate":
          result = await Teacher.updateMany(
            { _id: { $in: teacher_ids } },
            { active: false }
          );
          break;

        case "delete":
          // Check for active sessions first
          const activeSessionCount = await Session.countDocuments({
            teacher_id: { $in: teacher_ids },
            expiry_ts: { $gt: new Date() },
            is_active: true,
          });

          if (activeSessionCount > 0) {
            return res.status(400).json({
              error: "Cannot delete teachers with active sessions",
              active_sessions_count: activeSessionCount,
            });
          }

          result = await Teacher.deleteMany({ _id: { $in: teacher_ids } });
          break;
      }

      res.json({
        message: `Bulk ${action} completed successfully`,
        affected_count: result.modifiedCount || result.deletedCount,
        teacher_ids,
      });
    } catch (error) {
      console.error("Bulk teacher action error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Get all attendance records (admin only) with comprehensive filtering
router.get(
  "/attendance",
  adminAuth,
  [
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 500 }),
    query("teacher_id").optional().isMongoId(),
    query("course_id").optional().isMongoId(),
    query("session_id").optional().isMongoId(),
    query("student_id").optional().isMongoId(),
    query("status")
      .optional()
      .isIn(["present", "absent", "rejected", "manual_present"]),
    query("start_date").optional().isISO8601(),
    query("end_date").optional().isISO8601(),
    query("search").optional().trim(),
  ],
  validate,
  async (req, res) => {
    try {
      const {
        page = 1,
        limit = 50,
        teacher_id,
        course_id,
        session_id,
        student_id,
        status,
        start_date,
        end_date,
        search,
      } = req.query;

      const skip = (page - 1) * limit;

      // Build filter
      const filter = {};

      if (teacher_id) {
        // Get courses by teacher
        const teacherCourses = await Course.find({ teacher_id }).select("_id");
        filter.course_id = { $in: teacherCourses.map((c) => c._id) };
      }

      if (course_id) filter.course_id = course_id;
      if (session_id) filter.session_id = session_id;
      if (student_id) filter.student_id = student_id;
      if (status) filter.status = status;

      if (start_date || end_date) {
        filter.submitted_at = {};
        if (start_date) filter.submitted_at.$gte = new Date(start_date);
        if (end_date) filter.submitted_at.$lte = new Date(end_date);
      }

      // Build aggregation pipeline
      const pipeline = [
        { $match: filter },
        {
          $lookup: {
            from: "sessions",
            localField: "session_id",
            foreignField: "_id",
            as: "session",
          },
        },
        { $unwind: "$session" },
        {
          $lookup: {
            from: "courses",
            localField: "course_id",
            foreignField: "_id",
            as: "course",
          },
        },
        { $unwind: "$course" },
        {
          $lookup: {
            from: "teachers",
            localField: "course.teacher_id",
            foreignField: "_id",
            as: "teacher",
          },
        },
        { $unwind: "$teacher" },
        {
          $lookup: {
            from: "students",
            localField: "student_id",
            foreignField: "_id",
            as: "student",
          },
        },
        {
          $unwind: {
            path: "$student",
            preserveNullAndEmptyArrays: true,
          },
        },
      ];

      // Add search filter if provided
      if (search) {
        pipeline.push({
          $match: {
            $or: [
              { "course.course_code": { $regex: search, $options: "i" } },
              { "course.title": { $regex: search, $options: "i" } },
              { "teacher.name": { $regex: search, $options: "i" } },
              { "student.name": { $regex: search, $options: "i" } },
              { matric_no_submitted: { $regex: search, $options: "i" } },
            ],
          },
        });
      }

      // Add projection
      pipeline.push({
        $project: {
          _id: 1,
          matric_no_submitted: 1,
          status: 1,
          submitted_at: 1,
          lat: 1,
          lng: 1,
          accuracy: 1,
          reason: 1,
          session: {
            _id: "$session._id",
            session_code: "$session.session_code",
            start_ts: "$session.start_ts",
            expiry_ts: "$session.expiry_ts",
          },
          course: {
            _id: "$course._id",
            course_code: "$course.course_code",
            title: "$course.title",
          },
          teacher: {
            _id: "$teacher._id",
            name: "$teacher.name",
            email: "$teacher.email",
          },
          student: {
            _id: "$student._id",
            name: "$student.name",
            email: "$student.email",
            matric_no: "$student.matric_no",
          },
        },
      });

      // Get total count
      const totalPipeline = [...pipeline, { $count: "total" }];
      const [totalResult] = await Attendance.aggregate(totalPipeline);
      const total = totalResult ? totalResult.total : 0;

      // Add pagination
      pipeline.push(
        { $sort: { submitted_at: -1 } },
        { $skip: skip },
        { $limit: parseInt(limit) }
      );

      const attendance = await Attendance.aggregate(pipeline);

      res.json({
        attendance,
        pagination: {
          current_page: parseInt(page),
          total_pages: Math.ceil(total / limit),
          total_records: total,
          per_page: parseInt(limit),
        },
        filters_applied: {
          teacher_id,
          course_id,
          session_id,
          student_id,
          status,
          start_date,
          end_date,
          search,
        },
      });
    } catch (error) {
      console.error("Get all attendance error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Download comprehensive attendance report (CSV)
router.get(
  "/attendance/report.csv",
  adminAuth,
  [
    query("teacher_id").optional().isMongoId(),
    query("course_id").optional().isMongoId(),
    query("start_date").optional().isISO8601(),
    query("end_date").optional().isISO8601(),
    query("status")
      .optional()
      .isIn(["present", "absent", "rejected", "manual_present"]),
    query("email").optional().isBoolean(),
  ],
  validate,
  auditLogger("admin_downloaded_csv_report"),
  async (req, res) => {
    try {
      const { teacher_id, course_id, start_date, end_date, status, email } =
        req.query;

      // Build filter
      const filter = {};
      if (teacher_id) {
        const teacherCourses = await Course.find({ teacher_id }).select("_id");
        filter.course_id = { $in: teacherCourses.map((c) => c._id) };
      }
      if (course_id) filter.course_id = course_id;
      if (status) filter.status = status;
      if (start_date || end_date) {
        filter.submitted_at = {};
        if (start_date) filter.submitted_at.$gte = new Date(start_date);
        if (end_date) filter.submitted_at.$lte = new Date(end_date);
      }

      // Get attendance data with all relations
      const attendanceData = await Attendance.find(filter)
        .populate({
          path: "session_id",
          select: "session_code start_ts expiry_ts",
        })
        .populate({
          path: "course_id",
          select: "course_code title",
          populate: {
            path: "teacher_id",
            select: "name email",
          },
        })
        .populate("student_id", "name email matric_no phone")
        .sort({ submitted_at: -1 });

      // Generate enhanced CSV with session grouping
      const csvBuffer =
        await ReportGenerator.generateEnhancedAdminAttendanceCSV(
          attendanceData
        );

      if (email === "true") {
        // Send via email
        await emailService.sendAttendanceReport(
          req.teacher.email,
          req.teacher.name,
          "System-wide Attendance Report",
          csvBuffer,
          "csv"
        );

        res.json({
          message: "Attendance report sent to your email successfully",
          total_records: attendanceData.length,
        });
      } else {
        // Direct download
        const filename = `admin_attendance_report_${Date.now()}.csv`;

        res.setHeader("Content-Type", "text/csv");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${filename}"`
        );
        res.send(csvBuffer);
      }
    } catch (error) {
      console.error("Admin CSV report error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Download comprehensive attendance report (PDF)
router.get(
  "/attendance/report.pdf",
  adminAuth,
  [
    query("teacher_id").optional().isMongoId(),
    query("course_id").optional().isMongoId(),
    query("start_date").optional().isISO8601(),
    query("end_date").optional().isISO8601(),
    query("status")
      .optional()
      .isIn(["present", "absent", "rejected", "manual_present"]),
    query("email").optional().isBoolean(),
  ],
  validate,
  auditLogger("admin_downloaded_pdf_report"),
  async (req, res) => {
    try {
      const { teacher_id, course_id, start_date, end_date, status, email } =
        req.query;

      // Build filter (same as CSV)
      const filter = {};
      if (teacher_id) {
        const teacherCourses = await Course.find({ teacher_id }).select("_id");
        filter.course_id = { $in: teacherCourses.map((c) => c._id) };
      }
      if (course_id) filter.course_id = course_id;
      if (status) filter.status = status;
      if (start_date || end_date) {
        filter.submitted_at = {};
        if (start_date) filter.submitted_at.$gte = new Date(start_date);
        if (end_date) filter.submitted_at.$lte = new Date(end_date);
      }

      // Get attendance data
      const attendanceData = await Attendance.find(filter)
        .populate({
          path: "session_id",
          select: "session_code start_ts expiry_ts",
        })
        .populate({
          path: "course_id",
          select: "course_code title",
          populate: {
            path: "teacher_id",
            select: "name email",
          },
        })
        .populate("student_id", "name email matric_no phone")
        .sort({ submitted_at: -1 });

      // Generate PDF
      const pdfBuffer = await ReportGenerator.generateAdminAttendancePDF(
        attendanceData,
        {
          adminName: req.teacher.name,
          filters: { teacher_id, course_id, start_date, end_date, status },
        }
      );

      if (email === "true") {
        // Send via email
        await emailService.sendAttendanceReport(
          req.teacher.email,
          req.teacher.name,
          "System-wide Attendance Report",
          pdfBuffer,
          "pdf"
        );

        res.json({
          message: "Attendance report sent to your email successfully",
          total_records: attendanceData.length,
        });
      } else {
        // Direct download
        const filename = `admin_attendance_report_${Date.now()}.pdf`;

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${filename}"`
        );
        res.send(pdfBuffer);
      }
    } catch (error) {
      console.error("Admin PDF report error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Download comprehensive course attendance report (CSV) - Admin only
router.get(
  "/course/:courseId/report.csv",
  adminAuth,
  [param("courseId").isMongoId().withMessage("Valid course ID required")],
  validate,
  auditLogger("admin_downloaded_course_csv_report"),
  async (req, res) => {
    try {
      const { courseId } = req.params;
      const { email } = req.query;

      // Verify course exists
      const course = await Course.findById(courseId);
      if (!course) {
        return res.status(404).json({ error: "Course not found" });
      }

      // Generate comprehensive course attendance report data
      const reportData = await generateCourseAttendanceData(courseId);

      // Generate CSV
      const csvBuffer =
        ReportGenerator.generateCourseAttendanceReportCSV(reportData);

      // If email is requested, send via email
      if (email && email.toLowerCase() === "true") {
        try {
          await emailService.sendAttendanceReport(
            req.admin.email,
            req.admin.name,
            `${course.course_code} - ${course.title}`,
            csvBuffer,
            "csv"
          );

          res.json({
            message:
              "Comprehensive course attendance report has been sent to your email",
          });
          return;
        } catch (emailError) {
          console.error("Failed to send report email:", emailError);
          // Fall through to direct download
        }
      }

      // Direct download
      const filename = `admin-course-attendance-${
        course.course_code
      }-${Date.now()}.csv`;

      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`
      );
      res.send(csvBuffer);
    } catch (error) {
      console.error("Generate admin course CSV report error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Download comprehensive course attendance report (PDF) - Admin only
router.get(
  "/course/:courseId/report.pdf",
  adminAuth,
  [param("courseId").isMongoId().withMessage("Valid course ID required")],
  validate,
  auditLogger("admin_downloaded_course_pdf_report"),
  async (req, res) => {
    try {
      const { courseId } = req.params;
      const { email } = req.query;

      // Verify course exists
      const course = await Course.findById(courseId);
      if (!course) {
        return res.status(404).json({ error: "Course not found" });
      }

      // Generate comprehensive course attendance report data
      const reportData = await generateCourseAttendanceData(courseId);

      // Generate PDF
      const pdfBuffer = await ReportGenerator.generateCourseAttendanceReportPDF(
        reportData
      );

      // If email is requested, send via email
      if (email && email.toLowerCase() === "true") {
        try {
          await emailService.sendAttendanceReport(
            req.admin.email,
            req.admin.name,
            `${course.course_code} - ${course.title}`,
            pdfBuffer,
            "pdf"
          );

          res.json({
            message:
              "Comprehensive course attendance report has been sent to your email",
          });
          return;
        } catch (emailError) {
          console.error("Failed to send report email:", emailError);
          // Fall through to direct download
        }
      }

      // Direct download
      const filename = `admin-course-attendance-${
        course.course_code
      }-${Date.now()}.pdf`;

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`
      );
      res.send(pdfBuffer);
    } catch (error) {
      console.error("Generate admin course PDF report error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

module.exports = router;
