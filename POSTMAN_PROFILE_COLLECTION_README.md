# UniTrack Profile Settings API - Postman Collection

This Postman collection provides comprehensive testing for the UniTrack profile management API endpoints. It includes authentication, profile retrieval, profile updates, and extensive validation testing for both teacher and admin users.

## 📁 Collection Contents

### 1. **Authentication**
- **Login Teacher**: Authenticates teacher user and stores token
- **Login Admin**: Authenticates admin user and stores token

### 2. **Profile Management - Teacher**
- **Get Teacher Profile**: Retrieves current teacher profile information
- **Update Teacher Name Only**: Updates only the teacher's name
- **Update Teacher Password Only**: Updates only the teacher's password
- **Update Teacher Name and Password**: Updates both name and password simultaneously

### 3. **Profile Management - Admin**
- **Get Admin Profile**: Retrieves current admin profile (includes admin-specific fields)
- **Update Admin Name Only**: Updates only the admin's name
- **Update Admin Password Only**: Updates only the admin's password

### 4. **Validation Tests**
- **Invalid Name - Too Short**: Tests name length validation
- **Weak Password Validation**: Tests password complexity requirements
- **Password Confirmation Mismatch**: Tests password confirmation validation
- **Wrong Current Password**: Tests current password verification
- **Missing Current Password**: Tests required current password for password changes
- **Empty Request Body**: Tests handling of empty requests
- **Unauthorized Request**: Tests authentication requirement

## 🚀 How to Use

### Prerequisites
1. UniTrack backend server running on `http://localhost:5000`
2. Valid teacher and admin accounts in the database
3. Postman application installed

### Setup Steps

1. **Import the Collection**
   ```bash
   # Import the collection file
   postman_collection_profile.json
   
   # Import the environment file
   postman_environment_profile.json
   ```

2. **Configure Environment Variables**
   Update these variables in the environment or collection:
   ```json
   {
     "base_url": "http://localhost:5000",
     "teacher_email": "muhammedabiodun42@gmail.com",
     "teacher_password": "balikiss12",
     "admin_email": "louisdiaz43@gmail.com",
     "admin_password": "Balikiss12"
   }
   ```

3. **Run the Collection**
   - Start with the Authentication folder to get tokens
   - Run individual tests or the entire collection
   - Check test results in the Test Results tab

### Running Order
1. **Authentication** → Login Teacher/Admin (to get tokens)
2. **Profile Management** → Test profile operations
3. **Validation Tests** → Test error scenarios

## 🧪 Test Coverage

### Functional Tests
- ✅ Profile retrieval for teachers and admins
- ✅ Name updates
- ✅ Password updates
- ✅ Combined name and password updates
- ✅ Role-specific response data

### Security Tests
- ✅ Authentication requirement
- ✅ Current password verification
- ✅ Password complexity validation
- ✅ Token-based authorization

### Validation Tests
- ✅ Input validation (name length, password complexity)
- ✅ Password confirmation matching
- ✅ Required field validation
- ✅ Empty request handling

### Response Tests
- ✅ Correct HTTP status codes
- ✅ Response structure validation
- ✅ Data integrity checks
- ✅ Security (no password exposure)

## 📊 Expected Responses

### Successful Profile Retrieval (Teacher)
```json
{
  "success": true,
  "data": {
    "id": "user_id",
    "name": "Teacher Name",
    "email": "teacher@example.com",
    "role": "teacher",
    "email_verified": true,
    "created_at": "2025-08-30T06:00:00.000Z",
    "last_login": "2025-08-30T07:00:00.000Z"
  }
}
```

### Successful Profile Retrieval (Admin)
```json
{
  "success": true,
  "data": {
    "id": "admin_id",
    "name": "Admin Name",
    "email": "admin@example.com",
    "role": "admin",
    "is_super_admin": false,
    "status": "active",
    "permissions": ["view_all_reports", "manage_teachers"],
    "email_verified": true,
    "created_at": "2025-08-30T06:00:00.000Z",
    "last_login": "2025-08-30T07:00:00.000Z"
  }
}
```

### Successful Profile Update
```json
{
  "success": true,
  "message": "Profile updated successfully",
  "data": {
    "id": "user_id",
    "name": "Updated Name",
    "email": "user@example.com",
    "role": "teacher",
    "updated_at": "2025-08-30T07:00:00.000Z"
  },
  "changes": {
    "name_updated": true,
    "password_updated": false
  }
}
```

### Validation Error Example
```json
{
  "error": "Validation failed",
  "details": [
    {
      "type": "field",
      "value": "weak",
      "msg": "New password must contain at least one uppercase letter, one lowercase letter, and one number",
      "path": "newPassword",
      "location": "body"
    }
  ]
}
```

## 🔒 Security Features Tested

1. **Authentication**: All profile endpoints require valid JWT token
2. **Current Password Verification**: Password changes require current password
3. **Password Complexity**: Strong password requirements enforced
4. **Password Confirmation**: New passwords must be confirmed
5. **Data Security**: Passwords never exposed in responses
6. **Input Validation**: All inputs properly validated

## 🛠 Troubleshooting

### Common Issues

1. **401 Unauthorized**
   - Ensure you've run the login requests first
   - Check that tokens are saved to environment variables
   - Verify credentials are correct

2. **400 Validation Failed**
   - Check password complexity requirements
   - Ensure password confirmation matches
   - Verify name length (2-100 characters)

3. **400 Invalid Current Password**
   - Make sure you're using the current/correct password
   - Check if password was recently changed

### Environment Variables Check
```javascript
// Pre-request script to debug environment variables
console.log('Base URL:', pm.environment.get('base_url'));
console.log('Teacher Token:', pm.environment.get('teacher_token') ? 'Set' : 'Not Set');
console.log('Admin Token:', pm.environment.get('admin_token') ? 'Set' : 'Not Set');
```

## 📝 API Endpoints Covered

| Method | Endpoint | Description | Authentication |
|--------|----------|-------------|----------------|
| GET | `/api/auth/profile` | Get current user profile | Required |
| PUT | `/api/auth/profile` | Update user profile | Required |
| POST | `/api/auth/login` | User authentication | None |

## 🏷️ Tags and Organization

- **Authentication**: Login and token management
- **Profile**: Profile retrieval and updates
- **Validation**: Input validation and error handling
- **Security**: Authentication and authorization tests
- **Teacher**: Teacher-specific functionality
- **Admin**: Admin-specific functionality

This collection provides comprehensive testing coverage for the UniTrack profile management system, ensuring all functionality works correctly for both user types with proper security and validation.
