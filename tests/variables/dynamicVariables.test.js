import { DYNAMIC_VARIABLES, DYNAMIC_VARIABLE_GROUPS, getDynamicVariable } from '../../src/modules/variables/dynamicVariables.js';
import { DynamicVariableGenerator } from '../../src/modules/variables/DynamicVariableGenerator.js';

describe('dynamicVariables catalogue', () => {
    test('lists exactly the names the generator can produce', () => {
        const generatorNames = Object.keys(new DynamicVariableGenerator().generators).sort();
        const catalogueNames = DYNAMIC_VARIABLES.map((info) => info.name).sort();
        expect(catalogueNames).toEqual(generatorNames);
    });

    test('every entry has an example token for its own name, a known group and a description', () => {
        for (const info of DYNAMIC_VARIABLES) {
            expect(info.example.startsWith(`{{$${info.name}`)).toBe(true);
            expect(info.example.endsWith('}}')).toBe(true);
            expect(Object.keys(DYNAMIC_VARIABLE_GROUPS)).toContain(info.group);
            expect(info.description.length).toBeGreaterThan(0);
            expect(info.descriptionKey).toBe(`variables.dynamic.${info.name}`);
        }
    });

    test('getDynamicVariable finds entries by bare name and returns null otherwise', () => {
        expect(getDynamicVariable('uuid')).toMatchObject({ name: 'uuid', group: 'number' });
        expect(getDynamicVariable('$uuid')).toBeNull();
        expect(getDynamicVariable('nope')).toBeNull();
    });

    test('catalogue is frozen', () => {
        expect(Object.isFrozen(DYNAMIC_VARIABLES)).toBe(true);
        expect(Object.isFrozen(DYNAMIC_VARIABLES[0])).toBe(true);
    });
});
