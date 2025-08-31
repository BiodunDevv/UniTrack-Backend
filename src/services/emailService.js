const nodemailer = require("nodemailer");
const handlebars = require("handlebars");
const fs = require("fs").promises;
const path = require("path");

class EmailService {
  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: process.env.EMAIL_PORT,
      secure: false, // true for 465, false for other ports
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    // Register Handlebars helpers
    handlebars.registerHelper("eq", function (a, b) {
      return a === b;
    });

    handlebars.registerHelper("if_gt", function (a, b, options) {
      if (a > b) {
        return options.fn(this);
      }
      return options.inverse(this);
    });

    // Test connection
    this.transporter.verify((error, success) => {
      if (error) {
        console.error("Email service connection failed:", error);
      } else {
        console.log("Email service is ready");
      }
    });
  }

  async loadTemplate(templateName) {
    try {
      const templatePath = path.join(
        __dirname,
        "../templates/email",
        `${templateName}.hbs`
      );
      const templateSource = await fs.readFile(templatePath, "utf8");
      return handlebars.compile(templateSource);
    } catch (error) {
      console.error(`Failed to load email template ${templateName}:`, error);
      throw error;
    }
  }

  async sendOTP(email, otp, purpose = "verification") {
    try {
      const template = await this.loadTemplate("otp");
      const expiryTime = new Date(
        Date.now() + 60 * 60 * 1000
      ).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      });
      const html = template({
        otp,
        purpose,
        expiryMinutes: 60, // Always 1 hour expiry
        expiryTime: expiryTime,
      });

      const mailOptions = {
        from: process.env.EMAIL_FROM,
        to: email,
        subject: `Your OTP for ${purpose}`,
        html,
      };

      const info = await this.transporter.sendMail(mailOptions);
      console.log("OTP email sent:", info.messageId);
      return info;
    } catch (error) {
      console.error("Failed to send OTP email:", error);
      throw error;
    }
  }

  async sendSessionNotification(
    teacherEmail,
    teacherName,
    courseTitle,
    sessionCode
  ) {
    try {
      const template = await this.loadTemplate("session-notification");
      const html = template({
        teacherName,
        courseTitle,
        sessionCode,
        timestamp: new Date().toLocaleString(),
      });

      const mailOptions = {
        from: process.env.EMAIL_FROM,
        to: teacherEmail,
        subject: `Attendance Session Started - ${courseTitle}`,
        html,
      };

      const info = await this.transporter.sendMail(mailOptions);
      console.log("Session notification sent:", info.messageId);
      return info;
    } catch (error) {
      console.error("Failed to send session notification:", error);
      throw error;
    }
  }

  async sendAttendanceReport(
    teacherEmail,
    teacherName,
    courseName,
    reportBuffer,
    format = "csv"
  ) {
    try {
      const template = await this.loadTemplate("attendance-report");
      const html = template({
        teacherName,
        courseName,
        courseTitle: courseName, // For backward compatibility
        format: format.toUpperCase(),
        timestamp: new Date().toLocaleString(),
      });

      const mailOptions = {
        from: process.env.EMAIL_FROM,
        to: teacherEmail,
        subject: `Attendance Report - ${courseName}`,
        html,
        attachments: [
          {
            filename: `attendance-report-${Date.now()}.${format}`,
            content: reportBuffer,
            contentType: format === "csv" ? "text/csv" : "application/pdf",
          },
        ],
      };

      const info = await this.transporter.sendMail(mailOptions);
      console.log("Attendance report sent:", info.messageId);
      return info;
    } catch (error) {
      console.error("Failed to send attendance report:", error);
      throw error;
    }
  }

  async sendPasswordResetOTP(email, otp) {
    return this.sendOTP(email, otp, "password reset");
  }

  async sendWelcomeEmail(teacherEmail, teacherName, temporaryPassword) {
    try {
      const template = await this.loadTemplate("welcome");
      const html = template({
        teacherName,
        teacherEmail,
        temporaryPassword,
        loginUrl: process.env.FRONTEND_URL || "http://localhost:3000",
      });

      const mailOptions = {
        from: process.env.EMAIL_FROM,
        to: teacherEmail,
        subject: "Welcome to UniTrack Attendance System",
        html,
      };

      const info = await this.transporter.sendMail(mailOptions);
      console.log("Welcome email sent:", info.messageId);
      return info;
    } catch (error) {
      console.error("Failed to send welcome email:", error);
      throw error;
    }
  }

  async sendStudentShareRequest(
    targetTeacherEmail,
    targetTeacherName,
    requesterName,
    requesterCourse,
    targetCourse,
    studentCount,
    message,
    requestId
  ) {
    try {
      const template = await this.loadTemplate("student-share-request");
      const html = template({
        targetTeacherName,
        requesterName,
        requesterCourse,
        targetCourse,
        studentCount,
        message,
        requestId,
        approveUrl: `${
          process.env.FRONTEND_URL || "http://localhost:3000"
        }/share-requests/${requestId}`,
        timestamp: new Date().toLocaleString(),
      });

      const mailOptions = {
        from: process.env.EMAIL_FROM,
        to: targetTeacherEmail,
        subject: `Student Sharing Request from ${requesterName}`,
        html,
      };

      const info = await this.transporter.sendMail(mailOptions);
      console.log("Student share request email sent:", info.messageId);
      return info;
    } catch (error) {
      console.error("Failed to send student share request email:", error);
      throw error;
    }
  }

  async sendStudentShareResponse(
    requesterEmail,
    requesterName,
    responderName,
    requesterCourse,
    sourceCourse,
    approved,
    studentCount,
    responseMessage
  ) {
    try {
      const template = await this.loadTemplate("student-share-response");
      const html = template({
        requesterName,
        responderName,
        requesterCourse,
        sourceCourse,
        approved,
        studentCount,
        responseMessage,
        timestamp: new Date().toLocaleString(),
      });

      const subject = approved
        ? `Student Sharing Request Approved by ${responderName}`
        : `Student Sharing Request Declined by ${responderName}`;

      const mailOptions = {
        from: process.env.EMAIL_FROM,
        to: requesterEmail,
        subject,
        html,
      };

      const info = await this.transporter.sendMail(mailOptions);
      console.log("Student share response email sent:", info.messageId);
      return info;
    } catch (error) {
      console.error("Failed to send student share response email:", error);
      throw error;
    }
  }

  async sendSupportRequestToAdmin(adminEmail, supportData) {
    try {
      const template = await this.loadTemplate("support-request");

      // Determine priority color
      const priorityColors = {
        low: "#28a745",
        medium: "#ffc107",
        high: "#fd7e14",
        urgent: "#dc3545",
      };

      const html = template({
        userName: supportData.name,
        userEmail: supportData.email,
        userType: supportData.user_type,
        subject: supportData.subject,
        category: supportData.category,
        priority: supportData.priority.toLowerCase(),
        priorityColor: priorityColors[supportData.priority] || "#6c757d",
        message: supportData.message,
        submittedAt: new Date(supportData.submittedAt).toLocaleString(),
        ticketId: supportData.ticketId,
        phone: supportData.phone,
        matricNo: supportData.matric_no,
        courseInfo: supportData.course_info
          ? JSON.stringify(supportData.course_info, null, 2)
          : null,
        errorDetails: supportData.error_details
          ? JSON.stringify(supportData.error_details, null, 2)
          : null,
        browserInfo: supportData.browser_info
          ? JSON.stringify(supportData.browser_info, null, 2)
          : null,
        ip_address: supportData.ip_address,
        user_agent: supportData.user_agent,
        systemName: "UniTrack System",
      });

      const mailOptions = {
        from: process.env.EMAIL_FROM,
        to: adminEmail,
        subject: `[Support Request] ${supportData.priority.toUpperCase()} - ${
          supportData.subject
        }`,
        html,
      };

      const info = await this.transporter.sendMail(mailOptions);
      console.log("Support request email sent to admin:", info.messageId);
      return info;
    } catch (error) {
      console.error("Failed to send support request email to admin:", error);
      throw error;
    }
  }

  async sendSupportConfirmation(userEmail, supportData) {
    try {
      const template = await this.loadTemplate("support-confirmation");

      // Determine priority color and expected response time
      const priorityColors = {
        low: "#28a745",
        medium: "#ffc107",
        high: "#fd7e14",
        urgent: "#dc3545",
      };

      const expectedResponses = {
        low: "within 2-3 business days",
        medium: "within 1-2 business days",
        high: "within 24 hours",
        urgent: "within 4-6 hours",
      };

      const html = template({
        userName: supportData.name,
        subject: supportData.subject,
        category: supportData.category,
        priority: supportData.priority.toUpperCase(),
        priorityColor: priorityColors[supportData.priority] || "#6c757d",
        message: supportData.message,
        submittedAt: new Date(supportData.submittedAt).toLocaleString(),
        ticketId: supportData.ticketId,
        expectedResponse:
          expectedResponses[supportData.priority] || "as soon as possible",
        systemName: "UniTrack System",
      });

      const mailOptions = {
        from: process.env.EMAIL_FROM,
        to: userEmail,
        subject: `Support Request Confirmation - Ticket #${supportData.ticketId}`,
        html,
      };

      const info = await this.transporter.sendMail(mailOptions);
      console.log("Support confirmation email sent:", info.messageId);
      return info;
    } catch (error) {
      console.error("Failed to send support confirmation email:", error);
      throw error;
    }
  }
}

module.exports = EmailService;
