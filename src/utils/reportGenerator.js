const csv = require("fast-csv");
const PDFDocument = require("pdfkit");

class ReportGenerator {
  static async generateCSV(data, columns) {
    return new Promise((resolve, reject) => {
      try {
        // Create CSV header
        const header = columns.join(",") + "\n";

        // Create CSV rows
        const rows = data
          .map((row) => {
            return columns
              .map((col) => {
                const value = row[col] || "";
                // Escape quotes and wrap in quotes if contains comma or quote
                if (
                  typeof value === "string" &&
                  (value.includes(",") ||
                    value.includes('"') ||
                    value.includes("\n"))
                ) {
                  return `"${value.replace(/"/g, '""')}"`;
                }
                return value;
              })
              .join(",");
          })
          .join("\n");

        const csvContent = header + rows;
        resolve(Buffer.from(csvContent, "utf8"));
      } catch (error) {
        reject(error);
      }
    });
  }

  static async generateAttendanceCSV(attendanceData) {
    const columns = [
      "Session ID",
      "Course Code",
      "Course Title",
      "Student Name",
      "Matric No",
      "Status",
      "Submitted At",
      "Location (Lat, Lng)",
      "Reason",
    ];

    const formattedData = attendanceData.map((record) => ({
      "Session ID": record.session_id?.toString() || "",
      "Course Code": record.course_id?.course_code || "",
      "Course Title": record.course_id?.title || "",
      "Student Name": record.student_id?.name || "Unknown",
      "Matric No": record.matric_no_submitted,
      Status: record.status,
      "Submitted At": new Date(record.submitted_at).toLocaleString(),
      "Location (Lat, Lng)": `${record.lat}, ${record.lng}`,
      Reason:
        record.status === "manual_present"
          ? "Marked present by lecturer"
          : record.status === "present"
          ? "Submitted online"
          : record.reason || "",
    }));

    return this.generateCSV(formattedData, columns);
  }

  static async generateAdminAttendanceCSV(attendanceData) {
    const columns = [
      "Teacher Name",
      "Teacher Email",
      "Course Code",
      "Course Title",
      "Session ID",
      "Session Code",
      "Session Start",
      "Student Name",
      "Matric No",
      "Email",
      "Phone",
      "Status",
      "Submitted At",
      "Latitude",
      "Longitude",
      "Accuracy (m)",
      "Reason",
    ];

    const formattedData = attendanceData.map((record) => ({
      "Teacher Name": record.course_id?.teacher_id?.name || "Unknown",
      "Teacher Email": record.course_id?.teacher_id?.email || "Unknown",
      "Course Code": record.course_id?.course_code || "",
      "Course Title": record.course_id?.title || "",
      "Session ID": record.session_id?._id?.toString() || "",
      "Session Code": record.session_id?.session_code || "",
      "Session Start": record.session_id?.start_ts
        ? new Date(record.session_id.start_ts).toLocaleString()
        : "",
      "Student Name": record.student_id?.name || "Unknown",
      "Matric No": record.matric_no_submitted,
      Email: record.student_id?.email || "",
      Phone: record.student_id?.phone || "",
      Status: record.status,
      "Submitted At": new Date(record.submitted_at).toLocaleString(),
      Latitude: record.lat || "",
      Longitude: record.lng || "",
      "Accuracy (m)": record.accuracy || "N/A",
      Reason:
        record.status === "manual_present"
          ? "Marked present by lecturer"
          : record.status === "present"
          ? "Submitted online"
          : record.reason || "",
    }));

    return this.generateCSV(formattedData, columns);
  }

