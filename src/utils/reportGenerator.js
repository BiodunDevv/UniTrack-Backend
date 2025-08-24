const csv = require("fast-csv");
const PDFDocument = require("pdfkit");

class ReportGenerator {
  static async generateCSV(data, columns) {
    return new Promise((resolve, reject) => {
      const csvData = [];

      csv.writeToString(
        data,
        {
          headers: columns,
          writeHeaders: true,
        },
        (err, csvString) => {
          if (err) {
            reject(err);
          } else {
            resolve(Buffer.from(csvString));
          }
        }
      );
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
      "Distance (m)",
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
      "Distance (m)": record.distance || "N/A",
      Reason: record.reason || "",
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
      "Location (Lat, Lng)",
      "Accuracy (m)",
      "Reason",
      "Receipt Signature",
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
      "Location (Lat, Lng)": `${record.lat}, ${record.lng}`,
      "Accuracy (m)": record.accuracy || "N/A",
      Reason: record.reason || "",
      "Receipt Signature": record.receipt_signature || "",
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
        doc
          .fontSize(20)
          .text("UniTrack - System-wide Attendance Report", {
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
}

module.exports = ReportGenerator;
