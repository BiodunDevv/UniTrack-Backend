# UniTrack Student Sessions - Postman Collection

## 🎯 Overview

This Postman collection provides comprehensive testing capabilities for student session operations in the UniTrack Attendance System, with a focus on attendance submission, FingerprintJS integration, and security validation.

## 📁 Collection Files

- **Collection**: `postman_collection_student_sessions_fixed.json`
- **Environment**: `postman_environment_student_sessions.json`
- **README**: `POSTMAN_STUDENT_SESSIONS_README.md` (this file)

## 🚀 Quick Start

### 1. Import Collection and Environment

1. **Import Collection**:
   - Open Postman
   - Click "Import" → "Upload Files"
   - Select `postman_collection_student_sessions_fixed.json`

2. **Import Environment**:
   - Click "Import" → "Upload Files"
   - Select `postman_environment_student_sessions.json`
   - Set as active environment

### 2. Prerequisites

- ✅ UniTrack Backend server running on `http://localhost:5000`
- ✅ MongoDB database connected and populated with test data
- ✅ Test student account: `CSC/2020/001` with password `password123`
- ✅ Active session with code `1234` (or update the environment variable)

### 3. Test Execution Order

Run requests in this recommended order:

1. **🔐 Authentication → Student Login**
2. **🔐 Authentication → Get Student Profile**
3. **📋 Session Operations → Submit Attendance (Basic)**
4. **📋 Session Operations → Submit Attendance (FingerprintJS)**
5. **🚫 Error Scenarios → Invalid Session Code**

## 📋 Collection Structure

### 🔐 Authentication
- **Student Login**: Authenticate student and store JWT token
- **Get Student Profile**: Retrieve authenticated student information

### 📋 Session Operations
- **Submit Attendance (Basic)**: Standard attendance submission with basic device fingerprinting
- **Submit Attendance (FingerprintJS)**: Advanced attendance submission with FingerprintJS integration

### 🚫 Error Scenarios
- **Invalid Session Code**: Test error handling for invalid session codes

## 🔧 Environment Variables

### Base Configuration
- `base_url`: API base URL (default: `http://localhost:5000/api`)
- `test_student_matric`: Test student matriculation number
- `test_student_password`: Test student password
- `test_session_code`: Session code for testing

### Auto-Populated Variables
- `student_token`: JWT token (populated after login)
- `student_id`: Student ID (populated after login)
- `student_name`: Student name (populated after login)
- `student_matric`: Student matric number (populated after login)
- `student_level`: Student level (populated after login)

### Device & Location Testing
- `device_info`: Device information JSON (auto-generated)
- `fingerprintjs_data`: FingerprintJS device data (auto-generated)
- `test_lat`, `test_lng`: Test coordinates (University of Ibadan)
- `test_accuracy`: GPS accuracy for testing

## 🧪 Test Scenarios

### 1. Basic Attendance Submission

**Purpose**: Test standard attendance submission with basic device fingerprinting

**Request Body**:
```json
{
  "matric_no": "{{student_matric}}",
  "session_code": "{{test_session_code}}",
  "lat": {{test_lat}},
  "lng": {{test_lng}},
  "accuracy": {{test_accuracy}},
  "device_info": {{device_info}},
  "level": {{student_level}}
}
```

**Expected Response**: 201 Created with attendance record and receipt

### 2. FingerprintJS Attendance Submission

**Purpose**: Test advanced attendance submission with FingerprintJS device data

**Pre-request Script**: Generates FingerprintJS-style data:
```javascript
const fingerprintjsData = {
    visitorId: 'fp_' + Math.random().toString(36).substr(2, 16),
    confidence: {
        score: 0.95,
        comment: 'High confidence detection'
    },
    components: {
        screen: { value: '1920x1080', duration: 1 },
        timezone: { value: 'Africa/Lagos', duration: 2 },
        languages: { value: [['en-US'], ['en']], duration: 1 },
        platform: { value: 'Win32', duration: 0 },
        canvas: { value: 'canvas_hash_...', duration: 10 },
        fonts: { value: ['Arial', 'Times New Roman'], duration: 50 }
    },
    version: '3.3.0',
    timestamp: Date.now()
};
```

**Expected Response**: 201 Created with FingerprintJS security information

### 3. Error Scenarios

**Invalid Session Code**: Tests error handling for non-existent session codes
- **Expected Response**: 404 Not Found with detailed error message

## 🔍 Response Validation

### Successful Attendance Submission
```json
{
  "success": true,
  "message": "Attendance submitted successfully",
  "record": {
    "student_name": "John Doe",
    "matric_no": "CSC/2020/001",
    "course": "Computer Science 201",
    "status": "present",
    "receipt": "abc123def456...",
    "distance": 15
  },
  "validation_passed": {
    "student_enrolled": true,
    "session_active": true,
    "device_unique": true,
    "location_valid": true,
    "level_match": true
  },
  "security_info": {
    "device_fingerprint": "1234567...",
    "location_accuracy": 10,
    "distance_from_session": 15,
    "fingerprintjs": {
      "visitor_id": "1234567...",
      "confidence": 0.95,
      "detection_method": "FingerprintJS Pro"
    }
  }
}
```

