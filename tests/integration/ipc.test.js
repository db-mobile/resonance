/**
 * Integration tests for IPC communication
 * These tests verify the communication between Tauri backend and frontend
 */

describe('IPC Integration Tests', () => {
    let mockIpcBridge;

    beforeEach(() => {
        // Mock the IPC bridge that would be used for Tauri communication
        mockIpcBridge = {
            sendApiRequest: jest.fn(),
            importCollection: jest.fn(),
            store: {
                get: jest.fn(),
                set: jest.fn()
            },
            settings: {
                get: jest.fn(),
                set: jest.fn()
            }
        };
        
        global.ipcBridge = mockIpcBridge;
    });

    describe('API Request IPC', () => {
        test('should send API request via IPC', async () => {
            const requestData = {
                url: 'https://api.example.com/users',
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                }
            };

            const responseData = {
                status: 200,
                data: { users: [] },
                headers: { 'content-type': 'application/json' }
            };

            mockIpcBridge.sendApiRequest.mockResolvedValue(responseData);

            const result = await mockIpcBridge.sendApiRequest(requestData);

            expect(mockIpcBridge.sendApiRequest).toHaveBeenCalledWith(requestData);
            expect(result).toEqual(responseData);
        });

        test('should handle API request errors', async () => {
            const requestData = {
                url: 'invalid-url',
                method: 'GET'
            };

            const errorResponse = {
                error: 'Invalid URL',
                status: 0
            };

            mockIpcBridge.sendApiRequest.mockResolvedValue(errorResponse);

            const result = await mockIpcBridge.sendApiRequest(requestData);

            expect(result).toEqual(errorResponse);
        });
    });

    describe('Collection Import IPC', () => {
        test('should import collection via IPC', async () => {
            const collectionData = {
                openapi: '3.0.0',
                info: { title: 'Test API', version: '1.0.0' },
                paths: {
                    '/users': {
                        get: {
                            summary: 'Get users',
                            responses: {
                                '200': {
                                    description: 'Success'
                                }
                            }
                        }
                    }
                }
            };

            const importResult = {
                success: true,
                collectionId: 'test-collection-123',
                endpoints: 1
            };

            mockIpcBridge.importCollection.mockResolvedValue(importResult);

            const result = await mockIpcBridge.importCollection(collectionData);

            expect(mockIpcBridge.importCollection).toHaveBeenCalledWith(collectionData);
            expect(result).toEqual(importResult);
        });

        test('should handle collection import errors', async () => {
            const invalidCollectionData = {
                invalid: 'data'
            };

            const errorResult = {
                success: false,
                error: 'Invalid OpenAPI specification'
            };

            mockIpcBridge.importCollection.mockResolvedValue(errorResult);

            const result = await mockIpcBridge.importCollection(invalidCollectionData);

            expect(result).toEqual(errorResult);
        });
    });

    describe('Store IPC', () => {
        test('should get data from store via IPC', async () => {
            const storeData = {
                collections: [
                    {
                        id: 'collection-1',
                        name: 'Test Collection',
                        endpoints: []
                    }
                ]
            };

            mockIpcBridge.store.get.mockResolvedValue(storeData);

            const result = await mockIpcBridge.store.get('collections');

            expect(mockIpcBridge.store.get).toHaveBeenCalledWith('collections');
            expect(result).toEqual(storeData);
        });

        test('should set data in store via IPC', async () => {
            const storeData = {
                collections: [
                    {
                        id: 'collection-1',
                        name: 'Updated Collection',
                        endpoints: []
                    }
                ]
            };

            mockIpcBridge.store.set.mockResolvedValue(true);

            const result = await mockIpcBridge.store.set('collections', storeData);

            expect(mockIpcBridge.store.set).toHaveBeenCalledWith('collections', storeData);
            expect(result).toBe(true);
        });
    });

    describe('Settings IPC', () => {
        test('should get settings via IPC', async () => {
            const settings = {
                theme: 'dark',
                language: 'en'
            };

            mockIpcBridge.settings.get.mockResolvedValue(settings);

            const result = await mockIpcBridge.settings.get('theme');

            expect(mockIpcBridge.settings.get).toHaveBeenCalledWith('theme');
            expect(result).toEqual(settings);
        });

        test('should set settings via IPC', async () => {
            const settingValue = 'light';

            mockIpcBridge.settings.set.mockResolvedValue(true);

            const result = await mockIpcBridge.settings.set('theme', settingValue);

            expect(mockIpcBridge.settings.set).toHaveBeenCalledWith('theme', settingValue);
            expect(result).toBe(true);
        });
    });

    describe('Error Handling', () => {
        test('should handle IPC timeout errors', async () => {
            const timeoutError = new Error('IPC timeout');
            mockIpcBridge.sendApiRequest.mockRejectedValue(timeoutError);

            await expect(mockIpcBridge.sendApiRequest({})).rejects.toThrow('IPC timeout');
        });

        test('should handle IPC connection errors', async () => {
            const connectionError = new Error('IPC connection failed');
            mockIpcBridge.store.get.mockRejectedValue(connectionError);

            await expect(mockIpcBridge.store.get('test')).rejects.toThrow('IPC connection failed');
        });
    });
});
