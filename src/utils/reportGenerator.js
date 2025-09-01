const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");

class ReportGenerator {
  static generateCourseAttendanceReportPDF(reportData) {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: "A4",
          margin: 50,
        });

        const chunks = [];
        doc.on("data", (chunk) => chunks.push(chunk));
        doc.on("end", () => resolve(Buffer.concat(chunks)));

        // Colors
        const primaryBlue = "#2563eb";
        const darkText = "#1f2937";
        const lightGray = "#6b7280";
        const successGreen = "#059669";
        const warningOrange = "#d97706";
        const errorRed = "#dc2626";
        const mediumYellow = "#ca8a04";

        // Helper function to format date
        const formatDate = (dateString) => {
          return new Date(dateString).toLocaleDateString("en-US", {
            weekday: "short",
            year: "numeric",
            month: "short",
            day: "numeric",
          });
        };

        const formatLevel = (level) => {
          const levelMap = {
            100: "1st Year",
            200: "2nd Year", 
            300: "3rd Year",
            400: "4th Year",
            500: "5th Year",
            600: "6th Year",
          };
          return levelMap[level] || `Level ${level}`;
        };

        // Helper function to add footer
        const addFooter = () => {
          doc.fillColor(lightGray)
             .fontSize(8)
             .text(`Generated: ${new Date().toLocaleDateString("en-US")}`, 50, 780)
             .text(`${reportData.course.course_code} - Attendance Report`, 250, 780);
        };

        // Helper function to check if we need a new page
        const checkPageBreak = (currentY, requiredSpace = 30) => {
          if (currentY > 750) {
            addFooter();
            doc.addPage();
            return 50; // Reset to top margin
          }
          return currentY;
        };

        // Header
        doc.fillColor(darkText)
           .fontSize(24)
           .font("Helvetica-Bold")
           .text("Comprehensive Course Attendance Report", 50, 50);

        let yPos = 100;

        // Course Information Section
        doc.fillColor(primaryBlue)
           .fontSize(16)
           .font("Helvetica-Bold")
           .text("Course Information", 50, yPos);

        yPos += 25;
        doc.fillColor(darkText)
           .fontSize(12)
           .font("Helvetica");

        doc.text(`Course Code: ${reportData.course.course_code}`, 50, yPos);
        yPos += 20;
        doc.text(`Course Title: ${reportData.course.title}`, 50, yPos);
        yPos += 20;
        doc.text(`Course Level: ${formatLevel(reportData.course.level)}`, 50, yPos);
        yPos += 20;
        doc.text(`Total Sessions: ${reportData.summary.total_sessions}`, 50, yPos);
        yPos += 20;
        doc.text(`Total Students: ${reportData.summary.total_students}`, 50, yPos);
        yPos += 20;

        // Overall attendance rate with color coding
        const attendanceRate = reportData.summary.overall_attendance_rate;
        let rateColor = successGreen;
        if (attendanceRate < 50) rateColor = errorRed;
        else if (attendanceRate < 75) rateColor = warningOrange;

        doc.fillColor(rateColor)
           .fontSize(14)
           .font("Helvetica-Bold")
           .text(`Overall Attendance Rate: ${attendanceRate.toFixed(2)}%`, 50, yPos);

        yPos += 40;
        yPos = checkPageBreak(yPos);

        // Summary Statistics Section
        doc.fillColor(primaryBlue)
           .fontSize(16)
           .font("Helvetica-Bold")
           .text("Summary Statistics", 50, yPos);

        yPos += 25;
        doc.fillColor(darkText)
           .fontSize(12)
           .font("Helvetica");

        doc.text(`Students Meeting 75% Requirement: ${reportData.summary.students_meeting_75_percent}`, 50, yPos);
        yPos += 20;
        doc.text(`Students Below 75% Requirement: ${reportData.students_below_75_percent.length}`, 50, yPos);
        yPos += 20;
        doc.text(`Students with Perfect Attendance: ${reportData.insights.students_with_perfect_attendance}`, 50, yPos);

        yPos += 40;
        yPos = checkPageBreak(yPos);

        // Risk Analysis Section
        doc.fillColor(primaryBlue)
           .fontSize(16)
           .font("Helvetica-Bold")
           .text("Risk Analysis", 50, yPos);

        yPos += 25;
        doc.fillColor(darkText)
           .fontSize(12)
           .font("Helvetica");

        doc.fillColor(errorRed)
           .text(`Critical Risk (< 50%): ${reportData.risk_analysis.critical_risk} students`, 50, yPos);
        yPos += 20;
        doc.fillColor(warningOrange)
           .text(`High Risk (50-64%): ${reportData.risk_analysis.high_risk} students`, 50, yPos);
        yPos += 20;
        doc.fillColor(mediumYellow)
           .text(`Medium Risk (65-74%): ${reportData.risk_analysis.medium_risk} students`, 50, yPos);
        yPos += 20;
        doc.fillColor(errorRed)
           .font("Helvetica-Bold")
           .text(`Total Students at Risk: ${reportData.risk_analysis.total_at_risk}`, 50, yPos);

        yPos += 40;
        yPos = checkPageBreak(yPos);

        // Students Below 75% Attendance Section - Table Format
        if (reportData.students_below_75_percent.length > 0) {
          yPos = checkPageBreak(yPos, 150);

          doc.fillColor(primaryBlue)
             .fontSize(16)
             .font("Helvetica-Bold")
             .text("Students Below 75% Attendance", 50, yPos);

          yPos += 25;

          // Table headers for students below 75%
          doc.fillColor(darkText)
             .fontSize(10)
             .font("Helvetica-Bold");

          const studentColWidths = [25, 110, 80, 60, 50, 60, 55];
          const studentHeaders = ["#", "Student Name", "Matric No", "Rate %", "Attended", "Total", "Risk Level"];
          
          let xPos = 50;
          studentHeaders.forEach((header, index) => {
            doc.text(header, xPos, yPos);
            xPos += studentColWidths[index];
          });

          yPos += 20;

          // Draw header line
          doc.strokeColor(lightGray)
             .lineWidth(1)
             .moveTo(50, yPos)
             .lineTo(540, yPos)
             .stroke();

          yPos += 10;

          // Student data rows for below 75%
          reportData.students_below_75_percent.forEach((student, index) => {
            yPos = checkPageBreak(yPos);

            let studentColor = errorRed;
            if (student.risk_level === "high") studentColor = warningOrange;
            else if (student.risk_level === "medium") studentColor = mediumYellow;

            doc.fillColor(darkText)
               .fontSize(9)
               .font("Helvetica");

            xPos = 50;
            const studentRowData = [
              (index + 1).toString(),
              student.name.length > 16 ? student.name.substring(0, 13) + "..." : student.name,
              student.matric_no,
              `${student.attendance_rate.toFixed(1)}%`,
              student.sessions_attended.toString(),
              (student.sessions_attended + student.sessions_missed).toString(),
              student.risk_level.toUpperCase()
            ];

            studentRowData.forEach((data, colIndex) => {
              if (colIndex === 3) { // Attendance rate column
                doc.fillColor(studentColor);
              } else if (colIndex === 6) { // Risk level column
                doc.fillColor(studentColor);
              } else {
                doc.fillColor(darkText);
              }
              
              doc.text(data, xPos, yPos);
              xPos += studentColWidths[colIndex];
            });

            yPos += 15;
          });

          yPos += 30;
        }

        // Session Overview Section - Table Format
        yPos = checkPageBreak(yPos, 150);

        doc.fillColor(primaryBlue)
           .fontSize(16)
           .font("Helvetica-Bold")
           .text("Session Overview", 50, yPos);

        yPos += 25;

        if (reportData.session_overview && reportData.session_overview.length > 0) {
          // Table headers for session overview
          doc.fillColor(darkText)
             .fontSize(10)
             .font("Helvetica-Bold");

          const sessionColWidths = [25, 80, 90, 60, 60, 80];
          const sessionHeaders = ["#", "Session Code", "Date", "Present", "Absent", "Attendance %"];
          
          let xPos = 50;
          sessionHeaders.forEach((header, index) => {
            doc.text(header, xPos, yPos);
            xPos += sessionColWidths[index];
          });

          yPos += 20;

          // Draw header line
          doc.strokeColor(lightGray)
             .lineWidth(1)
             .moveTo(50, yPos)
             .lineTo(540, yPos)
             .stroke();

          yPos += 10;

          // Session data rows
          reportData.session_overview.forEach((session, index) => {
            yPos = checkPageBreak(yPos);

            const sessionDate = formatDate(session.start_ts);
            const attendanceRate = session.attendance_rate.toFixed(1);
            
            doc.fillColor(darkText)
               .fontSize(9)
               .font("Helvetica");

            xPos = 50;
            const sessionRowData = [
              (index + 1).toString(),
              session.session_code,
              sessionDate,
              session.present_count.toString(),
              session.absent_count.toString(),
              `${attendanceRate}%`
            ];

            sessionRowData.forEach((data, colIndex) => {
              if (colIndex === 5) { // Attendance rate column
                const rate = parseFloat(attendanceRate);
                if (rate >= 75) doc.fillColor(successGreen);
                else if (rate >= 50) doc.fillColor(warningOrange);
                else doc.fillColor(errorRed);
              } else {
                doc.fillColor(darkText);
              }
              
              doc.text(data, xPos, yPos);
              xPos += sessionColWidths[colIndex];
            });
            
            yPos += 15;
          });
        }

        yPos += 30;

        // All Students Attendance Summary Section - Enhanced Table Format
        yPos = checkPageBreak(yPos, 150);

        doc.fillColor(primaryBlue)
           .fontSize(16)
           .font("Helvetica-Bold")
           .text("All Students Attendance Summary", 50, yPos);

        yPos += 25;

        // Table headers
        doc.fillColor(darkText)
           .fontSize(10)
           .font("Helvetica-Bold");

        const colWidths = [25, 80, 110, 60, 50, 60, 70];
        const headers = ["#", "Matric No", "Name", "Attended", "Total", "Rate %", "Meets 75%"];
        
        let xPos = 50;
        headers.forEach((header, index) => {
          doc.text(header, xPos, yPos);
          xPos += colWidths[index];
        });

        yPos += 20;

        // Draw header line
        doc.strokeColor(lightGray)
           .lineWidth(1)
           .moveTo(50, yPos)
           .lineTo(540, yPos)
           .stroke();

        yPos += 10;

        // Student data rows
        if (reportData.all_students && reportData.all_students.length > 0) {
          reportData.all_students.forEach((student, index) => {
            yPos = checkPageBreak(yPos);

            const meets75 = student.attendance_rate >= 75 ? "Yes" : "No";
            const textColor = student.attendance_rate >= 75 ? successGreen : errorRed;

            doc.fillColor(darkText)
               .fontSize(9)
               .font("Helvetica");

            xPos = 50;
            const rowData = [
              (index + 1).toString(),
              student.matric_no,
              student.name.length > 16 ? student.name.substring(0, 13) + "..." : student.name,
              student.sessions_attended.toString(),
              student.total_sessions.toString(),
              student.attendance_rate.toFixed(1),
              meets75
            ];

            rowData.forEach((data, colIndex) => {
              if (colIndex === 5) { // Rate % column
                doc.fillColor(textColor);
              } else if (colIndex === 6) { // Meets 75% column
                doc.fillColor(textColor);
              } else {
                doc.fillColor(darkText);
              }
              
              doc.text(data, xPos, yPos);
              xPos += colWidths[colIndex];
            });

            yPos += 15;
          });
        }

        // Add footer to the final page
        addFooter();

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  static generateCourseAttendanceReportCSV(reportData) {
    let csv = "Comprehensive Course Attendance Report\n\n";
    
    // Course Information
    csv += "Course Information\n";
    csv += `Course Code,${reportData.course.course_code}\n`;
    csv += `Course Title,${reportData.course.title}\n`;
    csv += `Course Level,${reportData.course.level}\n`;
    csv += `Total Sessions,${reportData.summary.total_sessions}\n`;
    csv += `Total Students,${reportData.summary.total_students}\n`;
    csv += `Overall Attendance Rate,${reportData.summary.overall_attendance_rate.toFixed(2)}%\n\n`;

    // Summary Statistics
    csv += "Summary Statistics\n";
    csv += `Students Meeting 75% Requirement,${reportData.summary.students_meeting_75_percent}\n`;
    csv += `Students Below 75% Requirement,${reportData.students_below_75_percent.length}\n`;
    csv += `Students with Perfect Attendance,${reportData.insights.students_with_perfect_attendance}\n\n`;

    // Risk Analysis
    csv += "Risk Analysis\n";
    csv += `Critical Risk (< 50%),${reportData.risk_analysis.critical_risk} students\n`;
    csv += `High Risk (50-64%),${reportData.risk_analysis.high_risk} students\n`;
    csv += `Medium Risk (65-74%),${reportData.risk_analysis.medium_risk} students\n`;
    csv += `Total Students at Risk,${reportData.risk_analysis.total_at_risk}\n\n`;

    // Students Below 75% Attendance
    if (reportData.students_below_75_percent.length > 0) {
      csv += "Students Below 75% Attendance\n";
      csv += "#,Name,Matric No,Attendance Rate,Sessions Attended,Total Sessions,Risk Level\n";
      
      reportData.students_below_75_percent.forEach((student, index) => {
        csv += `${index + 1},${student.name},${student.matric_no},${student.attendance_rate.toFixed(2)}%,${student.sessions_attended},${student.sessions_attended + student.sessions_missed},${student.risk_level}\n`;
      });
      csv += "\n";
    }

    // Session Overview
    if (reportData.session_overview && reportData.session_overview.length > 0) {
      csv += "Session Overview\n";
      csv += "#,Session Code,Date,Present Count,Absent Count,Attendance Rate\n";
      
      reportData.session_overview.forEach((session, index) => {
        const sessionDate = new Date(session.start_ts).toLocaleDateString("en-US");
        csv += `${index + 1},${session.session_code},${sessionDate},${session.present_count},${session.absent_count},${session.attendance_rate.toFixed(1)}%\n`;
      });
      csv += "\n";
    }

    // All Students Attendance Summary
    if (reportData.all_students && reportData.all_students.length > 0) {
      csv += "All Students Attendance Summary\n";
      csv += "#,Matric No,Name,Attended,Total,Rate %,Meets 75%\n";
      
      reportData.all_students.forEach((student, index) => {
        const meets75 = student.attendance_rate >= 75 ? "Yes" : "No";
        csv += `${index + 1},${student.matric_no},${student.name},${student.sessions_attended},${student.total_sessions},${student.attendance_rate.toFixed(1)},${meets75}\n`;
      });
    }

    return Buffer.from(csv, "utf-8");
  }

  // Enhanced admin attendance report methods for backward compatibility
  static async generateEnhancedAdminAttendanceCSV(attendanceData) {
    let csv = "Enhanced Admin Attendance Report\n\n";
    csv += "Session Code,Course,Teacher,Student Name,Matric No,Status,Submitted At,Location\n";
    
    attendanceData.forEach((record) => {
      const sessionCode = record.session_id?.session_code || "N/A";
      const courseInfo = record.course_id ? `${record.course_id.course_code} - ${record.course_id.title}` : "N/A";
      const teacherName = record.course_id?.teacher_id?.name || "N/A";
      const studentName = record.student_id?.name || "Unknown";
      const matricNo = record.student_id?.matric_no || record.matric_no_submitted;
      const status = record.status;
      const submittedAt = record.submitted_at ? new Date(record.submitted_at).toLocaleString() : "Not Submitted";
      const location = record.lat && record.lng ? `${record.lat}, ${record.lng}` : "N/A";
      
      csv += `${sessionCode},${courseInfo},${teacherName},${studentName},${matricNo},${status},${submittedAt},${location}\n`;
    });

    return Buffer.from(csv, "utf-8");
  }

  static async generateAdminAttendancePDF(attendanceData, options = {}) {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ size: "A4", margin: 50 });
        const chunks = [];
        
        doc.on("data", (chunk) => chunks.push(chunk));
        doc.on("end", () => resolve(Buffer.concat(chunks)));

        // Header
        doc.fontSize(20)
           .text("Admin Attendance Report", 50, 50);

        if (options.adminName) {
          doc.fontSize(12)
             .text(`Generated by: ${options.adminName}`, 50, 80);
        }

        doc.fontSize(12)
           .text(`Generated: ${new Date().toLocaleString()}`, 50, 100);

        let yPos = 140;

        // Table headers
        doc.fontSize(10)
           .text("Session", 50, yPos)
           .text("Course", 120, yPos)
           .text("Student", 220, yPos)
           .text("Matric No", 320, yPos)
           .text("Status", 420, yPos)
           .text("Time", 480, yPos);

        yPos += 20;

        // Data rows
        attendanceData.forEach((record) => {
          if (yPos > 750) {
            doc.addPage();
            yPos = 50;
          }

          const sessionCode = record.session_id?.session_code || "N/A";
          const courseCode = record.course_id?.course_code || "N/A";
          const studentName = record.student_id?.name?.substring(0, 15) || "Unknown";
          const matricNo = record.student_id?.matric_no || record.matric_no_submitted;
          const status = record.status;
          const time = record.submitted_at ? new Date(record.submitted_at).toLocaleDateString() : "N/A";

          doc.fontSize(8)
             .text(sessionCode, 50, yPos)
             .text(courseCode, 120, yPos)
             .text(studentName, 220, yPos)
             .text(matricNo, 320, yPos)
             .text(status, 420, yPos)
             .text(time, 480, yPos);

          yPos += 15;
        });

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }
}

module.exports = ReportGenerator;
