j# UniTrack Attendance System API Documentation

## Authentication

All protected endpoints require a JWT token in the Authorization header:

```
Authorization: Bearer <your-jwt-token>
```

## Base URL

```
http://localhost:5000/api
```

## Error Responses

All endpoints return errors in this format:

```json
{
  "error": "Error message",
  "details": ["Detailed error information"],
  "timestamp": "2025-08-24T10:30:00.000Z"
}
```

## Status Codes

- `200` - Success
- `201` - Created
- `400` - Bad Request
- `401` - Unauthorized
- `403` - Forbidden
- `404` - Not Found
- `409` - Conflict
- `429` - Too Many Requests
- `500` - Internal Server Error

---

## Authentication Endpoints

### Register Teacher

```http
POST /auth/register_teacher
```

**Request Body:**

```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "password": "password123",
  "role": "teacher"
}
```

**Response:**

```json
{
  "message": "OTP sent to your email. Please verify to complete registration.",
  "registrationToken": "jwt-token-for-verification"
}
```

### Verify Registration

```http
POST /auth/verify_registration
```

**Request Body:**

```json
{
  "registrationToken": "jwt-token-from-registration",
  "otp": "123456"
}
```

**Response:**

```json
{
  "message": "Registration completed successfully",
  "token": "jwt-access-token",
  "teacher": {
    "_id": "teacher-id",
    "name": "John Doe",
    "email": "john@example.com",
    "role": "teacher"
  }
}
```

### Login

```http
POST /auth/login
```

**Request Body:**

```json
{
  "email": "john@example.com",
  "password": "password123"
}
```

**Response:**

```json
{
  "message": "Login successful",
  "token": "jwt-access-token",
  "teacher": {
    "_id": "teacher-id",
    "name": "John Doe",
    "email": "john@example.com",
    "role": "teacher"
  }
}
```

---

## Course Endpoints

### Create Course

```http
POST /courses
Authorization: Bearer <token>
```

**Request Body:**

```json
{
  "course_code": "CS101",
  "title": "Introduction to Computer Science"
}
```

**Response:**

```json
{
  "message": "Course created successfully",
  "course": {
    "_id": "course-id",
    "course_code": "CS101",
    "title": "Introduction to Computer Science",
    "teacher_id": "teacher-id",
    "created_at": "2025-08-24T10:30:00.000Z"
  }
}
```

### Get Courses

```http
GET /courses?page=1&limit=10&level=200&search=programming
Authorization: Bearer <token>
```

**Query Parameters:**

- `page` (optional): Page number for pagination (default: 1)
- `limit` (optional): Number of courses per page (default: 10)
- `level` (optional): Filter by course level (100, 200, 300, 400, 500, 600)
- `search` (optional): Search in course code and title

**Response:**

```json
{
  "courses": [
    {
      "_id": "68af21f71f08059b303b82c1",
      "teacher_id": {
        "_id": "68ae283386f3b217bd3f5181",
        "name": "Jane Smith",
        "email": "muhammedabiodun42@gmail.com"
      },
      "course_code": "CS 103",
      "title": "Data Structures",
      "level": 500,
      "created_at": "2025-08-27T15:19:19.539Z",
      "createdAt": "2025-08-27T15:19:19.539Z",
      "updatedAt": "2025-08-28T11:12:22.879Z",
      "__v": 0,
      "student_count": 25,
      "active_sessions_count": 1,
      "has_active_session": true,
      "active_sessions": [
        {
          "_id": "68b16f6a642ca2dc809e9cee",
          "session_code": "8665",
          "start_ts": "2025-08-29T09:14:18.667Z",
          "expiry_ts": "2025-08-29T10:14:18.667Z"
        }
      ]
    }
  ],
  "pagination": {
    "currentPage": 1,
    "totalPages": 2,
    "totalCourses": 11,
    "hasNext": true,
    "hasPrev": false
  }
}
```

**New Fields Added:**

- `student_count`: Number of students enrolled in the course
- `active_sessions_count`: Number of currently active sessions for this course
- `has_active_session`: Boolean indicating if the course has any active sessions
- `active_sessions`: Array of active session objects with basic information

---

## Student Management Endpoints

### Add Student to Course

