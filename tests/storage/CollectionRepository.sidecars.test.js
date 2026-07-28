import { CollectionRepository } from '../../src/modules/storage/CollectionRepository.js';

/**
 * Characterization of the per-field endpoint sidecar accessors.
 *
 * Each field is read out of the endpoint data file with its own empty-value
 * default and written back through a single-field update, and each setter wraps
 * a write failure in its own message. Pinning all of it here so the generated
 * accessors have to reproduce it field for field.
 */
describe('CollectionRepository endpoint sidecar accessors', () => {
    let repository;
    let backendAPI;

    const CASES = [
        {
            field: 'modifiedBody',
            getter: 'getModifiedRequestBody',
            setter: 'saveModifiedRequestBody',
            empty: null,
            stored: '{"a":1}',
            label: 'Failed to save modified request body'
        },
        {
            field: 'formBodyData',
            getter: 'getFormBodyData',
            setter: 'saveFormBodyData',
            empty: null,
            stored: { rows: [] },
            label: 'Failed to save form body data'
        },
        {
            field: 'pathParams',
            getter: 'getPersistedPathParams',
            setter: 'savePersistedPathParams',
            empty: [],
            stored: [{ key: 'id', value: '7' }],
            label: 'Failed to save persisted path params'
        },
        {
            field: 'queryParams',
            getter: 'getPersistedQueryParams',
            setter: 'savePersistedQueryParams',
            empty: [],
            stored: [{ key: 'q', value: 'x' }],
            label: 'Failed to save persisted query params'
        },
        {
            field: 'headers',
            getter: 'getPersistedHeaders',
            setter: 'savePersistedHeaders',
            empty: [],
            stored: [{ key: 'Accept', value: '*/*' }],
            label: 'Failed to save persisted headers'
        },
        {
            field: 'url',
            getter: 'getPersistedUrl',
            setter: 'savePersistedUrl',
            empty: null,
            stored: 'https://api.example.com/v1',
            label: 'Failed to save persisted URL'
        },
        {
            field: 'graphqlData',
            getter: 'getGraphQLData',
            setter: 'saveGraphQLData',
            empty: null,
            stored: { query: '{ me }' },
            label: 'Failed to save GraphQL data'
        },
        {
            field: 'grpcData',
            getter: 'getGrpcData',
            setter: 'saveGrpcData',
            empty: null,
            stored: { fullMethod: '/pkg.Svc/M' },
            label: 'Failed to save gRPC data'
        },
        {
            field: 'mqttData',
            getter: 'getMqttData',
            setter: 'saveMqttData',
            empty: null,
            stored: { qos: 1 },
            label: 'Failed to save MQTT data'
        },
        {
            field: 'responseSchema',
            getter: 'getResponseSchema',
            setter: 'saveResponseSchema',
            empty: null,
            stored: { type: 'object' },
            label: 'Failed to save response schema'
        }
    ];

    beforeEach(() => {
        backendAPI = {
            collections: {
                getEndpointData: jest.fn().mockResolvedValue({}),
                saveEndpointData: jest.fn().mockResolvedValue(undefined)
            }
        };
        repository = new CollectionRepository(backendAPI);
    });

    describe.each(CASES)('$field', ({ field, getter, setter, empty, stored, label }) => {
        test('exposes both accessors', () => {
            expect(typeof repository[getter]).toBe('function');
            expect(typeof repository[setter]).toBe('function');
        });

        test('returns the stored value', async () => {
            backendAPI.collections.getEndpointData.mockResolvedValue({ [field]: stored });

            await expect(repository[getter]('c1', 'e1')).resolves.toEqual(stored);
            expect(backendAPI.collections.getEndpointData).toHaveBeenCalledWith('c1', 'e1');
        });

        test('returns the empty default when the field is absent', async () => {
            backendAPI.collections.getEndpointData.mockResolvedValue({});

            await expect(repository[getter]('c1', 'e1')).resolves.toEqual(empty);
        });

        test('returns the empty default when the read fails', async () => {
            backendAPI.collections.getEndpointData.mockRejectedValue(new Error('unreadable'));

            await expect(repository[getter]('c1', 'e1')).resolves.toEqual(empty);
        });

        test('writes the field without disturbing its siblings', async () => {
            backendAPI.collections.getEndpointData.mockResolvedValue({ untouched: 'keep' });

            await repository[setter]('c1', 'e1', stored);

            expect(backendAPI.collections.saveEndpointData).toHaveBeenCalledWith('c1', 'e1', {
                untouched: 'keep',
                [field]: stored
            });
        });

        test('wraps a write failure in its own message', async () => {
            backendAPI.collections.saveEndpointData.mockRejectedValue(new Error('disk full'));

            await expect(repository[setter]('c1', 'e1', stored)).rejects.toThrow(
                `${label}: disk full`
            );
        });
    });
});
