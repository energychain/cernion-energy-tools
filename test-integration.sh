#!/bin/bash

# Integration Test Script for Cernion Energy Tools
# This script tests all core functionality

set -e

echo "🚀 Cernion Energy Tools - Integration Test"
echo "=========================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Function to print success
success() {
    echo -e "${GREEN}✓${NC} $1"
}

# Function to print error
error() {
    echo -e "${RED}✗${NC} $1"
    exit 1
}

# Check if node is installed
command -v node >/dev/null 2>&1 || error "Node.js is not installed"
success "Node.js is installed"

# Check if npm is installed
command -v npm >/dev/null 2>&1 || error "npm is not installed"
success "npm is installed"

# Check if dependencies are installed
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install || error "Failed to install dependencies"
fi
success "Dependencies are installed"

# Run linter
echo ""
echo "Running linter..."
npm run lint || error "Linting failed"
success "Code passes linting"

# Create a test service
echo ""
echo "Testing service creation..."
node create-service.js test-integration 2>&1 >/dev/null || error "Failed to create service"
if [ -f "services/test-integration.service.js" ]; then
    success "Service creation works"
    # Clean up
    rm services/test-integration.service.js
else
    error "Service file was not created"
fi

# Start services in background
echo ""
echo "Starting services..."
node index.js > /tmp/test-services.log 2>&1 &
SERVICE_PID=$!
success "Services started (PID: $SERVICE_PID)"

# Wait for services to start
sleep 5

# Check if services are running
if ! kill -0 $SERVICE_PID 2>/dev/null; then
    cat /tmp/test-services.log
    error "Services failed to start"
fi
success "Services are running"

# Test API Gateway
echo ""
echo "Testing API Gateway..."
curl -s http://localhost:3000/api/api/list-aliases > /dev/null || error "API Gateway not responding"
success "API Gateway is responding"

# Create a demo service for testing
cp templates/skeleton.service.js services/test-demo.service.js
sed -i "s/name: 'skeleton'/name: 'test-demo'/" services/test-demo.service.js

# Restart services to pick up new service
echo ""
echo "Restarting services to load test service..."
kill $SERVICE_PID 2>/dev/null || true
wait $SERVICE_PID 2>/dev/null || true
sleep 3

node index.js > /tmp/test-services.log 2>&1 &
SERVICE_PID=$!
sleep 5

if ! kill -0 $SERVICE_PID 2>/dev/null; then
    cat /tmp/test-services.log
    error "Services failed to restart"
fi
success "Services restarted with test service"

# Test REST API - Hello endpoint
echo ""
echo "Testing REST API endpoints..."
RESPONSE=$(curl -s http://localhost:3000/api/v1/test-demo/hello?name=Test)
if echo "$RESPONSE" | grep -q "Hello, Test"; then
    success "Hello endpoint works"
else
    error "Hello endpoint failed: $RESPONSE"
fi

# Test REST API - Health endpoint
RESPONSE=$(curl -s http://localhost:3000/api/v1/test-demo/health)
if echo "$RESPONSE" | grep -q "healthy"; then
    success "Health endpoint works"
else
    error "Health endpoint failed: $RESPONSE"
fi

# Test REST API - Process endpoint
RESPONSE=$(curl -s -X POST http://localhost:3000/api/v1/test-demo/process \
    -H "Content-Type: application/json" \
    -d '{"data":"test","options":{"uppercase":true}}')
if echo "$RESPONSE" | grep -q "TEST"; then
    success "Process endpoint works"
else
    error "Process endpoint failed: $RESPONSE"
fi

# Test CLI tool
echo ""
echo "Testing CLI tool..."
CLI_OUTPUT=$(node cli.js v1.test-demo.hello --name=CLI 2>&1)
if echo "$CLI_OUTPUT" | grep -q "Hello, CLI"; then
    success "CLI tool works"
else
    error "CLI tool failed: $CLI_OUTPUT"
fi

# Cleanup
echo ""
echo "Cleaning up..."
kill $SERVICE_PID 2>/dev/null || true
wait $SERVICE_PID 2>/dev/null || true
rm services/test-demo.service.js
success "Cleanup completed"

echo ""
echo "=========================================="
echo -e "${GREEN}✓ All tests passed!${NC}"
echo "=========================================="
