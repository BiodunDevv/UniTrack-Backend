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
      const html = template({
        otp,
        purpose,
        expiryMinutes: process.env.OTP_EXPIRY_MINUTES || 10,
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
    courseTitle,
    reportBuffer,
    format = "csv"
  ) {
    try {
      const template = await this.loadTemplate("attendance-report");
      const html = template({
        teacherName,
        courseTitle,
        format: format.toUpperCase(),
        timestamp: new Date().toLocaleString(),
      });

      const mailOptions = {
        from: process.env.EMAIL_FROM,
        to: teacherEmail,
        subject: `Attendance Report - ${courseTitle}`,
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
}

module.exports = EmailService;
