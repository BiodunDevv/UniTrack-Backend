const express = require("express");
const { body, param } = require("express-validator");
const Attendance = require("../models/Attendance");
const Session = require("../models/Session");
const Student = require("../models/Student");
const Course = require("../models/Course");
const CourseStudent = require("../models/CourseStudent");
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

// Helper function to generate comprehensive course attendance data
async function generateCourseAttendanceData(courseId) {
  try {
    // Get course information
    const course = await Course.findById(courseId);
    if (!course) {
      throw new Error("Course not found");
    }

    // Get all sessions for this course
    const sessions = await Session.find({ course_id: courseId })
      .sort({ start_ts: 1 });

    // Get all students enrolled in this course
    const enrolledStudents = await CourseStudent.find({ course_id: courseId })
      .populate("student_id", "matric_no name email level");

    // Get all attendance records for this course
    const attendanceRecords = await Attendance.find({ course_id: courseId })
      .populate("student_id", "matric_no name email level")
      .populate("session_id", "session_code start_ts expiry_ts");

    // Calculate statistics for each student
    const studentStats = {};
    const sessionStats = {};

    // Initialize student stats
    enrolledStudents.forEach(enrollment => {
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
        risk_level: "low"
      };
    });

    // Initialize session stats
    sessions.forEach(session => {
      sessionStats[session._id] = {
        session_code: session.session_code,
        start_ts: session.start_ts,
        present_count: 0,
        absent_count: 0,
        total_enrolled: enrolledStudents.length,
        attendance_rate: 0
      };
    });

    // Process attendance records
    attendanceRecords.forEach(record => {
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
    Object.values(studentStats).forEach(student => {
      const totalSubmissions = student.sessions_attended + student.sessions_missed;
      student.sessions_missed = sessions.length - student.sessions_attended;
      student.attendance_rate = sessions.length > 0 ? 
        (student.sessions_attended / sessions.length) * 100 : 0;

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

      student.sessions_needed_for_75_percent = Math.max(0, 
        Math.ceil(sessions.length * 0.75) - student.sessions_attended);
    });

    // Calculate session attendance rates
    Object.values(sessionStats).forEach(session => {
      session.attendance_rate = session.total_enrolled > 0 ? 
        (session.present_count / session.total_enrolled) * 100 : 0;
    });

    // Calculate overall statistics
    const totalStudents = enrolledStudents.length;
    const totalSessions = sessions.length;
    const studentsBelow75 = Object.values(studentStats).filter(s => s.attendance_rate < 75);
    const studentsMeeting75 = totalStudents - studentsBelow75.length;
    const studentsWithPerfectAttendance = Object.values(studentStats)
      .filter(s => s.attendance_rate === 100).length;

    // Risk analysis
    const criticalRisk = studentsBelow75.filter(s => s.risk_level === "critical").length;
    const highRisk = studentsBelow75.filter(s => s.risk_level === "high").length;
    const mediumRisk = studentsBelow75.filter(s => s.risk_level === "medium").length;

    // Calculate overall attendance rate
    const totalPossibleAttendance = totalStudents * totalSessions;
    const totalActualAttendance = Object.values(studentStats)
      .reduce((sum, student) => sum + student.sessions_attended, 0);
    const overallAttendanceRate = totalPossibleAttendance > 0 ? 
      (totalActualAttendance / totalPossibleAttendance) * 100 : 0;

    // Find best and worst sessions
    const sessionList = Object.values(sessionStats);
    const bestSession = sessionList.length > 0 ? 
      sessionList.reduce((max, session) => 
        session.attendance_rate > max.attendance_rate ? session : max
      ) : { session_code: "N/A", attendance_rate: 0 };

    const worstSession = sessionList.length > 0 ? 
      sessionList.reduce((min, session) => 
        session.attendance_rate < min.attendance_rate ? session : min
      ) : { session_code: "N/A", attendance_rate: 0 };

    const averageSessionAttendance = sessionList.length > 0 ?
      sessionList.reduce((sum, session) => sum + session.attendance_rate, 0) / sessionList.length : 0;

    // Prepare return data
    return {
      course: {
        course_code: course.course_code,
        title: course.title,
        level: course.level
      },
      generated_at: new Date().toISOString(),
      summary: {
        overall_attendance_rate: overallAttendanceRate,
        total_sessions: totalSessions,
        total_students: totalStudents,
        students_meeting_75_percent: studentsMeeting75
      },
      risk_analysis: {
        total_at_risk: studentsBelow75.length,
        critical_risk: criticalRisk,
        high_risk: highRisk,
        medium_risk: mediumRisk
      },
      students_below_75_percent: studentsBelow75.sort((a, b) => a.attendance_rate - b.attendance_rate),
      all_students: Object.values(studentStats).sort((a, b) => a.matric_no.localeCompare(b.matric_no)),
      session_overview: sessionList.sort((a, b) => new Date(a.start_ts) - new Date(b.start_ts)),
      insights: {
        best_attended_session: {
          session_code: bestSession.session_code,
          attendance_rate: bestSession.attendance_rate
        },
        worst_attended_session: {
          session_code: worstSession.session_code,
          attendance_rate: worstSession.attendance_rate
        },
        average_session_attendance: averageSessionAttendance,
        students_with_perfect_attendance: studentsWithPerfectAttendance
      }
    };

  } catch (error) {
    console.error("Error generating course attendance data:", error);
    throw error;
  }
}

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
        // Validate device_info structure for FingerprintJS compatibility
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
            // FingerprintJS specific fields
            "visitorId",
            "confidence",
            "components",
            "version",
            "timestamp"
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

          // Validate FingerprintJS visitorId if provided
          if (value.visitorId && typeof value.visitorId !== "string") {
            throw new Error("visitorId must be a string");
          }

          // Validate confidence score if provided
          if (value.confidence && (typeof value.confidence.score !== "number" || 
              value.confidence.score < 0 || value.confidence.score > 1)) {
            throw new Error("confidence.score must be a number between 0 and 1");
          }

          // Validate components if provided
          if (value.components && typeof value.components !== "object") {
            throw new Error("components must be an object");
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

      // Generate enhanced device fingerprint with FingerprintJS integration
      let deviceFingerprint;
      let fpjsVisitorId = null;
      let fpjsConfidence = null;
      let fpjsComponents = null;

      if (device_info && device_info.visitorId) {
        // FingerprintJS is being used - prioritize visitorId for uniqueness
        fpjsVisitorId = device_info.visitorId;
        fpjsConfidence = device_info.confidence || null;
        fpjsComponents = device_info.components || null;
        
        // Use FingerprintJS visitorId as primary fingerprint for maximum accuracy
        deviceFingerprint = device_info.visitorId;
        
        console.log(`FingerprintJS detected - Visitor ID: ${fpjsVisitorId.substring(0, 8)}...`);
        console.log(`Confidence: ${fpjsConfidence ? fpjsConfidence.score : 'N/A'}`);
      } else if (device_info && device_info.device_fingerprint) {
        // Use the device fingerprint generated by the frontend
        deviceFingerprint = device_info.device_fingerprint;
        console.log(`Frontend fingerprint used: ${deviceFingerprint.substring(0, 8)}...`);
      } else {
        // Generate device fingerprint server-side as fallback
        deviceFingerprint = generateDeviceFingerprint(userAgent, {
          ip,
          ...device_info,
        });
        console.log(`Server-side fingerprint generated: ${deviceFingerprint.substring(0, 8)}...`);
      }

      // ENHANCED VALIDATION: Check if this device has already been used for this session
      // For FingerprintJS, we check both visitorId and device_fingerprint for maximum security
      let deviceUsed = null;

      if (fpjsVisitorId) {
        // Check by FingerprintJS visitorId first (most accurate)
        deviceUsed = await Attendance.findOne({
          session_id: session._id,
          device_fingerprint: fpjsVisitorId,
        }).populate("student_id", "name matric_no");

        // If not found by visitorId, also check for any record with similar device components
        if (!deviceUsed && fpjsComponents) {
          const similarDevice = await Attendance.findOne({
            session_id: session._id,
            "fpjs_components.screen": fpjsComponents.screen,
            "fpjs_components.timezone": fpjsComponents.timezone,
            "fpjs_components.languages": fpjsComponents.languages,
          }).populate("student_id", "name matric_no");

          if (similarDevice) {
            deviceUsed = similarDevice;
            console.log(`Similar device detected via components analysis`);
          }
        }
      } else {
        // Standard device fingerprint check
        deviceUsed = await Attendance.findOne({
          session_id: session._id,
          device_fingerprint: deviceFingerprint,
        }).populate("student_id", "name matric_no");
      }

      if (deviceUsed) {
        return res.status(400).json({
          error: "Device already used for attendance in this session",
          details: [
            "This device has already been used to submit attendance for this session",
            `Previously used by: ${deviceUsed.student_id.name} (${deviceUsed.student_id.matric_no})`,
            `Submitted at: ${deviceUsed.submitted_at.toLocaleString()}`,
            "Each device can only be used once per session to prevent fraud",
            fpjsVisitorId ? "Detection method: FingerprintJS" : "Detection method: Standard fingerprinting"
          ],
          security_info: {
            device_fingerprint: deviceFingerprint.substring(0, 8) + "...",
            previous_user: deviceUsed.student_id.name,
            previous_matric: deviceUsed.student_id.matric_no,
            submission_time: deviceUsed.submitted_at,
            detection_method: fpjsVisitorId ? "FingerprintJS" : "Standard",
            confidence_score: fpjsConfidence ? fpjsConfidence.score : null,
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

      // ENHANCED GEOLOCATION VALIDATION - Precise location verification using Haversine formula
      const { calculateDistance } = require("../utils/helpers");
      
      // Calculate precise distance using Haversine formula
      const actualDistance = calculateDistance(session.lat, session.lng, lat, lng);
      const isInRange = actualDistance <= session.radius_m;
      
      // Enhanced location logging for security analysis
      console.log(`Location validation for ${matric_no}:`);
      console.log(`Session location: ${session.lat}, ${session.lng}`);
      console.log(`Student location: ${lat}, ${lng}`);
      console.log(`Distance: ${Math.round(actualDistance)}m, Required: ${session.radius_m}m`);
      console.log(`In range: ${isInRange}`);

      let status = "present";
      let reason = "submitted online";

      if (!isInRange) {
        // Return detailed location error with precise distance calculation
        return res.status(400).json({
          success: false,
          error: "Location validation failed",
          details: [
            `You are too far from the session location`,
            `Required radius: ${session.radius_m} meters`,
            `Your distance: ${Math.round(actualDistance)} meters`,
            `Accuracy: ±${accuracy || 'unknown'} meters`,
            "Please move closer to the session location and try again",
            "Ensure your GPS is enabled and has a clear signal"
          ],
          location_info: {
            required_radius: session.radius_m,
            actual_distance: Math.round(actualDistance),
            distance_difference: Math.round(actualDistance - session.radius_m),
            session_location: {
              lat: session.lat,
              lng: session.lng,
            },
            your_location: {
              lat: lat,
              lng: lng,
              accuracy: accuracy,
            },
            calculation_method: "Haversine formula",
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

      // Calculate distance for analytics (using precise Haversine calculation)
      const distanceFromLocation = actualDistance;

      // Create enhanced attendance record with FingerprintJS integration
      const attendanceData = {
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
      };

      // Add FingerprintJS specific data if available
      if (fpjsVisitorId) {
        attendanceData.fpjs_visitor_id = fpjsVisitorId;
        if (fpjsConfidence) {
          attendanceData.fpjs_confidence = fpjsConfidence;
        }
        if (fpjsComponents) {
          attendanceData.fpjs_components = fpjsComponents;
        }
        if (device_info.version) {
          attendanceData.fpjs_version = device_info.version;
        }
        if (device_info.timestamp) {
          attendanceData.fpjs_timestamp = new Date(device_info.timestamp);
        }
      }

      const attendance = new Attendance(attendanceData);
      await attendance.save();

      // Update device fingerprint record with complete device info and FingerprintJS data
      const deviceFingerprintUpdate = {
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
      };

      // Add FingerprintJS specific metadata
      if (fpjsVisitorId) {
        deviceFingerprintUpdate.fpjs_visitor_id = fpjsVisitorId;
        deviceFingerprintUpdate.meta.fingerprintjs = {
          visitor_id: fpjsVisitorId,
          confidence: fpjsConfidence,
          components: fpjsComponents,
          version: device_info.version,
          timestamp: device_info.timestamp,
        };
      }

      await DeviceFingerprint.findOneAndUpdate(
        { device_fingerprint: deviceFingerprint },
        deviceFingerprintUpdate,
        {
          upsert: true,
          setDefaultsOnInsert: true,
        }
      );

      // Response with enhanced validation details and FingerprintJS info
      if (status === "present") {
        const responseData = {
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
            distance: Math.round(distanceFromLocation),
          },
          validation_passed: {
            student_enrolled: true,
            session_active: true,
            device_unique: true,
            location_valid: true,
            level_match: true,
          },
          security_info: {
            device_fingerprint: deviceFingerprint.substring(0, 8) + "...",
            location_accuracy: accuracy || 0,
            distance_from_session: Math.round(distanceFromLocation),
          },
        };

        // Add FingerprintJS information to response if available
        if (fpjsVisitorId) {
          responseData.security_info.fingerprintjs = {
            visitor_id: fpjsVisitorId.substring(0, 8) + "...",
            confidence: fpjsConfidence ? fpjsConfidence.score : null,
            detection_method: "FingerprintJS Pro",
          };
        }

        res.status(201).json(responseData);
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

// Download comprehensive CSV attendance report
router.get(
  "/course/:courseId/report.csv",
  auth,
  [param("courseId").isMongoId().withMessage("Valid course ID required")],
  validate,
  auditLogger("attendance_report_downloaded"),
  async (req, res) => {
    try {
      const { courseId } = req.params;
      const { email } = req.query;

      // Verify course belongs to teacher (or admin access)
      const course = await Course.findOne({
        _id: courseId,
        ...(req.teacher.role !== "admin" && { teacher_id: req.teacher._id }),
      });

      if (!course) {
        return res.status(404).json({ error: "Course not found" });
      }

      // Generate comprehensive course attendance report data
      const reportData = await generateCourseAttendanceData(courseId);

      // Generate CSV
      const csvBuffer = ReportGenerator.generateCourseAttendanceReportCSV(reportData);

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
            message: "Comprehensive attendance report has been sent to your email",
          });
          return;
        } catch (emailError) {
          console.error("Failed to send report email:", emailError);
          // Fall through to direct download
        }
      }

      // Direct download
      const filename = `comprehensive-attendance-${course.course_code}-${Date.now()}.csv`;

      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`
      );
      res.send(csvBuffer);
    } catch (error) {
      console.error("Generate comprehensive CSV report error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Download comprehensive PDF attendance report
router.get(
  "/course/:courseId/report.pdf",
  auth,
  [param("courseId").isMongoId().withMessage("Valid course ID required")],
  validate,
  auditLogger("attendance_report_downloaded"),
  async (req, res) => {
    try {
      const { courseId } = req.params;
      const { email } = req.query;

      // Verify course belongs to teacher (or admin access)
      const course = await Course.findOne({
        _id: courseId,
        ...(req.teacher.role !== "admin" && { teacher_id: req.teacher._id }),
      }).populate("teacher_id", "name");

      if (!course) {
        return res.status(404).json({ error: "Course not found" });
      }

      // Generate comprehensive course attendance report data
      const reportData = await generateCourseAttendanceData(courseId);

      // Generate PDF
      const pdfBuffer = await ReportGenerator.generateCourseAttendanceReportPDF(reportData);

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
            message: "Comprehensive attendance report has been sent to your email",
          });
          return;
        } catch (emailError) {
          console.error("Failed to send report email:", emailError);
          // Fall through to direct download
        }
      }

      // Direct download
      const filename = `comprehensive-attendance-${course.course_code}-${Date.now()}.pdf`;

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`
      );
      res.send(pdfBuffer);
    } catch (error) {
      console.error("Generate comprehensive PDF report error:", error);
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
