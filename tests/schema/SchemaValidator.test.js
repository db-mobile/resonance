import { SchemaValidator } from '../../src/modules/schema/SchemaValidator.js';

describe('SchemaValidator exclusive bounds', () => {
    const validator = new SchemaValidator();

    test('JSON Schema numeric exclusiveMinimum and exclusiveMaximum', () => {
        const schema = { type: 'number', exclusiveMinimum: 0, exclusiveMaximum: 10 };

        expect(validator.validate(5, schema).valid).toBe(true);
        expect(validator.validate(0, schema).errors.map(e => e.keyword)).toEqual(['exclusiveMinimum']);
        expect(validator.validate(10, schema).errors.map(e => e.keyword)).toEqual(['exclusiveMaximum']);
    });

    test('OpenAPI 3.0 boolean exclusiveMinimum makes minimum exclusive', () => {
        const schema = { type: 'number', minimum: 0, exclusiveMinimum: true };

        expect(validator.validate(1, schema).valid).toBe(true);
        expect(validator.validate(0, schema).errors.map(e => e.keyword)).toEqual(['exclusiveMinimum']);
    });

    test('OpenAPI 3.0 boolean exclusiveMaximum makes maximum exclusive', () => {
        const schema = { type: 'number', maximum: 10, exclusiveMaximum: true };

        expect(validator.validate(9, schema).valid).toBe(true);
        expect(validator.validate(10, schema).errors.map(e => e.keyword)).toEqual(['exclusiveMaximum']);
    });

    test('OpenAPI 3.0 exclusiveMinimum false keeps minimum inclusive', () => {
        const schema = { type: 'number', minimum: 0, exclusiveMinimum: false };

        expect(validator.validate(0, schema).valid).toBe(true);
        expect(validator.validate(-1, schema).errors.map(e => e.keyword)).toEqual(['minimum']);
    });
});

describe('SchemaValidator number type', () => {
    const validator = new SchemaValidator();

    test('an integer satisfies type number', () => {
        expect(validator.validate(5, { type: 'number' }).valid).toBe(true);
    });

    test('a fraction does not satisfy type integer', () => {
        expect(validator.validate(1.5, { type: 'integer' }).errors.map(e => e.keyword)).toEqual(['type']);
    });
});