```http
POST /courses/:courseId/students
Authorization: Bearer <token>
```

**Request Body:**

```json
{
  "matric_no": "ABC/2021/12345",
  "name": "Jane Smith",
  "email": "jane@student.edu",
  "phone": "1234567890"
}
```

**Response:**

```json
{
  "message": "Student added to course successfully",
  "enrollment": {
    "_id": "enrollment-id",
    "course_id": "course-id",
    "student_id": {
      "matric_no": "ABC/2021/12345",
      "name": "Jane Smith",
      "email": "jane@student.edu"
    },
    "added_at": "2025-08-24T10:30:00.000Z"
  }
}
```

### Get Course Students

```http
GET /courses/:courseId/students?page=1&limit=20
Authorization: Bearer <token>
```

**Response:**

```json
{
  "course": {
    "_id": "course-id",
    "course_code": "CS101",
    "title": "Introduction to Computer Science"
  },
  "students": [
    {
      "_id": "enrollment-id",
      "student_id": {
        "matric_no": "ABC/2021/12345",
        "name": "Jane Smith",
        "email": "jane@student.edu"
      },
      "added_at": "2025-08-24T10:30:00.000Z"
    }
  ],
  "pagination": {
    "currentPage": 1,
    "totalPages": 1,
    "totalStudents": 1
  }
}
```

---

## Session Management Endpoints

### Start Attendance Session

```http
POST /courses/:courseId/sessions
Authorization: Bearer <token>
```

**Request Body:**

```json
{
  "lat": 6.5244,
  "lng": 3.3792,
  "radius_m": 100,
  "duration_minutes": 60
}
```

**Response:**

```json
{
  "message": "Attendance session started successfully",
  "session": {
    "id": "session-id",
    "session_code": "1234",
    "course": {
      "course_code": "CS101",
      "title": "Introduction to Computer Science"
    },
    "start_time": "2025-08-24T10:30:00.000Z",
    "expiry_time": "2025-08-24T11:30:00.000Z",
    "location": {
      "lat": 6.5244,
      "lng": 3.3792
    },
    "radius_meters": 100
  }
}
```

### Get Course Sessions

```http
GET /courses/:courseId/sessions?status=active&page=1&limit=20
Authorization: Bearer <token>
```

**Query Parameters:**

- `status`: `active`, `expired`, `all`
- `page`: Page number (default: 1)
- `limit`: Items per page (default: 20)

**Response:**

```json
{
  "course": {
    "_id": "course-id",
    "course_code": "CS101",
    "title": "Introduction to Computer Science"
  },
  "sessions": [
    {
      "_id": "session-id",
      "session_code": "1234",
      "start_ts": "2025-08-24T10:30:00.000Z",
      "expiry_ts": "2025-08-24T11:30:00.000Z",
      "attendance_stats": {
        "total_submissions": 15,
        "present_count": 14,
        "is_expired": false
      }
    }
  ]
}
```

---

## Attendance Endpoints

### Submit Attendance (Public)

```http
POST /attendance/submit
```

**Request Body:**

```json
{
  "matric_no": "ABC/2021/12345",
  "session_code": "1234",
  "lat": 6.5244,
  "lng": 3.3792,
  "accuracy": 10,
  "device_info": {
    "platform": "Android",
    "browser": "Chrome"
  }
}
```

**Success Response:**

```json
{
  "success": true,
  "message": "Attendance submitted successfully",
  "record": {
    "student_name": "Jane Smith",
    "matric_no": "ABC/2021/12345",
    "course": "Introduction to Computer Science",
    "session_code": "1234",
    "status": "present",
    "submitted_at": "2025-08-24T10:45:00.000Z",
    "receipt": "cryptographic-signature"
  }
}
```

**Error Response (Location Out of Range):**

```json
{
  "success": false,
  "message": "Attendance submission failed",
  "error": "Location out of range",
  "record": {
    "student_name": "Jane Smith",
    "matric_no": "ABC/2021/12345",
    "status": "rejected",
    "reason": "Location out of range"
  }
}
```

### Get Session Attendance

```http
GET /attendance/session/:sessionId?status=present&page=1&limit=50
Authorization: Bearer <token>
```

**Response:**

