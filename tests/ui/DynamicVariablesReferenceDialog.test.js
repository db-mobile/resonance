/* global document */
import { renderDynamicVariableRows } from '../../src/modules/ui/DynamicVariablesReferenceDialog.js';
import { DYNAMIC_VARIABLES } from '../../src/modules/variables/dynamicVariables.js';

describe('renderDynamicVariableRows', () => {
    test('renders one code/description pair per catalogue entry under its group heading', () => {
        const grid = document.createElement('div');
        grid.innerHTML = '<span>stale</span>';

        renderDynamicVariableRows(grid);

        const groups = [...grid.querySelectorAll('.var-reference-group')].map((el) => el.textContent);
        expect(groups).toEqual(['Time & dates', 'Numbers & IDs', 'Sample data']);
        expect(grid.querySelectorAll('code')).toHaveLength(DYNAMIC_VARIABLES.length);
        expect(grid.querySelector('code').textContent).toBe('{{$timestamp}}');
        expect(grid.querySelector('code + span').textContent).toBe('Unix timestamp, seconds');
        expect(grid.textContent).not.toContain('stale');
    });
});
