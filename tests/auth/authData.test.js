import { generateAuthData } from '../../src/modules/auth/authData.js';

const EMPTY = { headers: {}, queryParams: {}, authConfig: null };

describe('generateAuthData per auth type', () => {
    test.each([
        ['none', {}, EMPTY],
        ['bearer', { token: 't' }, { ...EMPTY, headers: { Authorization: 'Bearer t' } }],
        ['bearer', {}, EMPTY],
        ['basic', { username: 'u', password: 'p' }, { ...EMPTY, headers: { Authorization: `Basic ${Buffer.from('u:p').toString('base64')}` } }],
        ['basic', { username: 'u' }, { ...EMPTY, headers: { Authorization: `Basic ${Buffer.from('u:').toString('base64')}` } }],
        ['api-key', { keyName: 'X', keyValue: 'v', location: 'header' }, { ...EMPTY, headers: { X: 'v' } }],
        ['api-key', { keyName: 'k', keyValue: 'v', location: 'query' }, { ...EMPTY, queryParams: { k: 'v' } }],
        ['api-key', { keyName: 'k', keyValue: 'v', location: 'cookie' }, EMPTY],
        ['api-key', { keyName: 'k', location: 'header' }, EMPTY],
        ['oauth2', { token: 't' }, { ...EMPTY, headers: { Authorization: 'Bearer t' } }],
        ['oauth2', { token: 't', headerPrefix: 'Token' }, { ...EMPTY, headers: { Authorization: 'Token t' } }],
        ['digest', { username: 'u', password: 'p' }, { ...EMPTY, authConfig: { username: 'u', password: 'p' } }],
        ['digest', { username: 'u' }, { ...EMPTY, authConfig: { username: 'u', password: '' } }],
        ['ntlm', { username: 'u', password: 'p' }, { ...EMPTY, ntlmAuth: { username: 'u', password: 'p', domain: '', workstation: '' } }],
        ['ntlm', { username: 'u', password: 'p', domain: 'D', workstation: 'W' }, { ...EMPTY, ntlmAuth: { username: 'u', password: 'p', domain: 'D', workstation: 'W' } }],
        ['aws-v4', { accessKeyId: 'a', secretAccessKey: 's' }, { ...EMPTY, awsAuth: { accessKeyId: 'a', secretAccessKey: 's', region: 'us-east-1', service: '', sessionToken: null } }],
        ['aws-v4', { accessKeyId: 'a' }, EMPTY],
        ['inherit', {}, EMPTY],
        ['carrier-pigeon', { token: 't' }, EMPTY]
    ])('%s with %j', (type, config, expected) => {
        expect(generateAuthData({ type, config })).toEqual(expected);
    });

    test('a missing auth config yields empty auth data', () => {
        expect(generateAuthData(null)).toEqual(EMPTY);
        expect(generateAuthData(undefined)).toEqual(EMPTY);
        expect(generateAuthData({ type: 'bearer' })).toEqual(EMPTY);
    });
});
