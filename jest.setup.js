// Suppress console.error during tests for expected error handling
const originalConsoleError = console.error;
console.error = (...args) => {
  // Only suppress error messages that are part of expected error handling tests
  const message = args[0];
  if (typeof message === 'string' && (
    message.includes('Error processing request variables:') ||
    message.includes('Error processing template:') ||
    message.includes('Error getting template preview:')
  )) {
    return; // Suppress these expected errors
  }
  originalConsoleError.apply(console, args);
};