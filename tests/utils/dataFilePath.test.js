import { isAbsolutePath, toCollectionRelativePath } from '../../src/modules/utils/dataFilePath.js';

describe('dataFilePath', () => {
    test('a file inside the collection becomes a portable relative path', () => {
        expect(toCollectionRelativePath('/home/me/petstore/data/users.csv', '/home/me/petstore'))
            .toEqual({ path: 'data/users.csv', portable: true });
        expect(toCollectionRelativePath('/home/me/petstore/data/users.csv', '/home/me/petstore/'))
            .toEqual({ path: 'data/users.csv', portable: true });
    });

    test('a sibling directory sharing the prefix is not inside the collection', () => {
        expect(toCollectionRelativePath('/home/me/petstore2/users.csv', '/home/me/petstore'))
            .toEqual({ path: '/home/me/petstore2/users.csv', portable: false });
    });

    test('windows paths compare case-insensitively and use forward slashes when relative', () => {
        expect(toCollectionRelativePath('C:\\Work\\Petstore\\data\\users.csv', 'c:\\work\\petstore'))
            .toEqual({ path: 'data/users.csv', portable: true });
        expect(toCollectionRelativePath('\\\\server\\share\\users.csv', 'C:\\work\\petstore'))
            .toEqual({ path: '\\\\server\\share\\users.csv', portable: false });
    });

    test('an already relative reference stays as it is and counts as portable', () => {
        expect(toCollectionRelativePath('data/users.csv', '/home/me/petstore')).toEqual({ path: 'data/users.csv', portable: true });
        expect(toCollectionRelativePath('/tmp/users.csv', null)).toEqual({ path: '/tmp/users.csv', portable: false });
    });

    test('isAbsolutePath recognises posix, drive and UNC roots', () => {
        expect(isAbsolutePath('/x')).toBe(true);
        expect(isAbsolutePath('D:/x')).toBe(true);
        expect(isAbsolutePath('\\\\srv\\x')).toBe(true);
        expect(isAbsolutePath('data/x.csv')).toBe(false);
        expect(isAbsolutePath('')).toBe(false);
    });
});
