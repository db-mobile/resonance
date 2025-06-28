// Test script for variable functionality
import { VariableProcessor } from './src/modules/variables/VariableProcessor.js';

const processor = new VariableProcessor();

// Test basic template processing
console.log('=== Testing Variable Template Processing ===');

const testTemplate = 'https://{{ baseUrl }}/api/{{ version }}/users/{{ userId }}';
const testVariables = {
    baseUrl: 'api.example.com',
    version: 'v1',
    userId: '123'
};

const result = processor.processTemplate(testTemplate, testVariables);
console.log('Template:', testTemplate);
console.log('Variables:', testVariables);
console.log('Result:', result);
console.log('Expected: https://api.example.com/api/v1/users/123');
console.log('✅ Match:', result === 'https://api.example.com/api/v1/users/123');

// Test object processing
console.log('\n=== Testing Object Processing ===');

const testObject = {
    url: 'https://{{ baseUrl }}/api/users',
    headers: {
        'Authorization': 'Bearer {{ token }}',
        'X-API-Version': '{{ version }}'
    },
    body: {
        name: '{{ userName }}',
        email: '{{ userEmail }}'
    }
};

const objectVariables = {
    baseUrl: 'api.example.com',
    token: 'abc123',
    version: 'v2',
    userName: 'John Doe',
    userEmail: 'john@example.com'
};

const processedObject = processor.processObject(testObject, objectVariables);
console.log('Original:', JSON.stringify(testObject, null, 2));
console.log('Processed:', JSON.stringify(processedObject, null, 2));

// Test variable extraction
console.log('\n=== Testing Variable Extraction ===');

const extractedVars = processor.extractVariableNames(testTemplate);
console.log('Template:', testTemplate);
console.log('Extracted variables:', extractedVars);
console.log('Expected: ["baseUrl", "version", "userId"]');

// Test validation
console.log('\n=== Testing Variable Name Validation ===');

const validNames = ['baseUrl', 'api_key', '_private', 'version1'];
const invalidNames = ['123invalid', 'base-url', 'base url', ''];

validNames.forEach(name => {
    console.log(`"${name}" is valid:`, processor.isValidVariableName(name));
});

invalidNames.forEach(name => {
    console.log(`"${name}" is valid:`, processor.isValidVariableName(name));
});

console.log('\n=== All Tests Complete ===');