import { grpcHostForCertLookup } from '../src/modules/grpcHandler.js';

describe('grpcHostForCertLookup', () => {
    test('strips http/https schemes', () => {
        expect(grpcHostForCertLookup('https://api.example.com:50051')).toBe('api.example.com:50051');
        expect(grpcHostForCertLookup('http://api.example.com:50051')).toBe('api.example.com:50051');
    });

    test('strips paths after the authority', () => {
        expect(grpcHostForCertLookup('https://api.example.com:50051/some/path')).toBe('api.example.com:50051');
        expect(grpcHostForCertLookup('api.example.com:50051/some/path')).toBe('api.example.com:50051');
    });

    test('passes bare host:port through', () => {
        expect(grpcHostForCertLookup('localhost:50051')).toBe('localhost:50051');
        expect(grpcHostForCertLookup('127.0.0.1:50051')).toBe('127.0.0.1:50051');
    });

    test('lowercases the host and trims whitespace', () => {
        expect(grpcHostForCertLookup('  API.Example.Com:50051  ')).toBe('api.example.com:50051');
    });

    test('handles empty and missing input', () => {
        expect(grpcHostForCertLookup('')).toBe('');
        expect(grpcHostForCertLookup(null)).toBe('');
        expect(grpcHostForCertLookup(undefined)).toBe('');
    });
});
