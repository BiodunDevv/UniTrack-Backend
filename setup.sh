#!/bin/bash

# UniTrack Attendance System Setup Script

echo "🎓 UniTrack Attendance System Setup"
echo "=================================="

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js v14 or higher."
    exit 1
fi

NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt "14" ]; then
    echo "❌ Node.js version 14 or higher is required. Current version: $(node --version)"
    exit 1
fi

echo "✅ Node.js $(node --version) detected"

# Check if MongoDB is installed and running
if ! command -v mongod &> /dev/null; then
    echo "⚠️  MongoDB not found. Please install MongoDB."
    echo "   Ubuntu/Debian: sudo apt-get install mongodb"
    echo "   MacOS: brew install mongodb-community"
    echo "   Or use MongoDB Atlas (cloud) and update MONGODB_URI in .env"
else
    echo "✅ MongoDB detected"
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm install

if [ $? -ne 0 ]; then
    echo "❌ Failed to install dependencies"
    exit 1
fi

echo "✅ Dependencies installed successfully"

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    echo "⚙️  Creating .env file..."
    cp .env.example .env
    echo "✅ .env file created from template"
    echo "⚠️  Please edit .env file with your configuration before starting the server"
else
    echo "✅ .env file already exists"
fi

# Create logs directory
mkdir -p logs
echo "✅ Logs directory created"

# Check if all required environment variables are set
echo "🔍 Checking environment configuration..."

# Source the .env file to check variables
set -a
source .env
set +a

MISSING_VARS=()

if [ -z "$MONGODB_URI" ] || [ "$MONGODB_URI" = "your-mongodb-uri" ]; then
    MISSING_VARS+=("MONGODB_URI")
fi

if [ -z "$JWT_SECRET" ] || [ "$JWT_SECRET" = "your-super-secret-jwt-key-change-this-in-production" ]; then
    MISSING_VARS+=("JWT_SECRET")
fi

if [ -z "$EMAIL_USER" ] || [ "$EMAIL_USER" = "your-email@gmail.com" ]; then
    MISSING_VARS+=("EMAIL_USER")
fi

if [ -z "$EMAIL_PASS" ] || [ "$EMAIL_PASS" = "your-app-password" ]; then
    MISSING_VARS+=("EMAIL_PASS")
fi

if [ ${#MISSING_VARS[@]} -ne 0 ]; then
    echo "⚠️  Please configure the following environment variables in .env:"
    for var in "${MISSING_VARS[@]}"; do
        echo "   - $var"
    done
    echo ""
    echo "📖 See README.md for configuration details"
else
    echo "✅ Environment configuration looks good"
fi

echo ""
echo "🚀 Setup completed!"
echo ""
echo "Next steps:"
echo "1. Edit .env file with your configuration (if not done already)"
echo "2. Start MongoDB (if using local installation)"
echo "3. Run 'npm run dev' to start the development server"
echo "4. Run 'npm start' to start the production server"
echo ""
echo "📖 Documentation:"
echo "   - README.md - Complete setup and usage guide"
echo "   - API_DOCUMENTATION.md - API endpoint reference"
echo ""
echo "🌐 Default server URL: http://localhost:5000"
echo "🏥 Health check: http://localhost:5000/health"