### Error Response
```json
{
  "error": "Invalid session code or session has expired",
  "details": [
    "Please check the session code provided by your lecturer",
    "Session may have expired or not yet started",
    "Contact your lecturer if you believe this is an error"
  ]
}
```

## 🛠️ Customization

### Adding New Test Cases

1. **Duplicate Device Detection**:
```javascript
// Use same FingerprintJS data with different student
const duplicateTest = {
  matric_no: "CSC/2020/002",
  device_info: {{fingerprintjs_data}} // Same as previous request
};
```

2. **Location Validation Testing**:
```javascript
// Test with coordinates far from session
const locationTest = {
  lat: 6.4531, // Lagos coordinates (far from Ibadan)
  lng: 3.3958,
  accuracy: 5
};
```

3. **Different Device Types**:
```javascript
// Mobile device simulation
const mobileDevice = {
  platform: 'iPhone',
  browser: 'Safari/604.1',
  screen_resolution: '375x667',
  timezone: 'Africa/Lagos'
};
```

### Environment Customization

**For Different Universities**:
```json
{
  "test_lat": "your_university_latitude",
  "test_lng": "your_university_longitude",
  "base_url": "https://your-domain.com/api"
}
```

**For Production Testing**:
```json
{
  "base_url": "https://production-api.com/api",
  "test_student_matric": "PROD/2024/001",
  "test_student_password": "secure_password"
}
```

## 🔐 Security Testing

### Device Fingerprinting
- Tests basic device fingerprinting fallback
- Validates FingerprintJS visitor ID integration
- Verifies device uniqueness enforcement

### Location Validation
- Tests Haversine formula distance calculation
- Validates GPS accuracy consideration
- Verifies radius-based attendance restrictions

### Authentication
- Tests JWT token validation
- Verifies student profile access
- Validates role-based permissions

## 🐛 Troubleshooting

### Common Issues

1. **401 Unauthorized**:
   - Run "Student Login" first to get authentication token
   - Check if test student exists in database
   - Verify student credentials in environment

2. **404 Session Not Found**:
   - Update `test_session_code` with active session
   - Check if session is still active and not expired
   - Verify session belongs to enrolled course

3. **400 Location Validation Failed**:
   - Check if test coordinates are within session radius
   - Update `test_lat` and `test_lng` to valid coordinates
   - Verify session location is properly set

4. **500 Internal Server Error**:
   - Check server logs for detailed error information
   - Verify database connection is stable
   - Ensure all required models are properly initialized

### Debug Tips

1. **Enable Console Logging**:
   - Check Postman Console for detailed script output
   - Review pre-request and test script logs
   - Monitor API response details

2. **Validate Environment**:
   - Ensure all required environment variables are set
   - Check auto-populated variables after authentication
   - Verify device data generation in pre-request scripts

3. **Server-Side Debugging**:
   - Check server console for FingerprintJS integration logs
   - Monitor database queries for device fingerprinting
   - Review location validation calculations

## 📊 Test Results Analysis

### Success Indicators
- ✅ Authentication tokens are properly stored and used
- ✅ Attendance submissions return valid receipts
- ✅ FingerprintJS data is correctly processed and stored
- ✅ Location validation works within specified radius
- ✅ Error scenarios return appropriate error codes and messages

### Performance Metrics
- Response times should be under 2 seconds for attendance submission
- Device fingerprint generation should be instantaneous
- Location validation should complete quickly
- Database operations should be optimized

## 🔄 Integration with CI/CD

### Newman Command Line
```bash
# Install Newman
npm install -g newman

# Run collection with environment
newman run postman_collection_student_sessions_fixed.json \
  -e postman_environment_student_sessions.json \
  --reporters cli,json \
  --reporter-json-export results.json

# Run specific folder
newman run postman_collection_student_sessions_fixed.json \
  -e postman_environment_student_sessions.json \
  --folder "Session Operations"
```

### Automated Testing Script
```bash
#!/bin/bash
echo "🚀 Running UniTrack Student Sessions Tests..."

# Start server in background
npm start &
SERVER_PID=$!

# Wait for server to start
sleep 5

# Run Postman tests
newman run postman_collection_student_sessions_fixed.json \
  -e postman_environment_student_sessions.json \
  --bail

# Stop server
kill $SERVER_PID

echo "✅ Tests completed"
```

## 📈 Advanced Usage

### Batch Testing
- Create multiple environments for different test scenarios
- Use data files for testing multiple student accounts
- Implement parameterized testing for various device types

### Performance Testing
- Use collection runner for load testing
- Monitor response times across different scenarios
- Validate system behavior under concurrent submissions

### Security Auditing
- Test with various device fingerprint scenarios
- Validate security headers and response sanitization
- Verify proper error message handling without information leakage

This collection provides comprehensive testing coverage for student session operations with advanced security features and robust error handling. Use it to validate your UniTrack implementation and ensure reliable attendance submission functionality.
