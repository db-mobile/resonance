import { SchemaValidator } from '../../src/modules/schema/SchemaValidator.js';

// Constraint semantics (including the former exclusive-bound/number regressions)
// now run against the actual engine in commands/schema_tests.rs.
describe('SchemaValidator native adapter', () => {
    test('passes the original schema and response to the backend asynchronously', async () => {
        const schema = { const: 'expected' };
        const result = { valid: false, schemaValid: true, errors: [{ path: '/', keyword: 'const', message: 'Mismatch' }] };
        const backend = { schema: { validate: jest.fn().mockResolvedValue(result) } };
        const validator = new SchemaValidator(backend);

        await expect(validator.validate('wrong', schema)).resolves.toEqual(result);
        expect(backend.schema.validate).toHaveBeenCalledWith(schema, 'wrong');
    });

    test.each([true, false, {}])('checks the actual schema %j', async (schema) => {
        const backend = { schema: { check: jest.fn().mockResolvedValue({ valid: true, errors: [] }) } };

        await expect(new SchemaValidator(backend).check(schema)).resolves.toMatchObject({ valid: true });
        expect(backend.schema.check).toHaveBeenCalledWith(schema);
    });

    test.each(['check', 'validate'])('%s reports an unavailable engine as an error', async (method) => {
        const validator = new SchemaValidator({});

        await expect(validator[method]({})).resolves.toMatchObject({
            valid: false, schemaValid: false, errors: [{ keyword: 'backend' }]
        });
    });

    test('preserves backend error details', async () => {
        const validator = new SchemaValidator({ schema: { check: jest.fn().mockRejectedValue('Unavailable') } });

        await expect(validator.check({})).resolves.toMatchObject({
            valid: false, errors: [{ path: '/', keyword: 'backend', message: 'Unavailable' }]
        });
    });

    test.each([[false, 'boolean'], [0, 'integer'], [null, 'null']])('keeps local inference for %j', (value, type) => {
        expect(new SchemaValidator({}).inferSchema(value)).toEqual({ type });
    });
});
