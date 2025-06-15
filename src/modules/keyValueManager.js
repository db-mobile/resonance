import { headersList, addHeaderBtn, queryParamsList, addQueryParamBtn } from './domElements.js';

export function createKeyValueRow(key = '', value = '') {
    const row = document.createElement('div');
    row.classList.add('key-value-row');

    const keyInput = document.createElement('input');
    keyInput.type = 'text';
    keyInput.classList.add('key-input');
    keyInput.placeholder = 'Key';
    keyInput.value = key;

    const valueInput = document.createElement('input');
    valueInput.type = 'text';
    valueInput.classList.add('value-input');
    valueInput.placeholder = 'Value';
    valueInput.value = value;

    const removeButton = document.createElement('button');
    removeButton.classList.add('remove-row-btn');
    removeButton.textContent = 'Remove';
    // Event listener for remove button will be handled in renderer.js for simplicity

    row.appendChild(keyInput);
    row.appendChild(valueInput);
    row.appendChild(removeButton);

    return row;
}

export function addKeyValueRow(listContainer, key = '', value = '') {
    const newRow = createKeyValueRow(key, value);
    listContainer.appendChild(newRow);
}

export function parseKeyValuePairs(listContainer) {
    const result = {};
    const rows = listContainer.querySelectorAll('.key-value-row');
    rows.forEach(row => {
        const keyInput = row.querySelector('.key-input');
        const valueInput = row.querySelector('.value-input');
        const key = keyInput.value.trim();
        const value = valueInput.value.trim();

        if (key) {
            result[key] = value;
        }
    });
    return result;
}

export function initKeyValueListeners() {
    addHeaderBtn.addEventListener('click', () => addKeyValueRow(headersList));
    addQueryParamBtn.addEventListener('click', () => addKeyValueRow(queryParamsList));

    document.addEventListener('click', (event) => {
        if (event.target.classList.contains('remove-row-btn')) {
            event.target.closest('.key-value-row').remove();
        }
    });
}