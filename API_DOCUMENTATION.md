# UniTrack Attendance System API Documentation

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
GET /courses?page=1&limit=10
Authorization: Bearer <token>
```

**Response:**

```json
{
  "courses": [
    {
      "_id": "course-id",
      "course_code": "CS101",
      "title": "Introduction to Computer Science",
      "teacher_id": {
        "name": "John Doe",
        "email": "john@example.com"
      },
      "created_at": "2025-08-24T10:30:00.000Z"
    }
  ],
  "pagination": {
    "currentPage": 1,
    "totalPages": 1,
    "totalCourses": 1,
    "hasNext": false,
    "hasPrev": false
  }
}
```

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

### Download CSV Report

```http
GET /attendance/course/:courseId/report.csv?startDate=2025-08-01&endDate=2025-08-31&email=true
Authorization: Bearer <token>
```

**Query Parameters:**

- `startDate`: Filter from date (ISO format)
- `endDate`: Filter to date (ISO format)
- `email`: Set to `true` to send via email instead of download

**Response (Direct Download):**
Returns CSV file with headers:

```
Session ID,Course Code,Course Title,Student Name,Matric No,Status,Submitted At,Location (Lat, Lng),Distance (m),Reason
```

**Response (Email):**

```json
{
  "message": "Attendance report has been sent to your email"
}
```

---

## Admin Endpoints

### Get System Statistics

```http
GET /admin/stats
Authorization: Bearer <admin-token>
```

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
