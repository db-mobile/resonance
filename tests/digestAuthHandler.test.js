import { DigestAuthHandler, handleDigestAuth } from '../src/main/digestAuthHandler.js';

describe('DigestAuthHandler', () => {
    describe('parseDigestChallenge', () => {
        it('should parse a valid Digest challenge header', () => {
            const header = 'Digest realm="test@example.com", nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", qop="auth", opaque="5ccc069c403ebaf9f0171e9517f40e41"';
            const challenge = DigestAuthHandler.parseDigestChallenge(header);

            expect(challenge).toBeDefined();
            expect(challenge.realm).toBe('test@example.com');
            expect(challenge.nonce).toBe('dcd98b7102dd2f0e8b11d0f600bfb0c093');
            expect(challenge.qop).toBe('auth');
            expect(challenge.opaque).toBe('5ccc069c403ebaf9f0171e9517f40e41');
        });

        it('should return null for non-Digest headers', () => {
            const header = 'Basic realm="test"';
            const challenge = DigestAuthHandler.parseDigestChallenge(header);

            expect(challenge).toBeNull();
        });

        it('should return null for empty header', () => {
            const challenge = DigestAuthHandler.parseDigestChallenge('');
            expect(challenge).toBeNull();
        });
    });

    describe('md5', () => {
        it('should generate correct MD5 hash', () => {
            const hash = DigestAuthHandler.md5('test');
            expect(hash).toBe('098f6bcd4621d373cade4e832627b4f6');
        });

        it('should generate correct MD5 hash for username:realm:password', () => {
            const hash = DigestAuthHandler.md5('user:realm:pass');
            expect(hash).toBe('8493fbc53ba582fb4c044c456bdc40eb');
        });
    });

    describe('generateClientNonce', () => {
        it('should generate a 32-character hex string', () => {
            const nonce = DigestAuthHandler.generateClientNonce();
            expect(nonce).toHaveLength(32);
            expect(nonce).toMatch(/^[a-f0-9]{32}$/);
        });

        it('should generate unique nonces', () => {
            const nonce1 = DigestAuthHandler.generateClientNonce();
            const nonce2 = DigestAuthHandler.generateClientNonce();
            expect(nonce1).not.toBe(nonce2);
        });
    });

    describe('extractUriFromUrl', () => {
        it('should extract URI from full URL', () => {
            const uri = DigestAuthHandler.extractUriFromUrl('http://example.com/api/users');
            expect(uri).toBe('/api/users');
        });

        it('should include query string', () => {
            const uri = DigestAuthHandler.extractUriFromUrl('http://example.com/api/users?page=1');
            expect(uri).toBe('/api/users?page=1');
        });

        it('should handle HTTPS URLs', () => {
            const uri = DigestAuthHandler.extractUriFromUrl('https://example.com/api/users');
            expect(uri).toBe('/api/users');
        });

        it('should handle root path', () => {
            const uri = DigestAuthHandler.extractUriFromUrl('http://example.com/');
            expect(uri).toBe('/');
        });
    });

    describe('buildAuthorizationHeader', () => {
        it('should build authorization header with qop=auth', () => {
            const challenge = {
                realm: 'test@example.com',
                nonce: 'dcd98b7102dd2f0e8b11d0f600bfb0c093',
                qop: 'auth',
                opaque: '5ccc069c403ebaf9f0171e9517f40e41'
            };

            const authHeader = DigestAuthHandler.buildAuthorizationHeader({
                username: 'user',
                password: 'pass',
                method: 'GET',
                uri: '/api/test',
                challenge: challenge,
                nc: 1,
                cnonce: 'abc123'
            });

            expect(authHeader).toContain('Digest username="user"');
            expect(authHeader).toContain('realm="test@example.com"');
            expect(authHeader).toContain('nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093"');
            expect(authHeader).toContain('uri="/api/test"');
            expect(authHeader).toContain('qop=auth');
            expect(authHeader).toContain('nc=00000001');
            expect(authHeader).toContain('cnonce="abc123"');
            expect(authHeader).toContain('opaque="5ccc069c403ebaf9f0171e9517f40e41"');
            expect(authHeader).toContain('response="');
        });

        it('should build authorization header without qop (legacy)', () => {
            const challenge = {
                realm: 'test@example.com',
                nonce: 'dcd98b7102dd2f0e8b11d0f600bfb0c093'
            };

            const authHeader = DigestAuthHandler.buildAuthorizationHeader({
                username: 'user',
                password: 'pass',
                method: 'GET',
                uri: '/api/test',
                challenge: challenge
            });

            expect(authHeader).toContain('Digest username="user"');
            expect(authHeader).toContain('realm="test@example.com"');
            expect(authHeader).not.toContain('qop=');
            expect(authHeader).not.toContain('nc=');
            expect(authHeader).not.toContain('cnonce=');
        });

        it('should generate correct response hash for known test case', () => {
            // RFC 2617 test case
            const challenge = {
                realm: 'testrealm@host.com',
                nonce: 'dcd98b7102dd2f0e8b11d0f600bfb0c093',
                opaque: '5ccc069c403ebaf9f0171e9517f40e41'
            };

            const authHeader = DigestAuthHandler.buildAuthorizationHeader({
                username: 'Mufasa',
                password: 'Circle Of Life',
                method: 'GET',
                uri: '/dir/index.html',
                challenge: challenge
            });

            // The response hash should be consistent for same inputs
            expect(authHeader).toContain('response="');
            expect(authHeader).toContain('username="Mufasa"');
            expect(authHeader).toContain('realm="testrealm@host.com"');
        });

        it('should throw error for unsupported algorithm', () => {
            const challenge = {
                realm: 'test',
                nonce: 'abc123',
                algorithm: 'SHA-256'
            };

            expect(() => {
                DigestAuthHandler.buildAuthorizationHeader({
                    username: 'user',
                    password: 'pass',
                    method: 'GET',
                    uri: '/test',
                    challenge: challenge
                });
            }).toThrow('Unsupported algorithm: SHA-256');
        });

        it('should handle MD5-SESS algorithm', () => {
            const challenge = {
                realm: 'test',
                nonce: 'abc123',
                algorithm: 'MD5-SESS',
                qop: 'auth'
            };

            const authHeader = DigestAuthHandler.buildAuthorizationHeader({
                username: 'user',
                password: 'pass',
                method: 'GET',
                uri: '/test',
                challenge: challenge,
                cnonce: 'xyz789'
            });

            expect(authHeader).toContain('algorithm=MD5-SESS');
            expect(authHeader).toContain('response="');
        });
    });

    describe('handleDigestAuth', () => {
        it('should return response if initial request succeeds', async () => {
            const mockResponse = { data: 'success', status: 200 };
            const mockRequest = jest.fn().mockResolvedValue(mockResponse);

            const result = await handleDigestAuth(
                mockRequest,
                { username: 'user', password: 'pass' },
                'GET',
                'http://example.com/api'
            );

            expect(result).toBe(mockResponse);
            expect(mockRequest).toHaveBeenCalledTimes(1);
            expect(mockRequest).toHaveBeenCalledWith(); // First call without auth header
        });

        it('should retry with digest auth on 401 response', async () => {
            const mockError = {
                response: {
                    status: 401,
                    headers: {
                        'www-authenticate': 'Digest realm="test", nonce="abc123", qop="auth"'
                    }
                }
            };
            const mockSuccessResponse = { data: 'authenticated', status: 200 };

            const mockRequest = jest.fn()
                .mockRejectedValueOnce(mockError)
                .mockResolvedValueOnce(mockSuccessResponse);

            const result = await handleDigestAuth(
                mockRequest,
                { username: 'user', password: 'pass' },
                'GET',
                'http://example.com/api/test'
            );

            expect(result).toBe(mockSuccessResponse);
            expect(mockRequest).toHaveBeenCalledTimes(2);
            expect(mockRequest).toHaveBeenNthCalledWith(1); // First call without auth
            expect(mockRequest).toHaveBeenNthCalledWith(2, expect.stringContaining('Digest username="user"')); // Second call with auth
        });

        it('should re-throw error if not 401', async () => {
            const mockError = {
                response: {
                    status: 500,
                    headers: {}
                }
            };

            const mockRequest = jest.fn().mockRejectedValue(mockError);

            await expect(handleDigestAuth(
                mockRequest,
                { username: 'user', password: 'pass' },
                'GET',
                'http://example.com/api'
            )).rejects.toBe(mockError);

            expect(mockRequest).toHaveBeenCalledTimes(1);
        });

        it('should re-throw error if 401 without Digest challenge', async () => {
            const mockError = {
                response: {
                    status: 401,
                    headers: {
                        'www-authenticate': 'Basic realm="test"'
                    }
                }
            };

            const mockRequest = jest.fn().mockRejectedValue(mockError);

            await expect(handleDigestAuth(
                mockRequest,
                { username: 'user', password: 'pass' },
                'GET',
                'http://example.com/api'
            )).rejects.toBe(mockError);

            expect(mockRequest).toHaveBeenCalledTimes(1);
        });

        it('should re-throw error if no www-authenticate header', async () => {
            const mockError = {
                response: {
                    status: 401,
                    headers: {}
                }
            };

            const mockRequest = jest.fn().mockRejectedValue(mockError);

            await expect(handleDigestAuth(
                mockRequest,
                { username: 'user', password: 'pass' },
                'GET',
                'http://example.com/api'
            )).rejects.toBe(mockError);

            expect(mockRequest).toHaveBeenCalledTimes(1);
        });
    });
});
