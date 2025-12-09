# Scripts Feature Guide

Resonance supports pre-request and post-request scripts, similar to Postman, allowing you to automate workflows, validate responses, and manage dynamic data in your API testing.

## Table of Contents

- [Overview](#overview)
- [Getting Started](#getting-started)
- [Script Types](#script-types)
- [Available APIs](#available-apis)
- [Examples](#examples)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)

## Overview

Scripts in Resonance allow you to:

- **Modify requests dynamically** before they're sent (pre-request scripts)
- **Validate API responses** with assertions (test scripts)
- **Extract data** from responses for use in subsequent requests
- **Automate workflows** by chaining requests together
- **Manage environment variables** programmatically
- **Debug requests** with console logging

Scripts execute in a secure, sandboxed environment with a 10-second timeout.

## Getting Started

### Accessing Scripts

1. **Select an endpoint** from your collections
2. Click the **"Scripts"** tab in the request configuration section (alongside Path Params, Query Params, Headers, Body, and Authorization)
3. Edit your scripts in two sections:
   - **Pre-request Script** - Runs before the request is sent
   - **Test Script** - Runs after receiving the response
4. Scripts are **auto-saved** as you type (1 second delay)

### Viewing Script Output

After sending a request with scripts:

1. Click the **"Scripts"** tab in the response section
2. View console logs with timestamps and levels (info, warn, error)
3. See test results with pass/fail indicators (✓/✗)

## Script Types

### Pre-request Scripts

Execute **before** the request is sent. Use them to:

- Dynamically set headers, query parameters, or request body
- Calculate authentication signatures
- Set timestamps or nonces
- Load data from environment variables
- Prepare request data based on conditions

### Test Scripts

Execute **after** receiving the response. Use them to:

- Validate response status codes
- Assert response body structure and values
- Check response times and performance
- Extract data from responses
- Save data to environment variables for subsequent requests

## Available APIs

### Request Object (Pre-request & Test)

Access and modify the HTTP request:

```javascript
request.url           // Full URL string
request.method        // HTTP method (GET, POST, etc.)
request.headers       // Object of headers
request.body          // Request body (parsed JSON or string)
request.queryParams   // Object of query parameters
request.pathParams    // Object of path parameters
```

**Note:** In test scripts, the request object is read-only.

### Response Object (Test scripts only)

Access the HTTP response:

```javascript
response.status       // HTTP status code (e.g., 200)
response.statusText   // Status text (e.g., "OK")
response.headers      // Object of response headers
response.body         // Response body (parsed JSON or string)
response.cookies      // Array of cookies
response.timings      // Performance metrics object
  .dnsLookup         // DNS lookup time (ms)
  .tcpConnection     // TCP connection time (ms)
  .tlsHandshake      // TLS handshake time (ms)
  .firstByte         // Time to first byte (ms)
  .download          // Download time (ms)
  .total             // Total request time (ms)
```

### Environment Object

Read and write environment variables:

```javascript
environment.get(name)          // Get variable value
environment.set(name, value)   // Set variable value
environment.delete(name)       // Delete variable
```

**Examples:**
```javascript
// Get API key
const apiKey = environment.get('API_KEY');

// Save user ID for next request
environment.set('USER_ID', '12345');

// Remove temporary variable
environment.delete('TEMP_TOKEN');
```

### Console Object

Log messages for debugging:

```javascript
console.log('message')    // Info level
console.info('message')   // Info level
console.warn('message')   // Warning level
console.error('message')  // Error level
```

Output appears in the Scripts tab with timestamps and log levels.

### Expect API (Test scripts only)

Make assertions about response data:

```javascript
expect(actual).toBe(expected)                    // Strict equality (===)
expect(actual).toEqual(expected)                 // Deep equality
expect(actual).toContain(item)                   // Array/string contains
expect(actual).toBeDefined()                     // Not undefined
expect(actual).toBeUndefined()                   // Is undefined
expect(actual).toBeTruthy()                      // Boolean true
expect(actual).toBeFalsy()                       // Boolean false
expect(actual).toBeGreaterThan(value)           // Numeric comparison
expect(actual).toBeLessThan(value)              // Numeric comparison
expect(actual).toBeGreaterThanOrEqual(value)    // Numeric comparison
expect(actual).toBeLessThanOrEqual(value)       // Numeric comparison
expect(actual).toHaveProperty(key, value?)      // Object property
expect(actual).toMatch(regex)                    // Regex match
```

### Available JavaScript Features

Scripts have access to:

- **Date** - Date and time manipulation
- **Math** - Mathematical operations
- **JSON** - JSON parsing and stringification
- **parseInt, parseFloat** - Number parsing
- **isNaN, isFinite** - Number validation
- **encodeURIComponent, decodeURIComponent** - URL encoding
- **encodeURI, decodeURI** - URI encoding
- **btoa, atob** - Base64 encoding/decoding

**Security Note:** Scripts do NOT have access to `require`, `fs`, `process`, or other Node.js modules.

## Examples

### Pre-request Script Examples

#### 1. Add Dynamic Authentication

```javascript
// Get API key from environment
const apiKey = environment.get('API_KEY');

// Add to request headers
request.headers['Authorization'] = `Bearer ${apiKey}`;
request.headers['X-API-Key'] = apiKey;

console.log('Added authentication headers');
```

#### 2. Add Timestamp and Signature

```javascript
// Add timestamp
const timestamp = Date.now();
request.headers['X-Timestamp'] = timestamp.toString();

// Calculate simple signature (for demonstration)
const signature = btoa(`${request.method}:${request.url}:${timestamp}`);
request.headers['X-Signature'] = signature;

console.log('Added timestamp and signature');
```

#### 3. Modify Request Body

```javascript
// Add metadata to request body
request.body.requestId = Math.random().toString(36).substring(7);
request.body.timestamp = new Date().toISOString();
request.body.source = 'Resonance';

console.log('Added metadata to request:', request.body.requestId);
```

#### 4. Conditional Headers

```javascript
// Add different headers based on environment
const env = environment.get('ENVIRONMENT') || 'development';

if (env === 'production') {
    request.headers['X-Environment'] = 'prod';
    request.headers['X-Debug'] = 'false';
} else {
    request.headers['X-Environment'] = 'dev';
    request.headers['X-Debug'] = 'true';
}

console.log('Environment:', env);
```

#### 5. Generate OAuth Signature

```javascript
// Get OAuth credentials from environment
const consumerKey = environment.get('OAUTH_CONSUMER_KEY');
const consumerSecret = environment.get('OAUTH_CONSUMER_SECRET');
const token = environment.get('OAUTH_TOKEN');

// Add OAuth parameters
const timestamp = Math.floor(Date.now() / 1000);
const nonce = Math.random().toString(36).substring(7);

request.headers['Authorization'] = `OAuth oauth_consumer_key="${consumerKey}", oauth_token="${token}", oauth_timestamp="${timestamp}", oauth_nonce="${nonce}"`;

console.log('Added OAuth headers');
```

### Test Script Examples

#### 1. Basic Response Validation

```javascript
// Verify status code
expect(response.status).toBe(200);
expect(response.statusText).toBe('OK');

// Verify response exists
expect(response.body).toBeDefined();

console.log('Response validation passed');
```

#### 2. Validate Response Structure

```javascript
// Check response has expected structure
expect(response.body).toBeDefined();
expect(response.body.data).toBeDefined();
expect(response.body.data.users).toBeDefined();

// Verify it's an array
expect(Array.isArray(response.body.data.users)).toBeTruthy();

// Check array has items
expect(response.body.data.users.length).toBeGreaterThan(0);

console.log('Found', response.body.data.users.length, 'users');
```

#### 3. Extract Data for Next Request

```javascript
// Verify response
expect(response.status).toBe(200);
expect(response.body.user).toBeDefined();

// Extract user ID for subsequent requests
const userId = response.body.user.id;
environment.set('USER_ID', userId);

// Extract authentication token
const token = response.body.token;
environment.set('AUTH_TOKEN', token);

console.log('Saved USER_ID:', userId);
console.log('Saved AUTH_TOKEN');
```

#### 4. Validate Response Performance

```javascript
// Verify successful response
expect(response.status).toBe(200);

// Check response time
expect(response.timings.total).toBeLessThan(1000);
console.log('Response time:', response.timings.total, 'ms');

// Check individual timing metrics
expect(response.timings.dnsLookup).toBeLessThan(100);
expect(response.timings.firstByte).toBeLessThan(500);

console.log('Performance tests passed');
```

#### 5. Validate Response Content

```javascript
// Verify user object structure
expect(response.body.user).toBeDefined();
expect(response.body.user).toHaveProperty('id');
expect(response.body.user).toHaveProperty('email');
expect(response.body.user).toHaveProperty('name');

// Verify email format
expect(response.body.user.email).toMatch(/^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$/);

// Verify user is active
expect(response.body.user.active).toBeTruthy();

console.log('User validation passed:', response.body.user.email);
```

#### 6. Validate Array of Objects

```javascript
// Verify response structure
expect(response.status).toBe(200);
expect(response.body.users).toBeDefined();
expect(Array.isArray(response.body.users)).toBeTruthy();

// Validate each user
response.body.users.forEach((user, index) => {
    expect(user.id).toBeDefined();
    expect(user.name).toBeDefined();
    expect(user.email).toBeDefined();

    console.log(`User ${index + 1}: ${user.name} - Valid`);
});

console.log('All', response.body.users.length, 'users validated');
```

#### 7. Check Response Headers

```javascript
// Verify content type
expect(response.headers['content-type']).toContain('application/json');

// Check for security headers
expect(response.headers['x-frame-options']).toBeDefined();
expect(response.headers['x-content-type-options']).toBe('nosniff');

// Verify CORS headers
expect(response.headers['access-control-allow-origin']).toBeDefined();

console.log('Security headers validated');
```

#### 8. Conditional Logic Based on Response

```javascript
// Check response status
expect(response.status).toBe(200);

// Handle different response scenarios
if (response.body.status === 'pending') {
    console.log('Request is pending, retry needed');
    environment.set('RETRY_REQUIRED', 'true');
} else if (response.body.status === 'completed') {
    console.log('Request completed successfully');
    environment.set('RETRY_REQUIRED', 'false');
    environment.set('RESULT_ID', response.body.resultId);
}
```

### Workflow Examples

#### Chaining Requests: Login → Get User Data

**Request 1: POST /auth/login**

Pre-request Script:
```javascript
// Get credentials from environment
const username = environment.get('USERNAME');
const password = environment.get('PASSWORD');

// Set request body
request.body = {
    username: username,
    password: password
};

console.log('Attempting login for:', username);
```

Test Script:
```javascript
// Verify login success
expect(response.status).toBe(200);
expect(response.body.token).toBeDefined();

// Save auth token for next request
const token = response.body.token;
environment.set('AUTH_TOKEN', token);

console.log('Login successful, token saved');
```

**Request 2: GET /users/me**

Pre-request Script:
```javascript
// Get auth token from previous request
const token = environment.get('AUTH_TOKEN');

// Add to headers
request.headers['Authorization'] = `Bearer ${token}`;

console.log('Using saved auth token');
```

Test Script:
```javascript
// Verify user data
expect(response.status).toBe(200);
expect(response.body.id).toBeDefined();
expect(response.body.email).toBeDefined();

console.log('User data retrieved:', response.body.email);
```

#### Pagination: Get All Pages

**Request: GET /api/items?page=1**

Test Script:
```javascript
// Verify response
expect(response.status).toBe(200);
expect(response.body.items).toBeDefined();

// Check if there are more pages
const currentPage = response.body.currentPage;
const totalPages = response.body.totalPages;

console.log(`Page ${currentPage} of ${totalPages}`);

// Save next page number if available
if (currentPage < totalPages) {
    environment.set('NEXT_PAGE', (currentPage + 1).toString());
    console.log('More pages available, set NEXT_PAGE to', currentPage + 1);
} else {
    environment.delete('NEXT_PAGE');
    console.log('All pages retrieved');
}

// Accumulate item count
const previousCount = parseInt(environment.get('TOTAL_ITEMS') || '0');
const newCount = previousCount + response.body.items.length;
environment.set('TOTAL_ITEMS', newCount.toString());

console.log('Total items so far:', newCount);
```

#### Dynamic Request Based on Previous Response

**Request 1: GET /api/config**

Test Script:
```javascript
expect(response.status).toBe(200);

// Save API version for next request
const apiVersion = response.body.apiVersion;
environment.set('API_VERSION', apiVersion);

// Save base URL
const baseUrl = response.body.baseUrl;
environment.set('BASE_URL', baseUrl);

console.log('API version:', apiVersion);
```

**Request 2: Dynamic endpoint**

Pre-request Script:
```javascript
// Build URL from config
const baseUrl = environment.get('BASE_URL');
const version = environment.get('API_VERSION');

request.url = `${baseUrl}/${version}/users`;

console.log('Using dynamic URL:', request.url);
```

## Best Practices

### 1. Use Environment Variables for Secrets

**Good:**
```javascript
const apiKey = environment.get('API_KEY');
request.headers['Authorization'] = `Bearer ${apiKey}`;
```

**Bad:**
```javascript
request.headers['Authorization'] = 'Bearer hardcoded-secret-key';
```

### 2. Always Validate Before Extracting

**Good:**
```javascript
expect(response.status).toBe(200);
expect(response.body.user).toBeDefined();
expect(response.body.user.id).toBeDefined();

const userId = response.body.user.id;
environment.set('USER_ID', userId);
```

**Bad:**
```javascript
// Might crash if response.body.user is undefined
const userId = response.body.user.id;
environment.set('USER_ID', userId);
```

### 3. Use Descriptive Console Logs

**Good:**
```javascript
console.log('Login successful, user:', response.body.email);
console.log('Saved AUTH_TOKEN for subsequent requests');
```

**Bad:**
```javascript
console.log('ok');
console.log('done');
```

### 4. Clean Up Temporary Variables

```javascript
// After using a temporary token
environment.delete('TEMP_TOKEN');
console.log('Cleaned up temporary variables');
```

### 5. Handle Errors Gracefully

```javascript
// Check for error responses
if (response.status >= 400) {
    console.error('Request failed with status:', response.status);
    console.error('Error:', response.body.message);
    return; // Stop execution
}

// Continue with success logic
expect(response.status).toBe(200);
```

### 6. Keep Scripts Focused

- **Pre-request scripts** should focus on request preparation
- **Test scripts** should focus on validation and data extraction
- Keep logic simple and readable
- Split complex workflows into multiple requests

### 7. Use Meaningful Variable Names

```javascript
// Good
const authToken = response.body.token;
const userId = response.body.user.id;
environment.set('AUTH_TOKEN', authToken);
environment.set('USER_ID', userId);

// Bad
const t = response.body.token;
const x = response.body.user.id;
environment.set('T', t);
environment.set('X', x);
```

## Troubleshooting

### Script Not Running

**Issue:** Script doesn't seem to execute

**Solutions:**
- Verify the script is saved (click Save button in script editor)
- Check for syntax errors (look for red error messages in Scripts tab)
- Ensure the endpoint has a valid collection and endpoint ID
- Check browser console for errors

### Timeout Errors

**Issue:** "Script execution timeout" error

**Cause:** Scripts must complete within 10 seconds

**Solutions:**
- Simplify your script logic
- Remove unnecessary loops
- Avoid infinite loops
- Break complex operations into multiple requests

### Variables Not Available

**Issue:** `environment.get()` returns undefined

**Solutions:**
- Ensure you've created the environment variable in Environment Manager
- Check you're using the correct variable name (case-sensitive)
- Verify the correct environment is active
- Check if a previous script actually set the variable

### Assertion Failures

**Issue:** Test fails with "Expected X to be Y"

**Solutions:**
- Log the actual value: `console.log('Actual value:', response.body.field)`
- Check response status first: `expect(response.status).toBe(200)`
- Verify the response structure matches your expectations
- Check for typos in property names

### Request Not Modified

**Issue:** Pre-request script doesn't modify the request

**Solutions:**
- Ensure you're modifying the `request` object directly
- Check that properties exist (e.g., `request.headers` is an object)
- Verify script runs before the request (check console logs)
- Look for script errors that might stop execution

### Console Logs Not Appearing

**Issue:** Console logs don't show in Scripts tab

**Solutions:**
- Ensure you clicked the Scripts tab in the response section
- Verify the script executed (check for errors)
- Try adding logs at the beginning: `console.log('Script started')`
- Check if the script completed before timeout

### Can't Access Response Properties

**Issue:** `response.body.field` returns undefined

**Solutions:**
```javascript
// First check what you received
console.log('Response status:', response.status);
console.log('Response body:', JSON.stringify(response.body, null, 2));

// Then verify structure
expect(response.body).toBeDefined();
expect(response.body.field).toBeDefined();
```

## Security Notes

Scripts run in a sandboxed environment for security:

- ✅ **Allowed:** Date, Math, JSON, basic JavaScript operations
- ❌ **Blocked:** `require()`, file system access, network requests
- ❌ **Blocked:** `process`, `child_process`, `fs`, `http`
- ⏱️ **Timeout:** Scripts automatically terminate after 10 seconds

## Additional Resources

- **Environment Management:** Use the Environment Manager (settings icon) to create and manage environments
- **Variables:** Access Variables dialog from collection context menu
- **Examples:** See `CLAUDE.md` for more information about Resonance features

---

**Need help?** Open an issue on GitHub or check the main documentation.
