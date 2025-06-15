const urlInput = document.getElementById('url-input');
const methodSelect = document.getElementById('method-select');
const headersInput = document.getElementById('headers-input');
const bodyInput = document.getElementById('body-input');
const sendRequestBtn = document.getElementById('send-request-btn');
const responseDisplay = document.getElementById('response-display');
const statusDisplay = document.getElementById('status-display');

sendRequestBtn.addEventListener('click', async () => {
    const url = urlInput.value;
    const method = methodSelect.value;
    let headers = {};
    let body = undefined;

    try {
        if (headersInput.value) {
            headers = JSON.parse(headersInput.value);
        }
    } catch (e) {
        alert('Invalid Headers JSON');
        return;
    }

    if (['POST', 'PUT', 'PATCH'].includes(method) && bodyInput.value) {
        try {
            body = JSON.parse(bodyInput.value);
        } catch (e) {
            alert('Invalid Body JSON');
            return;
        }
    }

    try {
        const response = await window.electronAPI.sendApiRequest({
            method,
            url,
            headers,
            body
        });
        responseDisplay.textContent = JSON.stringify(response.data, null, 2);
        statusDisplay.textContent = `Status: ${response.status} ${response.statusText}`;
    } catch (error) {
        responseDisplay.textContent = `Error: ${error.message}`;
        statusDisplay.textContent = `Status: ${error.status || 'N/A'}`;
        console.error('API Error:', error);
    }
});