  static async generatePDF(title, data, options = {}) {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 50 });
        const buffers = [];

        doc.on("data", buffers.push.bind(buffers));
        doc.on("end", () => {
          const pdfData = Buffer.concat(buffers);
          resolve(pdfData);
        });

        // Header
        doc.fontSize(20).text(title, { align: "center" });
        doc.moveDown();

        // Add generation date
        doc.fontSize(12).text(`Generated on: ${new Date().toLocaleString()}`, {
          align: "right",
        });
        doc.moveDown();

        // Add course info if provided
        if (options.courseInfo) {
          doc
            .fontSize(14)
            .text(
              `Course: ${options.courseInfo.course_code} - ${options.courseInfo.title}`
            );
          doc.text(`Teacher: ${options.courseInfo.teacher_name}`);
          doc.moveDown();
        }

        // Table headers
        const headers = options.headers || [];
        let y = doc.y;
        const columnWidth = (doc.page.width - 100) / headers.length;

        // Draw table headers
        doc.fontSize(10);
        headers.forEach((header, index) => {
          doc.text(header, 50 + index * columnWidth, y, {
            width: columnWidth,
            align: "left",
            continued: index < headers.length - 1,
          });
        });

        doc.moveDown();

        // Draw horizontal line
        doc
          .strokeColor("#000000")
          .lineWidth(1)
          .moveTo(50, doc.y)
          .lineTo(doc.page.width - 50, doc.y)
          .stroke();

        doc.moveDown(0.5);

        // Table data
        data.forEach((row, rowIndex) => {
          if (doc.y > doc.page.height - 100) {
            doc.addPage();
            y = 50;
            doc.y = y;
          }

          y = doc.y;

          headers.forEach((header, colIndex) => {
            const value = row[header] || "";
            doc.text(value.toString(), 50 + colIndex * columnWidth, y, {
              width: columnWidth,
              align: "left",
              continued: colIndex < headers.length - 1,
            });
          });

          doc.moveDown(0.5);
        });

        // Footer
        doc
          .fontSize(8)
          .text(
            `Page ${doc.bufferedPageRange().count}`,
            50,
            doc.page.height - 50,
            { align: "center" }
          );

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  static async generateAttendancePDF(attendanceData, courseInfo) {
    const title = "Attendance Report";

    const headers = [
      "Matric No",
      "Student Name",
      "Status",
      "Submitted At",
      "Session",
    ];

    const formattedData = attendanceData.map((record) => ({
      "Matric No": record.matric_no_submitted,
      "Student Name": record.student_id?.name || "Unknown",
      Status: record.status.toUpperCase(),
      "Submitted At": new Date(record.submitted_at).toLocaleDateString(),
      Session:
        new Date(record.session_id?.start_ts).toLocaleDateString() || "N/A",
    }));

    return this.generatePDF(title, formattedData, {
      headers,
      courseInfo,
    });
  }

  static async generateSessionSummaryPDF(sessionData) {
    const title = "Session Summary Report";

    const headers = [
      "Session Code",
      "Date",
      "Total Students",
      "Present",
      "Absent",
      "Attendance Rate",
    ];

    const formattedData = sessionData.map((session) => ({
      "Session Code": session.session_code,
      Date: new Date(session.start_ts).toLocaleDateString(),
      "Total Students": session.total_students || 0,
      Present: session.present_count || 0,
      Absent: session.absent_count || 0,
      "Attendance Rate": session.attendance_rate
        ? `${session.attendance_rate}%`
        : "0%",
    }));

    return this.generatePDF(title, formattedData, { headers });
  }

  static async generateAdminAttendancePDF(attendanceData, options = {}) {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 50 });
        const buffers = [];

        doc.on("data", buffers.push.bind(buffers));
        doc.on("end", () => {
          const pdfData = Buffer.concat(buffers);
          resolve(pdfData);
        });

        // Header
        doc.fontSize(20).text("UniTrack - System-wide Attendance Report", {
          align: "center",
        });
        doc.moveDown();

        // Add generation info
        doc
          .fontSize(12)
          .text(`Generated by: ${options.adminName || "System Admin"}`, {
            align: "right",
          });
        doc.text(`Generated on: ${new Date().toLocaleString()}`, {
          align: "right",
        });
        doc.moveDown();

        // Add filters applied
        if (options.filters) {
          doc.fontSize(14).text("Filters Applied:", { underline: true });
          const filters = options.filters;
          if (filters.teacher_id) doc.text(`Teacher ID: ${filters.teacher_id}`);
          if (filters.course_id) doc.text(`Course ID: ${filters.course_id}`);
          if (filters.start_date) doc.text(`Start Date: ${filters.start_date}`);
          if (filters.end_date) doc.text(`End Date: ${filters.end_date}`);
          if (filters.status) doc.text(`Status: ${filters.status}`);
          doc.moveDown();
        }

        // Summary statistics
        const totalRecords = attendanceData.length;
        const presentCount = attendanceData.filter(
          (r) => r.status === "present"
        ).length;
        const absentCount = attendanceData.filter(
          (r) => r.status === "absent"
        ).length;
        const rejectedCount = attendanceData.filter(
          (r) => r.status === "rejected"
        ).length;
        const manualCount = attendanceData.filter(
          (r) => r.status === "manual_present"
        ).length;

        doc.fontSize(14).text("Summary Statistics:", { underline: true });
        doc.fontSize(12);
        doc.text(`Total Records: ${totalRecords}`);
        doc.text(
          `Present: ${presentCount} (${
            totalRecords > 0
              ? ((presentCount / totalRecords) * 100).toFixed(1)
              : 0
          }%)`
        );
        doc.text(
          `Absent: ${absentCount} (${
            totalRecords > 0
              ? ((absentCount / totalRecords) * 100).toFixed(1)
              : 0
          }%)`
        );
        doc.text(
          `Rejected: ${rejectedCount} (${
            totalRecords > 0
              ? ((rejectedCount / totalRecords) * 100).toFixed(1)
              : 0
          }%)`
        );
        doc.text(
          `Manual Present: ${manualCount} (${
            totalRecords > 0
              ? ((manualCount / totalRecords) * 100).toFixed(1)
              : 0
          }%)`
        );
        doc.moveDown();

        // Table headers for detailed data
        doc.fontSize(10);
        const headers = [
          "Teacher",
          "Course",
          "Session",
          "Student",
          "Matric No",
          "Status",
          "Time",
        ];
        const colWidth = (doc.page.width - 100) / headers.length;
        let y = doc.y;

        // Draw headers
        headers.forEach((header, index) => {
          doc.text(header, 50 + index * colWidth, y, {
            width: colWidth,
            align: "center",
          });
        });

        y += 20;
        doc
          .moveTo(50, y)
          .lineTo(doc.page.width - 50, y)
          .stroke();
        y += 10;

        // Add data rows (limited to prevent PDF from being too large)
        const maxRows = Math.min(attendanceData.length, 100);
        attendanceData.slice(0, maxRows).forEach((record, index) => {
          if (y > doc.page.height - 100) {
            doc.addPage();
            y = 50;
          }

          const rowData = [
            record.course_id?.teacher_id?.name || "Unknown",
            record.course_id?.course_code || "",
            record.session_id?.session_code || "",
            record.student_id?.name || "Unknown",
            record.matric_no_submitted,
            record.status,
            new Date(record.submitted_at).toLocaleDateString(),
          ];

          rowData.forEach((data, colIndex) => {
            doc.text(
              String(data).substring(0, 15),
              50 + colIndex * colWidth,
              y,
              {
                width: colWidth,
                align: "center",
              }
            );
          });

          y += 15;

          // Add separator line every 5 rows
          if ((index + 1) % 5 === 0) {
            doc
              .moveTo(50, y)
              .lineTo(doc.page.width - 50, y)
              .stroke();
            y += 5;
          }
        });

        if (attendanceData.length > maxRows) {
          doc.moveDown();
          doc
            .fontSize(10)
            .text(
              `Note: Showing first ${maxRows} of ${totalRecords} records. Download CSV for complete data.`,
              { align: "center" }
            );
        }

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  // Session-based CSV report generation
  static async generateSessionAttendanceCSV(attendanceData, sessionInfo) {
    const columns = [
      "Course Code",
      "Course Title",
      "Session Code",
      "Session Date",
      "Session Start Time",
      "Student Name",
      "Matric No",
      "Email",
      "Phone",
      "Status",
      "Submitted At",
      "Submission Time",
      "Latitude",
      "Longitude",
      "Accuracy (m)",
      "Reason",
    ];

    const sessionDate = sessionInfo.start_ts
      ? new Date(sessionInfo.start_ts).toLocaleDateString()
      : "Unknown";
    const sessionStartTime = sessionInfo.start_ts
      ? new Date(sessionInfo.start_ts).toLocaleTimeString()
      : "Unknown";

    const formattedData = attendanceData.map((record) => ({
      "Course Code":
        sessionInfo.course_code || record.course_id?.course_code || "",
      "Course Title": sessionInfo.course_title || record.course_id?.title || "",
      "Session Code":
        sessionInfo.session_code || record.session_id?.session_code || "",
      "Session Date": sessionDate,
      "Session Start Time": sessionStartTime,
      "Student Name": record.student_id?.name || "Unknown",
      "Matric No": record.matric_no_submitted,
      Email: record.student_id?.email || "",
      Phone: record.student_id?.phone || "",
      Status: record.status,
      "Submitted At": new Date(record.submitted_at).toLocaleDateString(),
      "Submission Time": new Date(record.submitted_at).toLocaleTimeString(),
      Latitude: record.lat || "",
      Longitude: record.lng || "",
      "Accuracy (m)": record.accuracy || "N/A",
      Reason:
        record.status === "manual_present"
          ? "Marked present by lecturer"
          : record.status === "present"
          ? "Submitted online"
          : record.reason || "",
    }));

    return this.generateCSV(formattedData, columns);
  }

  // Session-based PDF report generation
  static async generateSessionAttendancePDF(
    attendanceData,
    sessionInfo,
    teacherInfo
  ) {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 40 });
        const buffers = [];

        doc.on("data", buffers.push.bind(buffers));
        doc.on("end", () => {
          const pdfBuffer = Buffer.concat(buffers);
          resolve(pdfBuffer);
        });

        // Header
        doc
          .fontSize(20)
          .fillColor("#2c3e50")
          .text("SESSION ATTENDANCE REPORT", { align: "center" });
        doc.moveDown(0.5);

        // Session Information Box
        doc.rect(40, doc.y, 515, 120).fillAndStroke("#f8f9fa", "#dee2e6");
        doc.fillColor("#2c3e50");

        const sessionY = doc.y + 10;
        doc
          .fontSize(12)
          .text("SESSION DETAILS", 50, sessionY, { underline: true });

        const sessionDate = sessionInfo.start_ts
          ? new Date(sessionInfo.start_ts).toLocaleDateString()
          : "Unknown";
        const sessionTime = sessionInfo.start_ts
          ? new Date(sessionInfo.start_ts).toLocaleTimeString()
          : "Unknown";

        doc
          .fontSize(10)
          .text(
            `Course: ${sessionInfo.course_title || "Unknown"} (${
              sessionInfo.course_code || "N/A"
            })`,
            50,
            sessionY + 25
          )
          .text(
            `Session Code: ${sessionInfo.session_code || "N/A"}`,
            50,
            sessionY + 40
          )
          .text(`Date: ${sessionDate}`, 50, sessionY + 55)
          .text(`Start Time: ${sessionTime}`, 50, sessionY + 70)
          .text(
            `Teacher: ${teacherInfo?.name || "Unknown"}`,
            300,
            sessionY + 25
          )
          .text(`Email: ${teacherInfo?.email || "N/A"}`, 300, sessionY + 40)
          .text(`Total Students: ${attendanceData.length}`, 300, sessionY + 55)
          .text(
            `Report Generated: ${new Date().toLocaleString()}`,
            300,
            sessionY + 70
          );

        doc.y += 140;

        // Attendance Statistics
        const stats = {
          present: attendanceData.filter((r) => r.status === "present").length,
          manual_present: attendanceData.filter(
            (r) => r.status === "manual_present"
          ).length,
          absent: attendanceData.filter((r) => r.status === "absent").length,
          rejected: attendanceData.filter((r) => r.status === "rejected")
            .length,
        };

        doc
          .fontSize(14)
          .fillColor("#2c3e50")
          .text("ATTENDANCE STATISTICS", { underline: true });
        doc.moveDown(0.3);

        const statY = doc.y;
        doc
          .fontSize(10)
          .fillColor("#27ae60")
          .text(`Present: ${stats.present}`, 50, statY)
          .fillColor("#f39c12")
          .text(`Manual Present: ${stats.manual_present}`, 150, statY)
          .fillColor("#e74c3c")
          .text(`Absent: ${stats.absent}`, 280, statY)
          .fillColor("#8e44ad")
          .text(`Rejected: ${stats.rejected}`, 350, statY);

        doc.moveDown(1);

        // Attendance Table
        doc
          .fillColor("#2c3e50")
          .fontSize(12)
          .text("STUDENT ATTENDANCE DETAILS", { underline: true });
        doc.moveDown(0.5);

        // Table headers
        const tableTop = doc.y;
        const itemCodeX = 50;
        const itemNameX = 120;
        const itemMatricX = 220;
        const itemStatusX = 320;
        const itemTimeX = 380;
        const itemReasonX = 450;

        doc.fontSize(9).fillColor("#2c3e50");
        doc
          .text("S/N", itemCodeX, tableTop, { width: 30, align: "center" })
          .text("Student Name", itemNameX, tableTop, { width: 90 })
          .text("Matric No", itemMatricX, tableTop, { width: 90 })
          .text("Status", itemStatusX, tableTop, { width: 50 })
          .text("Time", itemTimeX, tableTop, { width: 60 })
          .text("Reason", itemReasonX, tableTop, { width: 100 });

        // Table line
        doc
          .moveTo(40, tableTop + 15)
          .lineTo(555, tableTop + 15)
          .stroke();

        // Table rows
        let currentY = tableTop + 25;
        attendanceData.forEach((record, index) => {
          if (currentY > 700) {
            doc.addPage();
            currentY = 50;
          }

          const statusColor =
            {
              present: "#27ae60",
              manual_present: "#f39c12",
              absent: "#e74c3c",
              rejected: "#8e44ad",
            }[record.status] || "#2c3e50";

          const submissionTime = new Date(
            record.submitted_at
          ).toLocaleTimeString();

          doc
            .fontSize(8)
            .fillColor("#2c3e50")
            .text(index + 1, itemCodeX, currentY, {
              width: 30,
              align: "center",
            })
            .text(record.student_id?.name || "Unknown", itemNameX, currentY, {
              width: 90,
            })
            .text(record.matric_no_submitted || "N/A", itemMatricX, currentY, {
              width: 90,
            })
            .fillColor(statusColor)
            .text(record.status.toUpperCase(), itemStatusX, currentY, {
              width: 50,
            })
            .fillColor("#2c3e50")
            .text(submissionTime, itemTimeX, currentY, { width: 60 })
            .text(
              record.status === "manual_present"
                ? "Marked present by lecturer"
                : record.status === "present"
                ? "Submitted online"
                : record.reason || "",
              itemReasonX,
              currentY,
              { width: 100 }
            );

          currentY += 20;
        });

        // Footer
        doc
          .fontSize(8)
          .fillColor("#7f8c8d")
          .text(
            "Generated by InClass Attendance System",
            40,
            doc.page.height - 40,
            {
              align: "center",
              width: doc.page.width - 80,
            }
          );

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  // Enhanced admin reports with session grouping
  static async generateEnhancedAdminAttendanceCSV(attendanceData) {
    const columns = [
      "Date",
      "Session Code",
      "Course Code",
      "Course Title",
      "Teacher Name",
      "Teacher Email",
      "Total Students",
      "Present Count",
      "Manual Present Count",
      "Absent Count",
      "Rejected Count",
      "Attendance Rate %",
      "Session Start Time",
      "Student Name",
      "Matric No",
      "Status",
      "Submission Time",
      "Latitude",
      "Longitude",
      "Accuracy (m)",
      "Reason",
    ];

    // Group by session for better organization
    const sessionGroups = {};
    attendanceData.forEach((record) => {
      const sessionId = record.session_id?._id?.toString() || "unknown";
      if (!sessionGroups[sessionId]) {
        sessionGroups[sessionId] = [];
      }
      sessionGroups[sessionId].push(record);
    });

    const formattedData = [];

    Object.entries(sessionGroups).forEach(([sessionId, records]) => {
      const firstRecord = records[0];
      const stats = {
        total: records.length,
        present: records.filter((r) => r.status === "present").length,
        manual_present: records.filter((r) => r.status === "manual_present")
          .length,
        absent: records.filter((r) => r.status === "absent").length,
        rejected: records.filter((r) => r.status === "rejected").length,
      };

      const attendanceRate = (
        ((stats.present + stats.manual_present) / stats.total) *
        100
      ).toFixed(1);
      const sessionDate = firstRecord.session_id?.start_ts
        ? new Date(firstRecord.session_id.start_ts).toLocaleDateString()
        : "Unknown";
      const sessionStartTime = firstRecord.session_id?.start_ts
        ? new Date(firstRecord.session_id.start_ts).toLocaleTimeString()
        : "Unknown";

      records.forEach((record, index) => {
        formattedData.push({
          Date: index === 0 ? sessionDate : "", // Show date only on first row of session
          "Session Code":
            index === 0 ? firstRecord.session_id?.session_code || "N/A" : "",
          "Course Code":
            index === 0 ? firstRecord.course_id?.course_code || "" : "",
          "Course Title": index === 0 ? firstRecord.course_id?.title || "" : "",
          "Teacher Name":
            index === 0
              ? firstRecord.course_id?.teacher_id?.name || "Unknown"
              : "",
          "Teacher Email":
            index === 0
              ? firstRecord.course_id?.teacher_id?.email || "Unknown"
              : "",
          "Total Students": index === 0 ? stats.total : "",
          "Present Count": index === 0 ? stats.present : "",
          "Manual Present Count": index === 0 ? stats.manual_present : "",
          "Absent Count": index === 0 ? stats.absent : "",
          "Rejected Count": index === 0 ? stats.rejected : "",
          "Attendance Rate %": index === 0 ? attendanceRate : "",
          "Session Start Time": index === 0 ? sessionStartTime : "",
          "Student Name": record.student_id?.name || "Unknown",
          "Matric No": record.matric_no_submitted,
          Status: record.status,
          "Submission Time": new Date(record.submitted_at).toLocaleString(),
          Latitude: record.lat || "",
          Longitude: record.lng || "",
          "Accuracy (m)": record.accuracy || "N/A",
          Reason:
            record.status === "manual_present"
              ? "Marked present by lecturer"
              : record.status === "present"
              ? "Submitted online"
              : record.reason || "",
        });
      });

      // Add separator row between sessions
      formattedData.push({
        Date: "---",
        "Session Code": "---",
        "Course Code": "---",
        "Course Title": "---",
        "Teacher Name": "---",
        "Teacher Email": "---",
        "Total Students": "---",
        "Present Count": "---",
        "Manual Present Count": "---",
        "Absent Count": "---",
        "Rejected Count": "---",
        "Attendance Rate %": "---",
        "Session Start Time": "---",
        "Student Name": "---",
        "Matric No": "---",
        Status: "---",
        "Submission Time": "---",
        Latitude: "---",
        Longitude: "---",
        "Accuracy (m)": "---",
      });
    });

    return this.generateCSV(formattedData, columns);
  }
}

module.exports = ReportGenerator;
