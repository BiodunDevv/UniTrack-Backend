# UniTrack Attendance System Backend

A comprehensive backend system for managing classroom attendance with geolocation verification, real-time monitoring, and automated reporting.

## Features

### 🔐 Authentication & Authorization

- JWT-based authentication for teachers and admins
- Email-based OTP verification for registration and password reset
- Role-based access control (Teacher/Admin)
- Secure password hashing with bcrypt

### 🎓 Course Management

- Create, update, and delete courses
- Add/remove students to courses
- Bulk student management operations

### 📍 Location-Based Attendance

- Geolocation verification with configurable radius
- Device fingerprinting to prevent duplicate submissions
- QR code and session code based attendance submission
- Real-time attendance monitoring

### 📊 Reporting & Analytics

- CSV and PDF attendance reports
- Email delivery of reports
- Attendance statistics and trends
- Admin dashboard with system analytics

### 📧 Email System

- Automated email notifications
- OTP delivery for verification
- Session start notifications
- Attendance report delivery
- Customizable email templates

### 🔍 Audit & Security

- Comprehensive audit logging
- Rate limiting for sensitive endpoints
- Input validation and sanitization
- Security headers with Helmet.js

## Installation

1. **Clone the repository**

   ```bash
   git clone <repository-url>
   cd UniTrack\ Backend
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Environment Setup**

   ```bash
   cp .env.example .env
   ```

   Configure the following environment variables:

   ```env
   NODE_ENV=development
   PORT=5000
   MONGODB_URI=mongodb://localhost:27017/UniTrack_attendance
   JWT_SECRET=your-super-secret-jwt-key
   EMAIL_HOST=smtp.gmail.com
   EMAIL_PORT=587
   EMAIL_USER=your-email@gmail.com
   EMAIL_PASS=your-app-password
   EMAIL_FROM=UniTrack Attendance <noreply@UniTrack.edu>
   ```

4. **Start MongoDB**

   ```bash
   # If using local MongoDB
   mongod

   # Or start MongoDB service
   sudo systemctl start mongodb
   ```

5. **Run the application**

   ```bash
   # Development mode
   npm run dev

   # Production mode
   npm start
   ```

## API Endpoints

### Authentication

- `POST /api/auth/register_teacher` - Register new teacher
- `POST /api/auth/verify_registration` - Complete registration with OTP
- `POST /api/auth/login` - Teacher login
- `POST /api/auth/request_otp` - Request OTP for password reset
- `POST /api/auth/verify_otp` - Verify OTP and reset password

### Courses

- `GET /api/courses` - Get teacher's courses
- `POST /api/courses` - Create new course
- `PATCH /api/courses/:id` - Update course
- `DELETE /api/courses/:id` - Delete course

### Students

- `POST /api/courses/:courseId/students` - Add student to course
- `GET /api/courses/:courseId/students` - Get course students
- `DELETE /api/courses/:courseId/students/:id` - Remove student
- `PATCH /api/courses/:courseId/students/:id/mark` - Manual attendance

### Sessions

- `POST /api/courses/:courseId/sessions` - Start attendance session
- `GET /api/courses/:courseId/sessions` - Get course sessions
- `GET /api/sessions/:id` - Get session details
- `PATCH /api/sessions/:id/end` - End session early
- `GET /api/sessions/:id/live` - Real-time attendance monitoring

### Attendance

- `POST /api/attendance/submit` - Submit attendance (public)
- `GET /api/attendance/session/:sessionId` - Get session attendance
- `GET /api/attendance/course/:courseId/report.csv` - Download CSV report
- `GET /api/attendance/course/:courseId/report.pdf` - Download PDF report
- `GET /api/attendance/course/:courseId/stats` - Course statistics

### Admin (Admin Role Required)

- `GET /api/admin/stats` - System statistics
- `GET /api/admin/teachers` - Get all teachers
- `POST /api/admin/teachers` - Create teacher account
- `PATCH /api/admin/teachers/:id` - Update teacher
- `DELETE /api/admin/teachers/:id` - Delete teacher
- `GET /api/admin/audit-logs` - System audit logs
- `GET /api/admin/health` - System health check

## Database Schema

### Teachers

- `id` (ObjectId) - Primary key
- `name` (String) - Teacher's full name
- `email` (String, unique) - Email address
- `password_hash` (String) - Hashed password
- `role` (String) - 'teacher' or 'admin'
- `created_at` (Date) - Registration date
- `last_login` (Date) - Last login timestamp

### Courses

- `id` (ObjectId) - Primary key
- `teacher_id` (ObjectId) - Reference to teacher
- `course_code` (String) - Course identifier
- `title` (String) - Course title
- `created_at` (Date) - Creation date

### Students

- `id` (ObjectId) - Primary key
- `matric_no` (String, unique) - Matriculation number
- `name` (String) - Student's full name
- `email` (String) - Email address
- `phone` (String) - Phone number
- `created_at` (Date) - Registration date

### Sessions

- `id` (ObjectId) - Primary key
- `course_id` (ObjectId) - Reference to course
- `teacher_id` (ObjectId) - Reference to teacher
- `session_code` (String) - 4-digit session code
- `start_ts` (Date) - Session start time
- `expiry_ts` (Date) - Session expiry time
- `lat` (Number) - Latitude coordinate
- `lng` (Number) - Longitude coordinate
- `radius_m` (Number) - Allowed radius in meters
- `nonce` (String) - Security nonce

### Attendance

- `id` (ObjectId) - Primary key
- `session_id` (ObjectId) - Reference to session
- `course_id` (ObjectId) - Reference to course
- `student_id` (ObjectId) - Reference to student
- `matric_no_submitted` (String) - Submitted matric number
- `device_fingerprint` (String) - Device identifier
- `lat` (Number) - Submission latitude
- `lng` (Number) - Submission longitude
- `status` (String) - 'present', 'absent', 'rejected', 'manual_present'
- `submitted_at` (Date) - Submission timestamp
- `receipt_signature` (String) - Cryptographic receipt

## Security Features

### Authentication

- JWT tokens with configurable expiration
- Secure password hashing with bcrypt (12 rounds)
- Email-based OTP verification

### Rate Limiting

- General API rate limiting (100 requests/15 minutes)
- Strict rate limiting for sensitive endpoints (5 requests/15 minutes)
- OTP rate limiting (1 request/minute)
- Attendance submission rate limiting (3 requests/minute)

### Input Validation

- Comprehensive input validation using express-validator
- SQL injection prevention
- XSS protection
- CORS configuration

### Geolocation Security

- Device fingerprinting to prevent duplicate submissions
- Location verification with configurable radius
- Cryptographic receipt generation for audit trails

## Email Configuration

The system supports multiple email providers. Configure your SMTP settings in the environment variables:

```env
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-app-password
```

### Gmail Setup

1. Enable 2-factor authentication
2. Generate an app-specific password
3. Use the app password in EMAIL_PASS

### Email Templates

Email templates are located in `src/templates/email/` and use Handlebars for templating.

## Development

### Prerequisites

- Node.js (v14 or higher)
- MongoDB (v4.4 or higher)
- npm or yarn

### Development Tools

- `nodemon` - Automatic server restart
- `jest` - Testing framework
- `supertest` - API testing

### Running Tests

```bash
npm test
```

### Code Structure

```
src/
├── config/          # Database and configuration
├── middleware/      # Express middleware
├── models/         # Mongoose models
├── routes/         # API route handlers
├── services/       # Business logic services
├── templates/      # Email templates
├── utils/          # Utility functions
└── server.js       # Main application file
```

## Deployment

### Environment Variables

Ensure all production environment variables are set:

- `NODE_ENV=production`
- `MONGODB_URI` - Production database URI
- `JWT_SECRET` - Strong secret key
- Email configuration for production SMTP

### Production Considerations

1. Use a reverse proxy (nginx)
2. Enable SSL/TLS certificates
3. Set up MongoDB replica sets
4. Configure log aggregation
5. Set up monitoring and alerts
6. Regular database backups

### Docker Deployment

```dockerfile
FROM node:16-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 5000
CMD ["npm", "start"]
```

## Monitoring & Logging

### Health Check

- Endpoint: `GET /health`
- Monitors database connectivity
- Returns system status and metrics

### Audit Logging

- All user actions are logged
- Admin audit trail
- Security event logging

### Performance Monitoring

- Request/response times
- Database query performance
- Error rate tracking

## API Testing

Use tools like Postman or curl to test the API:

```bash
# Register a teacher
curl -X POST http://localhost:5000/api/auth/register_teacher \
  -H "Content-Type: application/json" \
  -d '{"name":"John Doe","email":"john@example.com","password":"password123"}'

# Login
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"john@example.com","password":"password123"}'
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Ensure all tests pass
6. Submit a pull request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Support

For support and questions:

- Create an issue in the repository
- Check the documentation
- Review the API endpoints above

## Version History

### v1.0.0

- Initial release
- Core attendance functionality
- Email system integration
- Admin dashboard
- Comprehensive security features