```json
{
  "session": {
    "_id": "session-id",
    "session_code": "1234",
    "course_id": {
      "course_code": "CS101",
      "title": "Introduction to Computer Science"
    }
  },
  "attendance": [
    {
      "_id": "attendance-id",
      "student_id": {
        "matric_no": "ABC/2021/12345",
        "name": "Jane Smith"
      },
      "status": "present",
      "submitted_at": "2025-08-24T10:45:00.000Z",
      "lat": 6.5244,
      "lng": 3.3792
    }
  ]
}
```

### Download Comprehensive Course Report (CSV)

```http
GET /attendance/course/:courseId/report.csv?email=true
Authorization: Bearer <token>
```

**Query Parameters:**

- `email`: Set to `true` to send via email instead of download

**Response (Direct Download):**
Returns comprehensive CSV report with the following sections:
- Course Information
- Summary Statistics
- Risk Analysis
- Students Below 75% Attendance
- Session Overview
- All Students Attendance Summary

**Response (Email):**

```json
{
  "message": "Comprehensive attendance report has been sent to your email"
}
```

### Download Comprehensive Course Report (PDF)

```http
GET /attendance/course/:courseId/report.pdf?email=true
Authorization: Bearer <token>
```

**Query Parameters:**

- `email`: Set to `true` to send via email instead of download

**Features:**
- Complete course attendance analysis
- Risk assessment for students below 75% attendance
- Session-by-session breakdown
- Visual charts and statistics
- Professional formatting

**Response (Direct Download):**
Returns PDF file

**Response (Email):**

```json
{
  "message": "Comprehensive attendance report has been sent to your email"
}
```

---

## Admin Endpoints

### Get System Statistics

```http
GET /admin/stats
Authorization: Bearer <admin-token>
```

### Admin Course Reports

#### Download Comprehensive Course Report (CSV) - Admin

```http
GET /admin/course/:courseId/report.csv?email=true
Authorization: Bearer <admin-token>
```

#### Download Comprehensive Course Report (PDF) - Admin

```http
GET /admin/course/:courseId/report.pdf?email=true
Authorization: Bearer <admin-token>
```

Both admin endpoints provide the same comprehensive reporting functionality as teacher endpoints but with admin-level access to any course.

**Response:**

```json
{
  "system_stats": {
    "total_teachers": 25,
    "total_students": 1250,
    "total_courses": 75,
    "total_sessions": 300,
    "total_attendance_records": 15000,
    "active_sessions": 5
  },
  "trends": {
    "new_teachers_30d": 3,
    "attendance_submissions_30d": 2500
  },
  "recent_activity": [
    {
      "actor_id": {
        "name": "John Doe",
        "email": "john@example.com"
      },
      "action": "session_started",
      "created_at": "2025-08-24T10:30:00.000Z"
    }
  ]
}
```

### Create Teacher Account

```http
POST /admin/teachers
Authorization: Bearer <admin-token>
```

**Request Body:**

```json
{
  "name": "New Teacher",
  "email": "teacher@example.com",
  "role": "teacher",
  "sendWelcomeEmail": true
}
```

**Response:**

```json
{
  "message": "Teacher created successfully",
  "teacher": {
    "_id": "teacher-id",
    "name": "New Teacher",
    "email": "teacher@example.com",
    "role": "teacher"
  },
  "temporary_password": "generated-password"
}
```

---

## Real-time Endpoints

### Live Session Monitoring

```http
GET /sessions/:sessionId/live
Authorization: Bearer <token>
```

**Response:**

```json
{
  "session_info": {
    "session_code": "1234",
    "is_active": true,
    "expires_at": "2025-08-24T11:30:00.000Z"
  },
  "recent_submissions": [
    {
      "_id": "attendance-id",
      "student_id": {
        "matric_no": "ABC/2021/12345",
        "name": "Jane Smith"
      },
      "submitted_at": "2025-08-24T10:45:00.000Z"
    }
  ],
  "live_stats": {
    "total_submissions": 15,
    "present_count": 14,
    "last_updated": "2025-08-24T10:45:30.000Z"
  }
}
```

---

## Rate Limiting

Different endpoints have different rate limits:

- **General API**: 100 requests per 15 minutes
- **Authentication**: 5 requests per 15 minutes
- **OTP requests**: 1 request per minute
- **Attendance submission**: 3 requests per minute

