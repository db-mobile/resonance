import { extractCookies } from '../src/modules/cookieParser.js';

describe('cookieParser value parsing', () => {
    test('keeps cookie values containing = intact', () => {
        const cookies = extractCookies({ 'set-cookie': 'sid=abc123==; Path=/' });

        expect(cookies).toHaveLength(1);
        expect(cookies[0].name).toBe('sid');
        expect(cookies[0].value).toBe('abc123==');
        expect(cookies[0].path).toBe('/');
    });

    test('keeps attribute values containing = intact', () => {
        const cookies = extractCookies({
            'set-cookie': 'token=jwt.x=y; Expires=Wed, 09 Jun 2021 10:18:14 GMT; Path=/a=b'
        });

        expect(cookies[0].value).toBe('jwt.x=y');
        expect(cookies[0].expires).toBe('Wed, 09 Jun 2021 10:18:14 GMT');
        expect(cookies[0].path).toBe('/a=b');
    });

    test('still parses flag attributes and multiple cookies', () => {
        const cookies = extractCookies({
            'Set-Cookie': ['a=1; HttpOnly; Secure', 'b=2; SameSite']
        });

        expect(cookies).toHaveLength(2);
        expect(cookies[0]).toMatchObject({ name: 'a', value: '1', httpOnly: true, secure: true });
        expect(cookies[1]).toMatchObject({ name: 'b', value: '2', sameSite: 'None' });
    });
});
