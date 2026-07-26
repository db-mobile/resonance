/* global document, window */
import {
    suggestedFileName,
    textToBase64,
    setResponseMeta,
    getResponseMeta,
    clearResponseMeta,
    resolveSavePayload,
    handleSaveResponse
} from '../src/modules/responseSaver.js';
import { app } from '../src/modules/appContext.js';

describe('responseSaver.suggestedFileName', () => {
    it('keeps an existing extension on the URL segment', () => {
        expect(suggestedFileName('https://x.test/files/report.pdf', 'application/octet-stream')).toBe('report.pdf');
    });

    it('infers the extension from the content type', () => {
        expect(suggestedFileName('https://x.test/download', 'image/png')).toBe('download.png');
        expect(suggestedFileName('https://x.test/data', 'application/json; charset=utf-8')).toBe('data.json');
    });

    it('falls back to .txt for unknown text types and .bin otherwise', () => {
        expect(suggestedFileName('https://x.test/a', 'text/markdown')).toBe('a.txt');
        expect(suggestedFileName('https://x.test/a', 'application/unknown')).toBe('a.bin');
    });

    it('defaults the base name for a root path or unparseable URL', () => {
        expect(suggestedFileName('https://x.test/', 'application/json')).toBe('response.json');
        expect(suggestedFileName('not a url', 'image/png')).toBe('response.png');
    });
});

describe('responseSaver.textToBase64', () => {
    it('round-trips UTF-8 text through base64', () => {
        const text = 'héllo, wörld — 日本語 {"k":"v"}';
        const decoded = new TextDecoder().decode(
            Uint8Array.from(atob(textToBase64(text)), (c) => c.charCodeAt(0))
        );
        expect(decoded).toBe(text);
    });
});

describe('responseSaver metadata + save', () => {
    const TAB = 'tab-1';

    beforeEach(() => {
        clearResponseMeta(TAB);
        app.responseContainerManager = null;
        window.backendAPI = { saveResponseBody: jest.fn().mockResolvedValue({ success: true }) };
    });

    it('stores and reads response metadata', () => {
        setResponseMeta(TAB, { isBinary: true, base64: 'QUJD', suggestedName: 'x.bin' });
        expect(getResponseMeta(TAB)).toEqual({ isBinary: true, base64: 'QUJD', suggestedName: 'x.bin' });
    });

    it('resolves a binary payload from stored base64', () => {
        setResponseMeta(TAB, { isBinary: true, base64: 'QUJD', suggestedName: 'x.bin' });
        expect(resolveSavePayload(TAB)).toEqual({ base64: 'QUJD', defaultName: 'x.bin' });
    });

    it('returns null for a binary response with no stored bytes', () => {
        setResponseMeta(TAB, { isBinary: true, base64: null, suggestedName: 'x.bin' });
        expect(resolveSavePayload(TAB)).toBeNull();
    });

    it('encodes the editor text for a non-binary response', () => {
        setResponseMeta(TAB, { isBinary: false, suggestedName: 'data.json' });
        app.responseContainerManager = {
            getOrCreateContainer: () => ({ editor: { getContent: () => '{"a":1}' } })
        };

        const payload = resolveSavePayload(TAB);
        expect(payload.defaultName).toBe('data.json');
        expect(payload.base64).toBe(textToBase64('{"a":1}'));
    });

    it('returns null when the text response body is empty', () => {
        setResponseMeta(TAB, { isBinary: false, suggestedName: 'data.json' });
        app.responseContainerManager = {
            getOrCreateContainer: () => ({ editor: { getContent: () => '   ' } })
        };
        expect(resolveSavePayload(TAB)).toBeNull();
    });

    it('calls the backend save command with the resolved payload', async () => {
        setResponseMeta(TAB, { isBinary: true, base64: 'QUJD', suggestedName: 'file.bin' });
        const button = document.createElement('button');

        await handleSaveResponse(button, TAB);

        expect(window.backendAPI.saveResponseBody).toHaveBeenCalledWith('file.bin', 'QUJD');
    });

    it('does not call the backend when there is nothing to save', async () => {
        const button = document.createElement('button');
        await handleSaveResponse(button, TAB);
        expect(window.backendAPI.saveResponseBody).not.toHaveBeenCalled();
    });
});
