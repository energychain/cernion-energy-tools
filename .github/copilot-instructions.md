# GitHub Copilot Instructions for Cernion Energy Tools

## Project Overview
This is a MicroService Agent System for Energy Markets. The system is designed to handle energy market operations through a distributed microservice architecture.

## Coding Guidelines

### General Principles
- Follow clean code principles and SOLID design patterns
- Write self-documenting code with clear variable and function names
- Prioritize readability and maintainability over cleverness
- Use async/await for asynchronous operations instead of callbacks
- Handle errors explicitly and provide meaningful error messages

### Code Style
- Use 2 spaces for indentation
- Use ES6+ modern JavaScript features
- Use descriptive variable names (camelCase for variables, PascalCase for classes)
- Keep functions small and focused (single responsibility)
- Add JSDoc comments for public APIs and complex functions
- Include unit tests for all business logic

### Architecture Guidelines
- Follow microservice architecture patterns
- Each service should be independently deployable
- Use RESTful API design principles
- Implement proper error handling and logging
- Use environment variables for configuration
- Follow 12-factor app methodology

### Security Best Practices
- Never commit sensitive data (API keys, passwords, tokens)
- Use environment variables for secrets
- Validate and sanitize all inputs
- Implement proper authentication and authorization
- Follow OWASP security guidelines

### Testing Guidelines
- Write unit tests for all business logic
- Use Jest as the testing framework
- Aim for >80% code coverage
- Write integration tests for API endpoints
- Use meaningful test descriptions

### Documentation
- Update README.md with any significant changes
- Document API endpoints with examples
- Include inline comments for complex logic
- Keep documentation up-to-date with code changes

## Project-Specific Context

### Energy Market Domain
- Understand energy market operations and terminology
- Consider time-series data handling for energy consumption/production
- Implement proper data validation for market transactions
- Handle currency and unit conversions carefully

### Microservice Communication
- Use RESTful APIs for synchronous communication
- Consider message queues for asynchronous operations
- Implement proper service discovery mechanisms
- Use correlation IDs for distributed tracing

## File Organization
- `/src` - Source code for microservices
- `/tests` - Test files (unit and integration)
- `/docs` - Documentation files
- `/config` - Configuration files
- `/scripts` - Build and deployment scripts

## Common Patterns to Follow
- Use dependency injection for better testability
- Implement proper logging with structured logs
- Use configuration management for different environments
- Follow semantic versioning for releases

## What NOT to Do
- Don't use `var` - use `const` or `let`
- Don't ignore errors or use empty catch blocks
- Don't hardcode configuration values
- Don't write functions longer than 50 lines
- Don't commit commented-out code
- Don't use abbreviations in variable names unless widely understood
