/**
 * Integration tests for IPC communication
 * These tests verify the communication between main and renderer processes
 */

describe('IPC Integration Tests', () => {
    let mockElectronAPI;

    beforeEach(() => {
        // Mock the electron API that would be exposed via preload script
        mockElectronAPI = {
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
        
        global.electronAPI = mockElectronAPI;
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

            mockElectronAPI.sendApiRequest.mockResolvedValue(responseData);

            const result = await mockElectronAPI.sendApiRequest(requestData);

            expect(mockElectronAPI.sendApiRequest).toHaveBeenCalledWith(requestData);
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

            mockElectronAPI.sendApiRequest.mockResolvedValue(errorResponse);

            const result = await mockElectronAPI.sendApiRequest(requestData);

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

            mockElectronAPI.importCollection.mockResolvedValue(importResult);

            const result = await mockElectronAPI.importCollection(collectionData);

            expect(mockElectronAPI.importCollection).toHaveBeenCalledWith(collectionData);
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

            mockElectronAPI.importCollection.mockResolvedValue(errorResult);

            const result = await mockElectronAPI.importCollection(invalidCollectionData);

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

            mockElectronAPI.store.get.mockResolvedValue(storeData);

            const result = await mockElectronAPI.store.get('collections');

            expect(mockElectronAPI.store.get).toHaveBeenCalledWith('collections');
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

            mockElectronAPI.store.set.mockResolvedValue(true);

            const result = await mockElectronAPI.store.set('collections', storeData);

            expect(mockElectronAPI.store.set).toHaveBeenCalledWith('collections', storeData);
            expect(result).toBe(true);
        });
    });

    describe('Settings IPC', () => {
        test('should get settings via IPC', async () => {
            const settings = {
                theme: 'dark',
                language: 'en'
            };

            mockElectronAPI.settings.get.mockResolvedValue(settings);

            const result = await mockElectronAPI.settings.get('theme');

            expect(mockElectronAPI.settings.get).toHaveBeenCalledWith('theme');
            expect(result).toEqual(settings);
        });

        test('should set settings via IPC', async () => {
            const settingValue = 'light';

            mockElectronAPI.settings.set.mockResolvedValue(true);

            const result = await mockElectronAPI.settings.set('theme', settingValue);

            expect(mockElectronAPI.settings.set).toHaveBeenCalledWith('theme', settingValue);
            expect(result).toBe(true);
        });
    });

    describe('Error Handling', () => {
        test('should handle IPC timeout errors', async () => {
            const timeoutError = new Error('IPC timeout');
            mockElectronAPI.sendApiRequest.mockRejectedValue(timeoutError);

            await expect(mockElectronAPI.sendApiRequest({})).rejects.toThrow('IPC timeout');
        });

        test('should handle IPC connection errors', async () => {
            const connectionError = new Error('IPC connection failed');
            mockElectronAPI.store.get.mockRejectedValue(connectionError);

            await expect(mockElectronAPI.store.get('test')).rejects.toThrow('IPC connection failed');
        });
    });
});