Rate limit headers are included in responses:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 99
X-RateLimit-Reset: 1629800000
```

---

## Pagination

Most list endpoints support pagination with these query parameters:

- `page`: Page number (default: 1)
- `limit`: Items per page (default varies by endpoint)

Pagination response format:

```json
{
  "pagination": {
    "currentPage": 1,
    "totalPages": 5,
    "totalItems": 100,
    "hasNext": true,
    "hasPrev": false
  }
}
```

---

## Filtering and Search

Many endpoints support filtering:

- **Teachers**: `?search=john` (searches name and email)
- **Sessions**: `?status=active` (active, expired, all)
- **Attendance**: `?status=present` (present, absent, rejected, manual_present)
- **Reports**: `?startDate=2025-08-01&endDate=2025-08-31`

---

## Webhooks and Events

The system logs all significant events to the audit log. Admin users can retrieve these via:

```http
GET /admin/audit-logs?action=session_started&teacher_id=teacher-id
Authorization: Bearer <admin-token>
```

Event types include:

- `teacher_registration`
- `teacher_login`
- `course_created`
- `session_started`
- `attendance_submitted`
- `manual_attendance_marked`
- `report_downloaded`

---

## Error Handling

The API uses standard HTTP status codes and returns detailed error information:

```json
{
  "error": "Validation failed",
  "details": [
    {
      "field": "email",
      "message": "Valid email required"
    }
  ],
  "timestamp": "2025-08-24T10:30:00.000Z"
}
```

Common error scenarios:

- **400**: Invalid input data
- **401**: Missing or invalid authentication token
- **403**: Insufficient permissions
- **404**: Resource not found
- **409**: Duplicate data (email, course code, etc.)
- **429**: Rate limit exceeded
- **500**: Server error

---

## Support & Help System

The Support system allows users to contact administrators for help with technical issues, attendance problems, account management, and general inquiries.

### Submit Support Request

```http
POST /support/contact
```

Submit a new support request that will be sent to all active administrators.

**Rate Limit:** 2 requests per 5 minutes

**Request Body:**

```json
{
  "name": "John Doe",
  "email": "john.doe@example.com",
  "user_type": "student", // "student", "teacher", "admin", "other"
  "subject": "Unable to submit attendance",
  "category": "attendance", // "technical", "attendance", "account", "general", "urgent"
  "priority": "medium", // "low", "medium", "high", "urgent"
  "message": "Detailed description of the issue (20-2000 characters)",

  // Optional fields
  "phone": "+2348123456789",
  "matric_no": "CS/2021/001", // For students
  "course_info": {
    "course_code": "CS301",
    "session_id": "12345"
  },
  "error_details": {
    "error_code": "500",
    "error_message": "Internal Server Error",
    "timestamp": "2025-08-29T07:30:00Z"
  },
  "browser_info": {
    "browser": "Chrome",
    "version": "91.0.4472.124",
    "os": "Windows 10"
  }
}
```

**Response:**

```json
{
  "success": true,
  "message": "Support request submitted successfully",
  "ticketId": "TK175645301628642VM",
  "data": {
    "ticket_id": "TK175645301628642VM",
    "subject": "Unable to submit attendance",
    "category": "attendance",
    "priority": "medium",
    "submitted_at": "2025-08-29T07:36:56.284Z",
    "admins_notified": 2,
    "expected_response": "within 1-2 business days"
  }
}
```

### Get Support Information

```http
GET /support/info
```

Get information about support categories, priorities, guidelines, and contact tips.

**Response:**

```json
{
  "success": true,
  "data": {
    "categories": {
      "technical": "Technical Issues (Login problems, app crashes, etc.)",
      "attendance": "Attendance Related (Session issues, missing records, etc.)",
      "account": "Account Management (Profile updates, password issues, etc.)",
      "general": "General Inquiry (Questions, suggestions, feedback)",
      "urgent": "Urgent Issues (System down, critical problems)"
    },
    "priorities": {
      "low": "Non-urgent issues that can wait",
      "medium": "Issues affecting normal operation",
      "high": "Important issues requiring prompt attention",
      "urgent": "Critical issues requiring immediate attention"
    },
    "guidelines": [
      "Provide as much detail as possible about your issue",
      "Include relevant course or session information",
      "For technical issues, include browser and device information",
      "Use appropriate priority levels - reserve 'urgent' for critical system issues",
      "Check the FAQ section before submitting a request"
    ],
    "contact_tips": [
      "Be specific in your subject line",
      "Include error messages exactly as they appear",
      "Mention the steps you took before the issue occurred",
      "Include your user type (student/teacher) and relevant course information"
    ]
  }
}
```

### Get FAQ

```http
GET /support/faq
```

Get frequently asked questions organized by category.

**Response:**

```json
{
  "success": true,
  "data": {
    "categories": [
      {
        "category": "Authentication",
        "questions": [
          {
            "question": "I forgot my password, how can I reset it?",
            "answer": "Use the 'Forgot Password' link on the login page to reset your password via email verification."
          },
          {
            "question": "Why am I getting 'Invalid credentials' error?",
            "answer": "Please check your email and password. Ensure caps lock is off and try again. If the problem persists, contact support."
          }
        ]
      },
      {
        "category": "Attendance",
        "questions": [
          {
            "question": "Why can't I submit attendance?",
            "answer": "Ensure you're within the allowed location radius and the session is active. Check your internet connection and try again."
          },
          {
            "question": "My attendance was not recorded, what should I do?",
            "answer": "Contact your teacher immediately or submit a support request with your session details."
          }
        ]
      },
      {
        "category": "Technical",
        "questions": [
          {
            "question": "The app is not loading properly, what should I do?",
            "answer": "Try refreshing the page, clearing your browser cache, or using a different browser. If the issue persists, contact support."
          },
          {
            "question": "I'm getting location permission errors",
            "answer": "Please allow location access in your browser settings and ensure GPS is enabled on your device."
          }
        ]
      }
    ],
    "general_tips": [
      "Clear your browser cache if you're experiencing loading issues",
      "Ensure you have a stable internet connection",
      "Allow location access for attendance submission",
      "Use the latest version of your browser",
      "Contact support if your issue isn't covered in the FAQ"
    ]
  }
}
```

### Support System Health Check

```http
GET /support/health
```

Check if the support system is operational.

**Response:**

```json
{
  "success": true,
  "message": "Support system is operational",
  "timestamp": "2025-08-29T07:35:55.165Z",
  "available_endpoints": [
    "POST /contact - Submit support request",
    "GET /info - Get support information and guidelines",
    "GET /faq - Get frequently asked questions",
    "GET /health - Check support system status"
  ]
}
```

### Support Categories

- **technical**: Technical Issues (Login problems, app crashes, etc.)
- **attendance**: Attendance Related (Session issues, missing records, etc.)
- **account**: Account Management (Profile updates, password issues, etc.)
- **general**: General Inquiry (Questions, suggestions, feedback)
- **urgent**: Urgent Issues (System down, critical problems)

### Priority Levels & Response Times

- **urgent**: Critical issues requiring immediate attention (within 4-6 hours)
- **high**: Important issues requiring prompt attention (within 24 hours)
- **medium**: Issues affecting normal operation (within 1-2 business days)
- **low**: Non-urgent issues that can wait (within 2-3 business days)

### Email Notifications

When a support request is submitted:

1. **Admin Notification**: All active and verified administrators receive a detailed email with:

   - Priority-coded visual styling
   - Complete user information
   - Technical details (browser info, error details, etc.)
   - Direct reply-to functionality
   - Ticket tracking information

2. **User Confirmation**: The requester receives a confirmation email with:
   - Unique ticket number for tracking
   - Expected response timeframe
   - Timeline of what happens next
   - Instructions for follow-up

### Rate Limiting

- **Support Requests**: Maximum 2 requests per 5 minutes per IP address
- This prevents spam while allowing legitimate urgent requests

### Validation Rules

- **Name**: 2-100 characters, required
- **Email**: Valid email format, required
- **Subject**: 5-200 characters, required
- **Message**: 20-2000 characters, required
- **Phone**: 10-15 characters, optional
- **User Type**: Must be one of: student, teacher, admin, other
- **Category**: Must be one of the defined categories
- **Priority**: Must be one of: low, medium, high, urgent
